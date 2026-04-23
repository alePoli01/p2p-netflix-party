window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || event.data.type !== 'REMOTE_ACTION') return;
  
  try {
    const videoPlayer = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
    const playerSessionId = videoPlayer.getAllPlayerSessionIds()[0];
    const player = videoPlayer.getVideoPlayerBySessionId(playerSessionId);
    
    const data = event.data;
    const netflixTime = player.getCurrentTime();
    const targetTime = data.time * 1000; // Convert to milliseconds
    
    if (data.action === 'pause') {
      // Hard-sync the exact millisecond when pausing
      player.pause();
      player.seek(targetTime);
    } 
    else if (data.action === 'play') {
      // Only fix time during playback if drift is worse than 1 second
      if (Math.abs(netflixTime - targetTime) > 1000) {
        player.seek(targetTime);
      }
      setTimeout(() => { player.play(); }, 50); // Tiny delay to let buffer catch up
    } 
    else if (data.action === 'seeked') {
      player.seek(targetTime);
    }
    
  } catch(e) {
    console.log("NetSync: API not ready.", e);
  }
});