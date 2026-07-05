# APRS Client

Cross-platform desktop client for [aprsnet.uk](https://www.aprsnet.uk) - Windows 10/11 and Debian/Ubuntu Linux.

Built with Electron as an installable native desktop shell. The client loads a local APRSNET renderer rather than wrapping the website, while using APRSNET REST and WebSocket APIs for live traffic, messaging, station data, weather, analytics, and transmit workflows.

[![Release](https://img.shields.io/github/v/release/2E0LXY/APRS-Client)](https://github.com/2E0LXY/APRS-Client/releases)
[![Licence: GPL v3](https://img.shields.io/badge/Licence-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
![APRS Client desktop](docs/screenshot-desktop.svg)

---

## Also available on

![APRS Net - all platforms](docs/platforms.svg)

| Platform | Repository | Download |
|----------|------------|----------|
| **Android** | [2E0LXY/APRS-Android](https://github.com/2E0LXY/APRS-Android) | [APK](https://github.com/2E0LXY/APRS-Android/releases) |
| **iOS** | [2E0LXY/APRS-iOS](https://github.com/2E0LXY/APRS-iOS) | [Releases](https://github.com/2E0LXY/APRS-iOS/releases) |
| **Self-host the server** | [2E0LXY/Advanced-APRS-Go-server](https://github.com/2E0LXY/Advanced-APRS-Go-server) | [Install guide](https://github.com/2E0LXY/Advanced-APRS-Go-server#installation-debian-12) |

---

## Download

See [Releases](https://github.com/2E0LXY/APRS-Client/releases) for:
- `APRS.Client.Setup.x.x.x.exe` - Windows 10/11 NSIS installer
- `aprs-client_x.x.x_amd64.deb` - Debian/Ubuntu package

---

## Features

### Native APRSNET Desktop Dashboard

The app runs its own local renderer and connects directly to APRSNET. This is not an AI app and not a browser wrapper.

Current desktop foundation:

- Dashboard with live APRSNET status, packet feed, active stations, and recent messages
- Tactical canvas map powered by APRSNET GeoJSON/API data
- Direct APRSNET WebSocket feed for live packets, objects, alerts, and message replay
- REST API proxy in the Electron main process for `/api/*` calls
- Authenticated APRS message, position beacon, object, and raw packet transmit workflows
- Weather, analytics, member login, GPS/manual position, and settings panels

Planned replacement scope:

- Full feature parity with the APRSNET website map, messaging, weather, analytics, admin, sync, and utility tools
- Desktop-native navigation, keyboard shortcuts, tray actions, and notifications
- Windows installer and Debian package builds from the same codebase

### Desktop Integration

The app provides native desktop behaviour:

- **Native dashboard shell** - local renderer with dashboard, tactical map, messages, beacon/object tools, weather, analytics, and settings views
- **APRSNET API proxy** - the Electron main process brokers REST API calls to APRSNET without embedding the website
- **Live WebSocket feed** - the renderer connects directly to APRSNET `/ws` for packets, objects, alerts, and message replay
- **Authenticated transmit tools** - APRS message, position beacon, object, and raw packet workflows preview packets before sending
- **Native OS notifications** - incoming APRS messages can trigger Windows/Linux system notifications via the Electron main process
- **Auto member login** - signs in to the APRSNET member API using saved credentials for member-backed features
- **GPS/manual position support** - uses OS/browser geolocation or configured manual coordinates for beacon workflows

### System Integration

- System tray icon with context menu: Open, Reload, Disconnect, Quit
- Minimise to tray on window close (configurable)
- Launch on Windows startup with optional start-minimised mode
- Single-instance lock - re-launching focuses the existing window rather than opening a second

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

Click Settings in the toolbar to open the Desktop Settings dialog:

| Setting | Description |
|---------|-------------|
| Desktop notifications | Enable / disable OS message notifications |
| Minimise to tray | Window close minimises rather than quits |
| Launch on startup | Register with OS startup items |
| Auto-connect | Skip the connect screen on launch |
| Theme | Dark / Light - applied to the native desktop interface |

Full settings (callsign, passcode, member account, GPS source, appearance) are on the connect screen.  
All settings are stored in `settings.json` in the Electron `userData` folder.

---

## Cross-device Sync

The desktop client participates in the same cross-device sync as Android and iOS:

| What syncs | Trigger | Direction |
|------------|---------|-----------|
| Map filter preferences | Login (auto) | Server -> Desktop |
| Map filter preferences | Any checkbox change | Desktop -> Server -> All devices |
| Message history | Login (auto) | Server -> Desktop (via `loadMemberMessages()`) |
| New messages | Real-time | All devices -> Server -> Desktop (WS `rx` packet) |
| Settings changes | Any save | Any device -> Server -> Desktop (`member_sync` WS push) |
| Ecowitt WX config | Settings save | Desktop -> Server -> All devices |

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
main.js              - Electron main: BrowserWindow, tray, IPC, APRSNET API proxy, GPS store,
                       single-instance lock, launch-on-startup
preload.js           - contextBridge: exposes aprsClient API to local renderer
renderer/
  connect.html       - Connection / settings screen (callsign, passcode, member, GPS)
  native.html        - Local native APRSNET dashboard shell
  native.css         - Desktop dashboard styling
  native-app.js      - REST/WebSocket client, live station state, TX tools
assets/
  icon.png / icon.ico / icon.svg
```

The desktop client does not inject code into the APRSNET website. The renderer is local and talks to APRSNET through REST and WebSocket APIs.

---

## Changelog

| Version | Changes |
|---------|---------|
| v1.3.2 | Removes the legacy website overlay path; native renderer is the only client surface |
| v1.3.1 | Native APRSNET desktop foundation: local renderer, API proxy, WebSocket feed, map, messaging, weather, analytics, and TX tools |
| v1.0.x | Initial Electron desktop shell, system tray, native notifications, connect screen |

---

## Licence

GNU General Public Licence v3 - (c) 2026 Daren Loxley 2E0LXY
