# APRS Client

Cross-platform desktop APRS client for the [Advanced APRS Go Server](https://github.com/2E0LXY/Advanced-APRS-Go-server).

Built with Electron — wraps the full server web UI in a native desktop application with system tray, native notifications, GPS positioning, single sign-on, and persistent connection and appearance settings.

## Features

### Desktop integration
- Live APRS map with station icons, clustering, trails
- Station detail modal (overview, history, packets, path tabs)
- Weather dashboard, leaderboard, community message board
- ISS/ARISS live position and pass countdown
- Utilities: passcode calculator, Maidenhead converter, beacon generator, symbol picker
- Admin panel (full server configuration, webhooks, API keys)
- System tray with quick open/reload/disconnect
- Native Windows desktop notifications for APRS messages

### New in v1.1.0
- **Single sign-on** — automatically logs in to your aprsnet.uk member account
- **Appearance memory** — remembers and re-applies how you like the website set up:
  dark/light theme, map style, station filters, and feature toggles
  (auto-fit zoom, station ghosting, propagation lines, weather radar)
- **My location on the map** — plots your own station position on the map using
  Windows location services (GPS/Wi-Fi), with a manual lat/lon fallback
- **Quick message composer** — send APRS messages directly from the client toolbar
- **Launch on Windows startup** — optional, with start-minimised-to-tray
- **Single-instance** — re-launching focuses the existing window

## Server

This client is dedicated to **www.aprsnet.uk** — the server URL is fixed, so there is
nothing to configure. Just enter your callsign and connect.

## Download

See [Releases](https://github.com/2E0LXY/APRS-Client/releases) for:
- `APRS-Client-Setup-x.x.x.exe` — Windows 10/11 installer (NSIS)
- `aprs-client_x.x.x_amd64.deb` — Debian/Ubuntu package

Every push to `main` builds installers automatically via GitHub Actions; pushing a
`v*` tag publishes them as a Release.

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

## First Run

1. Launch the app
2. Enter your callsign and APRS-IS passcode
3. Optionally enter your aprsnet.uk member account for single sign-on
4. Tick "Remember me and connect automatically" to skip this screen next time
5. Click **Connect to APRS Net**

The server web UI loads inside the app with a client toolbar at the bottom showing
your callsign, your plotted location, and Message / My Location / Settings /
Disconnect buttons.

## Settings

Open **Settings** from the toolbar to configure:
- APRS callsign and passcode
- Website member account (for single sign-on)
- Position source — GPS (automatic), manual coordinates, or off
- Startup behaviour — auto-connect, minimise to tray, start minimised,
  launch on Windows startup
- Website appearance — set the site up how you like it, then click
  "Capture current website layout" to have the client re-apply it every time

Settings are stored locally in `settings.json` in the app's user-data folder.

## Member map filter preferences

The aprsnet.uk server stores per-member map filter preferences
(`drop_pistar`, `drop_dstar`, `drop_apdesk` and others). The web map
and the Android client v2.5.0+ both read and write these via
`/api/member/preferences`. The Windows client currently reads only
server-wide admin Drop Filters; per-member preference sync may be
added in a future release. See the
[server README](https://github.com/2E0LXY/Advanced-APRS-Go-server)
for the full preference schema.

## Architecture

```
main.js              — Electron main process: window, IPC, tray, GPS position store,
                       single-instance lock, launch-on-startup
preload.js           — Context bridge (exposes aprsClient API to the renderer)
renderer/
  connect.html       — Connection/settings screen (shown on first launch)
  client-overlay.js  — Injected into server pages: toolbar, native notifications,
                       appearance-preference sync, single sign-on, GPS map marker,
                       quick message composer
assets/
  icon.png           — App icon (512x512)
  icon.ico           — Windows icon
```

The client never modifies the website — `client-overlay.js` drives the site's own
controls (the same ones a user would click), so it works against the live site
with no server-side changes.

## Licence

GNU General Public Licence v3 — © 2026 Daren Loxley 2E0LXY
