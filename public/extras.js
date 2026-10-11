(() => {
  'use strict';

  const API_VERSION = '1.16.1';
  const CLIENT_ID = 'navpwa';
  const DB_NAME = 'nipo-offline';
  const urls = new Map();

  function auth() {
    try { return JSON.parse(localStorage.getItem('nd-auth') || 'null') || {}; }
    catch { return {}; }
  }
  function apiUrl(endpoint, params = {}) {
    const a = auth();
    const q = new URLSearchParams({
      u: a.username || '', t: a.token || '', s: a.salt || '',
      v: API_VERSION, c: CLIENT_ID, f: 'json', ...params,
    });
    return `${(a.server || '').replace(/\/$/, '')}/rest/${endpoint}?${q}`;
  }
  async function api(endpoint, params = {}) {
    const res = await fetch(apiUrl(endpoint, params));
    const data = await res.json();
    const body = data['subsonic-response'];
    if (!body || body.status !== 'ok') throw new Error((body && body.error && body.error.message) || 'Request failed');
    return body;
  }
  function cover(id, size) {
    return id ? apiUrl('getCoverArt', { id, size: size || 100 }) : '';
  }
  function esc(s) {
    return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c]));
  }
  function icon(name) {
    return `<svg class="ic"><use href="#i-${name}"></use></svg>`;
  }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('tracks')) req.result.createObjectStore('tracks', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Blobs read back from IndexedDB, kept so a URL can be minted synchronously
  // when playback starts. They are disk-backed, so holding the references does
  // not pull the audio into memory.
  const blobs = new Map();
  const coverBlobs = new Map();
  const coverUrls = new Map();

  const Offline = {
    ids: new Set(),
    async refresh() {
      try {
        const db = await openDb();
        const recs = await new Promise((resolve, reject) => {
          const r = db.transaction('tracks').objectStore('tracks').getAll();
          r.onsuccess = () => resolve(r.result || []);
          r.onerror = () => reject(r.error);
        });
        db.close();
        this.ids = new Set(recs.map((x) => x.id));
        // Previously only save() populated the URL map, so after a reload a
        // downloaded track had no local URL and silently streamed from the
        // network again — which is exactly what offline playback needs not to
        // do. Rehydrate from what is actually stored.
        blobs.clear();
        coverBlobs.clear();
        recs.forEach((r) => {
          if (r.blob) blobs.set(r.id, r.blob);
          if (r.cover) coverBlobs.set(r.id, r.cover);
        });
        return recs;
      } catch {
        return [];
      }
    },
    has(id) { return this.ids.has(id); },
    // Object URLs are minted on demand and cached, rather than creating one
    // per stored track up front.
    urlFor(id) {
      if (urls.has(id)) return urls.get(id);
      const b = blobs.get(id);
      if (!b) return null;
      const u = URL.createObjectURL(b);
      urls.set(id, u);
      return u;
    },
    coverUrlFor(id) {
      if (coverUrls.has(id)) return coverUrls.get(id);
      const b = coverBlobs.get(id);
      if (!b) return null;
      const u = URL.createObjectURL(b);
      coverUrls.set(id, u);
      return u;
    },
    async list() {
      const recs = await this.refresh();
      return recs.map((r) => ({ song: r.song, id: r.id }));
    },
    async get(id) {
      const db = await openDb();
      const rec = await new Promise((resolve, reject) => {
        const r = db.transaction('tracks').objectStore('tracks').get(id);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      db.close();
      return rec;
    },
    // onProgress receives 0..1 where the server reports a length, otherwise
    // null so callers can show an indeterminate state instead of a fake bar.
    async save(song, onProgress) {
      const res = await fetch(apiUrl('stream', { id: song.id }));
      if (!res.ok) throw new Error(`Download failed (${res.status})`);

      // Streamed rather than res.blob(), so a large track can report progress
      // instead of sitting silent for the whole transfer.
      let blob;
      const total = Number(res.headers.get('content-length')) || 0;
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const chunks = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          if (onProgress) onProgress(total ? Math.min(1, received / total) : null);
        }
        blob = new Blob(chunks, { type: res.headers.get('content-type') || 'audio/mpeg' });
      } else {
        blob = await res.blob();
      }

      // Artwork too, otherwise a downloaded track shows a blank tile offline.
      let coverBlob = null;
      try {
        const cRes = await fetch(cover(song.coverArt || song.id, 600));
        if (cRes.ok) coverBlob = await cRes.blob();
      } catch { /* artwork is optional; the audio is the point */ }

      const rec = { id: song.id, song, blob, cover: coverBlob, savedAt: Date.now() };
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('tracks', 'readwrite');
        tx.objectStore('tracks').put(rec);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();

      if (urls.has(song.id)) URL.revokeObjectURL(urls.get(song.id));
      urls.delete(song.id);
      if (coverUrls.has(song.id)) URL.revokeObjectURL(coverUrls.get(song.id));
      coverUrls.delete(song.id);
      blobs.set(song.id, blob);
      if (coverBlob) coverBlobs.set(song.id, coverBlob);
      this.ids.add(song.id);
      syncKeepButton(song);
    },
    async remove(id) {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('tracks', 'readwrite');
        tx.objectStore('tracks').delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
      if (coverUrls.has(id)) { URL.revokeObjectURL(coverUrls.get(id)); coverUrls.delete(id); }
      blobs.delete(id);
      coverBlobs.delete(id);
      this.ids.delete(id);
    },
    // Rough byte total, for showing how much space downloads are using.
    usage() {
      let bytes = 0;
      blobs.forEach((b) => { bytes += b.size || 0; });
      coverBlobs.forEach((b) => { bytes += b.size || 0; });
      return bytes;
    },
  };
  window.NipoOffline = Offline;
  Offline.refresh().then((recs) => {
    recs.forEach((r) => {
      if (r.blob) urls.set(r.id, URL.createObjectURL(r.blob));
    });
  });

  function moveTabPill() {
    const bar = document.getElementById('tabbar');
    const pill = document.getElementById('tab-pill');
    if (!bar || !pill) return;
    const active = bar.querySelector('.tab-btn.active');
    if (!active) {
      pill.style.opacity = '0';
      return;
    }
    const br = bar.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(bar).paddingLeft) || 0;
    pill.style.opacity = '1';
    pill.style.width = ar.width + 'px';
    pill.style.transform = `translateX(${ar.left - br.left - pad}px)`;
  }

  // The pill was only repositioned on tap, so a rotation or any relayout left
  // it sitting under the wrong tab. Re-measure on load and on resize, without
  // the move transition so it does not visibly slide during a rotate.
  function repositionPillNow() {
    const pill = document.getElementById('tab-pill');
    if (!pill) return;
    const prev = pill.style.transition;
    pill.style.transition = 'none';
    moveTabPill();
    // Restore on the next frame so later tab changes animate again.
    requestAnimationFrame(() => { pill.style.transition = prev; });
  }
  window.addEventListener('resize', repositionPillNow);
  window.addEventListener('orientationchange', repositionPillNow);
  if (document.readyState === 'complete') repositionPillNow();
  else window.addEventListener('load', repositionPillNow);

  function songRow(song) {
    const row = el('div', 'list-row');
    row.dataset.songId = song.id;
    song._list = song._list || [song];
    row.innerHTML = `
      <span class="row-star">${song.starred ? '★' : ''}</span>
      <img class="card-cover" loading="lazy" src="${cover(song.coverArt || song.id, 100)}" alt="" />
      <div class="row-main">
        <div class="row-title">${esc(song.title)}</div>
        <div class="row-sub">${esc(song.artist || '')}</div>
      </div>
      ${Offline.has(song.id) ? '<span class="dl-mark">' + icon('downloaded') + '</span>' : ''}
      <button class="row-more" aria-label="More">${icon('ellipsis')}</button>`;
    row.addEventListener('click', (e) => {
      if (e.target.closest('.row-more')) { openSongSheet(song); return; }
      const list = song._list || [song];
      const idx = Math.max(0, list.findIndex((x) => x.id === song.id));
      if (window.NipoPlayer && window.NipoPlayer.playQueue) {
        window.NipoPlayer.playQueue(list, idx);
      } else {
        const audio = document.getElementById('audio');
        if (audio) {
          audio.src = Offline.urlFor(song.id) || apiUrl('stream', { id: song.id });
          audio.play().catch(() => {});
        }
      }
    });
    return row;
  }

  function albumCard(album) {
    const card = el('div', 'card');
    card.innerHTML = `
      <img class="card-cover" loading="lazy" src="${cover(album.coverArt || album.id, 320)}" alt="" />
      <div class="card-title">${esc(album.name || album.title)}</div>
      <div class="card-sub">${esc(album.artist || '')}</div>`;
    return card;
  }

  async function fillNew() {
    const wrap = document.getElementById('new-content');
    if (!wrap) return;
    wrap.innerHTML = '<div class="empty-state">Loading…</div>';
    try {
      const data = await api('getAlbumList2', { type: 'newest', size: 40 });
      const albums = (data.albumList2 && data.albumList2.album) || [];
      wrap.innerHTML = '';
      wrap.appendChild(el('div', 'section-title', 'Recently Added'));
      const grid = el('div', 'grid');
      albums.forEach((a) => grid.appendChild(albumCard(a)));
      wrap.appendChild(grid);
      if (!albums.length) wrap.innerHTML = '<div class="empty-state">Nothing new yet</div>';
    } catch {
      wrap.innerHTML = '<div class="empty-state">Could not load new albums</div>';
    }
  }

  async function fillRadio() {
    const wrap = document.getElementById('radio-content');
    if (!wrap) return;
    wrap.innerHTML = '<div class="empty-state">Loading…</div>';
    try {
      const data = await api('getRandomSongs', { size: 40 });
      const songs = (data.randomSongs && data.randomSongs.song) || [];
      wrap.innerHTML = '';
      wrap.appendChild(el('div', 'section-title', 'Station Mix'));
      const list = el('div', 'song-list');
      songs.forEach((s) => { s._list = songs; list.appendChild(songRow(s)); });
      wrap.appendChild(list);
      if (!songs.length) wrap.innerHTML = '<div class="empty-state">No songs for radio</div>';
    } catch {
      wrap.innerHTML = '<div class="empty-state">Could not load radio</div>';
    }
  }

  async function injectLibraryExtras() {
    const content = document.getElementById('library-content');
    if (!content) return;
    const playlistsTab = document.querySelector('#library-tabs .seg-btn[data-lib="playlists"]');
    if (!playlistsTab || !playlistsTab.classList.contains('active')) return;
    if (content.querySelector('.starred-art')) return;
    let starredCount = 0;
    try {
      const data = await api('getStarred2');
      starredCount = ((data.starred2 && data.starred2.song) || []).length;
    } catch { /* ignore */ }
    const create = el('button', 'create-row');
    create.innerHTML = `${icon('plus')} New Playlist`;
    create.addEventListener('click', openCreateSheet);
    const starred = el('div', 'list-row');
    starred.innerHTML = `
      <div class="starred-art">${icon('star')}</div>
      <div class="row-main">
        <div class="row-title">Starred</div>
        <div class="row-sub">${starredCount} songs</div>
      </div>
      <button class="row-more" aria-label="Open">${icon('chevron-right')}</button>`;
    starred.addEventListener('click', openStarred);
    content.insertBefore(starred, content.firstChild);
    content.insertBefore(create, content.firstChild);
  }

  async function openStarred() {
    const wrap = document.getElementById('playlist-detail');
    const view = document.getElementById('view-playlist');
    if (!wrap || !view) return;
    document.querySelectorAll('.view').forEach((v) => { v.hidden = true; });
    view.hidden = false;
    wrap.innerHTML = '<div class="empty-state">Loading…</div>';
    try {
      const data = await api('getStarred2');
      const songs = (data.starred2 && data.starred2.song) || [];
      wrap.innerHTML = '';
      const header = el('div', 'detail-header');
      header.innerHTML = `
        <div class="starred-art" style="width:140px;height:140px;margin:0 auto;border-radius:16px;font-size:56px">${icon('star')}</div>
        <div class="detail-title">Starred</div>
        <div class="detail-meta">${songs.length} songs</div>`;
      wrap.appendChild(header);
      const list = el('div', 'song-list');
      songs.forEach((s) => { s._list = songs; list.appendChild(songRow(s)); });
      wrap.appendChild(list);
      if (!songs.length) list.appendChild(el('div', 'empty-state', 'Star a song to see it here'));
    } catch {
      wrap.innerHTML = '<div class="empty-state">Could not load starred</div>';
    }
  }

  const overlay = document.getElementById('sheet-overlay');
  const actionSheet = document.getElementById('action-sheet');
  const actionBody = document.getElementById('action-sheet-body');
  const createSheet = document.getElementById('create-sheet');
  let pendingSong = null;

  function closeSheets() {
    if (!overlay) return;
    overlay.classList.remove('open');
    if (actionSheet) actionSheet.classList.remove('open');
    if (createSheet) createSheet.classList.remove('open');
    setTimeout(() => {
      overlay.hidden = true;
      if (actionSheet) actionSheet.hidden = true;
      if (createSheet) createSheet.hidden = true;
    }, 280);
  }
  function showOverlay() {
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('open'));
  }
  if (overlay) overlay.addEventListener('click', closeSheets);

  window.NipoOpenSongSheet = openSongSheet;

  // Menu for a whole album or playlist, opened from a detail header's "...".
  window.NipoOpenListSheet = function openListSheet(ctx) {
    if (!actionSheet || !actionBody) return;
    actionBody.innerHTML = '';
    const add = (label, ic, fn) => {
      const b = el('button', 'sheet-item');
      b.innerHTML = `${icon(ic)} ${esc(label)}`;
      b.addEventListener('click', async () => { closeSheets(); await fn(); });
      actionBody.appendChild(b);
    };
    const P = window.NipoPlayer;
    add('Play', 'play', () => P && P.playQueue(ctx.songs, 0));
    add('Shuffle', 'shuffle', () => {
      if (P) P.playQueue(ctx.songs, Math.floor(Math.random() * ctx.songs.length), { shuffle: true });
    });
    add('Play Next', 'queue', () => {
      if (!P || !P.queue) return;
      ctx.songs.forEach((s, n) => {
        P.queue.push(s);
        P.order.splice(P.pos + 1 + n, 0, P.queue.length - 1);
      });
    });
    add(`Keep ${ctx.songs.length} Offline`, 'download', async () => {
      for (const s of ctx.songs) {
        try { await Offline.save(s); } catch (err) { console.warn('save failed', s.id, err); }
      }
    });
    actionSheet.hidden = false;
    showOverlay();
    requestAnimationFrame(() => actionSheet.classList.add('open'));
  };
  function openSongSheet(song) {
    if (!actionSheet || !actionBody) return;
    actionBody.innerHTML = '';
    const add = (label, ic, fn) => {
      const b = el('button', 'sheet-item');
      b.innerHTML = `${icon(ic)} ${esc(label)}`;
      b.addEventListener('click', async () => { closeSheets(); await fn(); });
      actionBody.appendChild(b);
    };
    add(song.starred ? 'Undo Favorite' : 'Favorite', 'star', async () => {
      await api(song.starred ? 'unstar' : 'star', { id: song.id });
      song.starred = song.starred ? undefined : new Date().toISOString();
      const starBtn = document.getElementById('np-star');
      if (starBtn) starBtn.classList.toggle('on', !!song.starred);
      if (window.NipoSyncRowMarks) window.NipoSyncRowMarks(song.id, { starred: !!song.starred });
    });
    add('Add to Playlist', 'list-plus', () => openAddToPlaylist(song));
    // Drop the track in directly after whatever is playing.
    add('Play Next', 'queue', () => {
      const P = window.NipoPlayer;
      if (!P || !P.queue) return;
      P.queue.push(song);
      P.order.splice(P.pos + 1, 0, P.queue.length - 1);
    });
    if (song.albumId || song.parent) {
      add('Go to Album', 'note', () => {
        if (window.NipoViews && window.NipoViews.openAlbum) {
          window.NipoViews.openAlbum(song.albumId || song.parent);
        }
      });
    }
    if (Offline.has(song.id)) {
      add('Remove Download', 'downloaded', async () => {
        await Offline.remove(song.id);
        syncKeepButton(song);
        if (window.NipoSyncRowMarks) window.NipoSyncRowMarks(song.id, { downloaded: false });
      });
    } else {
      add('Keep Offline', 'download', async () => {
        try {
          await Offline.save(song);
          if (window.NipoSyncRowMarks) window.NipoSyncRowMarks(song.id, { downloaded: true });
        } catch (err) { console.warn(err); }
      });
    }
    actionSheet.hidden = false;
    showOverlay();
    requestAnimationFrame(() => actionSheet.classList.add('open'));
  }

  async function openAddToPlaylist(song) {
    actionBody.innerHTML = '';
    const add = (label, ic, fn) => {
      const b = el('button', 'sheet-item');
      b.innerHTML = `${icon(ic)} ${esc(label)}`;
      b.addEventListener('click', async () => { closeSheets(); await fn(); });
      actionBody.appendChild(b);
    };
    add('New Playlist', 'plus', async () => { pendingSong = song; openCreateSheet(); });
    try {
      const data = await api('getPlaylists');
      ((data.playlists && data.playlists.playlist) || []).forEach((p) => {
        add(p.name, 'note', () => api('updatePlaylist', { playlistId: p.id, songIdToAdd: song.id }));
      });
    } catch { /* ignore */ }
    actionSheet.hidden = false;
    showOverlay();
    requestAnimationFrame(() => actionSheet.classList.add('open'));
  }

  function openCreateSheet() {
    if (!createSheet) return;
    createSheet.hidden = false;
    overlay.hidden = false;
    const input = document.getElementById('create-name');
    if (input) input.value = '';
    requestAnimationFrame(() => {
      overlay.classList.add('open');
      createSheet.classList.add('open');
      if (input) input.focus();
    });
  }

  function syncKeepButton(song) {
    const btn = document.getElementById('np-keep');
    if (!btn) return;
    const id = song && song.id;
    const on = !!(id && Offline.has(id));
    btn.classList.toggle('on', on);
    const use = btn.querySelector('use');
    if (use) use.setAttribute('href', on ? '#i-downloaded' : '#i-download');
  }
  Offline.syncKeep = syncKeepButton;

  const keepBtn = document.getElementById('np-keep');
  if (keepBtn) {
    keepBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cur = window.NipoPlayer && window.NipoPlayer.current;
      const titleEl = document.getElementById('np-title');
      const id = (cur && cur.id) || (titleEl && titleEl.dataset.songId);
      if (!id) return;
      const song = cur || {
        id,
        title: titleEl && titleEl.textContent,
        artist: document.getElementById('np-artist') && document.getElementById('np-artist').textContent,
      };
      // Saving pulls the whole audio blob, which takes seconds on a large
      // file. With no busy state the button looked dead, and a failure was an
      // unhandled rejection that surfaced nothing at all.
      if (keepBtn.dataset.busy) return;
      keepBtn.dataset.busy = '1';
      keepBtn.classList.add('busy');
      try {
        if (Offline.has(id)) await Offline.remove(id);
        else {
          await Offline.save(song, (p) => {
            // Drives a conic sweep on the button so a long download shows
            // real progress rather than just a pulse.
            if (p == null) keepBtn.style.removeProperty('--dl');
            else keepBtn.style.setProperty('--dl', Math.round(p * 100) + '%');
          });
          keepBtn.style.removeProperty('--dl');
        }
        syncKeepButton(song);
        if (window.NipoSyncRowMarks) {
          window.NipoSyncRowMarks(id, { downloaded: Offline.has(id) });
        }
      } catch (err) {
        keepBtn.style.removeProperty('--dl');
        console.warn('Keep Offline failed', err);
        keepBtn.classList.add('failed');
        setTimeout(() => keepBtn.classList.remove('failed'), 1600);
      } finally {
        delete keepBtn.dataset.busy;
        keepBtn.classList.remove('busy');
      }
    });
  }

  const createBtn = document.getElementById('create-playlist-btn');
  if (createBtn) createBtn.addEventListener('click', openCreateSheet);
  const cancel = document.getElementById('create-cancel');
  if (cancel) cancel.addEventListener('click', () => { pendingSong = null; closeSheets(); });
  const confirmBtn = document.getElementById('create-confirm');
  if (confirmBtn) confirmBtn.addEventListener('click', async () => {
    const name = (document.getElementById('create-name').value || '').trim();
    if (!name) return;
    const params = { name };
    if (pendingSong) params.songId = pendingSong.id;
    try {
      await api('createPlaylist', params);
      pendingSong = null;
      closeSheets();
    } catch (err) {
      document.getElementById('create-name').placeholder = err.message || 'Could not create';
    }
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn, #search-fab');
    if (!btn) return;
    setTimeout(() => {
      moveTabPill();
      const name = btn.dataset.view;
      if (name === 'new') fillNew();
      if (name === 'radio') fillRadio();
      if (name === 'library') setTimeout(injectLibraryExtras, 400);
    }, 30);
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('#library-tabs .seg-btn')) setTimeout(injectLibraryExtras, 400);
  });

  window.addEventListener('resize', moveTabPill);
  requestAnimationFrame(moveTabPill);
  setTimeout(moveTabPill, 250);
})();
