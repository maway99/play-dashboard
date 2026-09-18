// Companion 5 API setup: edit only the requested buttons, never reimport a page.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { withCompanionApi } from './companion-api.mjs';

export async function configureRandomCueButtons(baseUrl = 'http://127.0.0.1:8000',
  requested = ['lasers', 'slow', 'main', 'strobing']) {
  const targets = [
    { id: 'lasers', column: 0, oldText: 'CLOSE', text: 'LASERS', variable: 'pgro_sd_random_laser_cue_press' },
    { id: 'slow', column: 1, oldText: 'OPEN', text: 'SLOW', variable: 'pgro_sd_random_slow_cue_press' },
    { id: 'main', column: 2, oldText: 'STROBE', text: 'MAIN CUE', variable: 'pgro_sd_random_main_cue_press' },
    { id: 'strobing', column: 3, oldText: 'RND STROBE', text: 'STROBING', variable: 'pgro_sd_random_strobe_cue_press' }
  ].filter(target => requested.includes(target.id)).map(target => ({ ...target,
    row: 3, heading: 'RANDOM', oldHeading: 'SHUTTERS', backgroundColor: 0x24539b }));
  if (!targets.length || requested.some(id => !targets.some(target => target.id === id))) {
    throw new Error('Unknown random-cue button selection');
  }
  return configureCompanionCueButtons(baseUrl, targets, 'random-cues');
}

export async function configureCompanionCueButtons(baseUrl, targets, backupTag = 'cue-buttons') {
  const base = new URL(baseUrl);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const backup = path.join(root, 'logs', `companion-page1-before-${backupTag}-${Date.now()}.json`);
  async function exportPage() {
    const res = await fetch(new URL('/int/export/page/1?format=json&includeSecrets=false', base),
      { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Page export failed: ${res.status}`);
    return res.json();
  }

  const before = await exportPage();
  if (!before.companionBuild.startsWith('5.')) throw new Error('This setup script requires Companion 5');
  for (const target of targets) {
    const button = before.page.controls?.[target.row]?.[target.column];
    const labels = button?.style?.layers?.filter(layer => layer.type === 'text').map(layer => layer.text.value);
    if (button?.type !== 'button-layered' ||
        !([target.oldHeading, target.oldText].every(label => labels.includes(label)) ||
          [target.text, target.heading].every(label => labels.includes(label)))) {
      throw new Error(`Unexpected button at page 1, row ${target.row}, column ${target.column}; no changes made`);
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

  await withCompanionApi(baseUrl, async ({ rpc, mutation }) => {
    const pages = await rpc('subscription', 'pages.watch');
    for (const target of targets) {
      const { variable } = target;
      const controlId = pages.pages[pages.order[0]].controls[target.row][target.column];
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
        [header.id, 'text', target.heading],
        [centre.id, 'text', target.text],
        [background.id, 'color', target.backgroundColor]
      ]) await mutation('controls.styles.updateOption', {
        controlId, elementId, key, value: { isExpression: false, value }
      });
    }

    const after = await exportPage();
    for (const target of targets) {
      const { header, centre, variable } = target;
      const edited = after.page.controls[target.row][target.column];
      assert.equal(edited.style.layers.find(layer => layer.id === header.id).text.value, target.heading);
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
      delete beforeOther[target.row][target.column];
      delete afterOther[target.row][target.column];
    }
    assert.deepEqual(afterOther, beforeOther, 'Another button changed during setup; inspect the saved backup');
    console.log(`Cue buttons configured: ${targets.map(target => target.text.replace(/\n/g, ' ')).join(', ')}. Other buttons unchanged.`);
  });
}

// Keep the original command scoped to Main; the new command configures the group.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await configureRandomCueButtons(process.argv[2], ['main']);
}
