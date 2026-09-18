import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pickRandomCue, RANDOM_CUE_BANKS } from '../lib/random-cue.js';

const config = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url)));
const expected = {
  mainCues: [1, 2, 3, 4, 5, 28, 32],
  slowCues: [23, 24, 26, 27],
  strobeCues: [6, 8],
  laserCues: [11, 12, 13, 14, 16, 17, 18, 20, 21, 22]
};
for (const bankKey of RANDOM_CUE_BANKS) {
  test(`${bankKey}: assigned pool and no immediate repeats`, () => {
    const entries = config.cueBanks[bankKey].cues;
    const pool = expected[bankKey];
    const results = pool.map((_, index) => pickRandomCue(entries, null,
      () => (index + 0.5) / pool.length).cue);
    assert.deepEqual(results, pool);
    for (const active of pool) {
      for (const random of [0, 0.5, 0.99]) {
        const next = pickRandomCue(entries, active, () => random).cue;
        assert.ok(pool.includes(next));
        assert.notEqual(next, active);
      }
    }
  });
}

test('random controls have distinct counters and the intended deck positions', () => {
  const buttons = config.streamDeck.companion.buttons;
  const mapping = [
    ['randomLaserCue', 'laserCues', 0], ['randomSlowCue', 'slowCues', 1],
    ['randomMainCue', 'mainCues', 2], ['randomStrobeCue', 'strobeCues', 3]
  ];
  assert.equal(new Set(mapping.map(([id]) => buttons[id].pressVariable)).size, 4);
  for (const [id, bankKey, column] of mapping) {
    assert.equal(buttons[id].bankKey ?? 'mainCues', bankKey);
    assert.deepEqual([buttons[id].page, buttons[id].row, buttons[id].column], [1, 3, column]);
    assert.equal(buttons[id].releaseVariable, undefined);
    assert.equal(buttons[id].cooldownMs, undefined);
  }
});
