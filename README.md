# Play Gloucester Room One Panel

Touch-panel control interface for Play Gloucester Room One (Hereford). Drives grandMA2 via telnet from a 1920×1080 touchscreen connected to the MA2 PC.

This README is for whoever maintains the venue PC. Architecture and design rationale live in `play-gloucester-room-one-touch-panel-brief.md`.

---

## What runs where

| Process            | Where  | How it starts                                    |
|--------------------|--------|--------------------------------------------------|
| grandMA2 onPC      | MA2 PC | Started by `start-panel.bat` if not already open |
| Bitfocus Companion | MA2 PC | Started and verified by `start-panel.bat`        |
| Node server        | MA2 PC | PM2 — auto-restart on crash                      |
| Chrome kiosk       | MA2 PC | Interactive Task Scheduler entry at logon        |

Panel talks to its own backend on `localhost:3000` via WebSocket. Backend talks to grandMA2 on `127.0.0.1:30000` via telnet.

---

## First-time install

**Right-click `setup.bat` → Run as administrator** (run as the **same Windows user** that auto-logs in at the venue).

`setup.bat` is the full installer (plain batch). It verifies the `2.0.0.10 / 255.0.0.0` lighting adapter, installs dependencies and the Windows Ableton Link bridge, verifies Companion, builds the client, starts PM2, registers an interactive auto-start task, opens Chrome kiosk once at the end, then you reboot to confirm logon auto-start.

If Chrome does not open after reboot: run `start-panel.bat` manually and check the `logs\` folder.

For an on-demand end-to-end check, run `powershell -ExecutionPolicy Bypass -File scripts\verify-install.ps1`. It verifies the lighting NIC, scheduled task, dashboard, local MA2 and Companion routing, Carabiner, and the dedicated Chrome kiosk process.

Prerequisites (install manually before running setup):

- Node.js LTS (20.x or 22.x)
- Git (only required if you want to use `update.bat` for one-click updates)
- Google Chrome
- Bitfocus Companion with the Stream Deck profile configured
- grandMA2 onPC with **Telnet Remote → Login Enabled** in Global Settings

### Offline install over the lighting network

The offline deployment ZIP includes the built client, production dependencies, project-local PM2, a portable Windows Node runtime, Microsoft Visual C++ runtime, and `Carabiner.exe`. No internet connection, Git installation, or separate Chrome installation is required; the kiosk falls back to Microsoft Edge.

1. On the Mac connected to the lighting network, serve the ZIP on the Mac's `2.x.x.x` address.
2. On the lighting PC, download the ZIP in Edge and extract its `play-dashboard` folder to `C:\play-dashboard`.
3. Right-click `C:\play-dashboard\setup.bat` and choose **Run as administrator**.
4. Wait for `INSTALL VERIFIED`, then reboot and confirm the kiosk returns after Windows logon.

The offline bundle is for first installation. Once the PC has internet access, install Git if you want `update.bat` to pull future changes automatically.

---

## Public repo + venue PC (no GitHub login)

Repo: **https://github.com/maway99/play-dashboard** (public). `git pull` on the venue PC needs no GitHub account. `config.json` is included in the repo.

**First time on a venue PC:**

```bat
cd C:\
git clone https://github.com/maway99/play-dashboard.git
cd play-dashboard
```

Review `config.json` if this PC’s IPs differ, then **right-click `setup.bat` → Run as administrator**, reboot.

**Updates on the venue PC (no login):**

```bat
cd C:\play-dashboard
update.bat
```

`update.bat` runs `git pull` (no credentials) then rebuilds and restarts the server. Edits you make to `config.json` on the PC will be overwritten if the same file changed on GitHub — edit `config.json` in git on your laptop if you want pulls to apply everywhere.

---

## Moving to another PC

PM2 remembers processes **per Windows user account**, not inside this project folder. On a new machine you will see `process or namespace play-gloucester-room-one-panel not found` until the app is registered once.

**On each new PC (once):**

1. Install **Node.js LTS** and **Google Chrome**
2. Copy or clone the project (e.g. `C:\play-dashboard\`)
3. Edit `config.json` if IPs differ
4. **Right-click `setup.bat` → Run as administrator**
5. Reboot to test auto-start

**After that:** use `update.bat` for code changes, or `start-panel.bat` to start/restart the server only.

Do **not** rely on `pm2 restart play-gloucester-room-one-panel` alone on a PC that has never run `setup.bat`.

---

## Updating

Double-click `update.bat`. It runs `git pull`, reinstalls any changed dependencies, rebuilds the client, and restarts the server via PM2. The Chrome kiosk reconnects to the new server automatically — no need to relaunch it.

If you only edited `config.json` (cue mappings, IPs, labels), you don't need a rebuild:

```
pm2 restart play-gloucester-room-one-panel
```

Config-only edits take effect on the next server start. The client picks up the new config on its next WebSocket connect.

---

## Configuration — `config.json`

All venue-specific values live here. **No hardcoded values in code.**

| Section          | What to set                                                                 |
|------------------|------------------------------------------------------------------------------|
| `ma2.ip`         | `127.0.0.1` if panel is on the same PC as onPC (recommended)                |
| `ma2.password`   | Whatever you set in MA2's Telnet Remote settings                            |
| `cueStack`       | Page/exec of the single cue stack the panel drives                          |
| `colourControls.*` | Beam/Strobe colour-picker cue mappings and bottom palette controls |
| `fixtureMaintenance` | Maintenance-tab rig layout plus lamp/reset/disable cue mappings       |
| `specialEffects` | Lighting-tab Confetti and CO2 arm/fire controls plus cue mappings      |
| `streamDeck.companion` | Bitfocus Companion bridge host plus Stream Deck button locations |
| `cueBanks.*`     | Lighting cue-library buttons; `cue: null` means unassigned and will not dispatch |
| `executors.haze` | Fader executor for haze level                                               |
| `executors.endOfNight` | Page, executor, and cue for the dedicated End-of-Night control        |
| `executors.disables` | Inhibitive submaster execs per fixture group                            |
| `defaults.fadeTime`  | Fade time on first launch (currently 0.5s)                              |

`config.json` is read once at server start. Restart PM2 after editing.

The checked-in `config.json` uses `2.0.0.10` for development from the Mac. The Windows PM2 definition overrides MA2 to `127.0.0.1:30000` and Companion to `http://127.0.0.1:8000`, because both applications run on the lighting PC. This avoids sending same-machine traffic through the Art-Net/MA-Net adapter.

