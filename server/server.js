const WebSocket = require('ws');
const fs = require('fs'); // Node's built-in file system module

const wss = new WebSocket.Server({ port: 8080 });

// Helper function to read the whitelist file dynamically
const path = require('path'); // Make sure this line is somewhere at the very top of your server.js file

function getWhitelistedIPs() {
  try {
    // This forces Node to look in the exact same folder where server.js lives
    const whitelistPath = path.join(__dirname, 'whitelist.txt');
    const data = fs.readFileSync(whitelistPath, 'utf8');
    
    // Split by newlines, clean up extra spaces, and remove empty lines
    return data.split('\n').map(ip => ip.trim()).filter(ip => ip.length > 0);
  } catch (err) {
    console.log("Error: Could not read whitelist.txt. Blocking all connections just in case.");
    return [];
  }
}

wss.on('connection', (ws, req) => {
  // Grab the IP address of the person trying to connect
  let clientIp = req.socket.remoteAddress;

  // Node.js often wraps standard IPv4 addresses inside an IPv6 format (e.g., "::ffff:100.x.x.x")
  // We strip that prefix away so it perfectly matches the text in your whitelist file.
  if (clientIp.startsWith('::ffff:')) {
    clientIp = clientIp.substring(7);
  }

  const allowedIps = getWhitelistedIPs();

  // The Bouncer: If the IP isn't on the list, kick them out
  if (!allowedIps.includes(clientIp)) {
    console.log(`[BLOCKED] Unauthorized connection attempt from: ${clientIp}`);
    ws.close();
    return;
  }

  // Helper to print current room state
  function printRoomState() {
    console.log('\n--- Current Room State ---');
    let count = 0;
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) {
        count++;
        console.log(`- [${(c.role || 'unknown').toUpperCase()}] IP: ${c.ip}`);
      }
    });
    if (count === 0) console.log('  (Empty room)');
    console.log('--------------------------\n');
  }

  // Determine role: host if none exists, guest otherwise
  let hasHost = false;
  wss.clients.forEach((client) => {
    if (client !== ws && client.readyState === WebSocket.OPEN && client.role === 'host') {
      hasHost = true;
    }
  });

  ws.role = hasHost ? 'guest' : 'host';
  ws.ip = clientIp;
  console.log(`[ACCEPTED] Partner connected from: ${clientIp} as ${ws.role.toUpperCase()}`);
  printRoomState();

  // Send initial role assignment to the client
  ws.send(JSON.stringify({ type: 'roleAssignment', role: ws.role }));

  ws.on('message', (message) => {
    // Broadcast message to the other connected client
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message.toString());
      }
    });
  });

  ws.on('close', () => {
    console.log(`[DISCONNECTED] Client left: ${ws.ip} (${ws.role})`);
    
    // If the host disconnected, promote a guest to host
    if (ws.role === 'host') {
      let promotedClient = null;
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN && !promotedClient) {
          promotedClient = client;
        }
      });

      if (promotedClient) {
        promotedClient.role = 'host';
        console.log(`[PROMOTED] Client ${promotedClient.ip} promoted to HOST`);
        promotedClient.send(JSON.stringify({ type: 'roleAssignment', role: 'host' }));
      }
    }
    printRoomState();
  });
});

console.log("Tailscale WebRTC Signaling Server running on port 8080");
console.log("Security: IP Whitelist is ENABLED.");