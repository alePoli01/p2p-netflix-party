// Helper function to safely extract exactly the Netflix Video ID (e.g., 81236554)
// This strictly ignores any fake DOM URLs like "netsync-panel"
function getNetflixId(url) {
  const match = url.match(/\/watch\/(\d+)/);
  return match ? match[1] : null;
}

let peerConnection, localStream;
let isRemoteAction = false;
let currentUrl = window.location.href.split('?')[0];
let currentVideoId = getNetflixId(currentUrl);

const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
document.documentElement.appendChild(script);

// 1. AUTO-RECONNECT ON LOAD
chrome.runtime.sendMessage({ action: 'request_status' }, (response) => {
  if (response && response.connectionStatus === 'Connected' && response.tailscaleIP) {
    setupUI();
    chrome.runtime.sendMessage({ action: 'start', ip: response.tailscaleIP });
  }
});

// 2. LISTEN TO BACKGROUND
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (request.action === 'start') {
    setupUI();
    chrome.runtime.sendMessage({ action: 'start', ip: request.ip });
  } else if (request.action === 'ws_connected') {
    setupWebRTC();
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
      if (currentVideoId) sendToWS({ type: 'initialSync', videoId: currentVideoId });
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

function setupUI() {
  if (document.getElementById('netsync-panel')) return;
  document.body.classList.add('netsync-active');
  const panel = document.createElement('div');
  panel.id = 'netsync-panel';
  panel.innerHTML = `
    <video id="remoteVideo" autoplay playsinline></video>
    <video id="localVideo" autoplay playsinline muted></video>
  `;
  document.body.appendChild(panel);

  // THE FIX: Prevent clicks on the panel from bubbling up to Netflix's router
  panel.addEventListener('click', (e) => e.stopPropagation());
  panel.addEventListener('mousedown', (e) => e.stopPropagation());
  panel.addEventListener('mouseup', (e) => e.stopPropagation());

  setupVideoHooks();
}

async function setupWebRTC() {
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  }
  document.getElementById('localVideo').srcObject = localStream;

  createPeerConnection();

  peerConnection.onnegotiationneeded = async () => {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sendToWS({ type: 'offer', offer: offer });
  };

  // The moment we connect, ask the partner what they are watching
  sendToWS({ type: 'requestSync' });
}

async function handleIncomingOffer(offer) {
  if (peerConnection) peerConnection.close();
  
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if(document.getElementById('localVideo')) document.getElementById('localVideo').srcObject = localStream;
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

let currentNetflixVideo = null;

function setupVideoHooks() {
  setInterval(() => {
    const newUrl = window.location.href.split('?')[0];
    const newVideoId = getNetflixId(newUrl);

    // Track state by strict Video ID instead of full messy URLs
    if (newVideoId && newVideoId !== currentVideoId) {
      currentVideoId = newVideoId;
      currentUrl = newUrl;
      sendToWS({ type: 'urlChange', videoId: currentVideoId });
    }

    const netflixVideo = document.querySelector('video');
    if (netflixVideo && netflixVideo !== currentNetflixVideo) {
      currentNetflixVideo = netflixVideo;
      netflixVideo.addEventListener('play', () => sendVideoAction('play', netflixVideo.currentTime));
      netflixVideo.addEventListener('pause', () => sendVideoAction('pause', netflixVideo.currentTime));
      netflixVideo.addEventListener('seeked', () => sendVideoAction('seeked', netflixVideo.currentTime));
    }
  }, 1000);
}

function sendVideoAction(action, time) {
  if (isRemoteAction) return;
  sendToWS({ type: 'videoAction', action, time });
}

function handleRemoteVideoAction(data) {
  isRemoteAction = true;
  window.postMessage({ type: 'REMOTE_ACTION', action: data.action, time: data.time }, '*');
  setTimeout(() => { isRemoteAction = false; }, 500);
}