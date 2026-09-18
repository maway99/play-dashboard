// Companion 5 API setup: edit one existing button, never reimport a whole page.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:8000');
const variable = 'pgro_sd_random_main_cue_press';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backup = path.join(root, 'logs', `companion-page1-before-main-cue-${Date.now()}.json`);
async function exportPage() {
  const res = await fetch(new URL('/int/export/page/1?format=json&includeSecrets=false', base),
    { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Page export failed: ${res.status}`);
  return res.json();
}

const before = await exportPage();
if (!before.companionBuild.startsWith('5.')) throw new Error('This setup script requires Companion 5');
const target = before.page.controls?.[3]?.[2];
const labels = target?.style?.layers?.filter(layer => layer.type === 'text').map(layer => layer.text.value);
if (target?.type !== 'button-layered' ||
    !(['SHUTTERS', 'STROBE'].every(label => labels.includes(label)) ||
      ['MAIN CUE', 'RANDOM'].every(label => labels.includes(label)))) {
  throw new Error('Expected Shutters Strobe / Main Cue at page 1, row 3, column 2; no changes made');
}
// Refuse to overwrite newly added actions or alternate steps.
if (Object.keys(target.steps).length !== 1 || !target.steps['0']) throw new Error('Unexpected button steps');
const down = target.steps['0'].action_sets.down;
if (target.steps['0'].action_sets.up.length || down.some(action =>
  action.connectionId !== 'internal' || action.definitionId !== 'custom_variable_set_value' ||
  action.options?.name?.value !== variable) || down.length > 1) {
  throw new Error('Unexpected button actions; no changes made');
}
fs.mkdirSync(path.dirname(backup), { recursive: true });
fs.writeFileSync(backup, JSON.stringify(before, null, 2));
console.log(`Page backup: ${backup}`);

const wsUrl = new URL('/trpc', base);
wsUrl.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(wsUrl);
const pending = new Map();
let nextId = 1;
ws.on('message', raw => {
  const messages = JSON.parse(raw);
  for (const message of Array.isArray(messages) ? messages : [messages]) {
    const request = pending.get(message.id);
    if (!request) continue;
    if (message.error || message.result?.type === 'data') {
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (request.subscription) ws.send(JSON.stringify({ id: message.id, method: 'subscription.stop' }));
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result.data);
    }
  }
});
ws.on('error', error => {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(error);
  }
  pending.clear();
});
function rpc(method, rpcPath, input = null) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Companion API timeout: ${rpcPath}`));
    }, 10000);
    pending.set(id, { resolve, reject, timer, subscription: method === 'subscription' });
    ws.send(JSON.stringify({ id, method, params: { path: rpcPath, input } }));
  });
}
async function mutation(rpcPath, input) {
  const result = await rpc('mutation', rpcPath, input);
  if (result === false) throw new Error(`Companion rejected ${rpcPath}`);
  return result;
}

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Companion WebSocket connection timeout')), 10000);
    ws.once('open', () => { clearTimeout(timer); resolve(); });
    ws.once('error', error => { clearTimeout(timer); reject(error); });
  });
  const pages = await rpc('subscription', 'pages.watch');
  const controlId = pages.pages[pages.order[0]].controls[3][2];
  const variableResponse = await fetch(new URL(`/api/custom-variable/${variable}/value`, base),
    { signal: AbortSignal.timeout(10000) });
  if (variableResponse.status === 404) {
    await mutation('customVariables.create', { name: variable, defaultVal: '0' });
  } else if (!variableResponse.ok) {
    throw new Error(`Counter read failed: ${variableResponse.status}`);
  }
  const entityLocation = { stepId: '0', setId: 'down' };
  let entityId = down[0]?.id;
  if (!entityId) {
    entityId = await mutation('controls.entities.add', {
      controlId, entityLocation, ownerId: null, connectionId: 'internal',
      entityType: 'action', entityDefinition: 'custom_variable_set_value'
    });
    if (!entityId) throw new Error('Could not create press action');
  }
  for (const [key, value] of Object.entries({
    name: { isExpression: false, value: variable },
    create: { isExpression: false, value: true },
    value: { isExpression: true, value: `$(custom:${variable}) + 1` }
  })) await mutation('controls.entities.setOption', { controlId, entityLocation, entityId, key, value });

  const header = target.style.layers.find(layer => layer.type === 'text' && layer.valign.value === 'top');
  const centre = target.style.layers.find(layer => layer.type === 'text' && layer.valign.value === 'center');
  const background = target.style.layers.find(layer => layer.type === 'box' && layer.height.value === 100);
  for (const [elementId, key, value] of [
    [header.id, 'text', 'RANDOM'],
    [centre.id, 'text', 'MAIN CUE'],
    [background.id, 'color', 0x24539b]
  ]) await mutation('controls.styles.updateOption', {
    controlId, elementId, key, value: { isExpression: false, value }
  });

  const after = await exportPage();
  const edited = after.page.controls[3][2];
  assert.equal(edited.style.layers.find(layer => layer.id === header.id).text.value, 'RANDOM');
  assert.equal(edited.style.layers.find(layer => layer.id === centre.id).text.value, 'MAIN CUE');
  assert.equal(edited.steps['0'].action_sets.down.length, 1);
  assert.deepEqual(edited.steps['0'].action_sets.down[0].options, {
    name: { isExpression: false, value: variable },
    create: { isExpression: false, value: true },
    value: { isExpression: true, value: `$(custom:${variable}) + 1` }
  });
  assert.equal(edited.steps['0'].action_sets.up.length, 0);
  const beforeOther = structuredClone(before.page.controls);
  const afterOther = structuredClone(after.page.controls);
  delete beforeOther[3][2];
  delete afterOther[3][2];
  assert.deepEqual(afterOther, beforeOther, 'Another button changed during setup; inspect the saved backup');
  console.log('Main Cue configured at page 1 / row 3 / column 2. Other buttons unchanged.');
} finally {
  ws.close();
}
