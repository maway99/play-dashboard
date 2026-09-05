import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

const PORT = process.env.PORT || config.server?.port || 3000;
const startedAt = Date.now();

// ---------- Server state ("track what we sent") ----------
const state = {
  ma2: 'disconnected',
  haze: 0,
  fadeTime: config.defaults.fadeTime,
  endOfNightActive: false,
  activeCue: null,
  fixtureColours: Object.fromEntries(config.colourControls.fixtures.map(f => [f.id, null])),
  disabledBeamFixtures: Object.fromEntries((config.fixtureMaintenance?.beamFixtures ?? []).map(f => [f.id, false])),
  specialEffects: Object.fromEntries((config.specialEffects?.groups ?? []).map(group => [
    group.id,
    {
      armed: false,
      fired: Object.fromEntries((group.actions ?? []).map(action => [action.id, false]))
    }
  ])),
  disables: Object.fromEntries(Object.keys(config.executors.disables).map(k => [k, false])),
  ma2DisconnectedAt: Date.now(),
  ma2LastCommand: null,
  ma2LastCommandAt: null,
  ma2LastResponse: null,
  link: {
    enabled: config.link?.enabled !== false,
    carabiner: 'disconnected',
    peers: 0,
    linkBpm: null,
    bpm: config.link?.defaultBpm ?? 125,
    source: 'default',
    beat: null,
    lastStatusAt: null,
    lastSentBpm: null,
    lastSentAt: null,
    lastSentCommand: null
  }
};

function resetLightingNeutral() {
  state.haze = 0;
  state.endOfNightActive = false;
  state.activeCue = null;
  state.fixtureColours = Object.fromEntries(config.colourControls.fixtures.map(f => [f.id, null]));
  state.disabledBeamFixtures = Object.fromEntries((config.fixtureMaintenance?.beamFixtures ?? []).map(f => [f.id, false]));
  state.specialEffects = Object.fromEntries((config.specialEffects?.groups ?? []).map(group => [
    group.id,
    {
      armed: false,
      fired: Object.fromEntries((group.actions ?? []).map(action => [action.id, false]))
    }
  ]));
  for (const k of Object.keys(state.disables)) state.disables[k] = false;
}

// ---------- WebSocket broadcast ----------
let wss;
function broadcast(msg) {
  if (!wss) return;
  const data = JSON.stringify(msg);
  for (const c of wss.clients) {
    if (c.readyState === 1) c.send(data);
  }
}
function broadcastState() {
  broadcast({ type: 'state', state: snapshotState() });
}
function snapshotState() {
  return {
    ...state,
    uptimeMs: Date.now() - startedAt,
    config: {
      ma2: { ip: config.ma2.ip, port: config.ma2.port },
      colourControls: config.colourControls,
      fixtureMaintenance: config.fixtureMaintenance,
      specialEffects: config.specialEffects,
      cueBanks: config.cueBanks,
      cueStack: config.cueStack,
      executors: config.executors,
      defaults: config.defaults,
      link: {
        enabled: config.link?.enabled !== false,
        defaultBpm: config.link?.defaultBpm ?? 125,
        carabiner: { host: config.link?.carabiner?.host ?? '127.0.0.1', port: config.link?.carabiner?.port ?? 17000 },
        speedMaster: config.link?.ma2?.speedMaster ?? 1
      }
    }
  };
}

