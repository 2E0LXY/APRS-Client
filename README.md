# APRS Client

Cross-platform desktop APRS client for the [Advanced APRS Go Server](https://github.com/2E0LXY/Advanced-APRS-Go-server).

Built with Electron — wraps the full server web UI in a native desktop application with system tray, native notifications, and persistent connection settings.

## Features

- Live APRS map with station icons, clustering, trails
- Station detail modal (overview, history, packets, path tabs)
- Packet path visualiser on map
- Weather dashboard with historical graphs
- APRS-IS messaging (send and receive)
- Watchlist with native desktop notifications
- ISS/ARISS live position and pass countdown (SGP4)
- Utilities: passcode calculator, Maidenhead converter, beacon generator, symbol picker
- Leaderboard and community message board
- Admin panel (full server configuration, webhooks, API keys)
- System tray with quick connect/disconnect
- Settings saved locally (server URL, callsign, passcode, preferences)

## Default Server

Connects to **www.aprsnet.uk** by default. Can be configured to connect to any:
- Advanced APRS Go Server instance
- Standard APRS-IS server (aprs2.net, etc.)

## Download

See [Releases](https://github.com/2E0LXY/APRS-Client/releases) for:
- `APRS-Client-Setup-x.x.x.exe` — Windows 10/11 installer (NSIS)
- `aprs-client_x.x.x_amd64.deb` — Debian/Ubuntu package

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

# Build Windows EXE (requires Windows or Wine)
npm run build:win

# Build Linux DEB
npm run build:linux
```

### Build outputs
- `dist/APRS-Client-Setup-1.0.0.exe` — Windows NSIS installer
- `dist/aprs-client_1.0.0_amd64.deb` — Debian package

## First Run

1. Launch the app
2. Select a preset server or enter a custom URL
3. Enter your callsign and APRS-IS passcode
4. Tick "Auto-connect on startup" to skip this screen next time
5. Click **Connect to Server**

The server web UI loads inside the app with a thin client toolbar at the bottom showing your callsign, connected server, a Settings button, and a Disconnect button.

## Architecture

```
main.js           — Electron main process, window management, IPC, tray
preload.js        — Context bridge (exposes aprsClient API to renderer)
renderer/
  connect.html    — Connection/settings screen (shown on first launch)
  client-overlay.js — Injected into server pages: toolbar, native notifications,
                      callsign auto-fill
assets/
  icon.png        — App icon (512x512)
  icon.ico        — Windows icon
```

## Licence

GNU General Public Licence v3 — © 2026 Daren Loxley 2E0LXY
