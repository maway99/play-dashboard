# Room 1 Lighting Dashboard — Venue Handover

Last verified: **8 September 2026**

This is the durable operational context for future dashboard work. Keep it updated whenever the venue topology, cue mapping, startup process, or recovery package changes. Do not add passwords, private keys, or other secrets to this file.

## Venue topology

| Item | Venue value |
|---|---|
| Lighting PC / Windows account | `Room 1 Lighting PC` |
| Lighting PC wired address | `2.0.0.10` |
| Lighting network mask | `255.0.0.0` (`/8`) |
| Art-Net node | `2.0.0.1` |
| Maintenance Mac wired address | `2.0.0.50` |
| Operator dashboard | `http://2.0.0.10:3000` |
| grandMA2 onPC | `3.9.61.3` |
| MA2 runtime connection | `127.0.0.1:30000` telnet |
| Bitfocus Companion | `http://127.0.0.1:8000` |
| Carabiner / Ableton Link bridge | `127.0.0.1:17000` |

grandMA2 onPC, Bitfocus Companion, Carabiner, the dashboard server, and the kiosk browser all run on the lighting PC. The production process overrides the development addresses in `config.json` so MA2 and Companion use loopback. Do not route same-PC control traffic through `2.0.0.10`.

The lighting PC can share the lighting-network switch with the MA2/Art-Net node. Preserve `2.0.0.10 / 255.0.0.0`, avoid duplicate addresses, and do not add a gateway to the isolated lighting adapter unless the venue network design changes.

The Art-Net node at `2.0.0.1` was reachable from both the lighting PC and maintenance Mac on 8 September 2026. The lighting PC resolved it on the Ethernet adapter as MAC `02-2B-F5-51-59-92`.

## Canonical control mapping

`config.json` is the canonical machine-readable mapping. The key venue assignments are:

- MA2 speed master: `3.1`
- Main cue stack: executor `4.1`
- Beam colour selector: executor `1.1`
- Strobe colour selector: executor `1.2`
- White strobe: executor `1.101`, cue `1`
- White flash: executor `1.102`, cue `1`
- Lamp control: executor `4.6`, sequence `12`; cue `1` lamps on, cue `2` lamps off
- Main cues: cues `1–5`
- Strobe Tip: cue `6`
- End Of Night: cue `7`
- Strobe Spin: cue `8`
- Med Rnd Chase: cue `9`
- Fast Rnd Chase: cue `10`

The dashboard sections are Slow Cues, Main Cues, Strobes, Buildups, and Laser Cues, with Beam/Strobe colour selection and palettes at the bottom. Placeholder cues are hidden from the operator UI until they receive real MA2 cue numbers. Special Effects is intentionally hidden/unconfigured for now. Lamp controls live in the left sidebar.

Momentary Stream Deck actions must fire on every press and release cleanly. Do not add client-side debounce to flash actions. Strobe controls must use explicit press/on and release/off behavior rather than toggle behavior, which previously caused alternating or apparently random activation.

## Startup and kiosk

The unattended sequence is:

1. Windows signs into the venue account automatically.
2. The interactive Task Scheduler entry runs `start-panel.bat`.
3. grandMA2 onPC is found in its versioned MA Lighting installation folder and started if necessary.
4. Companion, Carabiner, and the PM2-managed dashboard server start.
5. The dedicated browser profile opens `http://127.0.0.1:3000` in kiosk mode.

The configured installation was verified with the Task Scheduler entry ready, passwordless venue autologon enabled, and a visible Edge kiosk session. The installer prefers Chrome when present and falls back to Edge.

Run this on the lighting PC for an end-to-end health check:

```powershell
powershell -ExecutionPolicy Bypass -File C:\play-dashboard\scripts\verify-install.ps1
```

The one remaining destructive acceptance test is a real Windows reboot. Only run it when MA2 may safely be interrupted, then confirm the kiosk and all green status indicators return unattended.

## Art-Net dropout capture

Wireshark `4.6.8` is installed at `C:\Program Files\Wireshark`. Its signature-verified installer is retained at `C:\play-dashboard\tools\Wireshark-4.6.8-x64.exe` (SHA-256 `8eba737cb6875d9b3709228d37893f71125bdc50d7148e24d9cdc755259e9c3a`). Npcap was deliberately not installed while the lighting network was active, because adding its capture driver may briefly disturb the Ethernet adapter or require a reboot. Live Art-Net evidence is collected with Windows Packet Monitor and then opened in Wireshark.