// ---------- MA2 Telnet manager ----------
class Ma2Telnet {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.loggedIn = false;
    this.reconnectTimer = null;
    this.buffer = '';
    this.queue = [];
  }

  connect() {
    if (this.socket) return;
    this.buffer = '';
    this.loggedIn = false;
    this._loginSent = false;
    if (this._loginFallback) { clearTimeout(this._loginFallback); this._loginFallback = null; }
    const sock = new net.Socket();
    this.socket = sock;
    sock.setEncoding('utf8');
    sock.setKeepAlive(true, 10000);

    const sendLogin = () => {
      if (this._loginSent) return;
      this._loginSent = true;
      const u = config.ma2.username ?? '';
      const p = config.ma2.password ?? '';
      const cmd = `Login "${u}" "${p}"\r\n`;
      sock.write(cmd);
      console.log(`[MA2 →] Login "${u}" "***"`);
      this.buffer = ''; // discard pre-login banner so we don't match old prompts
    };

    sock.on('connect', () => {
      console.log(`[MA2] TCP connected ${config.ma2.ip}:${config.ma2.port}`);
      // Send Login as soon as the first prompt arrives. If nothing arrives
      // within 800ms, send anyway — some MA2 builds present an empty prompt.
      this._loginFallback = setTimeout(sendLogin, 800);
    });

    sock.on('data', (chunk) => {
      this.buffer += chunk.toString();
      // strip telnet IAC negotiation bytes and other control chars
      this.buffer = this.buffer.replace(/[\x00-\x08\x0E-\x1F]/g, '');
      state.ma2LastResponse = this.buffer.slice(-200);
      const lower = this.buffer.toLowerCase();

      if (this.loggedIn) {
        // Parse command responses for state sync
        if (this.buffer.includes('ListVar') || this.buffer.includes('listvar')) {
          // Parse when we have ListVar responses
          parseMa2InfoResponse(this.buffer);
          // Clear buffer more aggressively to prevent accumulation
          this.buffer = '';
        } else if (this.buffer.length > 1000) {
          // Keep buffer manageable even without relevant responses
          this.buffer = this.buffer.slice(-300);
        }
        return;
      }

      if (!this._loginSent) {
        // First prompt seen → send Login immediately, don't wait for fallback.
        if (/\]>\s*$/.test(this.buffer) || /^>\s*$/m.test(this.buffer)) {
          if (this._loginFallback) { clearTimeout(this._loginFallback); this._loginFallback = null; }
          sendLogin();
        }
        return;
      }

      // After Login was sent, look for explicit success or failure.
      if (lower.includes('logged in') || lower.includes('login successful') ||
          new RegExp(`\\[${config.ma2.username}[^\\]]*\\]>`, 'i').test(this.buffer)) {
        this.loggedIn = true;
        this.connected = true;
        this.buffer = '';
        state.ma2 = 'connected';
        state.ma2DisconnectedAt = null;
        console.log('[MA2] Logged in as', config.ma2.username);
        // Immediate state sync on connection (includes haze fader value)
        setTimeout(() => pollMa2StateOnce(), 500);
        startMa2Polling(); // Start periodic polling for active cue
        setTimeout(() => link.pushTempo(true), 700); // desk just came up: give it the current tempo
        broadcastState();
        while (this.queue.length) sock.write(this.queue.shift());
      } else if (lower.includes('login failed') || lower.includes('wrong password') ||
                 lower.includes('access denied') || lower.includes('invalid user')) {
        console.warn('[MA2] Login rejected:', this.buffer.slice(-200));
        sock.destroy(); // triggers close → reconnect cycle
      }
    });

    sock.on('error', (err) => {
      console.warn('[MA2] Socket error:', err.message);
    });

    sock.on('close', () => {
      console.log('[MA2] Socket closed');
      const wasConnected = state.ma2 === 'connected';
      this.socket = null;
      this.connected = false;
      this.loggedIn = false;
      this._loginSent = false;
      if (this._loginFallback) { clearTimeout(this._loginFallback); this._loginFallback = null; }
      stopMa2Polling(); // Stop state polling
      if (wasConnected) {
        state.ma2 = 'disconnected';
        state.ma2DisconnectedAt = Date.now();
        resetLightingNeutral();
        broadcastState();
      }
      this.scheduleReconnect();
    });

    sock.connect(config.ma2.port, config.ma2.ip);
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, config.ma2.reconnectIntervalMs);
  }

  forceReconnect() {
    if (this.socket) {
      try { this.socket.destroy(); } catch {}
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connect();
  }

  send(command) {
    const line = command.endsWith('\r\n') ? command : `${command}\r\n`;
    state.ma2LastCommand = command;
    state.ma2LastCommandAt = Date.now();
    if (this.connected && this.loggedIn && this.socket) {
      this.socket.write(line);
      console.log('[MA2 →]', command);
    } else {
      console.log('[MA2 queued]', command);
      this.queue.push(line);
    }
  }
}
const ma2 = new Ma2Telnet();

