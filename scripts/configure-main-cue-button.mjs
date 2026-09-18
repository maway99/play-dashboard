// Companion 5 API setup: edit only the requested buttons, never reimport a page.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

export async function configureRandomCueButtons(baseUrl = 'http://127.0.0.1:8000',
  requested = ['lasers', 'slow', 'main', 'strobing']) {
  const base = new URL(baseUrl);
  const targets = [
    { id: 'lasers', column: 0, oldText: 'CLOSE', text: 'LASERS', variable: 'pgro_sd_random_laser_cue_press' },
    { id: 'slow', column: 1, oldText: 'OPEN', text: 'SLOW', variable: 'pgro_sd_random_slow_cue_press' },
    { id: 'main', column: 2, oldText: 'STROBE', text: 'MAIN CUE', variable: 'pgro_sd_random_main_cue_press' },
    { id: 'strobing', column: 3, oldText: 'RND STROBE', text: 'STROBING', variable: 'pgro_sd_random_strobe_cue_press' }
  ].filter(target => requested.includes(target.id));
  if (!targets.length || requested.some(id => !targets.some(target => target.id === id))) {
    throw new Error('Unknown random-cue button selection');
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const backup = path.join(root, 'logs', `companion-page1-before-random-cues-${Date.now()}.json`);
  async function exportPage() {
    const res = await fetch(new URL('/int/export/page/1?format=json&includeSecrets=false', base),
      { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Page export failed: ${res.status}`);
    return res.json();
  }

  const before = await exportPage();
  if (!before.companionBuild.startsWith('5.')) throw new Error('This setup script requires Companion 5');
  for (const target of targets) {
    const button = before.page.controls?.[3]?.[target.column];
    const labels = button?.style?.layers?.filter(layer => layer.type === 'text').map(layer => layer.text.value);
    if (button?.type !== 'button-layered' ||
        !(['SHUTTERS', target.oldText].every(label => labels.includes(label)) ||
          [target.text, 'RANDOM'].every(label => labels.includes(label)))) {
      throw new Error(`Unexpected button at page 1, row 3, column ${target.column}; no changes made`);
    }
    // Validate every target before writing anything to Companion.
    if (Object.keys(button.steps).length !== 1 || !button.steps['0']) throw new Error('Unexpected button steps');
    const down = button.steps['0'].action_sets.down;
    if (button.steps['0'].action_sets.up.length || down.some(action =>
      action.connectionId !== 'internal' || action.definitionId !== 'custom_variable_set_value' ||
      action.options?.name?.value !== target.variable) || down.length > 1 ||
      button.steps['0'].options.runWhileHeld.length) {
      throw new Error('Unexpected button actions; no changes made');
    }
    target.button = button;
    target.header = button.style.layers.find(layer => layer.type === 'text' && layer.valign.value === 'top');
    target.centre = button.style.layers.find(layer => layer.type === 'text' && layer.valign.value === 'center');
    target.background = button.style.layers.find(layer => layer.type === 'box' && layer.height.value === 100);
    if (!target.header || !target.centre || !target.background) throw new Error('Unexpected button layers');
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
    for (const target of targets) {
      const { variable } = target;
      const controlId = pages.pages[pages.order[0]].controls[3][target.column];
      const variableResponse = await fetch(new URL(`/api/custom-variable/${variable}/value`, base),
        { signal: AbortSignal.timeout(10000) });
      if (variableResponse.status === 404) {
        await mutation('customVariables.create', { name: variable, defaultVal: '0' });
      } else if (!variableResponse.ok) {
        throw new Error(`Counter read failed: ${variableResponse.status}`);
      }
      const entityLocation = { stepId: '0', setId: 'down' };
      let entityId = target.button.steps['0'].action_sets.down[0]?.id;
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

      const { header, centre, background } = target;
      for (const [elementId, key, value] of [
        [header.id, 'text', 'RANDOM'],
        [centre.id, 'text', target.text],
        [background.id, 'color', 0x24539b]
      ]) await mutation('controls.styles.updateOption', {
        controlId, elementId, key, value: { isExpression: false, value }
      });
    }

    const after = await exportPage();
    for (const target of targets) {
      const { header, centre, variable } = target;
      const edited = after.page.controls[3][target.column];
      assert.equal(edited.style.layers.find(layer => layer.id === header.id).text.value, 'RANDOM');
      assert.equal(edited.style.layers.find(layer => layer.id === centre.id).text.value, target.text);
      assert.equal(edited.steps['0'].action_sets.down.length, 1);
      assert.deepEqual(edited.steps['0'].action_sets.down[0].options, {
        name: { isExpression: false, value: variable },
        create: { isExpression: false, value: true },
        value: { isExpression: true, value: `$(custom:${variable}) + 1` }
      });
      assert.equal(edited.steps['0'].action_sets.up.length, 0);
    }
    const beforeOther = structuredClone(before.page.controls);
    const afterOther = structuredClone(after.page.controls);
    for (const target of targets) {
      delete beforeOther[3][target.column];
      delete afterOther[3][target.column];
    }
    assert.deepEqual(afterOther, beforeOther, 'Another button changed during setup; inspect the saved backup');
    console.log(`Random-cue buttons configured: ${targets.map(target => target.text).join(', ')}. Other buttons unchanged.`);
  } finally {
    ws.close();
  }
}

// Keep the original command scoped to Main; the new command configures the group.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await configureRandomCueButtons(process.argv[2], ['main']);
}
