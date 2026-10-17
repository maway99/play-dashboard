import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const config = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url)));
const sidebar = fs.readFileSync(new URL('../client/src/components/Sidebar.jsx', import.meta.url), 'utf8');
const control = fs.readFileSync(new URL('../client/src/tabs/Control.jsx', import.meta.url), 'utf8');

test('colour selectors always use zero fade independently of cue fade time', () => {
  const start = server.indexOf('function sendFixtureColour');
  const end = server.indexOf('function setFixtureColour', start + 1);
  const implementation = server.slice(start, end);
  assert.match(server, /const COLOUR_FADE_SECONDS = 0;/);
  assert.match(implementation, /Fade \$\{COLOUR_FADE_SECONDS\}/);
  assert.doesNotMatch(implementation, /state\.fadeTime/);
});

test('lamp off fires on one press in both operator control surfaces', () => {
  assert.doesNotMatch(sidebar, /pendingOff|Tap Again|Confirm all lamps off/);
  assert.match(sidebar, /send\(\{ type: 'maintenance', scope: 'global', action: 'lampOff' \}\)/);
  assert.match(control, /id: 'lampOff', label: 'All lamps off', tone: 'warn', confirm: false/);
  assert.match(control, /id: 'lampOff', label: 'Lamp off', confirm: false/);
});

test('End Of Night always uses its dedicated five-second fade', () => {
  assert.equal(config.executors.endOfNight.fadeTime, 5);
  assert.match(server, /const END_OF_NIGHT_FADE_SECONDS = 5;/);
  const start = server.indexOf('function setEndOfNight');
  const end = server.indexOf('function setDisable', start);
  const implementation = server.slice(start, end);
  assert.match(implementation, /Fade \$\{END_OF_NIGHT_FADE_SECONDS\}/);
  assert.doesNotMatch(implementation, /state\.fadeTime/);
});