// ---------- Ableton Link bridge (via Carabiner) ----------
// Carabiner (https://github.com/Deep-Symmetry/carabiner) joins the Ableton Link session on the
// local network and exposes it over a plain-text TCP socket. We read the session tempo from it and
// push it to a grandMA2 speed master. With no usable Link session (Carabiner not running, or zero
// peers on the network) we fall back to config.link.defaultBpm so the desk always has a tempo.
//
// Carabiner protocol (newline-terminated):
//   -> status                  <- status { :peers 1 :bpm 128.000000 :start 1234 :beat 56.7 }
//   -> bpm 125.0               (sets the session tempo; used to park the idle session at the default)
// Carabiner also emits an unsolicited status line whenever tempo or peer count changes.
class LinkBridge {
  constructor(cfg = {}) {
    this.cfg = {
      defaultBpm: 125,
      minChangeBpm: 0.1,
      minIntervalMs: 400,
      pollIntervalMs: 1000,
      reconnectIntervalMs: 3000,
      ...cfg
    };
    this.carabiner = { host: '127.0.0.1', port: 17000, autoStart: false, path: null, ...(cfg.carabiner ?? {}) };
    this.ma2Cfg = { speedMaster: 1, command: 'SpecialMaster 3.{speedMaster} At {bpm}', ...(cfg.ma2 ?? {}) };
    this.socket = null;
    this.buffer = '';
    this.pollTimer = null;
    this.reconnectTimer = null;
    this.pushTimer = null;
    this.child = null;
    this.spawnTimer = null;
    this.stopping = false;
  }

  start() {
    if (this.carabiner.autoStart && this.carabiner.path) this.spawnCarabiner();
    this.connect();
    this.recompute(true);
  }

  stop() {
    this.stopping = true;
    clearTimeout(this.reconnectTimer); clearTimeout(this.pushTimer); clearTimeout(this.spawnTimer);
    clearInterval(this.pollTimer);
    if (this.socket) { try { this.socket.destroy(); } catch {} }
    if (this.child) { try { this.child.kill(); } catch {} }
  }