Start a 256 MB circular capture of UDP port `6454`, together with a timestamped reachability monitor for the NET8 at `2.0.0.1`:

```powershell
powershell -ExecutionPolicy Bypass -File C:\play-dashboard\scripts\start-artnet-capture.ps1
```

Immediately after the next visible dropout, stop and convert it:

```powershell
powershell -ExecutionPolicy Bypass -File C:\play-dashboard\scripts\stop-artnet-capture.ps1 -OpenInWireshark
```

Use the Wireshark display filter `artnet || udp.port == 6454`. Check whether ArtDmx packets stop leaving the MA2 PC, continue with sequence gaps, switch source address, or continue normally while the node output fails. That separates a sender/software fault from a switch/cable/node fault. Keep the capture running only while diagnosing; the circular size limit prevents it filling the system drive.

### 8 September 2026 dropout evidence

Capture `C:\play-dashboard\logs\artnet-20260908-150700.pcapng` covered 15:07:01–15:18:25 and was stopped immediately after a reported dropout. It contained 6,200 ArtDmx packets from `2.0.0.10` to `2.0.0.1`, covering wire universes 0–6. Every universe continued through the end of the capture with zero sequence jumps and a maximum refresh gap of 1.072 seconds. The NET8 continued returning unicast ArtPollReply packets with a maximum gap of 5.035 seconds. Windows Packet Monitor reported zero lost capture events and zero packet drops.

The same-day Windows System log also contains a separate confirmed NIC failure at 14:45:38–14:46:24. The Intel I219-LM disconnected and Windows NDIS reset it twice, including the explicit reason that the hardware had stopped responding to driver commands. The adapter had reset five times since initialization. Energy Efficient Ethernet and Ultra Low Power Mode were enabled; the NIC power-management option allowing Windows to turn the device off was already disabled. No NIC reset event coincided with the 15:18 capture.

The node identifies as an ADJ NET8 on firmware `V1.10`. All eight ports are configured as Art-Net outputs at 30 Hz with RDM disabled. Its Signal Loss behavior is currently `Play Show Loop`, not `Hold Last`. Do not change the node or NIC during a show. In a maintenance window, first set Signal Loss to Hold Last, then disable Energy Efficient Ethernet, Ultra Low Power Mode, and Reduce Speed On Power Down on the Intel adapter; applying NIC properties will briefly interrupt Ethernet. Re-capture after each change so the actual fix remains attributable.

## Installation, updates, and recovery

- Production directory: `C:\play-dashboard`
- Golden runtime config: `C:\play-dashboard\config.golden.json`
- Offline recovery bundle: `C:\play-dashboard-offline-backup.zip`
- Previous recovery bundle: `C:\play-dashboard-offline-backup.previous.zip`
- Git remote: `https://github.com/maway99/play-dashboard.git`
- Current Mac maintenance checkout: `/Users/mylesgordon/Documents/Codex/2026-09-04/can/play-dashboard`
- Current Mac offline bundle: `/Users/mylesgordon/Documents/Codex/2026-09-04/can/play-dashboard-windows-offline.zip`

The offline bundle contains the built client, production dependencies, project-local PM2, portable Windows Node, Microsoft Visual C++ runtime, and Carabiner. It supports a first install without internet or Git.

SSH maintenance is enabled on the lighting PC and restricted to the maintenance Mac. The authorized private key stays on the Mac and must never be committed. Connect using the Windows account name and `2.0.0.10`.

Before changing production:

1. Pull or edit the Mac checkout and test locally.
2. Commit and push the change to `main`.
3. Deploy to `C:\play-dashboard`; preserve production loopback overrides.
4. Refresh `config.golden.json` and the offline recovery ZIP when configuration or installer behavior changes.
5. Run `verify-install.ps1` and check `http://2.0.0.10:3000/api/state`.
6. Avoid restarting MA2 or Windows while the lighting system is in use.

## Last verified production state

On 8 September 2026:

- Dashboard server responded on port `3000`.
- MA2 was connected through `127.0.0.1:30000`.
- Companion responded through `127.0.0.1:8000`.
- Carabiner was connected on `127.0.0.1:17000` with one external Ableton Link peer.
- Link tempo was `125 BPM`.
- grandMA2 onPC was running from `C:\Program Files\MA Lighting Technologies\grandma\grandMA2 onPC 3.9.61.3\gma2onpc.exe`.
- The local and lighting-PC copies of the offline recovery bundle were verified byte-for-byte with matching SHA-256 hashes.