### Cue library

The Lighting tab keeps separate Slow, Strobe, Main, Buildup, and Laser cue sections while hiding unassigned cue buttons. Beam and Strobe colour controls plus palette presets sit in the bottom band.

Each cue entry has a stable `id`, an operator-facing `label`, and a `cue` value. Leave `cue` as `null` until the matching grandMA2 cue exists in the show file. The Beam colour row uses executor 1.1 and the Strobe colour row uses executor 1.2. Main movement cues remain on executor 4.1 and reapply the currently selected Beam and Strobe colours after firing.

### Special effects

The Lighting tab includes local arm controls for Confetti and CO2. Fire actions stay disabled until `specialEffects.configured` is `true`, `specialEffects.cueStack.page` and `exec` are finite numbers, and the individual fire action has a finite `cue`.

To activate special effects, provide exact grandMA2 cue assignments for:

- `specialEffects.cueStack.page`
- `specialEffects.cueStack.exec`
- `specialEffects.groups[confetti].actions[fire1].cue`
- `specialEffects.groups[confetti].actions[fire2].cue`
- `specialEffects.groups[co2].actions[fire].cue`

Do not enable these cues until the physical effect routing has been verified against the final grandMA2 show file.

### Stream Deck / Companion bridge

The server can watch selected Bitfocus Companion buttons through Companion's local HTTP API and keep arm-button feedback in sync with the dashboard. `streamDeck.companion.baseUrl` defaults to `http://127.0.0.1:8000`. Button `page`, `row`, and `column` values are zero-based for the row and column numbers used by Companion's `/api/location/:page/:row/:column` routes.