  // --- optional: run the Carabiner binary ourselves so the kiosk has nothing extra to start ---
  spawnCarabiner() {
    if (this.child || this.stopping) return;
    const bin = resolveCarabinerBinary(this.carabiner.path);
    if (!bin) {
      const wanted = path.isAbsolute(this.carabiner.path) ? this.carabiner.path : path.join(__dirname, this.carabiner.path);
      console.warn(`[Link] Carabiner binary not found at ${wanted}${process.platform === 'win32' ? '(.exe)' : ''} - expecting an external Carabiner on ${this.carabiner.host}:${this.carabiner.port}`);
      return;
    }
    console.log(`[Link] Starting Carabiner: ${bin} --daemon --port ${this.carabiner.port}`);
    const child = spawn(bin, ['--daemon', '--port', String(this.carabiner.port)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    child.stdout.on('data', (d) => console.log('[Carabiner]', d.toString().trim()));
    child.stderr.on('data', (d) => console.warn('[Carabiner!]', d.toString().trim()));
    child.on('exit', (code) => {
      console.warn(`[Link] Carabiner exited (${code})`);
      this.child = null;
      if (!this.stopping) this.spawnTimer = setTimeout(() => this.spawnCarabiner(), 5000);
    });
    child.on('error', (err) => console.warn('[Link] Carabiner spawn error:', err.message));
  }

  // --- TCP client to Carabiner ---
  connect() {
    if (this.socket || this.stopping) return;
    const sock = new net.Socket();
    this.socket = sock;
    this.buffer = '';
    sock.setEncoding('utf8');
    sock.setKeepAlive(true, 10000);
    sock.on('connect', () => {
      console.log(`[Link] Connected to Carabiner ${this.carabiner.host}:${this.carabiner.port}`);
      state.link.carabiner = 'connected';
      this.write('status');
      clearInterval(this.pollTimer);
      this.pollTimer = setInterval(() => this.write('status'), this.cfg.pollIntervalMs);
      this.recompute(true);
    });
    sock.on('data', (chunk) => {
      this.buffer += chunk;
      let nl;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line) this.handleLine(line);
      }
      if (this.buffer.length > 4000) this.buffer = this.buffer.slice(-1000); // never let a chatty peer grow the buffer
    });
    sock.on('error', (err) => {
      if (state.link.carabiner === 'connected') console.warn('[Link] Carabiner socket error:', err.message);
    });
    sock.on('close', () => {
      const wasConnected = state.link.carabiner === 'connected';
      this.socket = null;
      clearInterval(this.pollTimer); this.pollTimer = null;
      state.link.carabiner = 'disconnected';
      state.link.peers = 0;
      state.link.linkBpm = null;
      state.link.beat = null;
      if (wasConnected) console.log('[Link] Carabiner disconnected');
      this.recompute(wasConnected);
      if (!this.stopping && !this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, this.cfg.reconnectIntervalMs);
      }
    });
    sock.connect(this.carabiner.port, this.carabiner.host);
  }

  write(cmd) {
    if (this.socket && state.link.carabiner === 'connected') {
      try { this.socket.write(`${cmd}\n`); } catch {}
    }
  }

  handleLine(line) {
    if (!line.startsWith('status')) {
      if (!/^(version|unsupported|bad-)/.test(line)) console.log('[Link <-]', line.slice(0, 120));
      return;
    }
    const peers = Number(/:peers\s+(\d+)/.exec(line)?.[1]);
    const bpm = Number(/:bpm\s+([\d.]+)/.exec(line)?.[1]);
    const beat = Number(/:beat\s+(-?[\d.]+)/.exec(line)?.[1]);
    const prevPeers = state.link.peers;
    if (Number.isFinite(peers)) state.link.peers = peers;
    if (Number.isFinite(bpm) && bpm > 0) state.link.linkBpm = Math.round(bpm * 10) / 10;
    if (Number.isFinite(beat)) state.link.beat = beat;
    state.link.lastStatusAt = Date.now();
    if (Number.isFinite(peers) && peers !== prevPeers) console.log(`[Link] Peers: ${prevPeers} -> ${peers}`);
    // Park the idle session at the default so a peer that joins us lands on it rather than Carabiner's 120.
    if (peers === 0 && Number.isFinite(bpm) && Math.abs(bpm - this.cfg.defaultBpm) > 0.05) {
      this.write(`bpm ${this.cfg.defaultBpm}`);
    }
    this.recompute(false);
  }

  setEnabled(enabled) {
    state.link.enabled = !!enabled;
    console.log(`[Link] Follow Link ${state.link.enabled ? 'enabled' : 'disabled'}`);
    this.recompute(true);
  }

  // Effective tempo = Link session tempo when we are following and there is at least one peer,
  // otherwise the configured default. Pushes to MA2 when it changes.
  recompute(force) {
    const following = state.link.enabled && state.link.carabiner === 'connected' && state.link.peers > 0 && Number.isFinite(state.link.linkBpm);
    const bpm = following ? state.link.linkBpm : this.cfg.defaultBpm;
    const source = following ? 'link' : 'default';
    const changed = bpm !== state.link.bpm || source !== state.link.source;
    state.link.bpm = bpm;
    state.link.source = source;
    if (changed || force) {
      if (changed) console.log(`[Link] Tempo ${bpm} BPM (${source})`);
      this.pushTempo(force);
      broadcastState();
    }
  }

  ma2Command(bpm) {
    const tidy = Number(Number(bpm).toFixed(1)); // 125 -> "125", 128.3 -> "128.3"
    return this.ma2Cfg.command
      .replace('{speedMaster}', String(this.ma2Cfg.speedMaster))
      .replace('{bpm}', String(tidy));
  }

  // Rate-limited push of the effective tempo to the desk. Only ever sends while MA2 is logged in
  // (queueing tempo changes for an offline desk would just replay a stale burst on reconnect).
  pushTempo(force = false) {
    if (state.ma2 !== 'connected') return;
    const bpm = state.link.bpm;
    const last = state.link.lastSentBpm;
    if (!force && last != null && Math.abs(bpm - last) < this.cfg.minChangeBpm) return;
    const since = Date.now() - (state.link.lastSentAt ?? 0);
    if (!force && since < this.cfg.minIntervalMs) {
      clearTimeout(this.pushTimer);
      this.pushTimer = setTimeout(() => this.pushTempo(false), this.cfg.minIntervalMs - since);
      return;
    }
    const cmd = this.ma2Command(bpm);
    ma2.send(cmd);
    state.link.lastSentBpm = bpm;
    state.link.lastSentAt = Date.now();
    state.link.lastSentCommand = cmd;
  }
}
// config points at "tools/Carabiner"; on Windows the release ships as Carabiner.exe.
function resolveCarabinerBinary(configured) {
  if (!configured) return null;
  const base = path.isAbsolute(configured) ? configured : path.join(__dirname, configured);
  const candidates = process.platform === 'win32'
    ? [base.endsWith('.exe') ? base : `${base}.exe`, base]
    : [base];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}
