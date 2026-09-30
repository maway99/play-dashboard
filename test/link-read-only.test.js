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

const root = fileURLToPath(new URL('../', import.meta.url));

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function eventually(check, message) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {}
    await delay(25);
  }
  throw new Error(message);
}

test('Link bridge only reads Serato tempo and never writes the 125 BPM fallback upstream',
  { timeout: 15000 }, async t => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'play-link-read-only-'));
    const ma2Sockets = new Set();
    const linkSockets = new Set();
    const ma2Commands = [];
    const linkCommands = [];
    let linkStatus = { peers: 0, bpm: 120 };

    const ma2 = net.createServer(socket => {
      ma2Sockets.add(socket);
      socket.on('close', () => ma2Sockets.delete(socket));
      socket.on('error', error => { if (error.code !== 'ECONNRESET') throw error; });
      socket.write('>\r\n');
      let buffer = '';
      socket.on('data', data => {
        buffer += data;
        const lines = buffer.split('\r\n');
        buffer = lines.pop();
        for (const line of lines) {
          ma2Commands.push(line);
          if (line.startsWith('Login ')) socket.write('login successful\r\n');
        }
      });
    });

    const carabiner = net.createServer(socket => {
      linkSockets.add(socket);
      socket.on('close', () => linkSockets.delete(socket));
      socket.on('error', error => { if (error.code !== 'ECONNRESET') throw error; });
      let buffer = '';
      socket.on('data', data => {
        buffer += data;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const raw of lines) {
          const command = raw.trim();
          if (!command) continue;
          linkCommands.push(command);
          if (command === 'status') {
            socket.write(`status { :peers ${linkStatus.peers} :bpm ${linkStatus.bpm.toFixed(6)} :start 0 :beat 1.0 }\n`);
          }
        }
      });
    });

    let child;
    t.after(async () => {
      if (child && child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await exited;
      }
      for (const socket of ma2Sockets) socket.destroy();
      for (const socket of linkSockets) socket.destroy();
      await Promise.all([
        new Promise(resolve => ma2.close(resolve)),
        new Promise(resolve => carabiner.close(resolve))
      ]);
      await fs.rm(temp, { recursive: true, force: true });
    });

    const ma2Port = await listen(ma2);
    const carabinerPort = await listen(carabiner);
    const reservation = http.createServer();
    const panelPort = await listen(reservation);
    await new Promise(resolve => reservation.close(resolve));

    const config = JSON.parse(await fs.readFile(path.join(root, 'config.json'), 'utf8'));
    config.ma2.ip = '127.0.0.1';
    config.ma2.port = ma2Port;
    config.ma2.reconnectIntervalMs = 50;
    config.link.defaultBpm = 125;
    config.link.pollIntervalMs = 50;
    config.link.reconnectIntervalMs = 50;
    config.link.minIntervalMs = 20;
    config.link.carabiner = {
      host: '127.0.0.1', port: carabinerPort, autoStart: false, path: null
    };
    config.streamDeck.companion.enabled = false;

    await fs.copyFile(path.join(root, 'server.js'), path.join(temp, 'server.js'));
    await fs.cp(path.join(root, 'lib'), path.join(temp, 'lib'), { recursive: true });
    await fs.writeFile(path.join(temp, 'config.json'), JSON.stringify(config));
    await fs.writeFile(path.join(temp, 'package.json'), '{"type":"module"}');
    await fs.symlink(path.join(root, 'node_modules'), path.join(temp, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir');

    child = spawn(process.execPath, ['server.js'], {
      cwd: temp,
      env: { ...process.env, PORT: String(panelPort), MA2_HOST: '127.0.0.1' },
      stdio: 'ignore'
    });

    const readState = async () => (await fetch(`http://127.0.0.1:${panelPort}/api/state`)).json();
    await eventually(async () => {
      const state = await readState();
      return state.ma2 === 'connected' && state.link.carabiner === 'connected' && linkCommands.length >= 3;
    }, 'Dashboard did not connect to both mock services');

    let state = await readState();
    assert.equal(state.link.bridgeMode, 'read-only');
    assert.equal(state.link.source, 'default');
    assert.equal(state.link.bpm, 125, '125 BPM remains the MA2-only no-peer fallback');
    assert.ok(linkCommands.every(command => command === 'status'),
      `Carabiner received an upstream command: ${linkCommands.join(', ')}`);

    await eventually(() => ma2Commands.includes('SpecialMaster 3.1 At 125'),
      'MA2 did not receive its no-peer fallback tempo');

    linkStatus = { peers: 1, bpm: 138.4 };
    await eventually(async () => {
      state = await readState();
      return state.link.source === 'link' && state.link.bpm === 138.4;
    }, 'Dashboard did not follow the external Link tempo');
    await eventually(() => ma2Commands.includes('SpecialMaster 3.1 At 138.4'),
      'MA2 did not receive the Serato/Link tempo');

    await delay(150);
    assert.ok(linkCommands.length >= 5, 'The bridge should continue polling Carabiner');
    assert.ok(linkCommands.every(command => command === 'status'),
      `Carabiner received a tempo-changing command: ${linkCommands.join(', ')}`);
  });
