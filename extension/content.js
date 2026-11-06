// Smooth Pinterest: when you click a pin, remember the pins that were
// on the page you clicked it from (feed, search, board, related pins), in
// the order Pinterest lists them. On the pin page, A/W/Left goes to the
// previous one and D/S/Right to the next one, replacing the history entry
// instead of adding one per pin.
(() => {
  const PREV_KEYS = new Set(['ArrowLeft', 'a', 'A', 'w', 'W']);
  const NEXT_KEYS = new Set(['ArrowRight', 'd', 'D', 's', 'S']);
  const STORE = 'pwasd';
  const PIN_RE = /\/pin\/(\d+)/;

  const pinId = () => (location.pathname.match(PIN_RE) || [])[1] || null;
  const idOf = (a) => ((a.getAttribute('href') || '').match(PIN_RE) || [])[1] || null;

  const events = [];
  const note = (t) => { events.push(new Date().toISOString().slice(11, 19) + ' ' + t); if (events.length > 40) events.shift(); };
  const netlog = [];
  // Pinterest's own like / save / board-list calls are remembered so the viewer
  // can send the same requests for any pin.
  let learn = {};
  try { learn = JSON.parse(localStorage.getItem('pwasd-learn')) || {}; } catch (_) {}
  document.addEventListener('pwasd-net', (e) => {
    try {
      const o = JSON.parse(e.detail);
      if (o.m !== 'GET' || /Board|Like|React|Repin|Save/.test(o.p)) { netlog.push({ m: o.m, p: o.p, s: o.s, d: (o.d || '').slice(0, 500) }); if (netlog.length > 40) netlog.shift(); }
      if (o.s < 200 || o.s >= 300 || !o.r) return;
      const kind = o.m === 'POST' && /\/\w*(Like|Reaction|React)\w*\/create\//.test(o.p) ? 'like'
        : o.m === 'POST' && /\/RepinResource\/create\//.test(o.p) ? 'repin'
        : o.m === 'POST' && /ApiResource\/create\//.test(o.p) && /v3(%2F|\/)pins(%2F|\/)\d+(%2F|\/)(repin|save)/i.test(o.r) ? 'repin'
        : o.m === 'GET' && /\/BoardPickerBoardsResource\/get\//.test(o.p) ? 'picker'
        : o.m === 'GET' && /\/Related\w*\/get\//.test(o.p) && pinId() && o.r.indexOf(pinId()) >= 0 && !/"bookmarks":\["/.test(decodeURIComponent(o.r)) ? 'related' : null;
      if (!kind) return;
      let pin = pinId();
      try { const op = JSON.parse(new URLSearchParams(o.r).get('data')).options; pin = String(op.pin_id || op.pinId || ((op.url || '').match(/pins\/(\d+)/) || [])[1] || pin); } catch (_) {}
      learn[kind] = { p: o.p, r: o.r, pin };
      try { localStorage.setItem('pwasd-learn', JSON.stringify(learn)); } catch (_) {}
      note('learned ' + kind + ' ' + o.p);
    } catch (_) {}
  });
  let ids = [];
  try { ids = JSON.parse(sessionStorage.getItem(STORE)) || []; } catch (_) {}

  // Pin ids of every pin link on the page in document order, which is
  // Pinterest's own list order (positions on screen are masonry columns).
  function snapshot() {
    const out = [];
    for (const a of document.querySelectorAll('a[href*="/pin/"]')) {
      const id = idOf(a);
      if (!id || out.includes(id)) continue;
      const r = a.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push(id);
    }
    return out;
  }

  // Capture phase, before Pinterest's own handler navigates away.
  document.addEventListener('click', (e) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href*="/pin/"]');
    if (!a || !idOf(a)) return;
    ids = snapshot();
    note('click pin ' + idOf(a) + ' list=' + ids.length + ' at=' + ids.indexOf(idOf(a)) + ' url=' + location.pathname);
    try { sessionStorage.setItem(STORE, JSON.stringify(ids)); } catch (_) {}
  }, true);

  function isTyping(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function go(step) {
    const i = ids.indexOf(pinId());
    const target = i < 0 ? null : ids[i + step];
    note('key step=' + step + ' cur=' + pinId() + ' idx=' + i + '/' + ids.length + ' target=' + target);
    if (!target) return false;
    const link = document.querySelector('a[href*="/pin/' + target + '"]');
    if (link) {
      // Pinterest's own router, but with pushState turned into replaceState
      // (see page.js) so Back still returns to the page you came from.
      note('spa click');
      document.dispatchEvent(new CustomEvent('pwasd-arm'));
      link.click();
    } else {
      note('no link on page, full load');
      location.replace('/pin/' + target + '/');
    }
    return true;
  }


  // ---------------------------------------------------------------- viewer
  // Fast viewer (popup switch, on by default): clicking a pin opens the
  // picture full screen right away from the thumbnail already on the page.
  // Pictures sit side by side on a track, so A/D/arrows (or a drag) slide
  // between them like swiping on a phone. Scrolling down shows the rest of
  // the list as a grid; clicking one brings it to the front. The feed behind
  // is scrolled quietly to keep more pins coming. Like and Save use Pinterest's
  // own web API with the signed-in session.
  let viewerOn = true;
  let ov = null, vItems = [], vIndex = 0, vSlides = new Map(), vSavedScroll = 0, vLastGrow = 0;
  const big = (src, size) => src.replace(/\/(?:\d+x(?:\d+)?|originals)\//, '/' + size + '/');
  const EASE = 'transform .34s cubic-bezier(.22,.8,.26,1)';
  const ITEMS = 'pwasd-items';
  let gItems = null, relMode = false, lastIdx = -1, relTimer = 0;
  let Z = { z: 1, x: 0, y: 0 };
  const relCache = new Map(), vidCache = new Map();

  function itemsFromPage() {
    const out = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href*="/pin/"]')) {
      const id = idOf(a);
      if (!id || seen.has(id)) continue;
      const img = a.querySelector('img');
      const r = a.getBoundingClientRect();
      if (!img || !(img.currentSrc || img.src) || r.width <= 0 || r.height <= 0) continue;
      seen.add(id);
      out.push({ id, src: img.currentSrc || img.src, alt: img.alt || '', w: img.naturalWidth, h: img.naturalHeight, video: !!a.querySelector('video') || /(^|\s)\d{1,2}:\d{2}(\s|$)/.test(a.textContent || '') });
    }
    return out;
  }

  function saveItems() {
    try { sessionStorage.setItem(ITEMS, JSON.stringify(vItems.slice(0, 400).map((x) => [x.id, x.src, x.alt.slice(0, 80), x.w, x.h, x.video ? 1 : 0]))); } catch (_) {}
  }

  function growList() {
    const have = new Set(vItems.map((x) => x.id));
    let added = false;
    for (const it of itemsFromPage()) if (!have.has(it.id)) { vItems.push(it); added = true; }
    if (added && ov) { syncGrid(); saveItems(); }
  }

  // Near the end of the list, scroll the feed behind the viewer to its
  // bottom so Pinterest fetches the next batch while you keep flipping.
  function wantMore() {
    const now = Date.now();
    if (now - vLastGrow < 700) return;
    vLastGrow = now;
    const before = vItems.length;
    growList();
    if (vItems.length === before) {
      const el = document.scrollingElement || document.documentElement;
      el.scrollTo(0, el.scrollHeight);
      setTimeout(() => { if (ov) growList(); }, 900);
    }
  }

  // Masonry that never reshuffles: columns are fixed when the viewer opens,
  // every tile reserves its height from the thumbnail's shape, and new tiles
  // are only ever appended to the currently shortest column.
  let gridCols = [], gridH = [], gridN = 0;
  function buildGrid() {
    const grid = ov.querySelector('.grid');
    grid.textContent = '';
    const n = Math.max(2, Math.floor((grid.clientWidth || window.innerWidth) / 220));
    gridCols = []; gridH = []; gridN = 0;
    for (let c = 0; c < n; c++) { const d = document.createElement('div'); d.className = 'col'; grid.appendChild(d); gridCols.push(d); gridH.push(0); }
  }
  const gridList = () => gItems || vItems;
  function setGrid(list) { gItems = list; gridCols = []; gridN = 0; if (ov) syncGrid(); }
  function syncGrid() {
    if (!gridCols.length) buildGrid();
    const gl = gridList();
    while (gridN < gl.length) {
      const k = gridN++, it = gl[k], t = document.createElement('img');
      const ratio = it.w && it.h ? it.h / it.w : 1.4;
      t.style.aspectRatio = '1 / ' + ratio;
      if (!(it.w && it.h)) t.onload = () => { t.style.aspectRatio = ''; };
      t.src = it.src; t.alt = it.alt; t.dataset.k = k; t.draggable = false; t.loading = 'lazy';
      let c = 0;
      for (let i = 1; i < gridH.length; i++) if (gridH[i] < gridH[c]) c = i;
      gridH[c] += ratio + 0.05;
      gridCols[c].appendChild(t);
    }
  }

  function makeSlide(k) {
    const it = vItems[k];
    const el = document.createElement('div');
    el.className = 'slide';
    const img = document.createElement('img');
    img.alt = it.alt; img.draggable = false;
    // Fix the displayed size from the thumbnail's shape so swapping in the
    // sharper picture never changes how big it looks.
    const fit = (w, h) => { if (w && h && !img.style.width) { img.style.width = 'min(94vw,' + (78 * w / h) + 'vh)'; img.style.height = 'auto'; } };
    fit(it.w, it.h);
    img.onload = () => { fit(img.naturalWidth, img.naturalHeight); img.onload = null; };
    img.src = it.src;
    const hi = new Image();
    hi.onload = () => { fit(img.naturalWidth, img.naturalHeight); img.src = hi.src; };
    hi.src = big(it.src, '736x');
    el.append(img);
    ov.querySelector('.track').appendChild(el);
    return el;
  }

  // Lays out slides k-2..k+2 relative to the current one. New slides start
  // in place without animating; existing ones slide to their new spot.
  function layout(dragPx) {
    const w = window.innerWidth;
    for (let k = vIndex - 2; k <= vIndex + 2; k++) {
      if (k < 0 || k >= vItems.length || vSlides.has(k)) continue;
      const el = makeSlide(k);
      el.style.transition = 'none';
      el.style.transform = 'translateX(' + ((k - vIndex) * w) + 'px)';
      el.getBoundingClientRect();
      vSlides.set(k, el);
    }
    for (const [k, el] of vSlides) {
      if (Math.abs(k - vIndex) > 2) { el.remove(); vSlides.delete(k); continue; }
      el.style.transition = dragPx === undefined ? EASE : 'none';
      el.style.transform = 'translateX(' + ((k - vIndex) * w + (dragPx || 0)) + 'px)';
    }
    syncGrid();
    const changed = vIndex !== lastIdx;
    if (changed && dragPx === undefined) {
      lastIdx = vIndex; resetZoom();
      if (relMode) scheduleRelated();
    }
    for (const [k, el] of vSlides) if (k !== vIndex) { const v = el.querySelector('video'); if (v) v.pause(); }
    startVideo(vSlides.get(vIndex), vItems[vIndex]);
    ov.querySelector('.count').textContent = (vIndex + 1) + ' / ' + vItems.length;
    for (let k = vIndex + 3; k <= vIndex + 6; k++) {
      const n = vItems[k];
      if (n && !n.warm) { n.warm = true; new Image().src = big(n.src, '736x'); }
    }
    const curEl = vSlides.get(vIndex);
    if (curEl && !curEl.dataset.orig) {
      curEl.dataset.orig = '1';
      const im = curEl.querySelector('img'), o = new Image();
      o.onload = () => { if (im.isConnected) im.src = o.src; };
      o.src = big(vItems[vIndex].src, 'originals');
    }
    if (dragPx === undefined) setLiked(false);
    if (vItems.length - vIndex < 12) wantMore();
  }

  // ----------------------------------------------------------- zoom / video
  function mediaOf(el) { return el && (el.querySelector('video') || el.querySelector('img')); }
  function applyZoom(m) {
    m.style.transition = 'none';
    m.style.transform = Z.z === 1 ? '' : 'translate(' + Z.x + 'px,' + Z.y + 'px) scale(' + Z.z + ')';
  }
  function resetZoom() {
    Z = { z: 1, x: 0, y: 0 };
    for (const el of vSlides.values()) { const m = el.querySelector('img'); if (m) m.style.transform = ''; }
  }
  function onWheel(e) {
    const m = mediaOf(vSlides.get(vIndex));
    if (!m || m.tagName === 'VIDEO' || e.target.closest('.grid, .boards')) return;
    const r = m.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    if (e.deltaY > 0 && Z.z <= 1) return;             // at 1x, scrolling down scrolls to the grid
    e.preventDefault();
    const nz = Math.max(1, Math.min(8, Z.z * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
    if (nz < 1.02) { Z = { z: 1, x: 0, y: 0 }; applyZoom(m); return; }
    const bx = r.left + r.width / 2 - Z.x, by = r.top + r.height / 2 - Z.y, k = nz / Z.z;
    Z.x = e.clientX - bx - (e.clientX - bx - Z.x) * k;
    Z.y = e.clientY - by - (e.clientY - by - Z.y) * k;
    Z.z = nz;
    applyZoom(m);
  }

  async function videoUrl(id) {
    if (vidCache.has(id)) return vidCache.get(id);
    let url = null;
    try {
      const html = (await (await fetch('/pin/' + id + '/', { credentials: 'same-origin' })).text()).split('\\/').join('/').split('\\u002F').join('/');
      const all = [...new Set(html.match(/https?:\/\/v\d*\.pinimg\.com\/videos\/[^"'\\\s<>]+?\.mp4/g) || [])];
      url = all.find((u) => /720p/.test(u)) || all.find((u) => /1080p|480p|360p/.test(u)) || all[0] || null;
    } catch (_) {}
    note('video ' + id + ' ' + (url || 'none found'));
    vidCache.set(id, url);
    return url;
  }

  function startVideo(el, it) {
    if (!el || !it || !it.video || el.dataset.vid) return;
    el.dataset.vid = '1';
    videoUrl(it.id).then((url) => {
      if (!url) { toast("Couldn't find this video's file. Press Enter to open the pin."); return; }
      if (!el.isConnected) return;
      const img = el.querySelector('img'), v = document.createElement('video');
      v.src = url; v.poster = img.src; v.controls = true; v.loop = true; v.playsInline = true; v.draggable = false;
      v.style.width = img.style.width || ''; v.style.height = 'auto';
      let was = false;
      v.addEventListener('pointerdown', () => { was = v.paused; });
      // Clicking the picture itself must not pause; the control bar still works.
      v.addEventListener('click', (e) => {
        const r = v.getBoundingClientRect();
        if (e.clientY > r.bottom - 56) return;
        e.preventDefault();
        setTimeout(() => { if (v.paused !== was) { if (was) v.pause(); else v.play(); } }, 0);
      });
      img.replaceWith(v);
      if (vItems[vIndex] === it) v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
    });
  }

  // ------------------------------------------------ related pins (grid mode)
  function findPins(x, out, seen, depth) {
    if (!x || typeof x !== 'object' || depth > 7) return out;
    if (!Array.isArray(x) && typeof x.id === 'string' && /^\d+$/.test(x.id) && x.images && typeof x.images === 'object') {
      const im = x.images['474x'] || x.images['236x'] || x.images['736x'] || Object.values(x.images)[0];
      if (im && im.url && !seen.has(x.id)) { seen.add(x.id); out.push({ id: x.id, src: im.url, alt: x.grid_title || x.title || '', w: im.width, h: im.height, video: !!x.videos }); }
      return out;
    }
    for (const v of Object.values(x)) findPins(v, out, seen, depth + 1);
    return out;
  }
  async function relatedOf(id) {
    if (relCache.has(id)) return relCache.get(id);
    const d = await replay('related', id);
    const list = findPins(d, [], new Set([id]), 0);
    if (!list.length) throw new Error('no related pins in the answer');
    relCache.set(id, list);
    return list;
  }
  function scheduleRelated() {
    clearTimeout(relTimer);
    const id = vItems[vIndex].id;
    relTimer = setTimeout(() => {
      relatedOf(id).then((l) => { if (ov && relMode && vItems[vIndex].id === id) setGrid(l); })
        .catch((e) => { note('related failed ' + e.message); toast('Related pins not available yet: open any pin page once so I can learn how Pinterest loads them.'); });
    }, 350);
  }
  function setRelMode(on) {
    relMode = on;
    const b = ov && ov.querySelector('.mode');
    if (b) b.textContent = on ? 'Below: related' : 'Below: this list';
    if (!ov) return;
    if (on) scheduleRelated(); else setGrid(null);
  }
  function pickRelated(it) {
    const rest = gridList().filter((x) => x.id !== it.id);
    vItems = [it, ...rest];
    for (const el of vSlides.values()) el.remove();
    vSlides = new Map(); vIndex = 0; lastIdx = -1;
    ov.scrollTo({ top: 0, behavior: 'smooth' });
    layout(); saveItems();
  }

  function goTo(i) {
    i = Math.max(0, Math.min(vItems.length - 1, i));
    if (i === vIndex) return layout();
    vIndex = i;
    layout();
  }

  // ------------------------------------------------- like / save (web API)
  const csrf = () => (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || '';
  async function api(name, options, post) {
    const data = JSON.stringify({ options, context: {} });
    const headers = { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRFToken': csrf(), 'X-Pinterest-AppState': 'active', 'X-Pinterest-Source-Url': location.pathname, 'X-Pinterest-PWS-Handler': 'www/pin/[id].js', Accept: 'application/json, text/javascript, */*, q=0.01' };
    let res;
    if (post) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      res = await fetch('/resource/' + name + '/create/', { method: 'POST', credentials: 'same-origin', headers, body: new URLSearchParams({ source_url: location.pathname, data }) });
    } else {
      res = await fetch('/resource/' + name + '/get/?source_url=' + encodeURIComponent(location.pathname) + '&data=' + encodeURIComponent(data), { credentials: 'same-origin', headers });
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    const rr = json && json.resource_response;
    const ok = res.ok && rr && (!rr.status || rr.status === 'success') && !rr.error;
    note('api ' + name + ' ' + res.status + (ok ? ' ok' : ' FAIL ' + text.slice(0, 160)));
    if (!ok) throw new Error(name + ' ' + res.status + ' ' + ((rr && rr.error && (rr.error.message || rr.error.message_detail)) || text.slice(0, 60)));
    return rr.data;
  }

  function swapPin(x, oldId, newId) {
    for (const k of Object.keys(x)) {
      const v = x[k];
      if (v && typeof v === 'object') swapPin(v, oldId, newId);
      else if (typeof v === 'string' && v.indexOf(oldId) >= 0) x[k] = v.split(oldId).join(newId);
      else if (typeof v === 'number' && String(v) === oldId) x[k] = Number(newId);
    }
  }

  // Sends Pinterest's own recorded request again, for another pin / board.
  async function replay(kind, newPin, boardId) {
    const t = learn[kind];
    if (!t) throw new Error('not learned yet');
    const params = new URLSearchParams(t.r);
    const data = JSON.parse(params.get('data'));
    swapPin(data, t.pin, newPin);
    if (boardId && data.options) { if (data.options.data && typeof data.options.data === 'object') data.options.data.board_id = boardId; else data.options.board_id = boardId; }
    params.set('data', JSON.stringify(data));
    params.set('source_url', '/pin/' + newPin + '/');
    const headers = { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRFToken': csrf(), 'X-Pinterest-AppState': 'active', 'X-Pinterest-Source-Url': '/pin/' + newPin + '/', 'X-Pinterest-PWS-Handler': 'www/pin/[id].js', Accept: 'application/json, text/javascript, */*, q=0.01' };
    let res;
    if (kind === 'picker' || kind === 'related') res = await fetch(t.p + '?' + params.toString(), { credentials: 'same-origin', headers });
    else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      res = await fetch(t.p, { method: 'POST', credentials: 'same-origin', headers, body: params.toString() });
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    const rr = json && json.resource_response;
    const ok = res.ok && rr && (!rr.status || rr.status === 'success') && !rr.error;
    note('replay ' + kind + ' ' + res.status + (ok ? ' ok' : ' FAIL ' + text.slice(0, 160)));
    if (!ok) throw new Error(kind + ' ' + res.status);
    return rr.data;
  }

  const HINT = " Click Pinterest's own heart / Save once on a pin page so I can learn it.";

  // First array of {id, name} objects found anywhere in the response.
  function findBoards(x, depth) {
    if (!x || typeof x !== 'object' || (depth || 0) > 5) return null;
    if (Array.isArray(x)) {
      const b = x.filter((o) => o && typeof o === 'object' && o.id && o.name);
      if (b.length) return b;
    }
    for (const v of Object.values(x)) { const f = findBoards(v, (depth || 0) + 1); if (f) return f; }
    return null;
  }

  let boards = null;
  async function loadBoards() {
    if (boards) return boards;
    let d;
    if (learn.picker) d = await replay('picker', vItems[vIndex].id);
    else { try { d = await api('BoardPickerBoardsResource', { field_set_key: 'board_picker', filter_all_pins: true, allow_stale: true, sort: 'last_pinned_to', pin_id: vItems[vIndex].id }); } catch (e) { throw new Error(e.message + '.' + HINT); } }
    boards = (findBoards(d) || []).map((b) => ({ id: String(b.id), name: b.name }));
    if (!boards.length) throw new Error('no boards found');
    return boards;
  }

  function toast(msg) {
    const t = ov && ov.querySelector('.toast');
    if (!t) return;
    t.textContent = msg; t.style.opacity = 1;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.style.opacity = 0; }, 2600);
  }

  const likedIds = new Set();
  function setLiked(on) {
    const b = ov && ov.querySelector('.like');
    if (!b) return;
    const l = on || likedIds.has(vItems[vIndex].id);
    b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 21s-8-5.2-8-11a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.800-8 11-8 11z"/></svg>';
    b.classList.toggle('on', l);
  }

  async function likePin() {
    const id = vItems[vIndex].id;
    try {
      await api('ApiResource', { url: '/v3/pins/' + id + '/react/', data: { reaction_type: 1 } }, true);
      likedIds.add(id); setLiked(true); toast('Liked');
    } catch (e) { toast('Like refused: ' + e.message); }
  }

  let chosen = null;
  try { chosen = JSON.parse(localStorage.getItem('pwasd-board')); } catch (_) {}
  const showChosen = () => { const b = ov && ov.querySelector('.pick'); if (b) b.textContent = (chosen ? chosen.name : 'Choose board') + ' ▾'; };

  async function saveToChosen() {
    if (!chosen) return openBoards();
    try {
      if (learn.repin) await replay('repin', vItems[vIndex].id, chosen.id);
      else await api('RepinResource', { board_id: chosen.id, pin_id: vItems[vIndex].id, description: '', title: '', link: '', is_buyable_pin: false, is_removable: false }, true);
      toast('Saved to ' + chosen.name);
    } catch (e) { toast('Save refused: ' + e.message); }
  }

  async function openBoards() {
    const panel = ov.querySelector('.boards');
    if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
    panel.textContent = 'Loading boards…';
    panel.style.display = 'block';
    try {
      const list = await loadBoards();
      panel.textContent = '';
      for (const b of list) {
        const row = document.createElement('div');
        row.className = 'board'; row.textContent = b.name;
        row.onclick = () => {
          chosen = b;
          try { localStorage.setItem('pwasd-board', JSON.stringify(b)); } catch (_) {}
          panel.style.display = 'none'; showChosen();
        };
        panel.appendChild(row);
      }
    } catch (e) { panel.textContent = 'Could not load your boards: ' + e.message; }
  }

  // ------------------------------------------------------------ open/close
  function startViewer(items, i) {
    vItems = items;
    const el = document.scrollingElement || document.documentElement;
    vSavedScroll = el.scrollTop;
    ov = document.createElement('div');
    ov.id = 'pwasd-viewer';
    ov.innerHTML = '<style>'
      + '#pwasd-viewer{position:fixed;inset:0;z-index:2147483647;background:rgba(8,8,8,.97);overflow-x:hidden;overflow-y:auto;font:15px system-ui,sans-serif;color:#eee;animation:pwasd-in .18s ease;scrollbar-width:thin}'
      + '@keyframes pwasd-in{from{opacity:0}to{opacity:1}}'
      + '#pwasd-viewer .stage{position:relative;height:100vh;overflow:hidden;touch-action:pan-y;user-select:none}'
      + '#pwasd-viewer .slide{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;will-change:transform}'
      + '#pwasd-viewer .slide img{max-width:94vw;max-height:78vh;object-fit:contain;border-radius:12px;box-shadow:0 8px 40px #000a}'
      + '#pwasd-viewer .cap{margin-top:12px;max-width:80vw;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      + '#pwasd-viewer .count{position:absolute;top:14px;left:50%;transform:translateX(-50%);font-size:13px;opacity:.7}'
      + '#pwasd-viewer .acts{position:absolute;top:10px;right:14px;display:flex;gap:8px;z-index:2}'
      + '#pwasd-viewer .acts{align-items:center;gap:6px}'
      + '#pwasd-viewer .acts button{font:600 16px system-ui,sans-serif;color:#fff;background:#e60023;border:0;border-radius:24px;padding:12px 18px;cursor:pointer}'
      + '#pwasd-viewer .acts button:hover{filter:brightness(1.1)}'
      + '#pwasd-viewer .acts button.like{background:none;padding:8px;display:flex;align-items:center}'
      + '#pwasd-viewer .acts button.like svg{width:26px;height:26px;fill:none;stroke:#fff;stroke-width:2}'
      + '#pwasd-viewer .acts button.like.on svg{fill:#e60023;stroke:#e60023}'
      + '#pwasd-viewer .acts button.mode{background:#333;font-size:13px;padding:8px 12px}'
      + '#pwasd-viewer .slide video{max-width:94vw;max-height:78vh;border-radius:12px;box-shadow:0 8px 40px #000a;background:#000}'
      + '#pwasd-viewer .acts button.pick{background:none;color:#fff;padding:8px 10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '#pwasd-viewer .boards{display:none;position:absolute;top:50px;right:14px;z-index:3;width:260px;max-height:60vh;overflow:auto;background:#1c1c1c;border-radius:12px;padding:6px;box-shadow:0 8px 30px #000c}'
      + '#pwasd-viewer .board{padding:9px 12px;border-radius:8px;cursor:pointer}'
      + '#pwasd-viewer .board:hover{background:#333}'
      + '#pwasd-viewer .toast{position:absolute;top:56px;left:50%;transform:translateX(-50%);background:#222;padding:8px 16px;border-radius:16px;opacity:0;transition:opacity .2s;z-index:3;pointer-events:none;max-width:80vw;text-align:center}'
      + '#pwasd-viewer .hint{position:absolute;bottom:12px;width:100%;text-align:center;font-size:12px;opacity:.55}'
      + '#pwasd-viewer .grid{display:flex;gap:10px;align-items:flex-start;padding:10px 14px 60px}'
      + '#pwasd-viewer .col{flex:1;min-width:0}'
      + '#pwasd-viewer .grid img{width:100%;display:block;margin-bottom:10px;border-radius:12px;cursor:pointer;background:#222;object-fit:cover}'
      + '</style><div class="stage"><div class="track"></div><div class="count"></div>'
      + '<div class="acts"><button class="mode" title="What the grid below shows"></button><button class="like" title="Like (L)"></button><button class="pick"></button><button class="save">Save</button></div>'
      + '<div class="boards"></div><div class="toast"></div>'
      + '<div class="hint">A / D or arrows or drag: previous / next &nbsp;·&nbsp; scroll down: more pins &nbsp;·&nbsp; wheel on picture: zoom &nbsp;·&nbsp; space: pause video &nbsp;·&nbsp; click picture or Enter: open pin &nbsp;·&nbsp; L: like &nbsp;·&nbsp; Esc: close</div></div>'
      + '<div class="grid"></div>';
    const stage = ov.querySelector('.stage');
    ov.addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest('.acts, .boards')) {
        if (t.closest('.mode')) { const on = !relMode; try { chrome.storage.local.set({ related: on }); } catch (_) {} setRelMode(on); }
        else if (t.closest('.like')) likePin();
        else if (t.closest('.pick')) openBoards();
        else if (t.closest('.save')) saveToChosen();
        return;
      }
      ov.querySelector('.boards').style.display = 'none';
      if (t.closest('.grid')) {
        if (t.tagName === 'IMG') {
          if (gItems) pickRelated(gItems[+t.dataset.k]);
          else { vIndex = +t.dataset.k; ov.scrollTo({ top: 0, behavior: 'smooth' }); layout(); }
        }
        return;
      }
      const img = mediaOf(vSlides.get(vIndex));
      const r = img && img.getBoundingClientRect();
      const inside = r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (inside && img.tagName === 'VIDEO') return;
      if (inside) { const id = vItems[vIndex].id; closeViewer(); location.assign('/pin/' + id + '/'); return; }
      closeViewer();
    });
    // Drag to swipe (mouse or touch); a drag over 15% of the width changes picture.
    let startX = null, dx = 0;
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.acts, .boards')) return;
      if (e.target.tagName === 'VIDEO') { const r = e.target.getBoundingClientRect(); if (e.clientY > r.bottom - 56) return; }
      startX = e.clientX; dx = 0;
    });
    stage.addEventListener('pointermove', (e) => {
      if (startX === null) return;
      dx = e.clientX - startX;
      if (Z.z > 1) {                                   // zoomed in: drag pans the picture
        const m = mediaOf(vSlides.get(vIndex));
        if (Math.abs(dx) > 3 && m) { Z.x += e.movementX; Z.y += e.movementY; applyZoom(m); ov.dataset.panned = '1'; }
        return;
      }
      if (Math.abs(dx) > 6) layout(dx);
    });
    const end = () => {
      if (startX === null) return;
      const w = window.innerWidth, moved = dx;
      startX = null; dx = 0;
      if (Z.z > 1) { if (ov.dataset.panned) { ov.dataset.dragged = '1'; ov.dataset.panned = ''; } return; }
      if (Math.abs(moved) > w * 0.15) { ov.dataset.dragged = '1'; goTo(vIndex + (moved < 0 ? 1 : -1)); }
      else layout();
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    ov.addEventListener('click', (e) => { if (ov.dataset.dragged) { ov.dataset.dragged = ''; e.stopPropagation(); } }, true);
    ov.addEventListener('wheel', onWheel, { passive: false });
    // Near the bottom of the grid, ask for more pins.
    ov.addEventListener('scroll', () => { if (!gItems && ov.scrollTop + ov.clientHeight > ov.scrollHeight - 1500) wantMore(); }, { passive: true });
    document.documentElement.appendChild(ov);
    showChosen();
    vIndex = i; vSlides = new Map(); vLastGrow = 0; gridCols = []; gridN = 0; gItems = null; lastIdx = -1; Z = { z: 1, x: 0, y: 0 };
    ov.querySelector('.mode').textContent = relMode ? 'Below: related' : 'Below: this list';
    layout();
    if (relMode) scheduleRelated();
    saveItems();
    return true;
  }

  function openViewer(id) {
    const items = itemsFromPage();
    const i = items.findIndex((x) => x.id === id);
    return i >= 0 && startViewer(items, i);
  }

  // On a pin page: click the big picture to go back into the viewer, with the
  // list you came from (kept in sessionStorage) plus the related pins here.
  function openFromPinPage(img) {
    const id = pinId();
    let items = [];
    try { items = (JSON.parse(sessionStorage.getItem(ITEMS)) || []).map(([i, src, alt, w, h, v]) => ({ id: i, src, alt, w, h, video: !!v })); } catch (_) {}
    let i = items.findIndex((x) => x.id === id);
    if (i < 0) { items = [{ id, src: img.currentSrc || img.src, alt: img.alt || '' }]; i = 0; }
    const have = new Set(items.map((x) => x.id));
    for (const it of itemsFromPage()) if (!have.has(it.id)) items.push(it);
    return startViewer(items, i);
  }

  function closeViewer() {
    if (!ov) return;
    ov.remove(); ov = null; vSlides = new Map();
    const el = document.scrollingElement || document.documentElement;
    el.scrollTo(0, vSavedScroll);
  }

  function viewerKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
    const step = PREV_KEYS.has(e.key) ? -1 : NEXT_KEYS.has(e.key) ? 1 : 0;
    if (step) { ov.scrollTo({ top: 0, behavior: 'smooth' }); goTo(vIndex + step); }
    else if (e.key === 'Escape') closeViewer();
    else if (e.key === 'Enter') { const id = vItems[vIndex].id; closeViewer(); location.assign('/pin/' + id + '/'); }
    else if (e.key === 'l' || e.key === 'L') likePin();
    else if (e.key === ' ') { const v = vSlides.get(vIndex) && vSlides.get(vIndex).querySelector('video'); if (v) { if (v.paused) v.play(); else v.pause(); } }
    else return false;
    return true;
  }

  try {
    chrome.storage.local.get({ viewer: true, related: false }).then((r) => { viewerOn = !!r.viewer; relMode = !!r.related; });
    chrome.storage.onChanged.addListener((c) => {
      if (c.viewer) { viewerOn = !!c.viewer.newValue; if (!viewerOn) closeViewer(); }
      if (c.related && !!c.related.newValue !== relMode) setRelMode(!!c.related.newValue);
    });
  } catch (_) {}

  document.addEventListener('click', (e) => {
    if (!viewerOn || ov || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const t = e.target;
    const a = t.closest && t.closest('a[href*="/pin/"]');
    if (a && a.querySelector('img') && idOf(a)) {
      if (openViewer(idOf(a))) { e.preventDefault(); e.stopImmediatePropagation(); note('viewer open ' + idOf(a)); }
      return;
    }
    // Big picture on a pin page (not a thumbnail link): open the viewer on it.
    if (pinId() && t.tagName === 'IMG') {
      const r = t.getBoundingClientRect();
      const main = t.closest('[data-test-id="pin-closeup-image"], [data-test-id="closeup-body-image-container"]');
      if ((main || r.width > 280) && !t.closest('a[href*="/pin/"]') && openFromPinPage(t)) {
        e.preventDefault(); e.stopImmediatePropagation(); note('viewer from pin page ' + pinId());
      }
    }
  }, true);

  window.addEventListener('keydown', (e) => {
    if (ov) { if (viewerKey(e)) { e.preventDefault(); e.stopImmediatePropagation(); } return; }
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || isTyping(e.target)) return;
    const step = PREV_KEYS.has(e.key) ? -1 : NEXT_KEYS.has(e.key) ? 1 : 0;
    if (!step || !pinId()) return;
    if (go(step)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  // Popup "Copy diagnostics": what the script sees on this page.
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (!msg || msg.type !== 'diag') return;
    const anchors = [...document.querySelectorAll('a[href*="/pin/"]')];
    reply({
      url: location.href,
      pin: pinId(),
      listLength: ids.length,
      listHead: ids.slice(0, 8),
      pinAnchorsOnPage: anchors.length,
      sample: anchors.slice(0, 3).map((a) => {
        const chain = [];
        for (let e = a.parentElement; e && chain.length < 5; e = e.parentElement)
          chain.push(e.tagName.toLowerCase() + (e.getAttribute('data-test-id') ? '[' + e.getAttribute('data-test-id') + ']' : '') + (e.getAttribute('role') ? '{' + e.getAttribute('role') + '}' : ''));
        return { html: a.outerHTML.slice(0, 220), parents: chain.join(' < ') };
      }),
      events,
      netlog,
    });
  });
})();
