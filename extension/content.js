// Helper function to safely extract exactly the Netflix Video ID (e.g., 81236554)
// This strictly ignores any fake DOM URLs like "netsync-panel"
function getNetflixId(url) {
  const match = url.match(/\/watch\/(\d+)/);
  return match ? match[1] : null;
}

// ─── State ───────────────────────────────────────────────────────────────
let peerConnection, localStream;
let isRemoteAction = false;
let lastRemoteActionTime = 0;
const REMOTE_ACTION_WINDOW_MS = 2000; // Suppress local echoes for 2s after remote action
let currentUrl = window.location.href.split('?')[0];
let currentVideoId = getNetflixId(currentUrl);
let videoHooksIntervalId = null;
let currentNetflixVideo = null;
let wsReady = false;
let pendingRequestSync = false;

// Host/Guest and Ad synchronization states
let currentRole = 'guest'; // Default role is guest; server will assign
let localAdActive = false;
let remoteAdActive = false;
let lastSyncedContentTime = 0;

// ─── Inject page-context script ──────────────────────────────────────────
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
document.documentElement.appendChild(script);

// ─── 1. AUTO-RECONNECT ON LOAD ───────────────────────────────────────────
chrome.runtime.sendMessage({ action: 'request_status' }, (response) => {
  if (response && response.connectionStatus === 'Connected' && response.tailscaleIP) {
    setupUI();
    chrome.runtime.sendMessage({ action: 'start', ip: response.tailscaleIP });
  }
});

// ─── 2. LISTEN TO BACKGROUND ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (request.action === 'start') {
    setupUI();
    chrome.runtime.sendMessage({ action: 'start', ip: request.ip });
  } else if (request.action === 'disconnect') {
    teardownSession();
  } else if (request.action === 'ws_connected') {
    wsReady = true;
    setupUI();
    setupWebRTC();
    // Flush any pending requestSync that was queued before WS was ready
    if (pendingRequestSync) {
      sendToWS({ type: 'requestSync' });
      pendingRequestSync = false;
    }
  } else if (request.action === 'ws_disconnected') {
    wsReady = false;
    // UI will be torn down; user sees panel disappear
    teardownSession();
  } else if (request.action === 'ws_error') {
    wsReady = false;
    // Show error state briefly before teardown
    const panel = document.getElementById('netsync-panel');
    if (panel) {
      panel.innerHTML = '<div style="color:#e50914;padding:20px;text-align:center;">Connection Error<br><small>Retrying...</small></div>';
    }
  } else if (request.action === 'ws_receive') {
    const data = request.data;

    if (data.type === 'offer') {
      handleIncomingOffer(data.offer);
    } else if (data.type === 'answer') {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } else if (data.type === 'candidate') {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } else if (data.type === 'videoAction') {
      handleRemoteVideoAction(data);
    }
    // Handshake & URL Sync Logic
    else if (data.type === 'requestSync') {
      if (currentVideoId) {
        sendToWS({ type: 'initialSync', videoId: currentVideoId });
      }
      // If we are currently in an ad, let the partner know immediately
      if (localAdActive) {
        sendToWS({ type: 'adState', isAd: true, time: currentNetflixVideo ? currentNetflixVideo.currentTime : 0 });
      }
    }
    else if (data.type === 'roleAssignment') {
      currentRole = data.role;
      updateStatusUI();
    }
    else if (data.type === 'adState') {
      const wasRemoteAdActive = remoteAdActive;
      remoteAdActive = data.isAd;
      updateAdOverlay();

      if (wasRemoteAdActive && !remoteAdActive) {
        console.log("NetSync: Partner ad ended. Syncing and resuming at:", data.time);
        if (currentNetflixVideo) {
          currentNetflixVideo.dataset.netsyncProgSeek = 'true';
          currentNetflixVideo.dataset.netsyncProgPlay = 'true';
        }
        window.postMessage({ type: 'REMOTE_ACTION', action: 'play', time: data.time }, '*');
      } else if (remoteAdActive) {
        console.log("NetSync: Partner ad started. Pausing.");
        if (currentNetflixVideo) {
          currentNetflixVideo.dataset.netsyncProgPause = 'true';
        }
        window.postMessage({ type: 'REMOTE_ACTION', action: 'pause', time: currentNetflixVideo ? currentNetflixVideo.currentTime : 0 }, '*');
      }
    }
    else if (data.type === 'urlChange' || data.type === 'initialSync') {
      const localVideoId = getNetflixId(window.location.href);

      // If the partner sends a Video ID that doesn't match ours, FORCE the jump.
      if (data.videoId && data.videoId !== localVideoId) {
        console.log("NetSync: Jumping to Partner's Episode ->", data.videoId);
        // Using location.assign forces a cleaner reload for SPA apps like Netflix
        window.location.assign(`https://www.netflix.com/watch/${data.videoId}`);
      }
    }
  }
});

