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

  console.log(`[ACCEPTED] Partner connected from: ${clientIp}`);

  ws.on('message', (message) => {
    // Broadcast message to the other connected client
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message.toString());
      }
    });
  });
});

console.log("Tailscale WebRTC Signaling Server running on port 8080");
console.log("Security: IP Whitelist is ENABLED.");