The current mapping watches:

| Button | Companion page/row/column | Panel action | MA2 assignment |
|--------|----------------------------|--------------|----------------|
| Strobes - White | `1 / 0 / 0` | Momentary MA2 sequence | `Cue 1 Exec 1.101` |
| Strobes - White rnd | `1 / 0 / 1` | Momentary MA2 sequence | `Cue 1 Exec 1.103` |
| Strobes - Red | `1 / 0 / 2` | Momentary MA2 sequence | `Cue 1 Exec 1.104` |
| Strobes - Blue | `1 / 0 / 3` | Momentary MA2 sequence | `Cue 1 Exec 1.105` |
| Control - Clear | `1 / 0 / 6` | Dashboard Clear | Uses `Off Fader 4`, `Off Exec 4.1`, and clears End of Night if active |
| Control - Blackout | `1 / 0 / 7` | Momentary MA2 sequence | `Cue 1 Exec 1.109` |
| Flashes - White | `1 / 1 / 0` | Momentary MA2 sequence | `Cue 1 Exec 1.102` |
| Flashes - White chase | `1 / 1 / 1` | Momentary MA2 sequence | `Cue 1 Exec 1.106` |
| Flashes - Red | `1 / 1 / 2` | Momentary MA2 sequence | `Cue 1 Exec 1.107` |
| Flashes - Blue | `1 / 1 / 3` | Momentary MA2 sequence | `Cue 1 Exec 1.108` |
| Confetti - Arm | `1 / 1 / 6` | Dashboard arm toggle | Local panel state |
| CO2 - Arm | `1 / 1 / 7` | Dashboard arm toggle | Local panel state |
| Confetti - Fire 1 | `1 / 2 / 6` | Fire-key visual feedback | Follows Confetti arm state |
| CO2 - Fire | `1 / 2 / 7` | Fire-key visual feedback | Follows CO2 arm state |
| Confetti - Fire 2 | `1 / 3 / 6` | Fire-key visual feedback | Follows Confetti arm state |

Momentary MA2 sequence buttons trigger the mapped `executors.streamDeckSequences` cue on press and send `Off Exec` for that executor on release. Confetti and CO2 arm buttons toggle the same local arm state shown on the Lighting dashboard, and the server pushes active/inactive colours plus `ARM`/`ARMED` text back to those Companion buttons. Fire buttons grey out when their effect group is disarmed and switch to the armed warning style when armed.

`pollMs` and `confirmPolls` control bridge polling and active-state filtering. Momentary sequence controls execute every distinct Companion press event without a cooldown, allowing rapid repeated taps. Per-button `cooldownMs` remains available for latching controls such as Clear and effect-arm buttons.

### Fixture colour wheel

The shared fixture-colour controls are based on the official CLB260 user manual DMX protocol. The manual lists the colour wheel on **CH8**, not CH7: `000-010` open, `011-015` through `061-065` as COLOR 1-11, `066-070` open, then indexed colour-wheel and rainbow ranges. The official product page describes this as 11 fixed dichroic colours plus white; Betopper's wheel images label COLOR 1-11 as Red, Green, Blue, Yellow, Orange, Rose red, Light blue, Grass green, Cyan, 3200K, and 5600K.

The panel's cue mappings use the same order:

| Slot | DMX range | Panel label |
|------|-----------|-------------|
| Open | `000-010` / `066-070` | Open |
| COLOR 1 | `011-015` | Red |
| COLOR 2 | `016-020` | Green |
| COLOR 3 | `021-025` | Blue |
| COLOR 4 | `026-030` | Yellow |
| COLOR 5 | `031-035` | Orange |
| COLOR 6 | `036-040` | Rose red |
| COLOR 7 | `041-045` | Light blue |
| COLOR 8 | `046-050` | Grass green |
| COLOR 9 | `051-055` | Cyan |
| COLOR 10 | `056-060` | 3200K filter |
| COLOR 11 | `061-065` | 5600K filter |

