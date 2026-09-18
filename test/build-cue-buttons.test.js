import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findStreamDeckCue } from '../lib/stream-deck-cue.js';

const config = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url)));
test('build buttons map to the four requested chases, not effects or random cues', () => {
  const mapping = [
    ['buildMedWhite', 0, 9, 'Med Rnd Chase'],
    ['buildFastWhite', 1, 10, 'Fast Rnd Chase'],
    ['buildMedStrobe', 2, 30, 'Strobe Col Rnd Med'],
    ['buildFastStrobe', 3, 31, 'Strobe Col Rnd Fast']
  ];
  const counters = new Set();
  for (const [id, column, cue, label] of mapping) {
    const button = config.streamDeck.companion.buttons[id];
    assert.deepEqual([button.page, button.row, button.column], [1, 2, column]);
    assert.equal(button.type, 'dashboardCue');
    assert.equal(button.bankKey, 'buildups');
    assert.equal(button.cueNumber, cue);
    assert.equal(findStreamDeckCue(config.cueBanks, button).label, label);
    assert.equal(button.releaseVariable, undefined);
    assert.equal(button.cooldownMs, undefined);
    counters.add(button.pressVariable);
  }
  assert.equal(counters.size, 4);
  const allCounters = Object.values(config.streamDeck.companion.buttons).map(button => button.pressVariable).filter(Boolean);
  assert.equal(new Set(allCounters).size, allCounters.length);
});

test('fixed cue actions reject unknown banks, unassigned cues and placeholders', () => {
  for (const button of [
    { bankKey: 'unknown', cueNumber: 9 },
    { bankKey: 'buildups', cueNumber: 6 },
    { bankKey: 'buildups', cueNumber: null },
    { bankKey: 'buildups', cueNumber: '9' },
    { bankKey: 'buildups', cueNumber: -1 }
  ]) assert.equal(findStreamDeckCue(config.cueBanks, button), null);
  assert.equal(findStreamDeckCue({ buildups: { cues: [{ cue: 9, placeholder: true }] } },
    { bankKey: 'buildups', cueNumber: 9 }), null);
});
