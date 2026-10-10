// Prepare the standalone web app for the Capacitor iOS shell.
// All runtime assets are bundled locally. There is no Navidrome server,
// reverse proxy, injected endpoint, or service worker in the native build.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'public');
const OUT = path.join(__dirname, 'www');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
copyDir(SRC, OUT);

// Capacitor already serves bundled files locally. A service worker is not
// needed in the native app and can make updates harder to reason about.
fs.rmSync(path.join(OUT, 'sw.js'), { force: true });

console.log('Staged standalone offline app to ' + OUT);
