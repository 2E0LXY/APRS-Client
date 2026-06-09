# APRS Client

Cross-platform desktop client for [aprsnet.uk](https://www.aprsnet.uk) — Windows 10/11 and Debian/Ubuntu Linux.

Built with Electron: wraps the full server web UI in a native desktop application with system tray, native OS notifications, GPS positioning, auto member login, two-way filter persistence, and persistent appearance settings.

[![Release](https://img.shields.io/github/v/release/2E0LXY/APRS-Client)](https://github.com/2E0LXY/APRS-Client/releases)
[![Licence: GPL v3](https://img.shields.io/badge/Licence-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

---

## Also available on

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

### Full aprsnet.uk dashboard
- Live APRS station map with clustering, trails, PHG circles
- Station detail modal with overview, history, packets, path tabs
- Weather dashboard, leaderboard, community message board
- ISS/ARISS live position and pass countdown
- Utilities: passcode calculator, Maidenhead converter, beacon generator, symbol picker
- Admin panel (full server configuration, API keys)

### Desktop integration (overlay — `client-overlay.js`)
- **Toolbar** — pinned bar showing callsign, WebSocket state (reads site's `#conn-status`), GPS fix, unread message count, and disconnect button
- **Native OS notifications** — incoming APRS messages trigger Windows/Linux system notifications via the Electron main process
- **Auto member login** — signs in to your aprsnet.uk member account on every page load
- **Two-way filter persistence** (v1.2.1+) — change listeners on all 21 filter checkboxes (`show-aprs`, `show-cwop`, `show-ogn`, `show-ships`, `show-lora`, sub-filters, `mp-drop-pistar`, etc.) capture changes and persist them via `saveSettings`; restored on reconnect
- **GPS map marker** — plots your location using system location services or manual coordinates
- **Theme control** — applies stored dark/light preference via `data-theme` attribute; selectable from the desktop settings panel

### System integration
- System tray icon with context menu (open, reload, disconnect, quit)
- Minimise to tray on close
- Launch on Windows startup (optional, with start-minimised mode)
- Single-instance lock — re-launching focuses the existing window

---

## Changelog

| Version | Changes |
|---------|---------|
| v1.2.1 | Fix WS state dot (reads `#conn-status` DOM, not missing `_wsState` global); two-way filter persistence via change listeners on all 21 checkboxes |
| v1.2.0 | `client-overlay.js` — desktop toolbar, auto member login, OS notifications, GPS forwarding, preference application |
| v1.1.0 | Single sign-on, appearance memory, GPS map marker, quick message composer, launch on startup, single-instance lock |
| v1.0.x | Initial release — Electron wrapper, system tray, native notifications, connect screen |

---

## First Run

1. Launch the app
2. Enter callsign and APRS-IS passcode
3. Optionally enter your aprsnet.uk member account (for auto login and filter sync)
4. Tick **Remember me and connect automatically** to skip this screen next time
5. Click **Connect to APRS Net**

The full web dashboard loads inside the app with a client toolbar at the top.

---

## Settings

Click the ⚙ button in the toolbar to open desktop settings:

| Setting | Description |
|---------|-------------|
| Desktop notifications | Enable/disable OS message notifications |
| Minimise to tray | Window close minimises rather than quits |
| Launch on startup | Register with OS login items |
| Auto-connect | Skip connect screen on launch |
| Theme | Dark / Light — applied to the site on every load |

Full settings (callsign, passcode, member account, position source, appearance preferences) are in the connect screen. Settings are stored in `settings.json` in the app's user-data folder.

---

## Member Map Filter Preferences

The server stores per-member filter preferences (`drop_pistar`, `drop_dstar`, `drop_apdesk`) via `/api/member/preferences`. These sync between the web map, Android app (v2.5.0+), and iOS app — toggle them in any client and the change appears everywhere on next login.

The desktop client persists all 21 site filter checkboxes (type filters, LoRa sub-filters, member drop filters) locally and re-applies them on every page load.

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
main.js              — Electron main: window, tray, IPC, GPS store,
                       single-instance lock, launch-on-startup
preload.js           — Context bridge (exposes aprsClient API to renderer)
renderer/
  connect.html       — Connection/settings screen
  client-overlay.js  — Injected into aprsnet.uk pages:
                       toolbar, notifications, auto-login, GPS, filters, theme
assets/
  icon.png / icon.ico / icon.svg
```

The overlay never modifies the server — it drives the site's own controls, so it works against the live site with no server-side changes required.

---

## Licence

GNU General Public Licence v3 — © 2026 Daren Loxley 2E0LXY
