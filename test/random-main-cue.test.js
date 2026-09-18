import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pickRandomMainCue } from '../lib/random-main-cue.js';

test('ignores placeholders, unassigned, invalid and duplicate cues', () => {
  const entries = [{ cue: null }, { cue: 0 }, { cue: NaN }, { cue: '3' },
    { cue: 9, placeholder: true }, { cue: 1 }, { cue: 1 }, { cue: 2 }];
  assert.equal(pickRandomMainCue(entries, null, () => 0).cue, 1);
  assert.equal(pickRandomMainCue(entries, null, () => 0.99).cue, 2);
});

test('never immediately repeats the current cue when alternatives exist', () => {
  const entries = [1, 2, 3].map(cue => ({ cue }));
  for (const active of [1, 2, 3]) {
    for (const random of [0, 0.49, 0.99]) {
      assert.notEqual(pickRandomMainCue(entries, active, () => random).cue, active);
    }
  }
});

test('handles an empty bank and a single assigned cue', () => {
  assert.equal(pickRandomMainCue([], null), null);
  assert.equal(pickRandomMainCue(undefined, null), null);
  assert.equal(pickRandomMainCue([{ cue: 1 }], 1).cue, 1);
});

test('the venue random pool is exactly the configured main cues', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url)));
  const entries = config.cueBanks.mainCues.cues;
  const results = entries.map((_, index) => pickRandomMainCue(entries, null,
    () => (index + 0.5) / entries.length).cue);
  assert.deepEqual(results, [1, 2, 3, 4, 5, 28, 32]);
});
