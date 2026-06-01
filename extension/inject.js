window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || event.data.type !== 'REMOTE_ACTION') return;
  
  try {
    const videoPlayer = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
    const playerSessionId = videoPlayer.getAllPlayerSessionIds()[0];
    const player = videoPlayer.getVideoPlayerBySessionId(playerSessionId);
    
    const data = event.data;
    const netflixTime = player.getCurrentTime();
    const targetTime = data.time * 1000; // Convert to milliseconds
    const drift = Math.abs(netflixTime - targetTime);
    
    // Sync threshold: only correct pause/play if drift exceeds 2 seconds.
    const SYNC_THRESHOLD = 2000;

    // Grab standard video element to set flags for content.js
    const videoEl = document.querySelector('video');
    
    if (data.action === 'pause') {
      if (videoEl) {
        videoEl.dataset.netsyncProgPause = 'true';
        if (drift > SYNC_THRESHOLD) {
          videoEl.dataset.netsyncProgSeek = 'true';
        }
      }
      if (drift > SYNC_THRESHOLD) {
        player.pause();
        player.seek(targetTime);
      } else {
        player.pause();
      }
    } 
    else if (data.action === 'play') {
      if (drift > SYNC_THRESHOLD) {
        if (videoEl) {
          videoEl.dataset.netsyncProgSeek = 'true';
        }
        player.seek(targetTime);
      }
      if (videoEl) {
        videoEl.dataset.netsyncProgPlay = 'true';
      }
      // 50ms delay lets the seek buffer settle before resuming playback.
      setTimeout(() => { player.play(); }, 50);
    } 
    else if (data.action === 'seeked') {
      if (videoEl) {
        videoEl.dataset.netsyncProgSeek = 'true';
      }
      player.seek(targetTime);
    }
    
  } catch(e) {
    console.log("NetSync: API not ready.", e);
  }
});