function sendToWS(data) {
  chrome.runtime.sendMessage({ action: 'ws_send', data: data });
}

// ─── 3. UI SETUP ─────────────────────────────────────────────────────────
function setupUI() {
  if (document.getElementById('netsync-panel')) return;
  document.body.classList.add('netsync-active');
  const panel = document.createElement('div');
  panel.id = 'netsync-panel';
  panel.innerHTML = `
    <div id="netsync-status-header" style="padding: 15px 10px; background: #141414; color: #fff; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 13px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333;">
      <span id="netsync-role" style="font-weight: bold; text-transform: uppercase; color: #aaa;">Role: Guest</span>
      <span id="netsync-status" style="color: #46d369; font-size: 11px; font-weight: bold;">Connected</span>
    </div>
    <video id="remoteVideo" autoplay playsinline></video>
    <video id="localVideo" autoplay playsinline muted></video>
  `;
  document.body.appendChild(panel);

  // Setup Ad Overlay if not existing
  if (!document.getElementById('netsync-ad-overlay')) {
    const overlay = document.createElement('div');
    overlay.id = 'netsync-ad-overlay';
    overlay.innerHTML = `
      <div style="font-size: 24px; font-weight: bold; margin-bottom: 10px;">Waiting for partner...</div>
      <div style="font-size: 16px; color: #aaa; text-align: center; max-width: 80%; line-height: 1.4;">Your partner is currently watching an ad break.<br>Playback will resume automatically once the ad ends.</div>
      <div class="netsync-spinner"></div>
    `;
    document.body.appendChild(overlay);
  }

  // Prevent clicks on the panel from bubbling up to Netflix's router
  panel.addEventListener('click', (e) => e.stopPropagation());
  panel.addEventListener('mousedown', (e) => e.stopPropagation());
  panel.addEventListener('mouseup', (e) => e.stopPropagation());

  updateStatusUI();
  updateAdOverlay();
  setupVideoHooks();
}

function updateStatusUI() {
  const roleEl = document.getElementById('netsync-role');
  if (roleEl) {
    roleEl.textContent = `Role: ${currentRole.toUpperCase()}`;
    roleEl.style.color = currentRole === 'host' ? '#e50914' : '#d2afff';
  }
}

function updateAdOverlay() {
  const overlay = document.getElementById('netsync-ad-overlay');
  if (overlay) {
    overlay.style.display = remoteAdActive ? 'flex' : 'none';
  }
}

function teardownSession() {
  try {
    if (peerConnection) {
      peerConnection.ontrack = null;
      peerConnection.onicecandidate = null;
      peerConnection.onnegotiationneeded = null;
      peerConnection.close();
    }
  } catch (_) {}
  peerConnection = null;

  try {
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
    }
  } catch (_) {}
  localStream = null;

  if (videoHooksIntervalId) {
    clearInterval(videoHooksIntervalId);
    videoHooksIntervalId = null;
  }

  currentNetflixVideo = null;
  isRemoteAction = false;
  lastRemoteActionTime = 0;
  localAdActive = false;
  remoteAdActive = false;
  currentRole = 'guest';

  const panel = document.getElementById('netsync-panel');
  if (panel) panel.remove();

  const overlay = document.getElementById('netsync-ad-overlay');
  if (overlay) overlay.remove();

  document.body.classList.remove('netsync-active');
}

// ─── 4. WebRTC ───────────────────────────────────────────────────────────
async function setupWebRTC() {
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  }
  // Guard: #localVideo may not exist if setupUI() hasn't run yet
  const localVid = document.getElementById('localVideo');
  if (localVid) localVid.srcObject = localStream;

  createPeerConnection();

  peerConnection.onnegotiationneeded = async () => {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sendToWS({ type: 'offer', offer: offer });
  };

  // Ask the partner what they are watching
  sendToWS({ type: 'requestSync' });
}

async function handleIncomingOffer(offer) {
  // Properly tear down existing connection before replacing
  if (peerConnection) {
    try {
      peerConnection.ontrack = null;
      peerConnection.onicecandidate = null;
      peerConnection.onnegotiationneeded = null;
      peerConnection.close();
    } catch (_) {}
  }

  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const localVid = document.getElementById('localVideo');
    if (localVid) localVid.srcObject = localStream;
  }

  createPeerConnection();

  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  sendToWS({ type: 'answer', answer: answer });
}

function createPeerConnection() {
  peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  peerConnection.ontrack = (event) => {
    const remoteVid = document.getElementById('remoteVideo');
    if (remoteVid) remoteVid.srcObject = event.streams[0];
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) sendToWS({ type: 'candidate', candidate: event.candidate });
  };
}

