(() => {
  'use strict';

  const DB = 'nipo-local';
  const STORE = 'tracks';
  const urls = new Map();
  const coverUrls = new Map();
  const state = { tracks: [], queue: [], order: [], pos: -1, shuffle: false, repeat: false, view: 'home', lib: 'songs' };
  const audio = document.getElementById('audio');

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = (n) => '<svg class="ic"><use href="#i-' + n + '"></use></svg>';
  const setIcon = (btn, n) => { const u = btn && btn.querySelector('use'); if (u) u.setAttribute('href', '#i-' + n); };
  const node = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const fmt = (s) => { s = Number.isFinite(s) && s > 0 ? s : 0; return Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0'); };

  function openDb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async function allTracks() {
    const db = await openDb();
    const rows = await new Promise((resolve, reject) => {
      const r = db.transaction(STORE).objectStore(STORE).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return rows;
  }

  async function putTrack(t) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(t);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  async function removeTrack(id) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  function synchsafe(b, o) {
    return ((b[o]&127)<<21)|((b[o+1]&127)<<14)|((b[o+2]&127)<<7)|(b[o+3]&127);
  }
  function be32(b,o) { return ((b[o]<<24)>>>0)+(b[o+1]<<16)+(b[o+2]<<8)+b[o+3]; }
  function textFrame(body) {
    if (!body || body.length < 2) return '';
    const enc = body[0], data = body.slice(1);
    try {
      if (enc === 3) return new TextDecoder('utf-8').decode(data).replace(/\0+$/,'').trim();
      if (enc === 1) return new TextDecoder('utf-16').decode(data).replace(/\0+$/,'').trim();
      if (enc === 2) {
        const sw = new Uint8Array(data.length);
        for (let i=0;i+1<data.length;i+=2){ sw[i]=data[i+1]; sw[i+1]=data[i]; }
        return new TextDecoder('utf-16le').decode(sw).replace(/\0+$/,'').trim();
      }
      return new TextDecoder('iso-8859-1').decode(data).replace(/\0+$/,'').trim();
    } catch { return ''; }
  }

  async function parseId3(file) {
    const out = { title: file.name.replace(/\.[^.]+$/, ''), artist: 'Unknown Artist', album: 'Unknown Album', track: 0, cover: null };
    const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 2*1024*1024)).arrayBuffer());
    if (bytes.length < 10 || String.fromCharCode(bytes[0],bytes[1],bytes[2]) !== 'ID3') return out;
    const ver = bytes[3], end = Math.min(bytes.length, 10 + synchsafe(bytes,6));
    let p = 10;
    while (p + 10 <= end) {
      const id = String.fromCharCode(bytes[p],bytes[p+1],bytes[p+2],bytes[p+3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const size = ver === 4 ? synchsafe(bytes,p+4) : be32(bytes,p+4);
      if (!size || p + 10 + size > end) break;
      const body = bytes.slice(p+10,p+10+size);
      if (id === 'TIT2') out.title = textFrame(body) || out.title;
      if (id === 'TPE1') out.artist = textFrame(body) || out.artist;
      if (id === 'TALB') out.album = textFrame(body) || out.album;
      if (id === 'TRCK') out.track = parseInt(textFrame(body),10) || 0;
      if (id === 'APIC' && body.length > 8) {
        const enc = body[0]; let i = 1;
        while (i<body.length && body[i]!==0) i++;
        const mime = new TextDecoder('iso-8859-1').decode(body.slice(1,i)) || 'image/jpeg';
        i += 2;
        if (enc === 1 || enc === 2) {
          while (i+1<body.length && !(body[i]===0 && body[i+1]===0)) i+=2;
          i += 2;
        } else {
          while (i<body.length && body[i]!==0) i++;
          i++;
        }
        if (i < body.length) out.cover = new Blob([body.slice(i)], { type: mime });
      }
      p += 10 + size;
    }
    return out;
  }

  async function fingerprint(file) {
    const part = await file.slice(0, Math.min(file.size, 128*1024)).arrayBuffer();
    if (crypto.subtle) {
      const h = new Uint8Array(await crypto.subtle.digest('SHA-256', part));
      return Array.from(h.slice(0,12), x => x.toString(16).padStart(2,'0')).join('') + '-' + file.size;
    }
    return file.name + '-' + file.size + '-' + file.lastModified;
  }

  function trackUrl(t) {
    if (!urls.has(t.id)) urls.set(t.id, URL.createObjectURL(t.blob));
    return urls.get(t.id);
  }
  function coverUrl(t) {
    if (!t || !t.cover) return 'icons/icon-512.png';
    if (!coverUrls.has(t.id)) coverUrls.set(t.id, URL.createObjectURL(t.cover));
    return coverUrls.get(t.id);
  }

  function toast(msg) {
    let t = $('local-toast');
    if (!t) { t = node('div','local-toast'); t.id='local-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._timer); t._timer = setTimeout(()=>t.classList.remove('show'),1800);
  }

  async function importFiles(fileList) {
    const files = Array.from(fileList || []).filter(f => /^audio\//.test(f.type || '') || /\.(mp3|m4a|aac|wav|flac)$/i.test(f.name || ''));
    if (!files.length) return toast('Choose audio files');
    let added = 0;
    for (const file of files) {
      try {
        const id = await fingerprint(file);
        if (state.tracks.some(t => t.id === id)) continue;
        const m = await parseId3(file);
        await putTrack({ id, title:m.title, artist:m.artist, album:m.album, track:m.track, cover:m.cover, blob:file, fileName:file.name, mime:file.type||'audio/mpeg', size:file.size, addedAt:Date.now()+added, starred:false });
        added++;
      } catch (e) { console.warn('import failed', file.name, e); }
    }
    await reload();
    toast(added ? 'Imported ' + added + ' track' + (added===1?'':'s') : 'No new tracks');
  }

  function chooseFiles() { $('local-file-picker').click(); }

  const Player = {
    get current(){ const i = state.order[state.pos]; return state.queue[i] || null; },
    playQueue(list,start=0,opts={}) {
      state.queue = list.slice(); state.shuffle = !!opts.shuffle;
      const n = state.queue.length;
      if (state.shuffle) {
        const rest = Array.from({length:n},(_,i)=>i).filter(i=>i!==start);
        for (let i=rest.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [rest[i],rest[j]]=[rest[j],rest[i]]; }
        state.order=[start,...rest]; state.pos=0;
      } else { state.order=Array.from({length:n},(_,i)=>i); state.pos=start; }
      this.playCurrent(); syncToggles();
    },
    playCurrent() {
      const t=this.current; if(!t)return;
      audio.src=trackUrl(t); audio.play().catch(()=>{});
      this.updateUI(); this.media(); renderQueue();
    },
    toggle(){ if(!this.current){ if(state.tracks.length)this.playQueue(state.tracks,0); return; } audio.paused?audio.play().catch(()=>{}):audio.pause(); },
    next(){ if(state.pos<state.order.length-1){state.pos++;this.playCurrent();} else if(state.repeat&&state.order.length){state.pos=0;this.playCurrent();} },
    prev(){ if(audio.currentTime>3){audio.currentTime=0;return;} if(state.pos>0){state.pos--;this.playCurrent();} },
    shuffle(){ const cur=this.current; state.shuffle=!state.shuffle; if(cur){ const i=state.queue.findIndex(x=>x.id===cur.id); this.playQueue(state.queue,i,{shuffle:state.shuffle}); } syncToggles(); },
    repeat(){ state.repeat=!state.repeat; syncToggles(); },
    updateUI(){
      const t=this.current; if(!t)return;
      $('mini-player').hidden=false; $('mini-cover').src=coverUrl(t); $('mini-title').textContent=t.title; $('mini-artist').textContent=t.artist;
      $('np-cover').src=coverUrl(t); $('np-title').textContent=t.title; $('np-artist').textContent=t.artist; $('np-star').classList.toggle('on',!!t.starred); $('np-keep').hidden=true;
      document.querySelectorAll('.list-row[data-song-id]').forEach(r=>r.classList.toggle('playing',r.dataset.songId===t.id));
      this.playIcons();
    },
    playIcons(){ const on=!audio.paused&&!audio.ended; setIcon($('mini-playpause'),on?'pause':'play'); setIcon($('np-playpause'),on?'pause':'play'); $('now-playing').classList.toggle('paused',!on); },
    media(){
      if(!('mediaSession' in navigator)||!this.current)return;
      const t=this.current;
      try{
        navigator.mediaSession.metadata=new MediaMetadata({title:t.title,artist:t.artist,album:t.album,artwork:[{src:coverUrl(t)}]});
        navigator.mediaSession.setActionHandler('play',()=>this.toggle());
        navigator.mediaSession.setActionHandler('pause',()=>this.toggle());
        navigator.mediaSession.setActionHandler('previoustrack',()=>this.prev());
        navigator.mediaSession.setActionHandler('nexttrack',()=>this.next());
        navigator.mediaSession.setActionHandler('seekto',d=>{if(d.seekTime!=null)audio.currentTime=d.seekTime;});
      }catch{}
    }
  };
  window.NipoPlayer=Player;

  function row(t,list){
    const r=node('div','list-row'); r.dataset.songId=t.id;
    r.innerHTML='<img class="card-cover" src="'+esc(coverUrl(t))+'" alt=""><div class="row-main"><div class="row-title">'+esc(t.title)+'</div><div class="row-sub">'+esc(t.artist)+'</div></div><button class="row-more" aria-label="More">'+icon('ellipsis')+'</button>';
    r.onclick=e=>{ if(e.target.closest('.row-more')) return openSheet(t); const i=Math.max(0,list.findIndex(x=>x.id===t.id)); Player.playQueue(list,i); };
    return r;
  }

  function actionRow(list){
    const a=node('div','action-row','<button class="action-btn" data-a="play">'+icon('play')+' Play</button><button class="action-btn" data-a="shuffle">'+icon('shuffle')+' Shuffle</button>');
    a.querySelector('[data-a=play]').onclick=()=>list.length&&Player.playQueue(list,0);
    a.querySelector('[data-a=shuffle]').onclick=()=>list.length&&Player.playQueue(list,Math.floor(Math.random()*list.length),{shuffle:true});
    return a;
  }

  function grouped(key){
    const m=new Map();
    state.tracks.forEach(t=>{const k=t[key]||('Unknown '+key); if(!m.has(k))m.set(k,[]); m.get(k).push(t);});
    return m;
  }

  function empty(c,msg){
    c.innerHTML=''; const e=node('div','empty-state','<div>'+esc(msg)+'</div>');
    const b=node('button','action-btn local-import-btn',icon('plus')+' Import Music'); b.onclick=chooseFiles; e.appendChild(b); c.appendChild(e);
  }

  function renderHome(){
    const a=$('home-recent'),b=$('home-random'),c=$('home-frequent');
    if(!state.tracks.length){empty(a,'Your music stays on this device. Import MP3 files to begin.');b.innerHTML='';c.innerHTML='';return;}
    a.innerHTML='<div class="section-title">Recently Added</div>'; const g=node('div','grid');
    Array.from(grouped('album')).slice(0,12).forEach(([name,list])=>{const card=node('div','card','<img class="card-cover" src="'+esc(coverUrl(list[0]))+'" alt=""><div class="card-title">'+esc(name)+'</div><div class="card-sub">'+esc(list[0].artist)+'</div>');card.onclick=()=>showCollection(name,list,'album');g.appendChild(card);}); a.appendChild(g);
    b.innerHTML='<div class="section-title">Songs</div>'; const l=node('div','song-list'); state.tracks.slice(0,14).forEach(t=>l.appendChild(row(t,state.tracks))); b.appendChild(l); c.innerHTML='';
  }

  function renderLibrary(tab=state.lib){
    state.lib=tab; const c=$('library-content'); c.innerHTML='';
    if(!state.tracks.length)return empty(c,'No local music yet.');
    if(tab==='songs'){ c.appendChild(actionRow(state.tracks)); const l=node('div','song-list'); state.tracks.forEach(t=>l.appendChild(row(t,state.tracks))); c.appendChild(l); }
    if(tab==='albums'){ const g=node('div','grid'); grouped('album').forEach((list,name)=>{const card=node('div','card','<img class="card-cover" src="'+esc(coverUrl(list[0]))+'" alt=""><div class="card-title">'+esc(name)+'</div><div class="card-sub">'+esc(list[0].artist)+'</div>');card.onclick=()=>showCollection(name,list,'album');g.appendChild(card);});c.appendChild(g); }
    if(tab==='artists'){ grouped('artist').forEach((list,name)=>{const r=node('div','list-row','<img class="card-cover" style="border-radius:50%" src="'+esc(coverUrl(list[0]))+'" alt=""><div class="row-main"><div class="row-title">'+esc(name)+'</div><div class="row-sub">'+list.length+' songs</div></div><button class="row-more">'+icon('chevron-right')+'</button>');r.onclick=()=>showCollection(name,list,'artist');c.appendChild(r);}); }
  }

  function renderSearch(){
    const q=($('search-input').value||'').trim().toLowerCase(), c=$('search-results'); c.innerHTML='';
    if(!q){c.appendChild(node('div','empty-state','Search your offline library.'));return;}
    const list=state.tracks.filter(t=>[t.title,t.artist,t.album,t.fileName].some(v=>String(v||'').toLowerCase().includes(q)));
    if(!list.length){c.appendChild(node('div','empty-state','No matches.'));return;}
    const l=node('div','song-list');list.forEach(t=>l.appendChild(row(t,list)));c.appendChild(l);
  }

  function renderRadio(){
    const c=$('radio-content'); c.innerHTML='';
    if(!state.tracks.length)return empty(c,'Import music before starting a mix.');
    const mix=state.tracks.slice().sort(()=>Math.random()-.5); c.appendChild(node('div','section-title','Offline Mix')); c.appendChild(actionRow(mix)); const l=node('div','song-list');mix.forEach(t=>l.appendChild(row(t,mix)));c.appendChild(l);
  }

  function showCollection(name,list,kind){
    showView(kind==='artist'?'artist':'album');
    const c=$(kind==='artist'?'artist-detail':'album-detail'); c.innerHTML='';
    const ordered=list.slice().sort((a,b)=>(a.track||0)-(b.track||0)||a.title.localeCompare(b.title));
    c.appendChild(node('div','detail-header','<img class="detail-cover" src="'+esc(coverUrl(ordered[0]))+'" alt=""><div class="detail-title">'+esc(name)+'</div><div class="detail-sub">'+esc(kind==='artist'?ordered.length+' songs':ordered[0].artist)+'</div>'));
    c.appendChild(actionRow(ordered));const l=node('div','song-list');ordered.forEach(t=>l.appendChild(row(t,ordered)));c.appendChild(l);
  }

  function showView(name){
    state.view=name; document.querySelectorAll('.view').forEach(v=>v.hidden=true); const v=$('view-'+name); if(v)v.hidden=false;
    document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
    $('topbar-title').textContent=({home:'Home',library:'Library',search:'Search',radio:'Radio',album:'Album',artist:'Artist'}[name]||'Music');
    if(name==='home')renderHome(); if(name==='library')renderLibrary(); if(name==='search')renderSearch(); if(name==='radio')renderRadio();
  }

  function renderQueue(){
    const c=$('np-queue-list'); c.innerHTML='';
    for(let p=state.pos+1;p<state.order.length;p++){const t=state.queue[state.order[p]];const r=row(t,state.queue);const jump=p;r.onclick=()=>{state.pos=jump;Player.playCurrent();};c.appendChild(r);}
    if(!c.children.length)c.appendChild(node('div','empty-state','Nothing else queued'));
  }
  function syncToggles(){ $('np-shuffle').classList.toggle('on',state.shuffle); $('np-repeat').classList.toggle('on',state.repeat); }

  function closeSheet(){ $('sheet-overlay').classList.remove('open'); $('action-sheet').classList.remove('open'); setTimeout(()=>{$('sheet-overlay').hidden=true;$('action-sheet').hidden=true;},250); }
  function openSheet(t){
    const body=$('action-sheet-body'); body.innerHTML='';
    const add=(label,ic,fn,danger=false)=>{const b=node('button','sheet-item'+(danger?' danger':''),icon(ic)+' '+esc(label));b.onclick=async()=>{closeSheet();await fn();};body.appendChild(b);};
    add(t.starred?'Remove Favorite':'Favorite','star',async()=>{t.starred=!t.starred;await putTrack(t);Player.updateUI();showView(state.view);});
    add('Play Next','queue',()=>{state.queue.push(t);state.order.splice(state.pos+1,0,state.queue.length-1);renderQueue();});
    add('Delete from Device','downloaded',async()=>{if(Player.current&&Player.current.id===t.id){audio.pause();audio.removeAttribute('src');audio.load();}$('mini-player').hidden=true;if(urls.has(t.id)){URL.revokeObjectURL(urls.get(t.id));urls.delete(t.id);}if(coverUrls.has(t.id)){URL.revokeObjectURL(coverUrls.get(t.id));coverUrls.delete(t.id);}await removeTrack(t.id);await reload();},true);
    $('sheet-overlay').hidden=false;$('action-sheet').hidden=false;requestAnimationFrame(()=>{$('sheet-overlay').classList.add('open');$('action-sheet').classList.add('open');});
  }

  async function reload(){ state.tracks=(await allTracks()).sort((a,b)=>(b.addedAt||0)-(a.addedAt||0)); if(state.view==='home')renderHome(); else if(state.view==='library')renderLibrary(); else if(state.view==='search')renderSearch(); else if(state.view==='radio')renderRadio(); }

  function wire(){
    $('login-screen').hidden=true; $('app').hidden=false;
    const importBtn=$('create-playlist-btn'); importBtn.setAttribute('aria-label','Import music'); importBtn.onclick=chooseFiles; setIcon(importBtn,'plus');
    $('logout-btn').hidden=true;

    const picker=document.createElement('input'); picker.type='file'; picker.id='local-file-picker'; picker.accept='audio/*,.mp3,.m4a,.aac,.wav,.flac'; picker.multiple=true; picker.hidden=true; picker.onchange=async()=>{await importFiles(picker.files);picker.value='';};document.body.appendChild(picker);

    const tabs=$('library-tabs'); tabs.innerHTML='<button class="seg-btn active" data-lib="songs">Songs</button><button class="seg-btn" data-lib="albums">Albums</button><button class="seg-btn" data-lib="artists">Artists</button>';
    tabs.onclick=e=>{const b=e.target.closest('[data-lib]');if(!b)return;tabs.querySelectorAll('.seg-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderLibrary(b.dataset.lib);};

    document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>showView(b.dataset.view));
    document.querySelectorAll('[data-back]').forEach(b=>b.onclick=()=>showView('library'));
    $('search-input').oninput=renderSearch;
    $('mini-playpause').onclick=()=>Player.toggle(); $('mini-next').onclick=()=>Player.next(); $('mini-player').onclick=e=>{if(!e.target.closest('button'))$('now-playing').classList.add('open');};
    $('np-collapse').onclick=()=>$('now-playing').classList.remove('open'); $('np-playpause').onclick=()=>Player.toggle(); $('np-next').onclick=()=>Player.next(); $('np-prev').onclick=()=>Player.prev();
    $('np-shuffle').onclick=()=>Player.shuffle(); $('np-repeat').onclick=()=>Player.repeat(); $('np-queue-btn').onclick=()=>{const q=$('np-queue');q.hidden=!q.hidden;if(!q.hidden)renderQueue();};
    $('np-star').onclick=async()=>{const t=Player.current;if(!t)return;t.starred=!t.starred;await putTrack(t);Player.updateUI();};
    $('np-seek').oninput=()=>{if(audio.duration)audio.currentTime=(+$('np-seek').value/1000)*audio.duration;};
    $('np-vol').oninput=()=>audio.volume=+$('np-vol').value/100; $('sheet-overlay').onclick=closeSheet;
  }

  audio.onplay=()=>Player.playIcons(); audio.onpause=()=>Player.playIcons(); audio.onended=()=>Player.next();
  audio.ontimeupdate=()=>{const d=audio.duration;$('np-time-cur').textContent=fmt(audio.currentTime);$('np-time-rem').textContent=d?'-'+fmt(d-audio.currentTime):'-0:00';if(d)$('np-seek').value=String(Math.round((audio.currentTime/d)*1000));};

  async function boot(){ wire(); await reload(); showView('home'); }
  window.NipoLocal={importFiles,chooseFiles,reload,state};
  boot().catch(e=>{console.error(e);toast('Could not open local library');});
})();