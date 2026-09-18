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

test('Companion counter fires a Main cue, preserves colours and does not stop on release',
  { timeout: 15000 }, async t => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'play-main-cue-test-'));
    const sockets = new Set();
    const commands = [];
    const ma2 = net.createServer(socket => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
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
    let reads = 0;
    const companion = http.createServer((_req, res) => {
      reads++;
      res.end(String(counter));
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
    config.streamDeck.companion.buttons = { randomMainCue: config.streamDeck.companion.buttons.randomMainCue };
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
    client.send(JSON.stringify({ type: 'fixtureColours', colours: { beams: 'red', strobes: 'cyan' } }));
    await eventually(async () => (await readState()).fixtureColours.beams === 'red');
    const pool = config.cueBanks.mainCues.cues.map(entry => entry.cue);
    let previous = null;
    for (let tap = 0; tap < 8; tap++) {
      const start = commands.length;
      counter++;
      await eventually(async () => (await readState()).activeCue !== previous);
      const state = await readState();
      assert.ok(pool.includes(state.activeCue));
      assert.notEqual(state.activeCue, previous);
      assert.equal(state.fixtureColours.beams, 'red');
      assert.equal(state.fixtureColours.strobes, 'cyan');
      await eventually(() => commands.slice(start).some(command => command.startsWith('Goto Cue')));
      const sent = commands.slice(start).filter(command => command.startsWith('Goto Cue'));
      assert.equal(sent.length, 3, 'One Main cue plus two colour-selector cues');
      assert.equal(sent[0], `Goto Cue ${state.activeCue} Exec 4.1 Fade ${config.defaults.fadeTime}`);
      assert.match(sent[1], /Exec 1\.1 /);
      assert.match(sent[2], /Exec 1\.2 /);
      previous = state.activeCue;
    }
    const count = commands.length;
    await delay(160);
    assert.equal((await readState()).activeCue, previous);
    assert.equal(commands.slice(count).some(command => command === 'Off Exec 4.1'), false);
  });
