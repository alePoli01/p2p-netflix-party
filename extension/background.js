let ws = null;
let netflixTabId = null;
let keepAliveInterval = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'start') {
    netflixTabId = sender.tab ? sender.tab.id : request.tabId;
    connectWebSocket(request.ip);
  } else if (request.action === 'ws_send' && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(request.data));
  } else if (request.action === 'disconnect') {
    if (ws) ws.close();
    chrome.storage.local.set({ connectionStatus: 'Disconnected' });
  } else if (request.action === 'request_status') {
    // Allows the content script to check if it should auto-reconnect after a reload
    chrome.storage.local.get(['connectionStatus', 'tailscaleIP'], (result) => {
      sendResponse(result);
    });
    return true; // Keeps the message channel open for the async response
  }
});

function connectWebSocket(ip) {
  if (ws) ws.close();
  ws = new WebSocket(`ws://${ip}:8080`);
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (netflixTabId) {
      chrome.tabs.sendMessage(netflixTabId, { action: 'ws_receive', data: data }).catch(() => {});
    }
  };

  ws.onopen = () => {
    chrome.storage.local.set({ connectionStatus: 'Connected' });
    if (netflixTabId) chrome.tabs.sendMessage(netflixTabId, { action: 'ws_connected' });
    
    keepAliveInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' })); 
    }, 20000);
  };

  ws.onclose = () => {
    clearInterval(keepAliveInterval);
    chrome.storage.local.set({ connectionStatus: 'Disconnected' });
  };
}