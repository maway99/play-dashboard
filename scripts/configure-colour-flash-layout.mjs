import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { withCompanionApi } from './companion-api.mjs';
import { configureCompanionCueButtons } from './configure-main-cue-button.mjs';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8000';
const targets = [
  { column: 0, heading: 'COLOUR', text: 'RND\nCOL', variable: 'pgro_sd_random_colours_press', backgroundColor: 0x6b398d },
  { column: 1, heading: 'BEAMS', text: 'WHITE', variable: 'pgro_sd_beams_white_press', backgroundColor: 0xe8edf4, textColor: 0x111827 },
  { column: 2, heading: 'STROBES', text: 'RED', variable: 'pgro_sd_strobes_red_colour_press', backgroundColor: 0xa72a30 }
].map(target => ({ ...target, row: 1, oldHeading: target.heading, oldText: target.text }));
const changed = [[0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3]];
const location = (row, column) => ({ pageNumber: 1, row, column });
async function exportPage() {
  const response = await fetch(new URL('/int/export/page/1?format=json&includeSecrets=false', baseUrl),
    { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Page export failed: ${response.status}`);
  return response.json();
}
const buttonAt = (page, row, column) => page.page.controls?.[row]?.[column];
function hasCounters(button, press, release) {
  if (button?.type !== 'button-layered' || Object.keys(button.steps).length !== 1 || !button.steps[0]) return false;
  const step = button.steps[0];
  if (step.options.runWhileHeld.length) return false;
  return [['down', press], ['up', release]].every(([setId, variable]) => {
    const actions = step.action_sets[setId];
    if (!variable) return actions.length === 0;
    return actions.length === 1 && actions[0].connectionId === 'internal' &&
      actions[0].definitionId === 'custom_variable_set_value' && actions[0].options.name.value === variable;
  });
}
const flash = (button, chase = false) => hasCounters(button,
  chase ? 'pgro_sd_flash_white_chase_down' : 'pgro_sd_white_flash_down',
  chase ? 'pgro_sd_flash_white_chase_up' : 'pgro_sd_white_flash_up');
const before = await exportPage();
if (!before.companionBuild.startsWith('5.')) throw new Error('Companion 5 is required');
const oldLayout = flash(buttonAt(before, 1, 0)) && flash(buttonAt(before, 1, 1), true) &&
  hasCounters(buttonAt(before, 0, 2), 'pgro_sd_strobe_red_down', 'pgro_sd_strobe_red_up') &&
  hasCounters(buttonAt(before, 0, 3), 'pgro_sd_strobe_blue_down', 'pgro_sd_strobe_blue_up') &&
  hasCounters(buttonAt(before, 1, 2), 'pgro_sd_flash_red_down', 'pgro_sd_flash_red_up') &&
  hasCounters(buttonAt(before, 1, 3), 'pgro_sd_flash_blue_down', 'pgro_sd_flash_blue_up');
const newLayout = flash(buttonAt(before, 0, 2)) && flash(buttonAt(before, 0, 3), true) &&
  targets.every(target => hasCounters(buttonAt(before, 1, target.column), target.variable)) && !buttonAt(before, 1, 3);
if (!oldLayout && !newLayout) throw new Error('Unexpected flash/colour layout; no changes made');

for (const [row, column] of changed) {
  if (!buttonAt(before, row, column)) continue;
  const response = await fetch(new URL(`/api/variable/internal/b_active_1_${row}_${column}/value`, baseUrl),
    { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Cannot verify that affected buttons are released');
  if (['true', '1'].includes((await response.text()).trim())) throw new Error('Release affected keys before rearranging them');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backup = path.join(root, 'logs', `companion-page1-before-colour-flash-layout-${Date.now()}.json`);
fs.mkdirSync(path.dirname(backup), { recursive: true });
fs.writeFileSync(backup, JSON.stringify(before, null, 2));
console.log(`Page backup: ${backup}`);

if (oldLayout) await withCompanionApi(baseUrl, async ({ rpc, mutation }) => {
  // Move the actual controls intact, including both press and release counters.
  for (const column of [0, 1]) await mutation('controls.moveControl', {
    fromLocation: location(1, column), toLocation: location(0, column + 2)
  });
  for (const column of [2, 3]) await mutation('controls.resetControl', { location: location(1, column) });
  for (const target of targets) {
    await mutation('controls.resetControl', { location: location(1, target.column), newType: 'button-layered' });
    const pages = await rpc('subscription', 'pages.watch');
    const controlId = pages.pages[pages.order[0]].controls[1][target.column];
    const update = async (elementId, key, value) => mutation('controls.styles.updateOption', {
      controlId, elementId, key, value: { isExpression: false, value }
    });
    await update('canvas', 'decoration', 'border');
    await update('box0', 'color', target.backgroundColor);
    for (const [key, value] of Object.entries({ text: target.text, y: 10, fontsize: 20,
      color: target.textColor ?? 0xffffff })) await update('text0', key, value);
    const strip = await mutation('controls.styles.addElement', { controlId, type: 'box', afterElementId: null });
    for (const [key, value] of Object.entries({ color: 0, height: 25, borderWidth: 0 })) await update(strip, key, value);
    const header = await mutation('controls.styles.addElement', { controlId, type: 'text', afterElementId: null });
    for (const [key, value] of Object.entries({ text: target.heading, valign: 'top', fontsize: 20,
      color: 0xffffff, fontsizeAllowShrink: true })) await update(header, key, value);
  }
});
await configureCompanionCueButtons(baseUrl, targets, 'colour-buttons');
const after = await exportPage();
assert.deepEqual(buttonAt(after, 0, 2), buttonAt(before, oldLayout ? 1 : 0, oldLayout ? 0 : 2));
assert.deepEqual(buttonAt(after, 0, 3), buttonAt(before, oldLayout ? 1 : 0, oldLayout ? 1 : 3));
assert.equal(buttonAt(after, 1, 3), undefined);
const othersBefore = structuredClone(before.page.controls);
const othersAfter = structuredClone(after.page.controls);
for (const [row, column] of changed) {
  delete othersBefore[row][column];
  delete othersAfter[row][column];
}
assert.deepEqual(othersAfter, othersBefore, 'An unrelated button changed; inspect the saved backup');
console.log('White flashes moved intact; red/blue performance buttons removed; three colour controls configured.');
