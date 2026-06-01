# TailParty (Tailscale NetSync)

A secure, self-hosted Chrome extension for synchronized Netflix playback over a private Tailscale network. Uses WebRTC for peer-to-peer video/audio chat and a local signaling server to coordinate playback state.

## ⚠️ Important Prerequisites
* **Network Setup:** Both devices **must** have [Tailscale](https://tailscale.com/) installed and configured (or be on the same local network/VPN) to communicate (Tailscale is a free service up to 5 device for private use).
* **Netflix Only:** At the moment, this extension strictly works only on `netflix.com`.
* **Security Notice:** This project was built for **personal use**. There is no advanced security or authentication. Access control is handled entirely by a `whitelist.txt` file. You must add the exact IPv4 addresses of the users allowed to connect into this file.

## 🚀 How to Run

1. **Configure Whitelist:** Add your Tailscale IP and your partner's Tailscale IP to `whitelist.txt` (one per line). If you are the host testing locally, also add `127.0.0.1`.
2. **Start the Server:** Only **one** user (the host) needs to run the signaling server. Open your terminal in the server folder and run:
   ```bash
   python server.py
   ```
   *(Note: If your server is the Node.js version, run `node server.js` instead).*
3. **Load Extension:** Load the `extension` folder as an unpacked extension in Chrome/Brave (`chrome://extensions/`).
4. **Connect:** Open a Netflix video, click the extension, enter the host's Tailscale IP (or `localhost` if you are the host), and connect.

## 🎬 Features & Sync Behavior
* **Host/Guest Architecture:** The server automatically assigns the first connected client as the **Host** and the second as the **Guest**. The Host acts as the definitive room admin. The extension UI displays your current role dynamically.
* **Shared Media Controls:** The extension robustly syncs Play, Pause, Next Episode, Skip Intro/Recap, and Seeking without "ping-pong" loops.
* **Automated Ad Handling:** The extension intelligently detects Netflix ad breaks (via duration and DOM heuristics). If one user is watching an ad, the partner's video is automatically paused and overlaid with a visual lock screen. When the ad finishes, playback automatically re-syncs and resumes.
* **Forced Sync on Join:** If one user is already watching, the second user is immediately redirected to the exact episode and timestamp upon connecting.

## 🐛 Known Issues & Quirks
* **Full Screen mode:** only available by pressing F11 on Windows (or any other command that makes the browser full screen). Media player full screen covers the extension sidebar.