const link = new LinkBridge(config.link ?? {});

// ---------- MA2 State Polling ----------
let ma2PollTimer = null;

function pollMa2State() {
  if (state.ma2 !== 'connected') return;
  
  // Query the selected/active cue using MA2 variable
  ma2.send('ListVar $SELECTEDEXECCUE');
  
  // Note: End of Night polling disabled - executor 1.3 doesn't exist in MA2
}

function pollMa2StateOnce() {
  if (state.ma2 !== 'connected') return;
  
  // One-time queries on connection/reconnect
  ma2.send('ListVar $SELECTEDEXECCUE');
  
  // Reset haze fader to 0 on startup/reconnect
  const { page, exec } = config.executors.haze;
  ma2.send(`Fader ${page}.${exec} At 0`);
  state.haze = 0;
  broadcastState();
}

function parseMa2InfoResponse(response) {
  // Strip ANSI color codes for easier parsing
  const cleanResponse = response.replace(/\[\d+m/g, '');
  
  // Parse SELECTEDEXECCUE variable - MA2 responds with "ListVar <number>"
  // Find ALL matches and take the LAST one (most recent)
  const allMatches = cleanResponse.matchAll(/ListVar\s+(\d+)/gi);
  const matches = [...allMatches];
  if (matches.length > 0) {
    const lastMatch = matches[matches.length - 1];
    const cueNum = parseInt(lastMatch[1]);
    
    if (cueNum > 0 && cueNum !== state.activeCue) {
      state.activeCue = cueNum;
      // Track End of Night state based on cue 141
      const newEotnState = (cueNum === 141);
      if (newEotnState !== state.endOfNightActive) {
        state.endOfNightActive = newEotnState;
        console.log('[MA2 Sync] End of Night state updated:', newEotnState);
      }
      console.log('[MA2 Sync] Active cue updated:', cueNum);
      broadcastState();
    } else if (cueNum === 0 && state.activeCue !== null) {
      state.activeCue = null;
      // If cue is cleared, End of Night is also off
      if (state.endOfNightActive) {
        state.endOfNightActive = false;
        console.log('[MA2 Sync] End of Night cleared');
      }
      console.log('[MA2 Sync] Active cue cleared');
      broadcastState();
    }
  }
}

function startMa2Polling() {
  if (ma2PollTimer) return;
  // Poll every 10 seconds
  ma2PollTimer = setInterval(() => {
    pollMa2State();
  }, 10000);
}

function stopMa2Polling() {
  if (ma2PollTimer) {
    clearInterval(ma2PollTimer);
    ma2PollTimer = null;
  }
}

// ---------- Command handlers (panel actions → MA2) ----------
function setHaze(value) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  state.haze = v;
  const { page, exec } = config.executors.haze;
  ma2.send(`Fader ${page}.${exec} At ${v}`);
  broadcastState();
}

function setFadeTime(value) {
  const v = Math.max(0, Math.min(30, Math.round(value * 2) / 2));
  state.fadeTime = v;
  broadcastState();
}

const ZERO_FADE_CUE_BANKS = ['laserCues', 'buildups', 'strobeCues'];

function findAssignedCue(cueNumber) {
  if (!Number.isFinite(cueNumber)) return null;
  for (const [bankKey, bank] of Object.entries(config.cueBanks ?? {})) {
    const cue = bank?.cues?.find((entry) => entry.cue === cueNumber);
    if (cue && Number.isFinite(cue.cue)) return { bankKey, bank, cue };
  }
  return null;
}

function cueUsesZeroFade(cueNumber) {
  const assignedCue = findAssignedCue(cueNumber);
  return assignedCue ? ZERO_FADE_CUE_BANKS.includes(assignedCue.bankKey) : false;
}

