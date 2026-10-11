// Prepares public/ for the native shell and writes it to www/.
//
// Two things differ from the browser build:
//
//  1. There is no server behind the app. In the PWA everything is same-origin
//     because server.js proxies /rest/*, and the sign-in field defaults to
//     window.location.origin. Inside the shell that origin is
//     capacitor://localhost, which is not a Navidrome server, so a default
//     has to be injected instead.
//
//  2. The service worker is pointless here — the files are already local — and
//     registering one against capacitor://localhost only risks caching the
//     shell's own URLs. The registration is stripped.
//
// Kept as a script rather than inline CI steps: it has to be runnable and
// checkable locally, not only on a runner.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'public');
const OUT = path.join(__dirname, 'www');

// Where the app should point when it has no origin of its own. The Tailscale
// name works from any network and is HTTPS, which iOS requires by default.
const DEFAULT_SERVER = process.env.NIPO_SERVER || 'https://amine.taildb7026.ts.net';

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
copyDir(SRC, OUT);

// The shell serves from the bundle, so a service worker adds nothing.
fs.rmSync(path.join(OUT, 'sw.js'), { force: true });

const appJsPath = path.join(OUT, 'app.js');
let app = fs.readFileSync(appJsPath, 'utf8');

const before = app;
app = app.replace(
  "if ('serviceWorker' in navigator && window.isSecureContext) {",
  "if (false && 'serviceWorker' in navigator && window.isSecureContext) {",
);
if (app === before) {
  throw new Error('service worker registration guard not found — stage_native.js is out of date with app.js');
}

fs.writeFileSync(appJsPath, app);

// Injected ahead of app.js so the sign-in field has a sensible default.
const indexPath = path.join(OUT, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const marker = '<script src="/md5.js"></script>';
if (!html.includes(marker)) {
  throw new Error('script marker not found in index.html — stage_native.js is out of date');
}
html = html.replace(
  marker,
  `<script>window.NIPO_DEFAULT_SERVER = ${JSON.stringify(DEFAULT_SERVER)};</script>\n${marker}`,
);

// Absolute paths resolve against the bundle root in the shell, so they are
// left alone; only the manifest is dropped, being meaningless off the web.
html = html.replace(/\s*<link rel="manifest"[^>]*>/, '');
fs.writeFileSync(indexPath, html);

console.log(`Staged ${OUT}`);
console.log(`  default server: ${DEFAULT_SERVER}`);
console.log(`  service worker: removed`);
