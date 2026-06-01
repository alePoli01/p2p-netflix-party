# AGENTS.md

## Project Structure

Two independent components (no monorepo tooling):
- `server/` — Node.js WebSocket signaling server (port 8080). Only one instance runs (the host).
- `extension/` — Chrome Manifest V3 extension. Loads as unpacked at `chrome://extensions/`.

## Architecture

```
Host runs: server/server.js (WS on :8080)
Both run: extension (loaded in Chrome)
```

Communication flow:
1. Host starts `node server/server.js` — accepts WS connections from whitelisted IPs only
2. Both peers load extension on `*.netflix.com/*`
3. Extension connects to host's WS server for signaling
4. WebRTC peer connection carries video/audio for face-to-face chat
5. Playback sync (play/pause/seek) flows through WS → content.js → inject.js → Netflix player API

Key files:
- `server/server.js` — WS server, reads `whitelist.txt` for IP access control
- `extension/background.js` — service worker, manages WS connection lifecycle
- `extension/content.js` — injected on netflix.com, sets up WebRTC, video hooks, UI panel
- `extension/inject.js` — runs in page context, calls Netflix internal player API (`window.netflix.appContext.state.playerApp`)

## Commands

- Start server: `cd server && node server.js` (or `npm start`)
- Load extension: `chrome://extensions/` → Load unpacked → select `extension/` folder
- No build step, no bundler, no tests, no linting

## Setup Requirements

- Both devices need Tailscale installed (or same LAN)
- Add Tailscale IPs to `server/whitelist.txt` (one per line); add `127.0.0.1` if testing host+peer on same machine
- Extension only works on `netflix.com` (enforced by `manifest.json` content_scripts matches)

## Important Conventions / Gotchas

- **No authentication** — access control is purely IP-based via `whitelist.txt`
- **Content script isolation**: `inject.js` runs in page context to access Netflix's internal player API; `content.js` runs in isolated world and communicates with `inject.js` via `window.postMessage`
- **Netflix player API is internal/undocumented** — accessed at `window.netflix.appContext.state.playerApp.getAPI().videoPlayer`. Time values from Netflix API are in **milliseconds**, while HTML5 video `currentTime` is in **seconds** — conversion happens in `inject.js`
- **WebRTC ping**: background.js sends `{ type: 'ping' }` every 20s to keep WS alive
- **Force sync on join**: joining peer gets redirected to host's episode via `window.location.assign()` to force full page reload (Netflix SPA needs this, not just history push)
- **Event bubbling guard**: the netsync-panel has click/mousedown/mouseup handlers that call `stopPropagation()` to prevent Netflix's router from intercepting