function findColourControl(fixtureId, colourId) {
  const fixture = config.colourControls.fixtures.find(f => f.id === fixtureId);
  const colour = config.colourControls.colours.find(c => c.id === colourId);
  if (!fixture || !colour) return null;
  const cue = fixture.cues?.[colourId];
  if (!cue) return null;
  return { fixture, colour, cue };
}

function sendFixtureColour(fixtureId, colourId) {
  const target = findColourControl(fixtureId, colourId);
  if (!target) return false;
  const { fixture, cue } = target;
  const executor = fixture.executorOverrides?.[colourId];
  if (Number.isFinite(executor?.page) && Number.isFinite(executor?.exec)) {
    ma2.send(`Goto Cue ${cue} Exec ${executor.page}.${executor.exec} Fade ${state.fadeTime}`);
  } else {
    ma2.send(`Goto Cue ${cue} Exec ${fixture.page}.${fixture.exec} Fade ${state.fadeTime}`);
  }
  state.fixtureColours[fixtureId] = colourId;
  return true;
}

function setFixtureColour(fixtureId, colourId) {
  if (sendFixtureColour(fixtureId, colourId)) broadcastState();
}

function setAllFixtureColours(colourId) {
  let changed = false;
  for (const fixture of config.colourControls.fixtures) {
    changed = sendFixtureColour(fixture.id, colourId) || changed;
  }
  if (changed) broadcastState();
}

function setFixturePalette(paletteId) {
  const palette = config.colourControls.palettes.find(p => p.id === paletteId);
  if (!palette) return;
  let changed = false;
  for (const [fixtureId, colourId] of Object.entries(palette.colours)) {
    changed = sendFixtureColour(fixtureId, colourId) || changed;
  }
  if (changed) broadcastState();
}

function selectCue(cueNumber) {
  const assignedCue = findAssignedCue(cueNumber);
  if (!assignedCue) {
    console.warn('[Cue] Ignored unassigned or unknown cue request', { cueNumber });
    return;
  }

  state.activeCue = cueNumber;
  // If End of Night was active, firing a cue should release it.
  if (state.endOfNightActive) {
    const eotn = config.executors.endOfNight;
    ma2.send(`Off Exec ${eotn.page}.${eotn.exec}`);
    state.endOfNightActive = false;
  }
  const { page, exec } = config.cueStack;
  const fade = cueUsesZeroFade(cueNumber) ? 0 : state.fadeTime;
  // Single line: 'Fade' as a suffix on Goto. MA2 errors on standalone 'Fade N'.
  ma2.send(`Goto Cue ${cueNumber} Exec ${page}.${exec} Fade ${fade}`);
  broadcastState();
}

function setClear() {
  const { page, exec } = config.cueStack;
  ma2.send(`Off Fader ${page}`);
  ma2.send(`Off Exec ${page}.${exec}`);
  state.activeCue = null;
  
  // Also turn off End of Night if active
  if (state.endOfNightActive) {
    const { page: eotnPage, exec: eotnExec } = config.executors.endOfNight;
    ma2.send(`Off Exec ${eotnPage}.${eotnExec}`);
    state.endOfNightActive = false;
  }
  
  broadcastState();
}

function setEndOfNight(active) {
  state.endOfNightActive = !!active;
  const { page, exec } = config.executors.endOfNight;
  ma2.send(`${active ? 'Go' : 'Off'} Exec ${page}.${exec}`);

  if (active) {
    // EOTN takes over: release the main cue stack so reload state is fresh for next night.
    const cs = config.cueStack;
    ma2.send(`Off Exec ${cs.page}.${cs.exec}`);
    // Activate cue 141 (End of Night cue) with 1s fade
    ma2.send(`Goto Cue 141 Exec ${cs.page}.${cs.exec} Fade 1`);
    state.activeCue = 141;
  } else {
    // When manually deactivating EOTN, clear cues
    const cs = config.cueStack;
    ma2.send(`Off Fader ${cs.page}`);
    ma2.send(`Off Exec ${cs.page}.${cs.exec}`);
    state.activeCue = null;
  }

  broadcastState();
}