### Fixture maintenance controls

The **Maintenance** tab shows a top-down maintenance diagram with 12 inner beam fixtures and 12 outer strobe references. Only the inner beams are individually selectable. Lamp, reset, disable, and enable actions are intentionally disabled until exact grandMA2 cue assignments are added to `fixtureMaintenance`.

To activate this tab's maintenance actions, set `fixtureMaintenance.configured` to `true` and provide:

- `fixtureMaintenance.cueStack.page`
- `fixtureMaintenance.cueStack.exec`
- `fixtureMaintenance.globalActions.lampOn.cue`
- `fixtureMaintenance.globalActions.lampOff.cue`
- `fixtureMaintenance.globalActions.reset.cue`
- `fixtureMaintenance.beamFixtures[*].actions.lampOn.cue`
- `fixtureMaintenance.beamFixtures[*].actions.lampOff.cue`
- `fixtureMaintenance.beamFixtures[*].actions.reset.cue`
- `fixtureMaintenance.beamFixtures[*].actions.disable.cue`
- `fixtureMaintenance.beamFixtures[*].actions.enable.cue`

Do not enable these cues until the fixture IDs/groups and cue assignments have been verified against the final grandMA2 show file.

---

## Ableton Link tempo sync

The panel can follow the tempo of an Ableton Link session and push it to a grandMA2 **speed master**,
so effects that run off `SpecialMaster 3.1` stay locked to the DJ. With no Link session available the
desk is held at a default tempo (125 BPM unless you change `link.defaultBpm`).

### How it works

```
Mac running Live (Link on)  ──network──▶  Carabiner (Link peer, on the lighting PC)
                                               │ TCP 127.0.0.1:17000
                                               ▼
                                          server.js  ──telnet──▶  MA2: SpecialMaster 3.1 At <bpm>
```

