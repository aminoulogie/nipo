// Minimal zero-dependency static file server + reverse proxy to Navidrome.
// Serves the PWA from /public and forwards all /rest/* Subsonic API calls
// (including audio streaming with Range support) to the real Navidrome server,
// so the browser only ever talks to ONE origin (no CORS issues).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const os = require('os');

// Navidrome runs on this same PC, so talk to it via loopback — avoids
// breaking if the machine's LAN IP changes (it's DHCP-assigned).
const NAVIDROME_HOST = '127.0.0.1';
const NAVIDROME_PORT = 4533;
const LISTEN_PORT = 4534;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, reqPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function proxyToNavidrome(req, res) {
  const target = new URL(req.url, `http://${NAVIDROME_HOST}:${NAVIDROME_PORT}`);
  const headers = { ...req.headers, host: `${NAVIDROME_HOST}:${NAVIDROME_PORT}` };

  const options = {
    hostname: NAVIDROME_HOST,
    port: NAVIDROME_PORT,
    path: target.pathname + target.search,
    method: req.method,
    headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad gateway: ' + e.message);
  });

  req.pipe(proxyReq, { end: true });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/rest/')) {
    proxyToNavidrome(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  console.log(`Navidrome PWA client running:`);
  console.log(`  http://localhost:${LISTEN_PORT}`);
  Object.values(nets).flat().forEach((n) => {
    if (n && n.family === 'IPv4' && !n.internal) {
      console.log(`  http://${n.address}:${LISTEN_PORT}`);
    }
  });
});
