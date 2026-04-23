chrome.storage.local.get(['connectionStatus', 'tailscaleIP', 'ipHistory'], (result) => {
  if (result.connectionStatus === 'Connected') {
    showStatusPanel('Connected to ' + (result.tailscaleIP || 'partner'));
  } else {
    showConnectPanel(result.tailscaleIP || '');
    renderHistory(result.ipHistory || []);
  }
});

document.getElementById('connectBtn').addEventListener('click', () => {
  const ip = document.getElementById('ipInput').value.trim();
  if (!ip) return;

  chrome.storage.local.get(['ipHistory'], (result) => {
    let history = result.ipHistory || [];
    // Keep last 3 IPs, push new to top, remove duplicates
    history = [ip, ...history.filter(h => h !== ip)].slice(0, 3);
    
    chrome.storage.local.set({ tailscaleIP: ip, connectionStatus: 'Connecting...', ipHistory: history }, () => {
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs.length > 0) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'start', ip: ip });
          window.close(); 
        }
      });
    });
  });
});

document.getElementById('disconnectBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'disconnect' });
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'disconnect' }).catch(() => {});
    }
  });
  showConnectPanel();
  chrome.storage.local.get(['ipHistory'], (result) => renderHistory(result.ipHistory || []));
});

function showStatusPanel(text) {
  document.getElementById('connectPanel').classList.add('hidden');
  document.getElementById('statusPanel').classList.remove('hidden');
  document.getElementById('statusText').innerText = text;
}

function showConnectPanel(lastIp = '') {
  document.getElementById('connectPanel').classList.remove('hidden');
  document.getElementById('statusPanel').classList.add('hidden');
  if (lastIp) document.getElementById('ipInput').value = lastIp;
}

function renderHistory(history) {
  const container = document.getElementById('historyContainer');
  container.innerHTML = history.length > 0 ? '<div style="font-size:12px; color:#aaa; margin-bottom:5px;">Recent IPs:</div>' : '';
  
  history.forEach(ip => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerText = ip;
    div.onclick = () => { document.getElementById('ipInput').value = ip; };
    container.appendChild(div);
  });
}