import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { getStreamDeckColourChoices } from '../lib/stream-deck-colours.js';

const root = fileURLToPath(new URL('../', import.meta.url));
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
async function eventually(check) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch {}
    await delay(25);
  }
  throw new Error('Timed out waiting for mock dashboard state');
}

for (const [buttonId, bankKey, fixedCue] of [
  ['randomMainCue', 'mainCues'], ['randomLaserCue', 'laserCues'],
  ['randomSlowCue', 'slowCues'], ['randomStrobeCue', 'strobeCues'],
  ['buildMedWhite', 'buildups', 9], ['buildFastWhite', 'buildups', 10],
  ['buildMedStrobe', 'buildups', 30], ['buildFastStrobe', 'buildups', 31],
  ['randomColours', null], ['beamsWhite', null], ['strobesRedColour', null],
  ['whiteFlash', null], ['flashWhiteChase', null]
]) {
test(`Companion ${buttonId} counter fires its assigned cues and does not stop on release`,
  { timeout: 15000 }, async t => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'play-main-cue-test-'));
    const sockets = new Set();
    const commands = [];
    const ma2 = net.createServer(socket => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      // Windows terminates the mock child abruptly on SIGTERM during cleanup.
      socket.on('error', error => { if (error.code !== 'ECONNRESET') throw error; });
      socket.write('>\r\n');
      let buffer = '';
      socket.on('data', data => {
        buffer += data;
        const lines = buffer.split('\r\n');
        buffer = lines.pop();
        for (const line of lines) {
          commands.push(line);
          if (line.startsWith('Login ')) socket.write('login successful\r\n');
        }
      });
    });
    let counter = 9;
    let releaseCounter = 9;
    let releaseVariable;
    let reads = 0;
    const companion = http.createServer((_req, res) => {
      reads++;
      res.end(String(releaseVariable && _req.url.includes(`/${releaseVariable}/`) ? releaseCounter : counter));
    });
    let child;
    let client;
    t.after(async () => {
      client?.terminate();
      if (child && child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await exited;
      }
      for (const socket of sockets) socket.destroy();
      await Promise.all([new Promise(resolve => ma2.close(resolve)),
        new Promise(resolve => companion.close(resolve))]);
      await fs.rm(temp, { recursive: true, force: true });
    });
    const ma2Port = await listen(ma2);
    const companionPort = await listen(companion);
    const reservation = http.createServer();
    const panelPort = await listen(reservation);
    await new Promise(resolve => reservation.close(resolve));
    const config = JSON.parse(await fs.readFile(path.join(root, 'config.json'), 'utf8'));
    config.ma2.ip = '127.0.0.1';
    config.ma2.port = ma2Port;
    delete config.link;
    config.streamDeck.companion.buttons = { [buttonId]: config.streamDeck.companion.buttons[buttonId] };
    const selectedButton = config.streamDeck.companion.buttons[buttonId];
    releaseVariable = selectedButton.releaseVariable;
    config.streamDeck.companion.baseUrl = `http://127.0.0.1:${companionPort}`;
    await fs.copyFile(path.join(root, 'server.js'), path.join(temp, 'server.js'));
    await fs.cp(path.join(root, 'lib'), path.join(temp, 'lib'), { recursive: true });
    await fs.writeFile(path.join(temp, 'config.json'), JSON.stringify(config));
    await fs.writeFile(path.join(temp, 'package.json'), '{"type":"module"}');
    await fs.symlink(path.join(root, 'node_modules'), path.join(temp, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir');
    child = spawn(process.execPath, ['server.js'], { cwd: temp,
      env: { ...process.env, PORT: String(panelPort), MA2_HOST: '127.0.0.1',
        COMPANION_BASE_URL: config.streamDeck.companion.baseUrl }, stdio: 'ignore' });
    const readState = async () => (await fetch(`http://127.0.0.1:${panelPort}/api/state`)).json();
    await eventually(async () => (await readState()).ma2 === 'connected' && reads >= 2);
    assert.equal(commands.some(command => command.startsWith('Goto Cue')), false,
      'The saved counter must not replay when the server starts');
    client = new WebSocket(`ws://127.0.0.1:${panelPort}/ws`);
    await once(client, 'open');
    client.send(JSON.stringify({ type: 'fixtureColours', colours: { beams: 'red', strobes: 'cyan', lasers: 'green' } }));
    await eventually(async () => (await readState()).fixtureColours.beams === 'red');
    await eventually(() => commands.filter(command => command.startsWith('Goto Cue')).length === 3);
    if (!bankKey) {
      const momentary = selectedButton.type === 'momentarySequence';
      const randomColour = selectedButton.type === 'dashboardRandomColours';
      const choices = getStreamDeckColourChoices(config.colourControls, config.streamDeck.colourChoices);
      let previousColours = { beams: 'red', strobes: 'cyan' };
      for (let tap = 0; tap < 8; tap++) {
        const start = commands.length;
        counter++;
        const expectedCount = randomColour ? 2 : 1;
        await eventually(() => commands.slice(start).filter(command => command.startsWith('Goto Cue')).length === expectedCount);
        const state = await readState();
        assert.equal(state.activeCue, null, 'Colour/flash actions must not change the main cue stack');
        assert.equal(state.fixtureColours.lasers, 'green');
        const sent = commands.slice(start).filter(command => command.startsWith('Goto Cue'));
        if (momentary) {
          const target = config.executors.streamDeckSequences[selectedButton.action];
          assert.equal(sent[0], `Goto Cue ${target.cue} Exec ${target.page}.${target.exec} Fade 0`);
          const off = `Off Exec ${target.page}.${target.exec}`;
          await delay(60);
          assert.equal(commands.slice(start).includes(off), false, 'Flash must stay on until release');
          releaseCounter++;
          await eventually(() => commands.slice(start).includes(off));
          assert.equal(commands.slice(start).filter(command => command === off).length, 1);
          assert.equal(state.fixtureColours.beams, 'red');
          assert.equal(state.fixtureColours.strobes, 'cyan');
        } else if (randomColour) {
          const pair = { beams: state.fixtureColours.beams, strobes: state.fixtureColours.strobes };
          assert.ok(choices.some(choice => choice.colours.beams === pair.beams && choice.colours.strobes === pair.strobes));
          assert.notDeepEqual(pair, previousColours, 'Do not immediately repeat the current colour combination');
          assert.match(sent[0], /Exec 1\.1 /);
          assert.match(sent[1], /Exec 1\.2 /);
          previousColours = pair;
        } else {
          const fixture = config.colourControls.fixtures.find(entry => entry.id === selectedButton.fixtureId);
          assert.equal(sent[0], `Goto Cue ${fixture.cues[selectedButton.colourId]} Exec ${fixture.page}.${fixture.exec} Fade ${config.defaults.fadeTime}`);
          assert.equal(state.fixtureColours[selectedButton.fixtureId], selectedButton.colourId);
          assert.equal(state.fixtureColours[selectedButton.fixtureId === 'beams' ? 'strobes' : 'beams'],
            selectedButton.fixtureId === 'beams' ? 'cyan' : 'red');
        }
      }
      return;
    }
    const pool = config.cueBanks[bankKey].cues.filter(entry => Number.isFinite(entry.cue)).map(entry => entry.cue);
    let previous = null;
    for (let tap = 0; tap < 8; tap++) {
      const start = commands.length;
      counter++;
      const expectedCount = bankKey === 'mainCues' ? 3 : 1;
      await eventually(() => commands.slice(start).filter(command => command.startsWith('Goto Cue')).length === expectedCount);
      const state = await readState();
      assert.ok(pool.includes(state.activeCue));
      if (fixedCue) assert.equal(state.activeCue, fixedCue, 'Every tap must fire the fixed build cue, including repeated taps');
      else assert.notEqual(state.activeCue, previous);
      assert.equal(state.fixtureColours.beams, 'red');
      assert.equal(state.fixtureColours.strobes, 'cyan');
      assert.equal(state.fixtureColours.lasers, 'green');
      const sent = commands.slice(start).filter(command => command.startsWith('Goto Cue'));
      assert.equal(sent.length, bankKey === 'mainCues' ? 3 : 1,
        'Only Main reapplies colour selectors; other banks retain their programmed look');
      const fade = ['laserCues', 'strobeCues', 'buildups'].includes(bankKey) ? 0 : config.defaults.fadeTime;
      assert.equal(sent[0], `Goto Cue ${state.activeCue} Exec 4.1 Fade ${fade}`);
      if (bankKey === 'mainCues') {
        assert.match(sent[1], /Exec 1\.1 /);
        assert.match(sent[2], /Exec 1\.2 /);
      }
      previous = state.activeCue;
    }
    const count = commands.length;
    await delay(160);
    assert.equal((await readState()).activeCue, previous);
    assert.equal(commands.slice(count).some(command => command === 'Off Exec 4.1'), false);
  });
}