[Carabiner](https://github.com/Deep-Symmetry/carabiner) is a small open-source daemon that joins the
Link session on the network and exposes it over a local TCP socket. `server.js` reads the session
tempo from it and sends it to MA2 whenever it changes by more than `minChangeBpm` (rate-limited to one
command per `minIntervalMs`). The panel shows the live tempo and its source in the **Tempo** block of
the control bar; tapping it toggles between following Link and holding the default.

Fallback rules (all lead to the default tempo being sent to MA2):

- Carabiner is not running / not reachable
- Carabiner is running but sees **no peers** (nothing on the network has Link enabled)
- Following is switched off on the panel

### Setting up the lighting PC

1. Download the Windows Carabiner release from the Carabiner GitHub releases page and put it at
   `tools/Carabiner.exe` (or anywhere, and set `link.carabiner.path`).
2. Either start it yourself alongside the panel server, or let the server manage it: set
   `link.carabiner.autoStart` to `true` and the server will run `Carabiner.exe --daemon --port 17000`
   and restart it if it exits.
3. Windows Firewall: allow Carabiner on **UDP 20808** (Link discovery, multicast `224.76.78.75`).
   The TCP port 17000 is local only and needs no rule.
4. Restart the panel server. The sidebar **Link** row should read *No peers* (bridge up, nothing
   playing yet). *No bridge* means Carabiner is not reachable.

### Connecting the Mac

Link works over any shared network; the simplest reliable setup for a booth is a **direct network
cable** between the Mac and the lighting PC:

- Give both ends a static address on the same subnet **or** just let them self-assign (169.254.x.x
  link-local works fine for Link - it only needs multicast on that interface).
- Do not route the Mac through a guest Wi-Fi network; most block multicast.
- In Live, click **Link** (top-left of the transport). The Link row on the panel turns green and shows
  the tempo within a second or two.

> **Link behaviour to be aware of:** when an app *joins* a Link session it adopts the session's
> current tempo - that is how Link works, for every app. Because Carabiner is always running, Live
> will jump to the parked default (125 BPM) the moment Link is switched on. Just set the tempo in
> Live afterwards; the panel and MA2 follow immediately.

### `config.json` keys

```json
"link": {
  "enabled": true,              // false = never follow, always send defaultBpm
  "defaultBpm": 125,
  "minChangeBpm": 0.1,          // ignore smaller wobbles
  "minIntervalMs": 400,         // never send to MA2 faster than this
  "pollIntervalMs": 1000,       // how often we ask Carabiner for status
  "reconnectIntervalMs": 3000,
  "carabiner": { "host": "127.0.0.1", "port": 17000, "autoStart": false, "path": "tools/Carabiner.exe" },
  "ma2": { "speedMaster": 1, "command": "SpecialMaster 3.{speedMaster} At {bpm}" }
}
```

`ma2.command` is a template; `{speedMaster}` and `{bpm}` are substituted. Change it if your show uses
a different speed master or a macro instead.

### Checking it

The **Status** page (tap MA2 or Link in the sidebar) has an *Ableton Link* card showing the bridge
connection, peer count, Link tempo, effective tempo and the last command sent to MA2, plus a
**Resend tempo to MA2** button.

## Daily operations

**Normal start:** PC boots → MA2 launches → PM2 brings the server up → Chrome opens in kiosk mode → panel shows MA2 status in the sidebar.

**Server crashed silently:** PM2 will have restarted it within ~2s. Verify with `pm2 status`. The panel UI auto-reconnects.

**MA2 crashed or restarted:** Panel shows a full-screen **CONSOLE OFFLINE — Reconnecting…** overlay. All state resets to neutral. When MA2 comes back, the overlay dismisses automatically. Staff re-select the cue they want — the panel does **not** try to replay stale state into a freshly-loaded show file.

**Exit kiosk to use the PC:** `Alt+F4` closes Chrome. PM2 keeps the server running in the background.

---

## Troubleshooting

| Symptom                                          | First check                                                            |
|--------------------------------------------------|------------------------------------------------------------------------|
| Panel stuck on "CONSOLE OFFLINE"                 | `pm2 logs play-gloucester-room-one-panel` → look for `ECONNREFUSED` (MA2 not listening on 30000) or login rejection. Verify MA2 → Setup → Network → Telnet Remote → Login Enabled. |
| Buttons press but nothing happens in MA2         | Status tab → Last MA2 response. If empty, login didn't complete. If you see `Error :` the executor number in `config.json` doesn't match the show file. Use the **Send Raw MA2 Command** box on the Status tab to test syntax. |
| Panel server offline overlay                     | `pm2 status`. If missing: double-click `start-panel.bat` or run `setup.bat`. If looping: `pm2 logs play-gloucester-room-one-panel`. |
| Chrome didn't auto-launch on boot                | `Task Scheduler → Play Gloucester Room One Chrome Kiosk → Last Run Result`. Check `logs\kiosk-startup.log`. |
| Need to update on the fly                        | Double-click `update.bat`. |

The **Status tab** in the panel itself is the primary diagnostic surface — connection state, last MA2 command/response, and a raw-command input.

---

## File map

```
server.js              # Express + WS + MA2 telnet
config.json            # All venue-specific mappings + IPs + labels
ecosystem.config.cjs   # PM2 process definition
setup.bat              # First-time installer (run as admin)
start-panel.bat        # Start everything: MA2 onPC, panel server, Chrome kiosk (Task Scheduler runs this at logon)
update.bat             # One-click updater
scripts/pm2-ensure-panel.bat  # PM2 helper (used by setup/update/start)
scripts/start-panel-server.bat
scripts/dismiss-gma2-popup.ps1        # Clears the onPC start-up dialog
scripts/close-play-gloucester-room-one-chrome.ps1  # Closes only the kiosk Chrome profile
scripts/get-carabiner.ps1             # Downloads the Ableton Link bridge into tools\
tools/                 # Carabiner binary (not in git)
client/                # React + Vite source
client/dist/           # Built frontend (Express serves from here)
LAUNCH_CHECKLIST.md    # Pre-go-live verification checklist
```