function setDisable(target, active) {
  const exec = config.executors.disables[target];
  if (!exec) return;
  state.disables[target] = !!active;
  // Disabled === executor turned Off (inhibitive submaster off → fixtures inhibited)
  ma2.send(`${active ? 'Off' : 'Go'} Exec ${exec.page}.${exec.exec}`);
  broadcastState();
}

function validCueNumber(value) {
  return Number.isFinite(value) && value > 0;
}

function findMaintenanceCue(scope, action, fixtureId) {
  const maintenance = config.fixtureMaintenance;
  const page = maintenance?.cueStack?.page;
  const exec = maintenance?.cueStack?.exec;
  if (!maintenance?.configured || !validCueNumber(page) || !validCueNumber(exec)) return null;

  let cue;
  if (scope === 'global') {
    cue = maintenance.globalActions?.[action]?.cue;
  } else if (scope === 'beam') {
    const fixture = maintenance.beamFixtures?.find(f => f.id === fixtureId);
    cue = fixture?.actions?.[action]?.cue;
  }

  if (!validCueNumber(cue)) return null;
  return { page, exec, cue };
}

function dispatchMaintenanceCommand(scope, action, fixtureId) {
  const assignment = findMaintenanceCue(scope, action, fixtureId);
  if (!assignment) {
    console.warn('[Maintenance] Cue ignored: missing maintenance cue mapping', { scope, action, fixtureId });
    return;
  }

  ma2.send(`Goto Cue ${assignment.cue} Exec ${assignment.page}.${assignment.exec} Fade 0`);

  if (scope === 'beam' && action === 'disable') {
    state.disabledBeamFixtures[fixtureId] = true;
    broadcastState();
  } else if (scope === 'beam' && action === 'enable') {
    state.disabledBeamFixtures[fixtureId] = false;
    broadcastState();
  }
}

function findSpecialEffectCue(groupId, actionId) {
  const effects = config.specialEffects;
  const page = effects?.cueStack?.page;
  const exec = effects?.cueStack?.exec;
  if (!effects?.configured || !validCueNumber(page) || !validCueNumber(exec)) return null;

  const group = effects.groups?.find(g => g.id === groupId);
  const action = group?.actions?.find(a => a.id === actionId);
  if (!validCueNumber(action?.cue)) return null;

  return { page, exec, cue: action.cue };
}

function setSpecialEffectArm(groupId, armed) {
  if (!state.specialEffects[groupId]) return;
  state.specialEffects[groupId].armed = !!armed;
  broadcastState();
}

function clearSpecialEffect(groupId) {
  const groupState = state.specialEffects[groupId];
  if (!groupState) return;
  groupState.armed = false;
  for (const actionId of Object.keys(groupState.fired)) groupState.fired[actionId] = false;
  broadcastState();
}

function fireSpecialEffect(groupId, actionId) {
  const groupState = state.specialEffects[groupId];
  if (!groupState?.armed) {
    console.warn('[SpecialEffects] Fire ignored: group is not armed', { groupId, actionId });
    return;
  }

  const assignment = findSpecialEffectCue(groupId, actionId);
  if (!assignment) {
    console.warn('[SpecialEffects] Fire ignored: missing cue mapping', { groupId, actionId });
    return;
  }

  ma2.send(`Goto Cue ${assignment.cue} Exec ${assignment.page}.${assignment.exec} Fade 0`);
  groupState.fired[actionId] = true;
  groupState.armed = false;
  broadcastState();
}

// ---------- HTTP / WS server ----------
const app = express();
app.use(express.json());

app.get('/api/state', (_req, res) => res.json(snapshotState()));
app.get('/api/health', (_req, res) => res.json({ ok: true, uptimeMs: Date.now() - startedAt }));

app.post('/api/actions/fixture-colour', (req, res) => {
  const fixture = typeof req.body?.fixture === 'string' ? req.body.fixture : '';
  const colour = typeof req.body?.colour === 'string' ? req.body.colour : '';
  const target = findColourControl(fixture, colour);

  if (!target) {
    return res.status(400).json({ ok: false, error: 'Unknown fixture or colour' });
  }

  setFixtureColour(fixture, colour);
  return res.json({
    ok: true,
    fixture,
    colour,
    ma2: state.ma2
  });
});

