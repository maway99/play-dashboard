# Launch Checklist — Play Gloucester Room One Panel

Run through this **on-site, on the actual lighting PC, with the MA2 show file finalised**. Anything unchecked is a known risk to opening night.

---

## Pre-install

- [ ] grandMA2 show file is finalised; every cue/executor referenced in `config.json` exists in the show
- [ ] MA2 → Setup → Network → **Telnet Remote → Login Enabled = Yes**
- [ ] A `password` is set in MA2 for the panel's user (not blank for production)
- [ ] Node.js LTS installed on the MA2 PC
- [ ] Google Chrome installed on the MA2 PC
- [ ] Bitfocus Companion installed and its Stream Deck profile imported
- [ ] Dedicated lighting Ethernet adapter is `2.0.0.10 / 255.0.0.0`

## Install

- [ ] Project copied to a permanent path (e.g. `C:\play-gloucester-room-one-panel\`)
- [ ] `config.json` reviewed end-to-end — every executor number cross-checked against the show file
- [ ] `setup.bat` run as Administrator, no errors
- [ ] `pm2 status` shows `play-gloucester-room-one-panel` as `online`
- [ ] `http://localhost:3000` loads — Status tab shows MA2 connection state
- [ ] Companion responds on `http://localhost:8000`
- [ ] Status confirms runtime MA2 host `127.0.0.1` and Companion `127.0.0.1:8000`

## Smoke test (server connected, panel open)

For each, press the panel control and confirm the **MA2 command line** reacts correctly:

- [ ] **Haze slider** — drag to 50, release. MA2 Fader for haze exec moves. Drag to 0.
- [ ] **Fade Time** — switch between 0s / 0.5s / 2s. Pick 0s for next test.
- [ ] **Colour controls** — test Both, Beams, Strobes, and each palette. Confirm only the mapped Beam and Strobe colour cues fire.
- [ ] **Maintenance tab cue mapping** — if lamp/reset/disable controls are required, confirm `fixtureMaintenance.configured = true` and every global/beam maintenance cue maps to the final MA2 show file.
- [ ] **Maintenance tab safety** — confirm All lamps off and Reset all fixtures require confirmation before dispatch.
- [ ] **Cue from each bank** — after assigning cues, test Slow, Main, Show, Buildups, and Laser Cues (1 cue per bank minimum). Confirm the right rig look comes up each time.
- [ ] **Cue swap** — fire a cue, then a different one. Previous deactivates, new one activates.
- [ ] **Blackout** — toggle on, rig blacks out. Toggle off, rig comes back to last cue.
- [ ] **End of Night** — fire while a cue is active. EOTN sequence runs and previous cue clears.
- [ ] **EOTN release** — with EOTN active, press any cue. EOTN goes off, new cue fires.
- [ ] **Disables** — toggle each fixture group off. That group goes dark. Toggle back on, returns. Sidebar badge increments correctly.

## Failure-mode test

- [ ] Stop MA2 onPC. Panel shows **CONSOLE OFFLINE** overlay within ~5s. All Lighting controls reset.
- [ ] Relaunch MA2. Overlay dismisses automatically. Verify cues fire again.
- [ ] `pm2 stop play-gloucester-room-one-panel` → panel shows **PANEL SERVER OFFLINE**. `pm2 start play-gloucester-room-one-panel` → panel reconnects within ~2s.
- [ ] Kill the Node process with Task Manager (not pm2). PM2 should auto-restart within 2s.

## Reboot test (most important)

- [ ] Reboot the MA2 PC.
- [ ] Windows signs into the venue operator account automatically, or the operator signs in once after boot.
- [ ] No further intervention needed — within ~90s of logon you should see the kiosk panel with green status.
- [ ] If anything is red after 2 minutes, check Task Scheduler → "Last Run Result" for both Play Gloucester Room One entries.

## Hardening for go-live

- [ ] Disable Windows Update auto-restart during venue hours
- [ ] Disable Windows notification toasts (do not let them pop over the kiosk)
- [ ] Set the PC's display sleep to **Never** while plugged in
- [ ] Disable screensaver
- [ ] Confirm Windows tablet on-screen keyboard auto-popup is disabled (the installer applies this for the current user)
- [ ] Test that the touchscreen tap registers as a single click event (some panels send right-click on long press — change driver settings if needed)
- [ ] Document the MA2 telnet password somewhere only the venue team can access
- [ ] Take a snapshot copy of the working `config.json` and stash it in the project root as `config.golden.json`

## Night 1

- [ ] Be physically on-site for the first hour
- [ ] Have a laptop ready that can SSH into / RDP onto the PC to run `pm2 logs` if something goes wrong
- [ ] Print this page and circle anything you skipped
