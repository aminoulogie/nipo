// Zero-dependency static development server for Nipo.
// The app is fully local/offline at runtime; this server only helps preview
// the bundled web UI during development.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = 4534;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html':'text/html; charset=utf-8',
  '.js':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.webmanifest':'application/manifest+json',
  '.svg':'image/svg+xml',
  '.png':'image/png',
  '.ico':'image/x-icon',
};

const server = http.createServer((req,res)=>{
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, reqPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(filePath,(err,data)=>{
    if (err) { res.writeHead(404,{'Content-Type':'text/plain'}); return res.end('Not found'); }
    const etag='W/"'+crypto.createHash('sha1').update(data).digest('hex').slice(0,16)+'"';
    if(req.headers['if-none-match']===etag){res.writeHead(304,{ETag:etag,'Cache-Control':'no-cache'});return res.end();}
    res.writeHead(200,{'Content-Type':MIME[path.extname(filePath)]||'application/octet-stream','Cache-Control':'no-cache',ETag:etag});
    res.end(data);
  });
});

server.listen(PORT,'0.0.0.0',()=>{
  console.log('Nipo local preview:');
  console.log('  http://localhost:'+PORT);
  Object.values(os.networkInterfaces()).flat().forEach(n=>{if(n&&n.family==='IPv4'&&!n.internal)console.log('  http://'+n.address+':'+PORT);});
});
