let ws = null;
let netflixTabId = null;
let keepAliveInterval = null;
let reconnectTimeout = null;
let userInitiatedDisconnect = false;
let isReplacingConnection = false;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'start') {
    netflixTabId = sender.tab ? sender.tab.id : request.tabId;
    connectWebSocket(request.ip);
  } else if (request.action === 'ws_send' && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(request.data));
  } else if (request.action === 'disconnect') {
    userInitiatedDisconnect = true;
    if (ws) ws.close();
    clearInterval(keepAliveInterval);
    clearTimeout(reconnectTimeout);
    keepAliveInterval = null;
    reconnectTimeout = null;
    chrome.storage.local.set({ connectionStatus: 'Disconnected' });
    if (netflixTabId) {
      chrome.tabs.sendMessage(netflixTabId, { action: 'disconnect' }).catch(() => {});
    }
    netflixTabId = null;
  } else if (request.action === 'request_status') {
    // Allows the content script to check if it should auto-reconnect after a reload
    chrome.storage.local.get(['connectionStatus', 'tailscaleIP'], (result) => {
      sendResponse(result);
    });
    return true; // Keeps the message channel open for the async response
  }
});

function connectWebSocket(ip) {
  if (ws) {
    isReplacingConnection = true;
    ws.close();
  }
  clearTimeout(reconnectTimeout);
  reconnectTimeout = null;
  userInitiatedDisconnect = false;

  // Persist the IP so auto-reconnect works after service worker restart
  chrome.storage.local.set({ tailscaleIP: ip });

  ws = new WebSocket(`ws://${ip}:8080`);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (netflixTabId) {
        chrome.tabs.sendMessage(netflixTabId, { action: 'ws_receive', data: data }).catch(() => {});
      }
    } catch (e) {
      console.error('NetSync: Failed to parse WS message:', e.message);
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
    clearTimeout(reconnectTimeout);

    // If we're intentionally replacing the connection, don't schedule a reconnect
    // — a new WebSocket is already being created below
    if (isReplacingConnection) {
      isReplacingConnection = false;
      return;
    }

    chrome.storage.local.set({ connectionStatus: 'Disconnected' });
    // Notify content script so it can update UI
    if (netflixTabId) {
      chrome.tabs.sendMessage(netflixTabId, { action: 'ws_disconnected' }).catch(() => {});
    }
    // Only auto-reconnect if the disconnect was NOT user-initiated
    if (userInitiatedDisconnect) {
      userInitiatedDisconnect = false;
      return;
    }
    // Attempt reconnection after 3 seconds
    chrome.storage.local.get(['tailscaleIP'], (result) => {
      if (result.tailscaleIP) {
        reconnectTimeout = setTimeout(() => {
          connectWebSocket(result.tailscaleIP);
        }, 3000);
      }
    });
  };

  ws.onerror = () => {
    chrome.storage.local.set({ connectionStatus: 'Connection Error' });
    if (netflixTabId) {
      chrome.tabs.sendMessage(netflixTabId, { action: 'ws_error' }).catch(() => {});
    }
  };
}