app.post('/api/actions/stream-deck-sequence', (req, res) => {
  const action = typeof req.body?.action === 'string' ? req.body.action : '';
  const target = config.executors.streamDeckSequences?.[action];

  if (!target || !Number.isFinite(target.page) || !Number.isFinite(target.exec) || !Number.isFinite(target.cue)) {
    return res.status(400).json({ ok: false, error: 'Unknown Stream Deck sequence action' });
  }

  ma2.send(`Goto Cue ${target.cue} Exec ${target.page}.${target.exec} Fade 0`);
  return res.json({
    ok: true,
    action,
    page: target.page,
    exec: target.exec,
    cue: target.cue,
    ma2: state.ma2
  });
});

app.post('/api/actions/stream-deck-momentary', (req, res) => {
  const action = typeof req.body?.action === 'string' ? req.body.action : '';
  const phase = req.body?.phase === 'release' ? 'release' : 'press';
  const target = config.executors.streamDeckSequences?.[action];

  if (!target || !Number.isFinite(target.page) || !Number.isFinite(target.exec)) {
    return res.status(400).json({ ok: false, error: 'Unknown Stream Deck momentary action' });
  }

  const command = phase === 'release'
    ? `Off Exec ${target.page}.${target.exec}`
    : `Go Exec ${target.page}.${target.exec}`;
  ma2.send(command);

  return res.json({ ok: true, action, phase, command, ma2: state.ma2 });
});

// Serve built client if present
const clientDist = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api|ws).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('html').send(`
      <!doctype html>
      <html><body style="background:#0a0a0a;color:#fff;font-family:system-ui;padding:40px">
        <h1>Play Gloucester Room One Panel — backend running</h1>
        <p>Client build not found at <code>client/dist</code>.</p>
        <p>For dev: <code>npm run client:dev</code> (Vite proxies /ws → :3000)</p>
        <p>For prod build: <code>npm run client:build</code></p>
      </body></html>
    `);
  });
}

const server = http.createServer(app);

wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'state', state: snapshotState() }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return; }

    switch (msg.type) {
      case 'haze':            return setHaze(msg.value);
      case 'fadeTime':        return setFadeTime(msg.value);
      case 'cue':             return selectCue(msg.cueNumber);
      case 'endOfNight':      return setEndOfNight(msg.active);
      case 'clear':           return setClear();
      case 'fixtureColour':   return setFixtureColour(msg.fixture, msg.colour);
      case 'allFixtureColours': return setAllFixtureColours(msg.colour);
      case 'fixturePalette':  return setFixturePalette(msg.palette);
      case 'disable':         return setDisable(msg.target, msg.active);
      case 'maintenance':     return dispatchMaintenanceCommand(msg.scope, msg.action, msg.fixtureId);
      case 'specialEffectArm': return setSpecialEffectArm(msg.group, msg.armed);
      case 'specialEffectFire': return fireSpecialEffect(msg.group, msg.action);
      case 'specialEffectClear': return clearSpecialEffect(msg.group);
      case 'forceReconnectMa2':       return ma2.forceReconnect();
      case 'linkEnable':      return link.setEnabled(msg.enabled);
      case 'linkPush':        return link.pushTempo(true);
      case 'rawMa2': {
        if (typeof msg.command === 'string' && msg.command.trim()) {
          ma2.send(msg.command.trim());
        }
        return;
      }
      default: console.warn('[WS] Unknown message type:', msg.type);
    }
  });
});

server.listen(PORT, () => {
  console.log(`[Server] Listening on http://localhost:${PORT}`);
  console.log(`[Server] WebSocket at ws://localhost:${PORT}/ws`);
  ma2.connect();
  if (config.link?.enabled !== false || config.link) link.start();
});

// Periodic uptime broadcast (cheap, keeps Status tab live)
setInterval(() => {
  if (wss && wss.clients.size > 0) {
    broadcast({ type: 'tick', uptimeMs: Date.now() - startedAt, ma2DisconnectedAt: state.ma2DisconnectedAt });
  }
}, 1000);

// Graceful shutdown
function shutdown() {
  console.log('\n[Server] Shutting down...');
  if (ma2.reconnectTimer) {
    clearTimeout(ma2.reconnectTimer);
    ma2.reconnectTimer = null;
  }
  if (ma2.socket) ma2.socket.destroy();
  link.stop();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
