(() => {
  'use strict';

  const DB_NAME = 'nipo-offline';
  const STORE = 'tracks';

  const escName = (name) => String(name || '').replace(/\.[^.]+$/, '') || 'Untitled';

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function synchsafe(b, o) {
    return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) |
      ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
  }
  function be32(b, o) {
    return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  }
  function decodeText(body) {
    if (!body || body.length < 2) return '';
    const enc = body[0];
    const data = body.slice(1);
    try {
      if (enc === 3) return new TextDecoder('utf-8').decode(data).replace(/\0+$/, '').trim();
      if (enc === 1) return new TextDecoder('utf-16').decode(data).replace(/\0+$/, '').trim();
      if (enc === 2) {
        const swapped = new Uint8Array(data.length);
        for (let i = 0; i + 1 < data.length; i += 2) {
          swapped[i] = data[i + 1];
          swapped[i + 1] = data[i];
        }
        return new TextDecoder('utf-16le').decode(swapped).replace(/\0+$/, '').trim();
      }
      return new TextDecoder('iso-8859-1').decode(data).replace(/\0+$/, '').trim();
    } catch {
      return '';
    }
  }

  async function metadata(file) {
    const out = {
      title: escName(file.name),
      artist: 'Local File',
      album: 'Imported from Files',
      track: 0,
      cover: null,
    };
    if (!/\.mp3$/i.test(file.name || '')) return out;

    const bytes = new Uint8Array(
      await file.slice(0, Math.min(file.size, 2 * 1024 * 1024)).arrayBuffer()
    );
    if (bytes.length < 10 ||
        String.fromCharCode(bytes[0], bytes[1], bytes[2]) !== 'ID3') return out;

    const version = bytes[3];
    const end = Math.min(bytes.length, 10 + synchsafe(bytes, 6));
    let p = 10;
    while (p + 10 <= end) {
      const id = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const size = version === 4 ? synchsafe(bytes, p + 4) : be32(bytes, p + 4);
      if (!size || p + 10 + size > end) break;
      const body = bytes.slice(p + 10, p + 10 + size);

      if (id === 'TIT2') out.title = decodeText(body) || out.title;
      else if (id === 'TPE1') out.artist = decodeText(body) || out.artist;
      else if (id === 'TALB') out.album = decodeText(body) || out.album;
      else if (id === 'TRCK') out.track = parseInt(decodeText(body), 10) || 0;
      else if (id === 'APIC' && body.length > 8) {
        const enc = body[0];
        let i = 1;
        while (i < body.length && body[i] !== 0) i++;
        const mime = new TextDecoder('iso-8859-1').decode(body.slice(1, i)) || 'image/jpeg';
        i += 2; // MIME terminator + picture type
        if (enc === 1 || enc === 2) {
          while (i + 1 < body.length && !(body[i] === 0 && body[i + 1] === 0)) i += 2;
          i += 2;
        } else {
          while (i < body.length && body[i] !== 0) i++;
          i++;
        }
        if (i < body.length) out.cover = new Blob([body.slice(i)], { type: mime });
      }
      p += 10 + size;
    }
    return out;
  }

  async function fingerprint(file) {
    const sample = await file.slice(0, Math.min(file.size, 128 * 1024)).arrayBuffer();
    if (crypto && crypto.subtle) {
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', sample));
      return 'local:' + Array.from(hash.slice(0, 12), b =>
        b.toString(16).padStart(2, '0')
      ).join('') + ':' + file.size;
    }
    return 'local:' + encodeURIComponent(file.name) + ':' + file.size + ':' + file.lastModified;
  }

  async function exists(id) {
    const db = await openDb();
    const found = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(id);
      req.onsuccess = () => resolve(!!req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return found;
  }

  async function store(file) {
    const id = await fingerprint(file);
    if (await exists(id)) return false;
    const meta = await metadata(file);
    const song = {
      id,
      title: meta.title,
      artist: meta.artist,
      album: meta.album,
      track: meta.track,
      local: true,
      localFileName: file.name,
      contentType: file.type || 'audio/mpeg',
      size: file.size,
    };
    const rec = {
      id,
      song,
      blob: file,
      cover: meta.cover,
      savedAt: Date.now(),
      imported: true,
    };
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  }

  function toast(text) {
    let box = document.getElementById('files-import-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'files-import-toast';
      box.className = 'files-import-toast';
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.classList.add('show');
    clearTimeout(box._timer);
    box._timer = setTimeout(() => box.classList.remove('show'), 2200);
  }

  async function importFiles(files) {
    const chosen = Array.from(files || []).filter(file =>
      /^audio\//i.test(file.type || '') || /\.(mp3|m4a|aac|wav|flac)$/i.test(file.name || '')
    );
    if (!chosen.length) return toast('Choose an audio file');

    let added = 0;
    toast('Importing…');
    for (const file of chosen) {
      try {
        if (await store(file)) added++;
      } catch (err) {
        console.warn('Local file import failed', file.name, err);
      }
    }

    if (window.NipoOffline && window.NipoOffline.refresh) {
      await window.NipoOffline.refresh();
    }

    const activeDownloaded = document.querySelector(
      '#library-tabs .seg-btn[data-lib="downloaded"].active'
    );
    if (activeDownloaded && window.NipoViews && window.NipoViews.showLibrary) {
      await window.NipoViews.showLibrary('downloaded');
    }

    toast(added
      ? 'Imported ' + added + ' file' + (added === 1 ? '' : 's')
      : 'Those files are already imported');
  }

  function install() {
    if (document.getElementById('import-files-btn')) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'files-import-input';
    input.accept = 'audio/*,.mp3,.m4a,.aac,.wav,.flac';
    input.multiple = true;
    input.hidden = true;
    input.addEventListener('change', async () => {
      await importFiles(input.files);
      input.value = '';
    });
    document.body.appendChild(input);

    const actions = document.querySelector('.topbar-actions');
    if (actions) {
      const button = document.createElement('button');
      button.id = 'import-files-btn';
      button.className = 'round-btn glass';
      button.type = 'button';
      button.setAttribute('aria-label', 'Import music from Files');
      button.title = 'Import from Files';
      button.innerHTML = '<svg class="ic"><use href="#i-download"></use></svg>';
      button.addEventListener('click', () => input.click());
      actions.insertBefore(button, actions.firstChild);
    }

    const style = document.createElement('style');
    style.textContent = `
      .files-import-toast {
        position: fixed; z-index: 100; left: 50%;
        bottom: calc(108px + var(--safe-bottom));
        transform: translate(-50%, 12px);
        padding: 10px 14px; border-radius: 12px;
        background: rgba(28,28,31,.94); color: #fff;
        font-size: 14px; font-weight: 600;
        opacity: 0; pointer-events: none;
        transition: opacity .2s ease, transform .2s ease;
        border: 1px solid rgba(255,255,255,.1);
        backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
      }
      .files-import-toast.show { opacity: 1; transform: translate(-50%, 0); }
    `;
    document.head.appendChild(style);
  }

  window.NipoFilesImport = { importFiles };
  install();
})();