# APRSNET Desktop

Installable Windows and Debian desktop client for APRSNET.UK.

This repository is now the native APRSNET desktop application. It is not a browser wrapper, not a hosted web view, and not an AI application. The app runs a local Electron renderer and uses APRSNET as the data connection to the APRS networks through the APRSNET REST API and WebSocket feed.

## Current Scope

- Native desktop cockpit with Dashboard, Map, Messages, Transmit, Weather, Analytics and Settings views
- Direct APRSNET WebSocket connection for live packets, objects, alerts and authenticated transmit
- Main-process REST proxy restricted to APRSNET `/api/*` routes
- Station table and tactical canvas map from APRSNET GeoJSON/API data
- Zoomable OpenStreetMap tactical map with live APRSNET station markers
- Nearest six APRS weather stations from the user's saved/device location
- Synced member message history displayed as conversation threads with chat bubbles
- Readable analytics dashboard with summary cards, activity heatmap, reliability and long-path tables
- APRS message, position beacon, object and raw packet builders with previews before transmit
- APRSNET member login token storage for member-backed API calls
- Member login verification can autofill callsign and APRS-IS passcode when APRSNET returns them
- Desktop notifications, tray menu, single-instance behaviour and launch-on-startup support
- Windows NSIS installer and Debian `.deb` packaging through Electron Builder

## Intended End State

The goal is a direct replacement for the previous APRS-Client browser-style app, with the website's APRSNET features rebuilt as native desktop workflows:

- Full map controls, filters, station history, object handling, weather layers and replay
- Full APRS messaging centre with inbox, conversation threading and message traffic log
- Weather, Ecowitt, analytics, propagation, satellite/pass and utility tools
- Admin/member workflows where the APRSNET API permits them
- Installer releases for Windows and Debian from one shared codebase

## Repository Layout

```text
main.js             Electron main process, tray, settings, API proxy, notifications
preload.js          Safe bridge exposed to the local renderer
renderer/
  index.html        Native desktop shell
  styles.css        Desktop UI styling
  app.js            APRSNET API/WebSocket client and UI logic
assets/             Application icons
.github/workflows/  Windows and Linux build/release workflow
```

## Development

Requirements:

- Node.js 20+
- npm

Run locally:

```bash
npm install
npm start
```

Build installers:

```bash
npm run build:win -- --publish never
npm run build:linux -- --publish never
```

## Releases

The GitHub Actions workflow builds on pushes to `main` and on tags matching `v*`.

To publish a release:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

The tag build creates a GitHub Release and uploads the Windows installer and Debian package.

## Security Model

- The app loads only local renderer files.
- The renderer cannot use Node integration.
- External links are opened through validated `http`/`https` URLs only.
- REST access from the renderer is restricted to APRSNET `/api/*` paths.
- Transmit actions require WebSocket authentication and user confirmation.

## Licence

GNU General Public Licence v3, copyright 2026 Daren Loxley 2E0LXY.