// ─── 5. Video Hooks ──────────────────────────────────────────────────────
// Polling every 2s is sufficient — episode changes aren't instantaneous.
// The interval also detects when Netflix swaps the <video> element (e.g., ad breaks,
// episode transitions). Old video elements are removed from DOM so their listeners
// are garbage-collected — no accumulation leak.
// ─── 5. Video Hooks ──────────────────────────────────────────────────────
function isAdPlaying() {
  const video = document.querySelector('video');
  if (!video) return false;

  // 1. Duration-based heuristic (ads are short segments e.g. 15s/30s/60s, content is > 10m)
  if (video.duration > 0 && video.duration < 180) {
    return true;
  }

  // 2. DOM-based Netflix selectors for ad-related layouts
  const adSelectors = [
    '.ad-break-container',
    '.ad-break-message',
    '.ad-timer',
    '[data-uia="ad-break-skip-button"]',
    '.video-ad-label'
  ];
  for (const selector of adSelectors) {
    if (document.querySelector(selector)) {
      return true;
    }
  }

  return false;
}

function setupVideoHooks() {
  if (videoHooksIntervalId) return;
  
  // Polling every 1s allows rapid ad detection and video element tracking
  videoHooksIntervalId = setInterval(() => {
    const newUrl = window.location.href.split('?')[0];
    const newVideoId = getNetflixId(newUrl);

    // Track state by strict Video ID instead of full messy URLs
    if (newVideoId && newVideoId !== currentVideoId) {
      currentVideoId = newVideoId;
      currentUrl = newUrl;
      sendToWS({ type: 'urlChange', videoId: currentVideoId });
    }

    // Monitor local ad active state changes
    const isAd = isAdPlaying();
    if (isAd !== localAdActive) {
      localAdActive = isAd;
      console.log("NetSync: Local ad state changed to:", localAdActive);
      sendToWS({
        type: 'adState',
        isAd: localAdActive,
        time: currentNetflixVideo ? currentNetflixVideo.currentTime : 0
      });
    }

    const netflixVideo = document.querySelector('video');
    if (netflixVideo && netflixVideo !== currentNetflixVideo) {
      currentNetflixVideo = netflixVideo;
      
      // Reset flags upon finding a new video element
      netflixVideo.removeAttribute('data-netsync-prog-play');
      netflixVideo.removeAttribute('data-netsync-prog-pause');
      netflixVideo.removeAttribute('data-netsync-prog-seek');

      netflixVideo.addEventListener('play', () => {
        // If an ad is running locally or remotely, force pause immediately
        if (localAdActive || remoteAdActive) {
          netflixVideo.dataset.netsyncProgPause = 'true';
          window.postMessage({ type: 'REMOTE_ACTION', action: 'pause', time: netflixVideo.currentTime }, '*');
          return;
        }

        if (netflixVideo.dataset.netsyncProgPlay === 'true') {
          netflixVideo.removeAttribute('data-netsync-prog-play');
          return;
        }
        sendVideoAction('play', netflixVideo.currentTime);
      });

      netflixVideo.addEventListener('pause', () => {
        if (netflixVideo.dataset.netsyncProgPause === 'true') {
          netflixVideo.removeAttribute('data-netsync-prog-pause');
          return;
        }
        sendVideoAction('pause', netflixVideo.currentTime);
      });

      netflixVideo.addEventListener('seeked', () => {
        if (netflixVideo.dataset.netsyncProgSeek === 'true') {
          netflixVideo.removeAttribute('data-netsync-prog-seek');
          return;
        }

        // Both Host and Guest can seek. The programmatic dataset flag 
        // ensures this doesn't cause a synchronization ping-pong loop.
        sendVideoAction('seeked', netflixVideo.currentTime);
      });

      netflixVideo.addEventListener('timeupdate', () => {
        // Only update the last synced content time when playing normally and not seeking
        if (!localAdActive && !remoteAdActive && !netflixVideo.seeking) {
          if (netflixVideo.dataset.netsyncProgSeek !== 'true') {
            lastSyncedContentTime = netflixVideo.currentTime;
          }
        }
      });
    }
  }, 1000);
}

function sendVideoAction(action, time) {
  // Silence action messages while anyone is in an ad break
  if (localAdActive || remoteAdActive) return;

  // Echo suppression: check remote action timing
  if (isRemoteAction && (Date.now() - lastRemoteActionTime) < REMOTE_ACTION_WINDOW_MS) return;
  
  sendToWS({ type: 'videoAction', action, time });
}

function handleRemoteVideoAction(data) {
  isRemoteAction = true;
  lastRemoteActionTime = Date.now();
  window.postMessage({ type: 'REMOTE_ACTION', action: data.action, time: data.time }, '*');
  // Reset flag after window expires (safety net)
  setTimeout(() => { isRemoteAction = false; }, REMOTE_ACTION_WINDOW_MS);
}
