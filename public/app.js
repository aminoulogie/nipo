(() => {
  'use strict';

  const CLIENT_ID = 'navpwa';
  const API_VERSION = '1.16.1';

  // ---------- Subsonic API client ----------
  const Api = {
    server: '',
    username: '',
    salt: '',
    token: '',

    load() {
      try {
        const s = JSON.parse(localStorage.getItem('nd-auth') || 'null');
        if (s) Object.assign(this, s);
        return !!this.token;
      } catch {
        return false;
      }
    },
    save() {
      localStorage.setItem('nd-auth', JSON.stringify({
        server: this.server, username: this.username, salt: this.salt, token: this.token,
      }));
    },
    clear() {
      localStorage.removeItem('nd-auth');
      this.server = this.username = this.salt = this.token = '';
    },
    setCreds(server, username, password) {
      this.server = server.replace(/\/$/, '');
      this.username = username;
      this.salt = Math.random().toString(36).slice(2, 12);
      this.token = md5(password + this.salt);
    },
    url(endpoint, params = {}) {
      const q = new URLSearchParams({
        u: this.username, t: this.token, s: this.salt,
        v: API_VERSION, c: CLIENT_ID, f: 'json', ...params,
      });
      return `${this.server}/rest/${endpoint}?${q.toString()}`;
    },
    async call(endpoint, params = {}) {
      const res = await fetch(this.url(endpoint, params));
      const data = await res.json();
      const body = data['subsonic-response'];
      if (!body || body.status !== 'ok') {
        throw new Error(body && body.error ? body.error.message : 'Request failed');
      }
      return body;
    },
    coverUrl(id, size = 300) {
      return id ? this.url('getCoverArt', { id, size }) : '';
    },
    streamUrl(id) {
      return this.url('stream', { id });
    },
  };

  // ---------- Helpers ----------
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return (s || '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  // Markup for one sprite glyph; `name` is an id in the sprite minus the "i-".
  function icon(name, cls) {
    return `<svg class="ic${cls ? ' ' + cls : ''}"><use href="#i-${name}"></use></svg>`;
  }
  // Swap the glyph inside an existing button without rebuilding it.
  function setIcon(btn, name) {
    const use = btn.querySelector('use');
    if (use) use.setAttribute('href', '#i-' + name);
  }

  // OpenSubsonic exposes explicitStatus; render the badge only when the server
  // actually reports it rather than guessing.
  function explicitBadge(item) {
    return item && item.explicitStatus === 'explicit' ? '<span class="explicit">E</span>' : '';
  }

  // Average the artwork down to one muted colour and use it to tint the
  // Now Playing background, the way Apple Music derives its backdrop.
  function applyArtworkTint(coverSrc) {
    if (!coverSrc) return;
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 24;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, 24, 24);
        const d = ctx.getImageData(0, 0, 24, 24).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
        const mix = (v, target, amt) => Math.round(v + (target - v) * amt);
        const root = document.documentElement.style;
        // Pull toward black so text stays legible whatever the cover looks like.
        root.setProperty('--np-tint', `rgb(${mix(r, 0, 0.52)},${mix(g, 0, 0.52)},${mix(b, 0, 0.52)})`);
        root.setProperty('--np-tint-hi', `rgb(${mix(r, 0, 0.32)},${mix(g, 0, 0.32)},${mix(b, 0, 0.32)})`);
      } catch {
        /* Canvas read can fail; the default tint is a fine fallback. */
      }
    };
    img.src = coverSrc;
  }

  // ---------- Player ----------
  const audio = document.getElementById('audio');
  const Player = {
    queue: [],
    order: [],       // indices into queue, in playback order
    pos: -1,         // position within order
    shuffle: false,
    repeat: false,

    get current() {
      const i = this.order[this.pos];
      return this.queue[i] || null;
    },

    playQueue(songs, startIndex, { shuffle = false } = {}) {
      this.queue = songs;
      this.shuffle = shuffle;
      this.buildOrder(startIndex);
      this.playCurrent();
      syncToggleButtons();
    },
    buildOrder(startIndex) {
      const n = this.queue.length;
      if (this.shuffle) {
        const rest = [];
        for (let i = 0; i < n; i++) if (i !== startIndex) rest.push(i);
        for (let i = rest.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        this.order = [startIndex, ...rest];
      } else {
        this.order = Array.from({ length: n }, (_, i) => i);
      }
      this.pos = this.shuffle ? 0 : startIndex;
    },
    toggleShuffle() {
      const cur = this.order[this.pos];
      this.shuffle = !this.shuffle;
      if (cur !== undefined) this.buildOrder(cur);
      syncToggleButtons();
      renderQueue();
    },
    toggleRepeat() {
      this.repeat = !this.repeat;
      syncToggleButtons();
    },

    playCurrent() {
      const song = this.current;
      if (!song) return;
      audio.src = Api.streamUrl(song.id);
      audio.play().catch(() => {});
      this.updateUI();
      this.updateMediaSession();
      renderQueue();
    },
    toggle() {
      if (!this.current) return;
      if (audio.paused) audio.play().catch(() => {}); else audio.pause();
    },
    next() {
      if (this.pos < this.order.length - 1) { this.pos++; this.playCurrent(); }
      else if (this.repeat && this.order.length) { this.pos = 0; this.playCurrent(); }
    },
    prev() {
      if (audio.currentTime > 3) { audio.currentTime = 0; return; }
      if (this.pos > 0) { this.pos--; this.playCurrent(); }
    },

    updateUI() {
      const song = this.current;
      const mini = document.getElementById('mini-player');
      if (!song) { mini.hidden = true; return; }
      mini.hidden = false;

      const smallCover = Api.coverUrl(song.coverArt || song.id, 120);
      const bigCover = Api.coverUrl(song.coverArt || song.id, 600);
      document.getElementById('mini-cover').src = smallCover;
      document.getElementById('mini-title').textContent = song.title || '';
      document.getElementById('mini-artist').textContent = song.artist || '';
      document.getElementById('np-cover').src = bigCover;
      const titleEl = document.getElementById('np-title');
      // extras.js reads this as a fallback for which song the Keep Offline
      // button should act on.
      titleEl.dataset.songId = song.id;
      titleEl.innerHTML = esc(song.title) + explicitBadge(song);
      document.getElementById('np-artist').textContent = song.artist || '';
      document.getElementById('np-star').classList.toggle('on', !!song.starred);
      applyArtworkTint(bigCover);
      // Keep the download icon showing the new track's state, not the old one.
      if (window.NipoOffline && window.NipoOffline.syncKeep) window.NipoOffline.syncKeep(song);

      this.updatePlayIcons();
      document.querySelectorAll('.list-row[data-song-id]').forEach((r) => {
        r.classList.toggle('playing', r.dataset.songId === song.id);
      });
    },
    updatePlayIcons() {
      const playing = !audio.paused && !audio.ended;
      setIcon(document.getElementById('mini-playpause'), playing ? 'pause' : 'play');
      setIcon(document.getElementById('np-playpause'), playing ? 'pause' : 'play');
      document.getElementById('now-playing').classList.toggle('paused', !playing);
    },
    updateMediaSession() {
      if (!('mediaSession' in navigator)) return;
      const song = this.current;
      if (!song) return;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title || '',
        artist: song.artist || '',
        album: song.album || '',
        artwork: [{ src: Api.coverUrl(song.coverArt || song.id, 600), sizes: '600x600', type: 'image/jpeg' }],
      });
      navigator.mediaSession.setActionHandler('play', () => this.toggle());
      navigator.mediaSession.setActionHandler('pause', () => this.toggle());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
      navigator.mediaSession.setActionHandler('seekto', (d) => {
        if (d.seekTime != null) audio.currentTime = d.seekTime;
      });
    },
  };

  // extras.js drives playback through this (song rows, the Downloaded and
  // Starred views, the Keep Offline button). Without it those fall back to
  // setting audio.src directly, which skips updateUI, so the artwork and
  // title stay on the previous track.
  window.NipoPlayer = Player;

  function syncToggleButtons() {
    document.getElementById('np-shuffle').classList.toggle('on', Player.shuffle);
    document.getElementById('np-repeat').classList.toggle('on', Player.repeat);
  }

  function renderQueue() {
    const list = document.getElementById('np-queue-list');
    if (!list) return;
    list.innerHTML = '';
    for (let p = Player.pos + 1; p < Player.order.length; p++) {
      const song = Player.queue[Player.order[p]];
      if (!song) continue;
      const row = el('div', 'list-row');
      row.innerHTML = `
        <img class="card-cover" loading="lazy" src="${Api.coverUrl(song.coverArt || song.id, 100)}" alt="" />
        <div class="row-main">
          <div class="row-title">${esc(song.title)}${explicitBadge(song)}</div>
          <div class="row-sub">${esc(song.artist || '')}</div>
        </div>`;
      const jumpTo = p;
      row.addEventListener('click', () => { Player.pos = jumpTo; Player.playCurrent(); });
      list.appendChild(row);
    }
    if (!list.children.length) {
      list.appendChild(el('div', 'empty-state', 'Nothing else queued'));
    }
  }

  // Keep a slider's filled portion in step with its value.
  function paintSlider(input) {
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const pct = max > min ? ((input.value - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--pct', pct + '%');
  }

  audio.addEventListener('play', () => Player.updatePlayIcons());
  audio.addEventListener('pause', () => Player.updatePlayIcons());
  audio.addEventListener('ended', () => Player.next());
  audio.addEventListener('timeupdate', () => {
    const dur = audio.duration;
    const seek = document.getElementById('np-seek');
    if (dur && !seek.dataset.dragging) {
      seek.value = Math.round((audio.currentTime / dur) * 1000);
      paintSlider(seek);
    }
    document.getElementById('np-time-cur').textContent = fmtTime(audio.currentTime);
    document.getElementById('np-time-rem').textContent =
      dur ? '-' + fmtTime(dur - audio.currentTime) : '-0:00';
    if ('mediaSession' in navigator && dur) {
      try {
        navigator.mediaSession.setPositionState({
          duration: dur, playbackRate: 1, position: Math.min(audio.currentTime, dur),
        });
      } catch { /* setPositionState throws on some transient states */ }
    }
  });

  // ---------- Row / card builders ----------
  function songRow(song, list, idx, { numbered = false } = {}) {
    const row = el('div', 'list-row');
    row.dataset.songId = song.id;
    const lead = numbered
      ? `<div class="row-index">${esc(String(song.track || idx + 1))}</div>`
      : `<span class="row-star">${song.starred ? '★' : ''}</span>
         <img class="card-cover" loading="lazy" src="${Api.coverUrl(song.coverArt || song.id, 100)}" alt="" />`;
    row.innerHTML = `
      ${lead}
      <div class="row-main">
        <div class="row-title">${esc(song.title)}${explicitBadge(song)}</div>
        <div class="row-sub">${esc(song.artist || '')}</div>
      </div>
      <button class="row-more" aria-label="More">${icon('ellipsis')}</button>`;
    row.addEventListener('click', (e) => {
      // extras.js owns the action sheet; these rows previously swallowed the
      // tap and opened nothing.
      if (e.target.closest('.row-more')) {
        if (window.NipoOpenSongSheet) window.NipoOpenSongSheet(song);
        return;
      }
      Player.playQueue(list, idx);
    });
    return row;
  }

  function albumCard(album) {
    const card = el('div', 'card');
    card.innerHTML = `
      <img class="card-cover" loading="lazy" src="${Api.coverUrl(album.coverArt || album.id, 320)}" alt="" />
      <div class="card-title">${esc(album.name || album.title)}</div>
      <div class="card-sub">${esc(album.artist || '')}</div>`;
    card.addEventListener('click', () => Views.openAlbum(album.id));
    return card;
  }

  function artistRow(artist) {
    const row = el('div', 'list-row');
    row.innerHTML = `
      <img class="card-cover" loading="lazy" style="border-radius:50%"
           src="${Api.coverUrl(artist.coverArt || artist.id, 100)}" alt="" />
      <div class="row-main">
        <div class="row-title">${esc(artist.name)}</div>
        <div class="row-sub">${artist.albumCount || 0} albums</div>
      </div>
      <button class="row-more" aria-label="Open">${icon('chevron-right')}</button>`;
    row.addEventListener('click', () => Views.openArtist(artist.id));
    return row;
  }

  function playlistRow(pl) {
    const row = el('div', 'list-row');
    row.innerHTML = `
      <img class="card-cover" loading="lazy" src="${Api.coverUrl(pl.coverArt || pl.id, 100)}" alt="" />
      <div class="row-main">
        <div class="row-title">${esc(pl.name)}</div>
        <div class="row-sub">${pl.songCount || 0} songs</div>
      </div>
      <button class="row-more" aria-label="Open">${icon('chevron-right')}</button>`;
    row.addEventListener('click', () => Views.openPlaylist(pl.id));
    return row;
  }

  // Play + Shuffle pair shown above every tracklist.
  function actionRow(getSongs) {
    const row = el('div', 'action-row');
    row.innerHTML = `
      <button class="action-btn" data-act="play">${icon('play')} Play</button>
      <button class="action-btn" data-act="shuffle">${icon('shuffle')} Shuffle</button>`;
    row.querySelector('[data-act=play]').addEventListener('click', () => {
      const s = getSongs();
      if (s.length) Player.playQueue(s, 0, { shuffle: false });
    });
    row.querySelector('[data-act=shuffle]').addEventListener('click', () => {
      const s = getSongs();
      if (s.length) Player.playQueue(s, Math.floor(Math.random() * s.length), { shuffle: true });
    });
    return row;
  }

  // ---------- Views ----------
  const Views = {
    async showHome() {
      Nav.setTitle('Home');
      const [recent, random, frequent] = await Promise.all([
        Api.call('getAlbumList2', { type: 'newest', size: 12 }).catch(() => null),
        Api.call('getAlbumList2', { type: 'random', size: 12 }).catch(() => null),
        Api.call('getAlbumList2', { type: 'frequent', size: 12 }).catch(() => null),
      ]);
      const pick = (d) => (d && d.albumList2 && d.albumList2.album) || null;
      renderSection('home-recent', 'Recently Added', pick(recent));
      renderSection('home-random', 'Made for You', pick(random));
      renderSection('home-frequent', 'Most Played', pick(frequent));
    },

    async openAlbum(id) {
      Nav.push('album');
      const wrap = document.getElementById('album-detail');
      wrap.innerHTML = '<div class="empty-state">Loading…</div>';
      const { album } = await Api.call('getAlbum', { id });
      const songs = album.song || [];
      wrap.innerHTML = '';

      const header = el('div', 'detail-header');
      const mins = Math.round((album.duration || 0) / 60);
      header.innerHTML = `
        <img class="detail-cover" src="${Api.coverUrl(album.coverArt || album.id, 600)}" alt="" />
        <div class="detail-title">${esc(album.name)}</div>
        <div class="detail-sub">${esc(album.artist || '')}</div>
        <div class="detail-meta">${album.year ? album.year + ' · ' : ''}${songs.length} songs${mins ? ' · ' + mins + ' min' : ''}</div>`;
      wrap.appendChild(header);
      wrap.appendChild(actionRow(() => songs));

      const list = el('div', 'tracklist');
      songs.forEach((s, i) => list.appendChild(songRow(s, songs, i, { numbered: true })));
      wrap.appendChild(list);
      stagger(list);
      // Feeds the header's "..." button, which is shared across detail views.
      detailContext = { kind: 'album', title: album.name, songs };
    },

    async openArtist(id) {
      Nav.push('artist');
      const wrap = document.getElementById('artist-detail');
      wrap.innerHTML = '<div class="empty-state">Loading…</div>';
      const { artist } = await Api.call('getArtist', { id });
      const albums = artist.album || [];
      wrap.innerHTML = '';
      const header = el('div', 'detail-header');
      header.innerHTML = `
        <img class="detail-cover" style="border-radius:50%"
             src="${Api.coverUrl(artist.coverArt || artist.id, 600)}" alt="" />
        <div class="detail-title">${esc(artist.name)}</div>
        <div class="detail-meta">${albums.length} albums</div>`;
      wrap.appendChild(header);
      const grid = el('div', 'grid');
      albums.forEach((a) => grid.appendChild(albumCard(a)));
      wrap.appendChild(grid);
    },

    async openPlaylist(id) {
      Nav.push('playlist');
      const wrap = document.getElementById('playlist-detail');
      wrap.innerHTML = '<div class="empty-state">Loading…</div>';
      const { playlist } = await Api.call('getPlaylist', { id });
      const songs = playlist.entry || [];
      wrap.innerHTML = '';
      const header = el('div', 'detail-header');
      header.innerHTML = `
        <img class="detail-cover" src="${Api.coverUrl(playlist.coverArt || playlist.id, 600)}" alt="" />
        <div class="detail-title">${esc(playlist.name)}</div>
        <div class="detail-meta">${songs.length} songs</div>`;
      wrap.appendChild(header);
      wrap.appendChild(actionRow(() => songs));
      const list = el('div', 'song-list');
      songs.forEach((s, i) => list.appendChild(songRow(s, songs, i)));
      wrap.appendChild(list);
      stagger(list);
      detailContext = { kind: 'playlist', title: playlist.name, songs };
    },

    async showLibrary(tab) {
      Nav.setTitle('Library');
      const content = document.getElementById('library-content');
      content.innerHTML = '<div class="empty-state">Loading…</div>';
      if (tab === 'albums') {
        const data = await Api.call('getAlbumList2', { type: 'alphabeticalByName', size: 500 });
        const albums = (data.albumList2 && data.albumList2.album) || [];
        content.innerHTML = '';
        const grid = el('div', 'grid');
        albums.forEach((a) => grid.appendChild(albumCard(a)));
        content.appendChild(grid);
        stagger(grid);
        if (!albums.length) content.innerHTML = '<div class="empty-state">No albums found</div>';
      } else if (tab === 'artists') {
        const data = await Api.call('getArtists');
        const idx = (data.artists && data.artists.index) || [];
        content.innerHTML = '';
        idx.forEach((group) => (group.artist || []).forEach((a) => content.appendChild(artistRow(a))));
        if (!content.children.length) content.innerHTML = '<div class="empty-state">No artists found</div>';
      } else if (tab === 'downloaded') {
        // This tab had no branch at all, so it fell through and rendered the
        // playlist list instead of the offline tracks.
        const Off = window.NipoOffline;
        const recs = Off && Off.list ? await Off.list() : [];
        const songs = recs.map((r) => r.song).filter(Boolean);
        content.innerHTML = '';
        if (!songs.length) {
          content.innerHTML = '<div class="empty-state">Nothing downloaded yet</div>';
        } else {
          const list = el('div', 'song-list');
          songs.forEach((s, i) => list.appendChild(songRow(s, songs, i)));
          content.appendChild(list);
          stagger(list);
        }
      } else {
        const data = await Api.call('getPlaylists');
        const pls = (data.playlists && data.playlists.playlist) || [];
        content.innerHTML = '';
        pls.forEach((p) => content.appendChild(playlistRow(p)));
        if (!pls.length) content.innerHTML = '<div class="empty-state">No playlists found</div>';
        stagger(content);
      }
    },
  };

  // Lets the action sheet in extras.js navigate ("Go to Album").
  window.NipoViews = Views;

  // Whatever detail view is on screen, for the shared header "..." button.
  let detailContext = null;

  // Stamps each child's position so the CSS can stagger their entrance.
  function stagger(container) {
    if (!container) return;
    let i = 0;
    for (const child of container.children) {
      if (child.classList.contains('list-row') || child.classList.contains('card')) {
        // Capped so a long list does not visibly crawl in from the bottom.
        child.style.setProperty('--i', Math.min(i++, 12));
      } else {
        stagger(child); // grids and groups nest one level down
      }
    }
  }
  window.NipoStagger = stagger;

  function renderSection(containerId, title, albums) {
    const c = document.getElementById(containerId);
    if (!albums || !albums.length) { c.innerHTML = ''; return; }
    c.innerHTML = `<div class="section-title">${esc(title)}</div>`;
    const row = el('div', 'carousel');
    albums.forEach((a) => row.appendChild(albumCard(a)));
    c.appendChild(row);
    stagger(row);
  }

  // ---------- Search ----------
  let searchTimer = null;
  document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    const results = document.getElementById('search-results');
    if (!q) { results.innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      const data = await Api.call('search3', { query: q, artistCount: 8, albumCount: 8, songCount: 25 })
        .catch(() => null);
      if (!data) return;
      const r = data.searchResult3 || {};
      results.innerHTML = '';
      if ((r.artist || []).length) {
        results.appendChild(el('div', 'result-group-title', 'Artists'));
        r.artist.forEach((a) => results.appendChild(artistRow(a)));
      }
      if ((r.album || []).length) {
        results.appendChild(el('div', 'result-group-title', 'Albums'));
        const grid = el('div', 'grid');
        r.album.forEach((a) => grid.appendChild(albumCard(a)));
        results.appendChild(grid);
        stagger(grid);
      }
      if ((r.song || []).length) {
        results.appendChild(el('div', 'result-group-title', 'Songs'));
        r.song.forEach((s, i) => results.appendChild(songRow(s, r.song, i)));
      }
      if (!results.children.length) results.innerHTML = '<div class="empty-state">No results</div>';
    }, 320);
  });

  // ---------- Navigation ----------
  const TITLES = { home: 'Home', search: 'Search', library: 'Library' };
  const Nav = {
    stack: ['home'],
    setTitle(t) { document.getElementById('topbar-title').textContent = t; },
    showView(name) {
      document.querySelectorAll('.view').forEach((v) => (v.hidden = true));
      document.getElementById('view-' + name).hidden = false;
      // Detail screens carry their own back / "..." row, so the big section
      // title does not belong there — it was still reading "Home" while an
      // album was open.
      const isDetail = !TITLES[name];
      document.getElementById('app').classList.toggle('in-detail', isDetail);
    },
    push(name) { this.stack.push(name); this.showView(name); },
    back() {
      if (this.stack.length > 1) this.stack.pop();
      const name = this.stack[this.stack.length - 1];
      this.showView(name);
      if (TITLES[name]) this.setTitle(TITLES[name]);
    },
    tabTo(name) {
      this.stack = [name];
      this.showView(name);
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
      this.setTitle(TITLES[name]);
      if (name === 'library') Views.showLibrary(currentLibTab());
    },
  };
  function currentLibTab() {
    const active = document.querySelector('#library-tabs .seg-btn.active');
    return active ? active.dataset.lib : 'albums';
  }

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => Nav.tabTo(btn.dataset.view));
  });

  // Horizontal swipe across the content area moves between tabs. Only fires
  // when the gesture is clearly sideways, so it never fights vertical
  // scrolling or a horizontal carousel.
  const viewsEl = document.getElementById('views');
  const TAB_ORDER = [...document.querySelectorAll('.tab-btn')].map((b) => b.dataset.view);
  let swX = null, swY = null, swLocked = false;
  viewsEl.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    // A carousel or slider under the finger keeps its own horizontal drag.
    if (e.target.closest('.carousel, input[type=range]')) { swX = null; return; }
    swX = e.touches[0].clientX;
    swY = e.touches[0].clientY;
    swLocked = false;
  }, { passive: true });
  viewsEl.addEventListener('touchmove', (e) => {
    if (swX === null || swLocked) return;
    const dx = e.touches[0].clientX - swX;
    const dy = e.touches[0].clientY - swY;
    if (Math.abs(dy) > Math.abs(dx)) { swX = null; return; } // vertical scroll wins
    if (Math.abs(dx) < 60) return;
    swLocked = true;
    const cur = document.querySelector('.tab-btn.active');
    const i = TAB_ORDER.indexOf(cur && cur.dataset.view);
    if (i === -1) return;
    const next = TAB_ORDER[dx < 0 ? i + 1 : i - 1];
    if (!next) return;
    const btn = document.querySelector(`.tab-btn[data-view="${next}"]`);
    if (btn) btn.click(); // click so extras.js pill/lazy-loading also runs
  }, { passive: true });
  viewsEl.addEventListener('touchend', () => { swX = null; });
  document.querySelectorAll('[data-back]').forEach((btn) => btn.addEventListener('click', () => Nav.back()));

  // The "..." in each detail header had no handler at all — three dead
  // buttons, one per detail view. They share one menu driven by whichever
  // view is currently open.
  document.querySelectorAll('.detail-head-row .round-btn:not([data-back])').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!detailContext || !detailContext.songs.length) return;
      if (window.NipoOpenListSheet) window.NipoOpenListSheet(detailContext);
    });
  });
  document.querySelectorAll('#library-tabs .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#library-tabs .seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      Views.showLibrary(btn.dataset.lib);
    });
  });

  // ---------- Now Playing sheet ----------
  const npSheet = document.getElementById('now-playing');
  document.getElementById('mini-player').addEventListener('click', (e) => {
    if (e.target.closest('.mini-btn')) return;
    npSheet.hidden = false;
    requestAnimationFrame(() => npSheet.classList.add('open'));
  });
  function closeNP() {
    npSheet.classList.remove('open');
    setTimeout(() => { npSheet.hidden = true; }, 440);
  }
  document.getElementById('np-collapse').addEventListener('click', closeNP);

  // Swipe down to dismiss. The sheet tracks the finger 1:1, resists upward
  // drags, and flicks away on either distance or velocity so a short fast
  // swipe closes it just like a slow long one.
  // Touch events rather than Pointer events: iOS Safari cancels pointer
  // sequences unpredictably in standalone (home-screen) mode, which killed the
  // gesture mid-swipe. Mouse handlers cover the desktop case separately.
  let dragFrom = null, dragLastY = 0, dragLastT = 0, dragVel = 0;

  function dragStart(y, target) {
    // Controls and the scrollable queue keep their own gestures.
    if (target && target.closest && target.closest('button, input[type=range], .np-queue')) return;
    dragFrom = y;
    dragLastY = y;
    dragLastT = performance.now();
    dragVel = 0;
    npSheet.classList.add('dragging');
  }
  function dragMove(y) {
    if (dragFrom === null) return;
    // Rubber-band anything above the resting position instead of lifting off.
    const raw = y - dragFrom;
    const dy = raw < 0 ? raw / 6 : raw;
    const now = performance.now();
    const dt = now - dragLastT;
    if (dt > 0) {
      dragVel = (y - dragLastY) / dt; // px per ms
      dragLastY = y;
      dragLastT = now;
    }
    npSheet.style.transform = `translateY(${dy}px)`;
  }
  function dragEnd(y) {
    if (dragFrom === null) return;
    const dy = y - dragFrom;
    dragFrom = null;
    npSheet.classList.remove('dragging');
    npSheet.style.transform = '';
    // Distance or a quick flick both dismiss.
    if (dy > 110 || dragVel > 0.55) closeNP();
  }
  function dragAbort() {
    if (dragFrom === null) return;
    dragFrom = null;
    npSheet.classList.remove('dragging');
    npSheet.style.transform = '';
  }

  npSheet.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    dragStart(e.touches[0].clientY, e.target);
  }, { passive: true });
  npSheet.addEventListener('touchmove', (e) => {
    if (dragFrom === null) return;
    e.preventDefault(); // hold off Safari's rubber-band scroll
    dragMove(e.touches[0].clientY);
  }, { passive: false });
  npSheet.addEventListener('touchend', (e) => {
    if (dragFrom === null) return;
    dragEnd(e.changedTouches[0].clientY);
  });
  npSheet.addEventListener('touchcancel', dragAbort);

  // Desktop: same gesture with a mouse, so it is testable outside a phone.
  npSheet.addEventListener('mousedown', (e) => dragStart(e.clientY, e.target));
  window.addEventListener('mousemove', (e) => dragMove(e.clientY));
  window.addEventListener('mouseup', (e) => dragEnd(e.clientY));

  document.getElementById('mini-playpause').addEventListener('click', () => Player.toggle());
  document.getElementById('mini-next').addEventListener('click', () => Player.next());
  document.getElementById('np-playpause').addEventListener('click', () => Player.toggle());
  document.getElementById('np-prev').addEventListener('click', () => Player.prev());
  document.getElementById('np-next').addEventListener('click', () => Player.next());
  document.getElementById('np-shuffle').addEventListener('click', () => Player.toggleShuffle());
  document.getElementById('np-repeat').addEventListener('click', () => Player.toggleRepeat());

  const npQueue = document.getElementById('np-queue');
  const npQueueBtn = document.getElementById('np-queue-btn');
  function setQueueOpen(open) {
    npQueue.hidden = !open;
    npQueueBtn.classList.toggle('on', open);
    if (open) renderQueue();
  }
  npQueueBtn.addEventListener('click', () => setQueueOpen(npQueue.hidden));

  // The queue had no way back once opened. It now closes by dragging it down,
  // and by tapping the artwork above it.
  let qFrom = null, qScrollTop = 0;
  npQueue.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    qFrom = e.touches[0].clientY;
    qScrollTop = npQueue.scrollTop;
  }, { passive: true });
  npQueue.addEventListener('touchmove', (e) => {
    if (qFrom === null) return;
    const dy = e.touches[0].clientY - qFrom;
    // Only treat it as a dismiss once the list is scrolled to the top,
    // otherwise the drag belongs to the list's own scrolling.
    if (qScrollTop > 0 || dy <= 0) return;
    e.preventDefault();
    npQueue.style.transform = `translateY(${dy}px)`;
  }, { passive: false });
  function endQueueDrag(e) {
    if (qFrom === null) return;
    const dy = (e.changedTouches ? e.changedTouches[0].clientY : qFrom) - qFrom;
    qFrom = null;
    npQueue.style.transition = 'transform 0.3s cubic-bezier(0.32,0.72,0,1)';
    npQueue.style.transform = '';
    setTimeout(() => { npQueue.style.transition = ''; }, 320);
    if (qScrollTop === 0 && dy > 90) setQueueOpen(false);
  }
  npQueue.addEventListener('touchend', endQueueDrag);
  npQueue.addEventListener('touchcancel', endQueueDrag);
  npSheet.addEventListener('click', (e) => {
    if (npQueue.hidden) return;
    if (!e.target.closest('#np-queue, #np-queue-btn')) setQueueOpen(false);
  });

  // The player's own "..." had no handler at all.
  const npMore = document.getElementById('np-more');
  if (npMore) {
    npMore.addEventListener('click', (e) => {
      e.stopPropagation();
      const song = Player.current;
      if (song && window.NipoOpenSongSheet) window.NipoOpenSongSheet(song);
    });
  }

  // Favourite the playing track (Subsonic star/unstar).
  document.getElementById('np-star').addEventListener('click', async (e) => {
    const song = Player.current;
    if (!song) return;
    const nowStarred = !song.starred;
    e.currentTarget.classList.toggle('on', nowStarred);
    song.starred = nowStarred ? new Date().toISOString() : undefined;
    try {
      await Api.call(nowStarred ? 'star' : 'unstar', { id: song.id });
    } catch {
      song.starred = nowStarred ? undefined : song.starred;
      e.currentTarget.classList.toggle('on', !nowStarred);
    }
  });

  // The sheet sets touch-action:none on its whole subtree so the swipe-to-
  // dismiss gesture is not stolen by the browser. That also disables the
  // native drag on a range input, so both sliders are driven by hand here:
  // the value is computed straight from where the finger is along the track.
  function bindSlider(input, wrap, onChange) {
    let active = false;

    function valueAt(clientX) {
      const r = input.getBoundingClientRect();
      if (!r.width) return Number(input.value);
      const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      const min = Number(input.min || 0);
      const max = Number(input.max || 100);
      return min + ratio * (max - min);
    }
    function apply(clientX) {
      input.value = String(Math.round(valueAt(clientX)));
      paintSlider(input);
      onChange(Number(input.value));
    }
    function begin(clientX) {
      active = true;
      wrap.classList.add('scrubbing');
      input.dataset.dragging = '1';
      apply(clientX);
    }
    function end() {
      if (!active) return;
      active = false;
      wrap.classList.remove('scrubbing');
      delete input.dataset.dragging;
    }

    input.addEventListener('touchstart', (e) => {
      begin(e.touches[0].clientX);
    }, { passive: true });
    input.addEventListener('touchmove', (e) => {
      if (!active) return;
      e.preventDefault();
      apply(e.touches[0].clientX);
    }, { passive: false });
    input.addEventListener('touchend', end);
    input.addEventListener('touchcancel', end);

    // Desktop.
    input.addEventListener('mousedown', (e) => { e.preventDefault(); begin(e.clientX); });
    window.addEventListener('mousemove', (e) => { if (active) apply(e.clientX); });
    window.addEventListener('mouseup', end);
    // Keyboard / assistive tech still drive the native input.
    input.addEventListener('input', () => {
      paintSlider(input);
      onChange(Number(input.value));
    });
  }

  const seekEl = document.getElementById('np-seek');
  const seekWrap = document.getElementById('np-progress');
  bindSlider(seekEl, seekWrap, (v) => {
    if (audio.duration) audio.currentTime = (v / 1000) * audio.duration;
  });

  const volEl = document.getElementById('np-vol');
  const volWrap = document.getElementById('np-vol-wrap');
  bindSlider(volEl, volWrap, (v) => { audio.volume = v / 100; });
  paintSlider(volEl);

  // ---------- Login ----------
  function showApp() {
    document.getElementById('login-screen').hidden = true;
    document.getElementById('app').hidden = false;
    syncToggleButtons();
    Views.showHome();
  }
  function showLogin(err) {
    document.getElementById('login-screen').hidden = false;
    document.getElementById('app').hidden = true;
    const errEl = document.getElementById('login-error');
    if (err) { errEl.textContent = err; errEl.hidden = false; } else { errEl.hidden = true; }
  }

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const server = document.getElementById('login-server').value.trim() || window.location.origin;
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn');
    btn.disabled = true; btn.textContent = 'Signing in…';
    Api.setCreds(server, username, password);
    try {
      await Api.call('ping');
      Api.save();
      showApp();
    } catch (err) {
      showLogin(err.message || 'Sign in failed');
    } finally {
      btn.disabled = false; btn.textContent = 'Sign In';
    }
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    audio.pause();
    Api.clear();
    showLogin();
  });

  // ---------- Boot ----------
  document.getElementById('login-server').value = window.location.origin;
  if (Api.load()) {
    Api.call('ping').then(showApp).catch(() => showLogin());
  } else {
    showLogin();
  }
})();
