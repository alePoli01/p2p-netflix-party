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
* **Forced Sync on Join:** If one user is already in the room watching a video, the second user will be forcefully redirected to their exact episode and timestamp upon connecting. **Make sure to agree on what to watch before joining!**
* **Shared Media Controls:** The extension syncs the following actions:
  * Play & Pause
  * Next Episode
  * Skip Intro / Recap
  * Seeking (jumping to a specific minute)

## 🐛 Known Issues & Quirks
* **Seeking Glitches:** Jumping to a specific minute might cause some temporary play/pause stuttering between the two peers. Just toggle play/pause a couple of times to stabilize the sync.
* **Netflix Ad-Supported Plans:** If one or both users have a Netflix plan with ads, the streams will likely desynchronize because ads trigger at different times for different users. 
  * *Workaround:* Wait for the ad break to finish, then have one user pause and play to force a resync.
* **Full Screen mode:** only available by pressing F11 on windows (or any other command that makes the browser full screen). Media player full screen covers the extension
