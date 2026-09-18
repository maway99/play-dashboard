import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getStreamDeckColourChoices, pickStreamDeckColour } from '../lib/stream-deck-colours.js';

const config = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url)));
const choices = getStreamDeckColourChoices(config.colourControls, config.streamDeck.colourChoices);
test('RND COL offers exactly six solids and three existing palettes, without laser changes', () => {
  assert.deepEqual(choices.map(choice => choice.id),
    ['red', 'green', 'blue', 'orange', 'magenta', 'cyan', 'pinkBlue', 'fire', 'candy']);
  for (const choice of choices) assert.deepEqual(Object.keys(choice.colours), ['beams', 'strobes']);
  assert.deepEqual(choices.find(choice => choice.id === 'magenta').colours, { beams: 'roseRed', strobes: 'roseRed' });
  for (const id of ['pinkBlue', 'fire', 'candy']) {
    const palette = config.colourControls.palettes.find(entry => entry.id === id);
    assert.deepEqual(choices.find(choice => choice.id === id).colours,
      { beams: palette.colours.beams, strobes: palette.colours.strobes });
  }
});

test('every colour option can be picked and the current pair never immediately repeats', () => {
  assert.deepEqual(choices.map((_, i) => pickStreamDeckColour(choices, {}, () => (i + 0.5) / choices.length).id),
    choices.map(choice => choice.id));
  for (const current of choices) {
    for (const random of [0, 0.5, 0.99]) {
      assert.notDeepEqual(pickStreamDeckColour(choices, current.colours, () => random).colours, current.colours);
    }
  }
  assert.equal(pickStreamDeckColour([], {}), null);
  assert.equal(pickStreamDeckColour([choices[0]], choices[0].colours).id, 'red');
  assert.deepEqual(getStreamDeckColourChoices(config.colourControls,
    [{ id: 'unknown', colour: 'magenta' }, { id: 'empty', palette: 'palette-11' }]), []);
});

test('deck positions, removed controls, and press/release mappings are correct', () => {
  const buttons = config.streamDeck.companion.buttons;
  for (const id of ['strobeRed', 'strobeBlue', 'flashRed', 'flashBlue']) assert.equal(buttons[id], undefined);
  for (const [id, row, column] of [
    ['whiteStrobe', 0, 0], ['strobeWhiteRandom', 0, 1], ['whiteFlash', 0, 2], ['flashWhiteChase', 0, 3],
    ['randomColours', 1, 0], ['beamsWhite', 1, 1], ['strobesRedColour', 1, 2]
  ]) assert.deepEqual([buttons[id].page, buttons[id].row, buttons[id].column], [1, row, column]);
  assert.equal(buttons.whiteFlash.releaseVariable, 'pgro_sd_white_flash_up');
  assert.equal(buttons.flashWhiteChase.releaseVariable, 'pgro_sd_flash_white_chase_up');
  for (const id of ['randomColours', 'beamsWhite', 'strobesRedColour']) {
    assert.equal(buttons[id].releaseVariable, undefined);
    assert.equal(buttons[id].cooldownMs, undefined);
  }
  assert.equal(buttons.beamsWhite.colourId, 'open');
  assert.equal(buttons.strobesRedColour.colourId, 'red');
  const positions = Object.values(buttons).map(button => `${button.page}/${button.row}/${button.column}`);
  assert.equal(new Set(positions).size, positions.length);
});
