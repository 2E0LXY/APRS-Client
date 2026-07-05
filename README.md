# APRS Client

Cross-platform desktop client for [aprsnet.uk](https://www.aprsnet.uk) — Windows 10/11 and Debian/Ubuntu Linux.

Built with Electron as an installable native desktop shell. The client loads a local APRSNET renderer rather than wrapping the website, while using APRSNET REST and WebSocket APIs for live traffic, messaging, station data, weather, analytics, and transmit workflows.

[![Release](https://img.shields.io/github/v/release/2E0LXY/APRS-Client)](https://github.com/2E0LXY/APRS-Client/releases)
[![Licence: GPL v3](https://img.shields.io/badge/Licence-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
![APRS Client desktop](docs/screenshot-desktop.svg)

---

## Also available on

![APRS Net — all platforms](docs/platforms.svg)

| Platform | Repository | Download |
|----------|------------|----------|
| **Android** | [2E0LXY/APRS-Android](https://github.com/2E0LXY/APRS-Android) | [APK](https://github.com/2E0LXY/APRS-Android/releases) |
| **iOS** | [2E0LXY/APRS-iOS](https://github.com/2E0LXY/APRS-iOS) | [Releases](https://github.com/2E0LXY/APRS-iOS/releases) |
| **Self-host the server** | [2E0LXY/Advanced-APRS-Go-server](https://github.com/2E0LXY/Advanced-APRS-Go-server) | [Install guide](https://github.com/2E0LXY/Advanced-APRS-Go-server#installation-debian-12) |

---

## Download

See [Releases](https://github.com/2E0LXY/APRS-Client/releases) for:
- `APRS.Client.Setup.x.x.x.exe` — Windows 10/11 NSIS installer
- `aprs-client_x.x.x_amd64.deb` — Debian/Ubuntu package

---

## Features

### Native APRSNET Desktop Dashboard

The app runs its own local renderer and connects directly to APRSNET:

- Live APRS station map with clustering, trails, PHG range circles, solar day/night terminator
- TOCALL-based station classification (LoRa, MMDVM/DMR, OGN, CWOP weather)
- Station type filters and sub-filters; station ghosting; auto-fit zoom
- **Smart search** (Ctrl+K) — searches callsigns, comments, messages, devices
- **Time-lapse replay** — rewinds station history at 10×–240× speed
- Station detail modal with history, packet log, path tabs, QRZ.com profile
- **Messages centre** — conversations inbox sidebar, thread view, compose bar, 5-row traffic log
- Weather dashboard, UK Met Office severe weather warnings, animated RainViewer rain radar
- Propagation analytics, activity and coverage meters, activity heatmap
- ISS / ARISS live position and pass countdown
- Utilities: passcode calculator, Maidenhead converter, beacon generator, symbol picker
- Admin panel: full server configuration, API keys, webhooks, audit log, ban list, backup/restore
- **Geo-fence Alerts panel** — create and manage server-side enter/exit rules
- **Member settings panel** — quiet hours, map filter preferences, **Ecowitt weather station** configuration (API keys, MAC, beacon interval, WX SSID, pressure source, optional comment fields, Test Connection button)

### Desktop Integration

The app provides native desktop behaviour:

- **Native dashboard shell** — local renderer with dashboard, tactical map, messages, beacon/object tools, weather, analytics, and settings views
- **APRSNET API proxy** — the Electron main process brokers REST API calls to APRSNET without embedding the website
- **Live WebSocket feed** — the renderer connects directly to APRSNET `/ws` for packets, objects, alerts, and message replay
- **Authenticated transmit tools** — APRS message, position beacon, object, and raw packet workflows preview packets before sending
- **Native OS notifications** — incoming APRS messages can trigger Windows/Linux system notifications via the Electron main process
- **Auto member login** — signs in to the APRSNET member API using saved credentials for member-backed features
- **GPS/manual position support** — uses OS/browser geolocation or configured manual coordinates for beacon workflows

### System Integration

- System tray icon with context menu: Open, Reload, Disconnect, Quit
- Minimise to tray on window close (configurable)
- Launch on Windows startup with optional start-minimised mode
- Single-instance lock — re-launching focuses the existing window rather than opening a second

---

## First Run

1. Launch the app
2. Enter callsign and APRS-IS passcode
3. Enter your aprsnet.uk member account credentials (for auto-login, filter sync, and direct messaging)
4. Tick **Remember me and connect automatically** to skip this screen on future launches
5. Click **Connect to APRS Net**

The native desktop dashboard opens and connects to APRSNET.

---

## Settings

Click ⚙ in the toolbar to open the Desktop Settings dialog:

| Setting | Description |
|---------|-------------|
| Desktop notifications | Enable / disable OS message notifications |
| Minimise to tray | Window close minimises rather than quits |
| Launch on startup | Register with OS startup items |
| Auto-connect | Skip the connect screen on launch |
| Theme | Dark / Light — applied to the site on every page load |

Full settings (callsign, passcode, member account, GPS source, appearance) are on the connect screen.  
All settings are stored in `settings.json` in the Electron `userData` folder.

---

## Cross-device Sync

The desktop client participates in the same cross-device sync as Android and iOS:

| What syncs | Trigger | Direction |
|------------|---------|-----------|
| Map filter preferences | Login (auto) | Server → Desktop |
| Map filter preferences | Any checkbox change | Desktop → Server → All devices |
| Message history | Login (auto) | Server → Desktop (via `loadMemberMessages()`) |
| New messages | Real-time | All devices → Server → Desktop (WS `rx` packet) |
| Settings changes | Any save | Any device → Server → Desktop (`member_sync` WS push) |
| Ecowitt WX config | Settings save | Desktop → Server → All devices |

---

## Building from Source

### Prerequisites
- Node.js 18+
- npm

### Install and build
```bash
git clone https://github.com/2E0LXY/APRS-Client
cd APRS-Client
npm install

# Run in development
npm start

# Build Windows installer (requires Windows or Wine)
npm run build:win -- --publish never

# Build Linux DEB
npm run build:linux -- --publish never
```

Every push to `main` builds installers; pushing a `v*` tag publishes them as a Release.

---

## Architecture

```
main.js              — Electron main: BrowserWindow, tray, IPC, APRSNET API proxy, GPS store,
                       single-instance lock, launch-on-startup
preload.js           — contextBridge: exposes aprsClient API to local renderer
renderer/
  connect.html       — Connection / settings screen (callsign, passcode, member, GPS)
  native.html        — Local native APRSNET dashboard shell
  native.css         — Desktop dashboard styling
  native-app.js      — REST/WebSocket client, live station state, TX tools
  client-overlay.js  — Legacy compatibility overlay for the old website-wrapper mode
                         • theme application
                         • member_sync WS event handling
assets/
  icon.png / icon.ico / icon.svg
```

The overlay never modifies the server — it drives the site's own DOM controls, so it remains fully compatible with any server update.

---

## Changelog

| Version | Changes |
|---------|---------|
| v1.2.2 | Geo-fence alert hook in overlay — forwards `alert` WS events to Electron `ipcRenderer` for native OS notification |
| v1.2.1 | Fix WS state dot (reads `#conn-status` DOM correctly); two-way filter persistence via change listeners on all 21 checkboxes |
| v1.2.0 | `client-overlay.js` — desktop toolbar, auto member login, OS notifications, GPS forwarding, preference application |
| v1.1.0 | Single sign-on, appearance memory, GPS map marker, quick message composer, launch on startup, single-instance lock |
| v1.0.x | Initial release — Electron wrapper, system tray, native notifications, connect screen |

---

## Licence

GNU General Public Licence v3 — © 2026 Daren Loxley 2E0LXY
