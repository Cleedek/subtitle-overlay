// Runs in every page and frame. Finds the video, draws the subtitle layer on
// top of it and keeps it in sync with the video's own clock.
(function () {
  'use strict';
  if (window.__subOverlay) return;

  const { SubLib, SubSettings, SubRender, SubI18n } = globalThis;
  const t = SubI18n.t;
  SubI18n.load();

  let settings = Object.assign({}, SubSettings.DEFAULTS);
  let cues = [];          // loaded subtitle lines, sorted by start (ms)
  let file = null;        // { name, b64, encoding, usedEncoding } of the loaded file
  let stashed = null;     // previous subtitles after a video swap, for "Restore"
  let original = null;    // { file, cues } of the untranslated subtitles while a translation shows
  const translations = new Map(); // language -> translated cues, so switching back is instant
  let prefs = Object.assign({}, SubSettings.TRANSLATION); // language, automatic mode, hide the site's subtitles
  let autoLoaded = false; // the subtitles on screen came from automatic mode (a newer file may replace them)
  let video = null;       // the video the overlay follows
  let pinned = null;      // video chosen by hand in the popup
  let visible = true;     // the main subtitles; the shortcut (Alt + S by default) hides or shows both
  let dualVisible = true; // the second subtitles, switched apart in the language panel over the video
  let toggleKey = SubSettings.TOGGLE_KEY; // the show / hide shortcut, changeable in the popup
  let origLang = '';      // the original's language, as Google Translate detected it
  let tabHasSubs = false; // some frame in this tab has subtitles (for shortcut forwarding)
  let lastSrc = '';
  let lastAdAt = 0;
  let lastKey = '';
  let lastGeom = '';
  let raf = 0;
  let watchTimer = 0;
  let bareFullscreen = false;
  let ownFullscreen = null; // { container, videoStyle } while our own fullscreen is on
  let off = false;        // turned off on this site from the popup: offer, show and restore nothing

  // The site is the tab's address, also inside a player frame from another domain.
  const topUrl = window === window.top ? location.href
    : (location.ancestorOrigins && location.ancestorOrigins.length ? location.ancestorOrigins[location.ancestorOrigins.length - 1] : location.href);
  const site = SubSettings.siteOf(topUrl);

  // ---------- storage ----------

  SubSettings.load().then((s) => { settings = s; refreshStyle(); });
  SubSettings.loadTranslation().then((p) => { prefs = p; });
  SubSettings.loadToggleKey().then((k) => { toggleKey = k; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.toggleKey) toggleKey = changes.toggleKey.newValue || SubSettings.TOGGLE_KEY;
    if (area === 'local' && changes.offSites) setOff(SubSettings.isOff(changes.offSites.newValue, site));
    if (area === 'local') {
      for (const k of Object.keys(SubSettings.TRANSLATION)) {
        if (changes[k]) prefs[k] = changes[k].newValue != null ? changes[k].newValue : SubSettings.TRANSLATION[k];
      }
      if (changes.secondLang && cues.length) { ensureSecond(); lastKey = ''; position(true); render(true); }
    }
    if (area !== 'local' || !changes.settings) return;
    const offsetBefore = settings.offset;
    settings = Object.assign({}, SubSettings.DEFAULTS, changes.settings.newValue || {});
    if (file && settings.offset !== offsetBefore) rememberSoon();
    refreshStyle();
  });

  // Turning off removes our subtitles and the card at once; turning back on
  // needs nothing: the next subtitles the site loads are offered again.
  function setOff(value) {
    if (value === off) return;
    off = value;
    if (!off) return;
    restorePending = null;
    waiting.length = 0;
    hideFound();
    hideRestore();
    clearSubs();
    forgetPage();
  }

  // The subtitles of each page are kept on this computer (storage.local), with
  // their sync, so a later visit can bring them back. A mark in session storage
  // says they were already showing in this browser session: then a reload
  // restores them at once, a later visit only offers them.
  const pageKey = () => 'page:' + location.href;
  const memKey = () => 'mem:' + location.href;
  const MEM_PAGES = 30;

  async function rememberFile() {
    if (!file) return;
    const record = Object.assign({ t: Date.now(), offset: settings.offset }, file);
    try { await chrome.storage.session.set({ [pageKey()]: { t: record.t } }); } catch (e) { /* reload just won't restore */ }
    // Newest first; everything past `keep` is removed.
    const prune = async (keep) => {
      const all = await chrome.storage.local.get(null);
      const pages = Object.keys(all).filter((k) => k.startsWith('mem:')).sort((a, b) => all[b].t - all[a].t);
      if (pages.length > keep) await chrome.storage.local.remove(pages.slice(keep));
    };
    try {
      await chrome.storage.local.set({ [memKey()]: record });
      await prune(MEM_PAGES);
    } catch (e) {
      // Storage full: keep only the newest few pages and try once more.
      try { await prune(5); await chrome.storage.local.set({ [memKey()]: record }); } catch (e2) { /* not remembered */ }
    }
  }

  function forgetPage() {
    try { chrome.storage.session.remove(pageKey()); } catch (e) { /* ignore */ }
    try { chrome.storage.local.remove(memKey()); } catch (e) { /* ignore */ }
  }

  // A sync change while subtitles show is saved with them (once it settles).
  let memTimer = 0;
  function rememberSoon() {
    clearTimeout(memTimer);
    memTimer = setTimeout(rememberFile, 800);
  }

  function send(msg) {
    try { return chrome.runtime.sendMessage(msg).catch(() => {}); } catch (e) { return Promise.resolve(); }
  }

  // ---------- finding videos ----------

  // All <video> elements in this frame, including inside open shadow roots.
  function findVideos() {
    const found = [...document.querySelectorAll('video')];
    const walk = (rootNode) => {
      const all = rootNode.querySelectorAll('*');
      for (const el of all) {
        if (!el.shadowRoot) continue;
        found.push(...el.shadowRoot.querySelectorAll('video'));
        walk(el.shadowRoot);
      }
    };
    walk(document);
    return [...new Set(found)];
  }

  function area(v) {
    const r = v.getBoundingClientRect();
    if (r.width < 50 || r.height < 50) return 0;
    const st = getComputedStyle(v);
    if (st.visibility === 'hidden' || st.display === 'none' || +st.opacity === 0) return 0;
    return r.width * r.height;
  }

  const isPlaying = (v) => !v.paused && !v.ended && v.readyState > 2;

  // Pinned video first, then the largest playing one, then the largest visible one.
  function pickVideo() {
    if (pinned && pinned.isConnected) return pinned;
    const vids = findVideos().map((v) => ({ v, a: area(v) })).filter((x) => x.a > 0);
    if (!vids.length) return null;
    const playing = vids.filter((x) => isPlaying(x.v));
    const pool = playing.length ? playing : vids;
    pool.sort((a, b) => b.a - a.a);
    return pool[0].v;
  }

  // ---------- overlay DOM ----------

  let host, shadow, subsEl, dualEl, toastEl, hintEl, restoreEl, fsBtn, dropEl, foundEl, siteNoteEl, langsEl;

  function ensureHost() {
    if (host) return;
    host = document.createElement('subtitle-overlay-root');
    const hs = host.style;
    for (const [k, v] of Object.entries({
      all: 'initial', position: 'fixed', left: '0px', top: '0px', width: '0px', height: '0px',
      'z-index': '2147483647', 'pointer-events': 'none', display: 'block', overflow: 'visible',
      contain: 'layout style',
    })) hs.setProperty(k, v, 'important');
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = SubRender.CSS + `
      :host { all: initial; }
      .toast, .hint, .fs, .drop { font: 600 14px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff; }
      .toast {
        position: absolute; top: max(10%, 52px); left: 50%; transform: translateX(-50%);
        background: rgba(20,20,20,.85); padding: 6px 12px; border-radius: 999px;
        opacity: 0; transition: opacity .2s; white-space: nowrap; pointer-events: none;
      }
      .toast.on { opacity: 1; }
      .toast.low { top: auto; bottom: max(10%, 52px); }
      .toast.mid { top: 30%; }
      .hint {
        position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
        display: none; align-items: center; gap: 8px; pointer-events: auto;
        background: rgba(20,20,20,.9); padding: 6px 6px 6px 12px; border-radius: 10px; white-space: nowrap;
      }
      .hint.on { display: flex; }
      .hint.on ~ .hint.on { display: none; } /* "New video" first, never both */
      .restore .name { max-width: 260px; overflow: hidden; text-overflow: ellipsis; font-weight: 500; opacity: .85; }
      .site-note {
        position: absolute; top: 12px; left: 12px; max-width: min(360px, calc(100% - 24px));
        display: none; align-items: center; gap: 10px; pointer-events: auto;
        background: rgba(20,20,20,.92); padding: 8px 6px 8px 12px; border-radius: 10px;
        font: 500 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff;
      }
      .site-note.on { display: flex; }
      /* A clean circle in the accent purple with a white outline copy icon (no ring around it). */
      .subs.copy .front .line { pointer-events: auto; cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Ccircle cx='14' cy='14' r='13' fill='%237a41e4'/%3E%3Cg transform='translate(8 8) scale(.5)' fill='none' stroke='white' stroke-width='3.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='8' y='8' width='14' height='14' rx='2'/%3E%3Cpath d='M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'/%3E%3C/g%3E%3C/svg%3E") 14 14, copy; }
      .site-note b { font-weight: 700; }
      .site-note button { font: inherit; color: #fff; background: transparent; border: 0; border-radius: 7px; padding: 2px 8px; cursor: pointer; }
      .site-note button:hover { background: rgba(255,255,255,.18); }
      .hint button {
        font: inherit; color: #fff; background: rgba(255,255,255,.16); border: 0;
        border-radius: 7px; padding: 4px 10px; cursor: pointer;
      }
      .hint button:hover { background: rgba(255,255,255,.28); }
      /* Top centre: players rarely put their own controls there. The same dark
         card and row hover as the language switches, the shortcut as a key cap. */
      .fs {
        position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: none; pointer-events: auto;
        background: rgba(20,20,20,.92); padding: 4px; border-radius: 12px; white-space: nowrap;
      }
      .fs.on { display: block; }
      .fs button {
        display: flex; align-items: center; gap: 8px; font: 600 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif;
        color: #fff; background: transparent; border: 0; border-radius: 8px; padding: 6px 8px 6px 10px; cursor: pointer;
      }
      .fs button:hover { background: rgba(255,255,255,.12); }
      .fs svg { flex: none; width: 14px; height: 14px; }
      .fs kbd {
        font: 600 11px/1 system-ui, -apple-system, "Segoe UI", sans-serif; color: rgba(255,255,255,.7);
        background: rgba(255,255,255,.12); border-radius: 5px; padding: 3px 6px;
      }
      .hint.on ~ .fs { display: none; } /* the "New video" hint uses the same spot */
      .drop {
        position: absolute; inset: 8px; border: 3px dashed rgba(255,255,255,.9); border-radius: 12px;
        background: rgba(0,0,0,.45); display: none; align-items: center; justify-content: center; font-size: 20px;
      }
      .drop.on { display: flex; }
      .found {
        position: absolute; top: 12px; right: 12px; display: none; flex-direction: column; gap: 6px;
        pointer-events: auto; max-width: min(420px, calc(100% - 24px));
        background: rgba(20,20,20,.92); padding: 10px 10px 10px 12px; border-radius: 12px;
        font: 600 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff;
      }
      .found.on { display: flex; }
      .found-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .found-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .found-name { flex-basis: 120px; }
      .found-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; opacity: .85; }
      .found-lang { font-size: 11px; text-transform: uppercase; background: #6d28d9; border-radius: 5px; padding: 1px 6px; }
      .found button {
        font: inherit; color: #fff; background: rgba(255,255,255,.16); border: 0;
        border-radius: 7px; padding: 4px 10px; cursor: pointer; white-space: nowrap;
      }
      .found button:hover { background: rgba(255,255,255,.28); }
      .found button.main { background: #7c3aed; }
      .found button.main:hover { background: #8b5cf6; }
      .found .x { background: transparent; padding: 2px 6px; }
      .found-msg { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; font-weight: 500; font-size: 12px; }
      .found-msg > span { opacity: .85; }
      /* Dual subtitles: one switch per language, top right while the mouse moves over the video. */
      .langs {
        position: absolute; top: 12px; right: 12px; display: none; flex-direction: column; gap: 2px;
        pointer-events: auto; background: rgba(20,20,20,.92); padding: 4px; border-radius: 12px;
        font: 600 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff;
      }
      .langs.on { display: flex; }
      .found.on ~ .langs { display: none; } /* the found card uses the same corner */
      .langs button {
        display: flex; align-items: center; gap: 8px; font: inherit; color: inherit; background: transparent;
        border: 0; border-radius: 8px; padding: 6px 8px 6px 10px; cursor: pointer; text-align: left;
      }
      .langs button:hover { background: rgba(255,255,255,.12); }
      .langs .name { flex: 1; white-space: nowrap; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
      .langs button[aria-checked=false] .name { opacity: .55; }
      .langs .sw { position: relative; flex: none; width: 28px; height: 16px; border-radius: 999px; background: rgba(255,255,255,.28); transition: background .15s; }
      .langs .sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: transform .15s; }
      .langs button[aria-checked=true] .sw { background: #7a41e4; }
      .langs button[aria-checked=true] .sw::after { transform: translateX(12px); }
      .found-msg .saved::before { content: "\\2713"; color: #86efac; font-weight: 700; margin-right: 6px; }
      .covered { visibility: hidden !important; } /* something of the page lies over the video here */
    `;
    subsEl = el('div', 'subs');
    dualEl = el('div', 'subs');
    // Clicks on a line copy it and never reach the player (no pause, no fullscreen on double click).
    for (const [layer, lines] of [[subsEl, () => shownCues], [dualEl, () => shownDual]]) {
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick']) layer.addEventListener(type, (e) => e.stopPropagation());
      layer.addEventListener('click', async (e) => {
        e.stopPropagation();
        const block = e.target.closest && e.target.closest('.block');
        const c = block && lines()[[...layer.children].indexOf(block)];
        if (!c) return;
        toast(t((await copyText(lineText(c))) ? 'Copied' : 'Couldn’t copy'), 1000);
      });
    }
    toastEl = el('div', 'toast');
    hintEl = el('div', 'hint');
    hintEl.append(el('span', '', t('New video. Load subtitles for it?')));
    const restore = el('button', '', t('Restore previous'));
    restore.addEventListener('click', restoreStashed);
    const close = el('button', '', '×');
    close.title = t('Dismiss');
    close.addEventListener('click', () => { stashed = null; hintEl.classList.remove('on'); });
    hintEl.append(restore, close);
    restoreEl = el('div', 'hint restore');
    fsBtn = el('div', 'fs');
    const fsGo = el('button');
    fsGo.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 6V3.5C2 2.7 2.7 2 3.5 2H6M10 2h2.5c.8 0 1.5.7 1.5 1.5V6M14 10v2.5c0 .8-.7 1.5-1.5 1.5H10M6 14H3.5C2.7 14 2 13.3 2 12.5V10"/></svg>';
    fsGo.append(el('span', '', t('Fullscreen with subtitles')), el('kbd', '', /Mac/.test(navigator.platform) ? '⌥F' : 'Alt+F'));
    fsGo.addEventListener('click', (e) => { e.stopPropagation(); toggleFullscreen(); });
    fsBtn.append(fsGo);
    dropEl = el('div', 'drop', t('Drop .srt or .vtt subtitles here'));
    foundEl = el('div', 'found');
    siteNoteEl = el('div', 'site-note');
    const noteText = el('span', '');
    noteText.append(el('b', '', t('Two sets of subtitles.') + ' '), t('Turn the site’s own subtitles off in its player (CC button).'));
    const noteClose = el('button', '', '\u00d7');
    noteClose.title = t('Dismiss');
    noteClose.addEventListener('click', () => { siteDismissed = true; setSiteNote(siteSeen); });
    siteNoteEl.append(noteText, noteClose);
    langsEl = el('div', 'langs');
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick']) langsEl.addEventListener(type, (e) => e.stopPropagation());
    shadow.append(style, subsEl, dualEl, toastEl, hintEl, restoreEl, fsBtn, dropEl, foundEl, siteNoteEl, langsEl);
    placeHost();
    useFont();
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  // Puts the overlay where it can be seen: inside the fullscreen element when
  // the site's player container is fullscreen, otherwise at the page root.
  function placeHost() {
    if (!host) return;
    const fe = document.fullscreenElement;
    let parent = document.documentElement;
    if (fe && video && fe !== video && containsDeep(fe, video)) {
      const root = video.getRootNode();
      parent = root instanceof ShadowRoot && containsDeep(fe, root.host) && fe.shadowRoot ? root : fe;
    }
    if (host.parentNode !== parent) parent.appendChild(host);
  }

  // Like Node.contains, but also looks through shadow roots.
  function containsDeep(ancestor, node) {
    let n = node;
    while (n) {
      if (n === ancestor) return true;
      n = n.parentNode || (n instanceof ShadowRoot ? n.host : null);
    }
    return false;
  }

  let toastTimer = 0;
  function toast(text, ms) {
    ensureHost();
    toastEl.textContent = text;
    // Out of the subtitles' way: low when they sit at the top, mid-height when both edges are taken.
    toastEl.classList.toggle('low', settings.place === 'top' && !dualOn());
    toastEl.classList.toggle('mid', dualOn());
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), ms || 1500);
    position(true);
  }

  // ---------- geometry ----------

  // Box of the actual picture inside the video element (without letterbox bars).
  function pictureRect(v) {
    const r = v.getBoundingClientRect();
    const vw = v.videoWidth, vh = v.videoHeight;
    const fit = getComputedStyle(v).objectFit;
    if (!vw || !vh || fit === 'fill' || fit === 'cover') return { left: r.left, top: r.top, width: r.width, height: r.height };
    const k = Math.min(r.width / vw, r.height / vh);
    const w = vw * k, h = vh * k;
    return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
  }

  function position(force) {
    if (!host || !video) return;
    const r = pictureRect(video);
    const geom = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
    if (!force && geom === lastGeom) return;
    lastGeom = geom;
    const hs = host.style;
    hs.setProperty('left', Math.round(r.left) + 'px', 'important');
    hs.setProperty('top', Math.round(r.top) + 'px', 'important');
    hs.setProperty('width', Math.round(r.width) + 'px', 'important');
    hs.setProperty('height', Math.round(r.height) + 'px', 'important');
    SubRender.applyStyle(subsEl, settings, r.height, r.width);
    SubRender.applyStyle(dualEl, dualSettings(), r.height, r.width);
    liftForControls();
  }

  // YouTube's control bar (progress bar and buttons) covers the bottom of the
  // video while you hover or pause. Lift the subtitles above it, as YouTube does
  // with its own captions, and drop them back when the bar hides.
  function liftForControls() {
    if (!subsEl) return;
    const player = video && video.closest && video.closest('.html5-video-player');
    const bar = player && !player.classList.contains('ytp-autohide') && player.querySelector('.ytp-chrome-bottom');
    // Never in fullscreen: there the subtitles stay put and the bar may cover them,
    // instead of jumping up and down every time the mouse moves.
    const shows = bar && host && !document.fullscreenElement;
    const b = shows && bar.getBoundingClientRect(), h = shows && host.getBoundingClientRect();
    // Each layer by its own distance (with dual subtitles the bottom one may be the original).
    for (const layer of [subsEl, dualEl]) {
      let lift = 0;
      if (shows && b.height && b.top < h.bottom && b.bottom > h.top) {
        const bottomPx = parseFloat(layer.style.getPropertyValue('--bottom')) || 0;
        lift = Math.max(0, Math.round(h.bottom - b.top + 8 - bottomPx));
      }
      layer.style.setProperty('--lift', lift + 'px');
    }
  }

  function refreshStyle() {
    if (!subsEl) return;
    useFont();
    position(true);
    render(true);
    ensureSecond();
  }

  // A Google font is only downloaded once the overlay is actually used on a page.
  function useFont() {
    if (!SubRender.isGoogle(settings.font)) return;
    SubRender.ensureFont(document, settings.font)
      .then(() => position(true))
      .catch(() => toast(t('Font "{name}" could not load', { name: SubRender.googleName(settings.font) })));
  }

  // ---------- timing ----------

  // Index of the last cue starting at or before t (ms), -1 if none. Binary search.
  function lastStart(t, list) {
    let lo = 0, hi = list.length - 1, last = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].start <= t) { last = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return last;
  }

  // Cues active at time t (ms): the last one starting, then look back for overlaps.
  function activeAt(t, list) {
    if (!list) list = cues;
    const last = lastStart(t, list);
    const out = [];
    for (let i = last; i >= 0 && last - i < 30; i--) if (list[i].end > t) out.push(i);
    return out.reverse();
  }

  // YouTube marks its player with .ad-showing while an ad plays in the same video.
  function inAd() {
    const ad = !!(video && video.closest && video.closest('.ad-showing'));
    if (ad) lastAdAt = Date.now();
    return ad;
  }

  let shownCues = []; // the lines on screen, in the order renderCues draws them
  // Dual subtitles: while a translation shows, the original goes to the
  // opposite edge (top when the translation is at the bottom or middle).
  const dualOn = () => !!secondCues();
  // With the main ones switched off in the language panel, the second ones
  // take their place (usually the bottom): no reason to keep them at the other edge.
  const dualSettings = () => (!visible && dualVisible ? settings : Object.assign({}, settings, {
    place: settings.place === 'top' ? 'bottom' : 'top', bottom: settings.dualDistance,
  }));
  let shownDual = [];

  function render(force) {
    if (!subsEl || !video) return;
    let idx = [], idxDual = [];
    const hide = !cues.length || inAd() || (video.paused && settings.onPause === 'hide');
    const now = video.currentTime * 1000 - settings.offset;
    if (!hide && visible) idx = activeAt(now);
    const second = secondCues();
    if (!hide && dualVisible && second) idxDual = activeAt(now, second);
    const key = idx.join(',') + '|' + idxDual.join(',');
    if (!force && key === lastKey) return;
    lastKey = key;
    const clean = (list) => (settings.hideSounds
      ? list.map((c) => Object.assign({}, c, { text: SubLib.cleanCaption(c.text) })).filter((c) => c.text)
      : list);
    shownCues = clean(idx.map((i) => cues[i]));
    shownDual = clean(idxDual.map((i) => second[i]));
    for (const layer of [subsEl, dualEl]) layer.classList.toggle('copy', !!settings.clickCopy);
    SubRender.renderCues(subsEl, shownCues);
    SubRender.renderCues(dualEl, shownDual);
    // The site draws its line a moment after ours, so look a little later.
    startSiteWatch();
    checkSiteText();
    clearTimeout(siteTimer);
    siteTimer = setTimeout(checkSiteText, 400);
  }

  // The overlay sits above the whole page, so a site's own menus or dialogs
  // (YouTube's notifications, say) would land under it. Each piece that has
  // something of the page lying over it hides until it is uncovered, as if the
  // overlay were just one layer above the video.
  let coverAt = 0, coverRoot = null, coverGeom = '';
  function playerRoot() {
    const r = video.getBoundingClientRect();
    const geom = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
    if (coverRoot && coverGeom === geom && containsDeep(coverRoot, video)) return coverRoot;
    // The biggest ancestor that is still no bigger than the video: the player
    // with its own controls and overlays, but not the page around it.
    let root = video, n = video;
    for (;;) {
      n = n.parentNode || (n instanceof ShadowRoot ? n.host : null);
      if (!n || n === document.body || n === document.documentElement || n.nodeType !== 1) break;
      const p = n.getBoundingClientRect();
      if (p.left < r.left - 8 || p.top < r.top - 8 || p.right > r.right + 8 || p.bottom > r.bottom + 8) break;
      root = n;
    }
    coverGeom = geom;
    return (coverRoot = root);
  }
  function covered(el) {
    // A subtitle layer is as wide as the longest allowed line: test the lines themselves.
    if (el === subsEl || el === dualEl) return [...el.querySelectorAll('.front .line')].some((line) => coveredBox(line.getBoundingClientRect()));
    return coveredBox(el.getBoundingClientRect());
  }
  function coveredBox(b) {
    if (!b.width || !b.height) return false;
    const root = playerRoot();
    const pts = [[b.left + 3, b.top + 3], [b.right - 3, b.top + 3], [b.left + 3, b.bottom - 3], [b.right - 3, b.bottom - 3], [(b.left + b.right) / 2, (b.top + b.bottom) / 2]];
    for (const [x, y] of pts) {
      const top = document.elementsFromPoint(x, y).find((e) => e !== host);
      if (top && top !== document.documentElement && top !== document.body && !containsDeep(root, top) && !containsDeep(top, video)) return true;
    }
    return false;
  }
  function checkCovered() {
    if (!host || !video || !host.isConnected) return;
    coverAt = performance.now();
    for (const el of [subsEl, dualEl, langsEl, fsBtn, foundEl, hintEl, restoreEl, siteNoteEl, toastEl]) {
      if (el) el.classList.toggle('covered', !document.fullscreenElement && covered(el));
    }
  }
  function checkCoveredSoon() {
    if (performance.now() - coverAt > 250) checkCovered();
  }
  // Menus and dialogs open on a click, also while the video is paused.
  document.addEventListener('click', () => setTimeout(checkCovered, 350), true);

  function tick() {
    raf = 0;
    position(false);
    render(false);
    checkCoveredSoon();
    if (video && cues.length && !video.paused && !video.ended) raf = requestAnimationFrame(tick);
  }

  function kick() {
    if (!raf) raf = requestAnimationFrame(tick);
  }

  // ---------- attaching to a video ----------

  const VIDEO_EVENTS = ['play', 'playing', 'pause', 'seeking', 'seeked', 'ratechange', 'timeupdate', 'loadedmetadata'];
  let resizeObs = null;

  function attach(v) {
    if (video === v) return;
    detachVideo();
    video = v;
    lastSrc = v.currentSrc || v.src || '';
    for (const ev of VIDEO_EVENTS) v.addEventListener(ev, kick);
    v.addEventListener('loadstart', onSourceChange);
    v.addEventListener('emptied', onSourceChange);
    // The site may switch a caption track back on (for example when you pick another language).
    v.textTracks.addEventListener('change', () => { if (siteStyle) hideSiteSubs(true); });
    resizeObs = new ResizeObserver(() => position(false));
    resizeObs.observe(v);
    ensureHost();
    placeHost();
    lastKey = '';
    position(true);
    kick();
  }

  function detachVideo() {
    if (!video) return;
    for (const ev of VIDEO_EVENTS) video.removeEventListener(ev, kick);
    video.removeEventListener('loadstart', onSourceChange);
    video.removeEventListener('emptied', onSourceChange);
    if (resizeObs) resizeObs.disconnect();
    resizeObs = null;
    if (siteObs) siteObs.disconnect(); // the next video gets its own watcher
    siteObs = sitePlayer = null;
    video = null;
  }

  // While subtitles are loaded: once a second, check the video still exists
  // and still plays the same thing (single-page sites swap videos without reloading).
  function startWatch() {
    if (watchTimer) return;
    watchTimer = setInterval(() => {
      if (!cues.length && !stashed && !restorePending) return stopWatch();
      if (restorePending) return tryRestore();
      if (!video || !video.isConnected) {
        const next = pickVideo();
        if (next) {
          const sameSrc = (next.currentSrc || next.src) === lastSrc;
          attach(next);
          if (!sameSrc) onSourceChange();
        }
        return;
      }
      if ((video.currentSrc || video.src || '') !== lastSrc) onSourceChange();
      inAd();
      checkCovered();
    }, 1000);
  }

  function stopWatch() {
    clearInterval(watchTimer);
    watchTimer = 0;
  }

  function onSourceChange() {
    if (!video) return;
    const src = video.currentSrc || video.src || '';
    if (!src || src === lastSrc) return;
    lastSrc = src;
    // Ads in the same element change the source too; don't drop subtitles for them.
    if (inAd() || Date.now() - lastAdAt < 5000) return;
    if (!cues.length) return;
    stashed = { cues, file };
    clearSubs(true);
    ensureHost();
    hintEl.classList.add('on');
    // Gone after 8 s; a newer video swap restarts the clock.
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hintEl && hintEl.classList.remove('on'), 8000);
  }
  let hintTimer = 0;

  let restoreTimer = 0;
  function offerRestore(record) {
    const show = el('button', '', t('Show'));
    show.addEventListener('click', () => { hideRestore(); restoreRecord(record, video || pickVideo()); });
    const close = el('button', '', '×');
    close.title = t('Dismiss');
    close.addEventListener('click', hideRestore);
    const name = el('span', 'name', record.name);
    name.title = record.name;
    restoreEl.replaceChildren(el('span', '', t('Subtitles from last time:')), name, show, close);
    restoreEl.classList.add('on');
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(hideRestore, 8000);
    position(true);
  }
  function hideRestore() {
    clearTimeout(restoreTimer);
    if (restoreEl) restoreEl.classList.remove('on');
  }

  function restoreStashed() {
    if (!stashed) return;
    cues = stashed.cues;
    file = stashed.file;
    stashed = null;
    hintEl.classList.remove('on');
    afterLoad();
  }

  // ---------- loading ----------

  function loadBytes(name, b64, encoding, targetVideo) {
    const bytes = SubLib.base64ToBytes(b64);
    const { text, encoding: used } = SubLib.decode(bytes, encoding || 'auto');
    const parsed = SubLib.parse(text);
    if (!parsed.length) return { ok: false, error: t('No subtitle lines found in this file.') };
    const v = targetVideo || pickVideo();
    if (!v) return { ok: false, error: t('No video found on this page.') };
    cues = parsed;
    file = { name, b64, encoding: encoding || 'auto', usedEncoding: used };
    autoLoaded = false;
    siteDismissed = false;
    original = null;
    translations.clear();
    origLang = '';
    stashed = null;
    if (hintEl) hintEl.classList.remove('on');
    hideRestore();
    attach(v);
    afterLoad();
    rememberFile();
    toast(t('Loaded {n} lines', { n: parsed.length }) + (settings.offset ? ' · ' + t('Sync: {offset}', { offset: fmtOffset(settings.offset) }) : ''));
    return { ok: true, count: parsed.length, encoding: used };
  }

  function afterLoad() {
    hideSiteSubs(true);
    visible = dualVisible = true;
    lastKey = '';
    startWatch();
    enableMouse(true);
    position(true);
    render(true);
    kick();
    ensureSecond();
    send({ type: 'subs-state', has: true });
  }

  function clearSubs(keepStash) {
    hideSiteSubs(false);
    stopSiteWatch();
    autoLoaded = false;
    cues = [];
    file = null;
    original = null;
    translations.clear();
    origLang = '';
    if (!keepStash) stashed = null;
    lastKey = '';
    if (subsEl) subsEl.replaceChildren();
    if (dualEl) dualEl.replaceChildren();
    enableMouse(false);
    if (fsBtn) fsBtn.classList.remove('on');
    if (langsEl) langsEl.classList.remove('on');
    send({ type: 'subs-state', has: false });
  }

  // The last subtitles of this exact page: after a reload they come back at
  // once; on a later visit a card offers them once you watch the video.
  let restorePending = null; // { record, ask }
  async function checkRestore() {
    try {
      const got = await chrome.storage.local.get(memKey());
      const record = got[memKey()];
      if (!record) return;
      let ask = true;
      try { ask = !(await chrome.storage.session.get(pageKey()))[pageKey()]; } catch (e) { /* treat as a new visit */ }
      restorePending = { record, ask };
      startWatch();
      tryRestore();
    } catch (e) { /* no storage access */ }
  }
  function tryRestore() {
    if (!restorePending) return;
    if (cues.length) { restorePending = null; return; } // something else loaded first
    if (restorePending.ask) {
      const v = watched();
      if (!v) return;
      const { record } = restorePending;
      restorePending = null;
      attach(v);
      ensureHost();
      offerRestore(record);
      return;
    }
    const v = pickVideo();
    if (!v) return;
    const f = restorePending.record;
    restorePending = null;
    restoreRecord(f, v);
  }

  function restoreRecord(f, v) {
    if (typeof f.offset === 'number' && f.offset !== settings.offset) {
      settings.offset = SubSettings.clamp('offset', f.offset);
      SubSettings.save({ offset: settings.offset });
    }
    if (!f.original) return loadBytes(f.name, f.b64, f.encoding, v);
    // A translation was showing: bring back the original, then the saved translation (no new request).
    const r = loadBytes(f.original.name, f.original.b64, f.original.encoding, v);
    if (r.ok && f.origLang) origLang = f.origLang;
    if (r.ok) showTranslation(f.translatedTo, SubLib.parse(SubLib.decode(SubLib.base64ToBytes(f.b64), 'utf-8').text), true);
  }

  // ---------- the site's own subtitles ----------

  // While our subtitles show, the site's own ones are hidden so they don't
  // double up: the browser's built-in caption layer always, plus the caption
  // layers of common web players. A player that draws captions some other way
  // keeps them; then you switch them off in the player.
  const SITE_SUBS_CSS = `
    video::-webkit-media-text-track-container { display: none !important; }
    .vjs-text-track-display, .shaka-text-container, .jw-captions, .jw-text-track-container,
    .bmpui-ui-subtitle-overlay, .theoplayer-texttracks, .fp-captions, .plyr__captions,
    .mejs__captions-layer, .dash-captions-container, .ytp-caption-window-container,
    .ytp-caption-window-container .caption-window, .ytp-caption-segment { visibility: hidden !important; }`;
  let siteStyle = null;
  let hiddenTracks = [];

  function hideSiteSubs(on) {
    if (on && cues.length) {
      if (!siteStyle) {
        siteStyle = document.createElement('style');
        siteStyle.textContent = SITE_SUBS_CSS;
        (document.head || document.documentElement).append(siteStyle);
      }
      // Tracks the browser draws itself: "hidden" still loads their lines (players keep working).
      for (const v of findVideos()) {
        for (const t of v.textTracks) if (t.mode === 'showing') { t.mode = 'hidden'; hiddenTracks.push(t); }
      }
    } else {
      if (siteStyle) siteStyle.remove();
      siteStyle = null;
      for (const t of hiddenTracks) if (t.mode === 'hidden') t.mode = 'showing';
      hiddenTracks = [];
    }
  }

  // Players that draw subtitles with their own code (Prima+ and many others).
  // The site shows the very file we caught, so we know its current line. The
  // first time that text shows up next to the video, its box is hidden and,
  // when the box has class names, a style rule hides every later box like it,
  // so new lines never paint. A watcher on the player also catches a new line
  // before the browser draws it. If something still shows (we couldn't hide
  // it), a note asks you to switch the site's subtitles off in its player.
  let siteTimer = 0;
  let siteSeen = false;      // the site's line is on screen right now
  let siteDismissed = false; // you closed the note (until the next file)
  let siteObs = null;        // watches the player for new caption lines
  let sitePlayer = null;     // the element it watches
  const siteRules = new Map(); // document or shadow root -> <style> with the hide rules
  const siteMarked = new Set(); // boxes hidden directly
  const squash = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

  // The nearest ancestor of the video that is about as big as the video.
  function playerOf(v) {
    const vr = v.getBoundingClientRect();
    let player = v.parentElement;
    for (let i = 0; i < 6 && player && player.parentElement; i++) {
      const r = player.parentElement.getBoundingClientRect();
      if (r.width > vr.width * 1.3 || r.height > vr.height * 1.6) break;
      player = player.parentElement;
    }
    return player;
  }

  function startSiteWatch() {
    if (siteObs || !video) return;
    const player = sitePlayer = playerOf(video);
    if (!player) return;
    // Mutation callbacks run before the next paint, so a line hidden here never shows.
    siteObs = new MutationObserver(checkSiteText);
    siteObs.observe(player, SITE_WATCH);
  }
  // Text changes, new elements, and boxes shown by switching a class or style.
  const SITE_WATCH = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] };
  const watchedRoots = new WeakSet(); // shadow roots inside the player already watched
  const siteHiddenLog = []; // what was hidden, shown in the popup

  function stopSiteWatch() {
    if (siteObs) siteObs.disconnect();
    siteObs = sitePlayer = null;
    for (const st of siteRules.values()) st.remove();
    siteRules.clear();
    for (const el of siteMarked) el.style.removeProperty('visibility');
    siteMarked.clear();
    siteHiddenLog.length = 0;
    setSiteNote(false);
  }

  // A class selector for a caption box, without state classes that come and go.
  function boxSelector(el) {
    const cls = [...el.classList].filter((c) => !/^(is-|has-)?(active|visible|show(n|ing)?|hidden|on|off|open|in|out|enter|leave|fade.*)$/i.test(c)
      && !/[-_]\d+$/.test(c)); // numbered per line ("line-17"): would never match the next one
    return cls.length ? el.localName + cls.map((c) => '.' + CSS.escape(c)).join('') : '';
  }

  function hideBox(box) {
    box.style.setProperty('visibility', 'hidden', 'important');
    siteMarked.add(box);
    let sel = boxSelector(box);
    // No class of its own: name it through its parent, if the parent holds no controls.
    const p = box.parentElement;
    if (!sel && p && !p.querySelector('button, input, select, [role=slider]')) {
      const ps = boxSelector(p);
      if (ps) sel = ps + ' > ' + box.localName;
    }
    const label = (sel || box.localName + ' (no class)') + (box.getRootNode() instanceof ShadowRoot ? ' in shadow DOM' : '');
    if (!siteHiddenLog.includes(label)) siteHiddenLog.push(label);
    if (!sel) return;
    const root = box.getRootNode();
    let st = siteRules.get(root);
    if (!st) {
      st = document.createElement('style');
      siteRules.set(root, st);
      (root instanceof ShadowRoot ? root : (document.head || document.documentElement)).append(st);
    }
    const rule = sel + ' { visibility: hidden !important; }';
    if (!st.textContent.includes(rule)) st.textContent += rule + '\n';
  }

  function checkSiteText() {
    if (!video || !cues.length) return setSiteNote(false);
    const source = original ? original.cues : cues;
    // The site's own timing, without our sync offset; also the line just
    // starting, since the site may switch a moment before our clock says so.
    const t = video.currentTime * 1000;
    const idx = [...new Set(activeAt(t, source).concat(activeAt(t + 700, source)))];
    if (!idx.length) return; // nothing to compare between lines: keep the note as it is
    const player = sitePlayer || playerOf(video); // measured once per video, not on every change
    if (!player) return;
    let visible = false;
    for (const i of idx) {
      // The first line, clean: enough to recognise it, short enough to survive the site's own line breaks.
      const first = SubLib.toRuns(source[i].text).map((r) => r.text).join('').split('\n').find((l) => squash(l).length >= 3);
      const needle = squash(first).slice(0, 40);
      if (needle.length < 4) continue; // too short to be sure it is a caption ("Ano.")
      for (const el of textHolders(player, needle)) {
        // Hide it even while it is still invisible: players fade lines in or
        // reveal them by a class change a moment later.
        if (getComputedStyle(el).visibility === 'hidden') continue;
        // Climb a little while the parent holds nothing but this caption (so a
        // background box goes too), never up to anything with controls in it.
        let box = el;
        for (let k = 0; k < 3; k++) {
          const p = box.parentElement;
          if (!p || p === player || p.contains(video) || (host && p.contains(host))) break;
          if (squash(p.textContent) !== squash(box.textContent)) break;
          if (p.querySelector('button, input, select, a[href], [role=button], [role=slider], [tabindex]')) break;
          box = p;
        }
        hideBox(box);
        if (el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden') visible = true;
      }
    }
    setSiteNote(visible);
  }

  function setSiteNote(on) {
    siteSeen = on;
    if (!siteNoteEl) return;
    siteNoteEl.classList.toggle('on', on && !siteDismissed);
  }

  // Smallest elements whose text contains the needle, also inside open shadow roots.
  function textHolders(root, needle) {
    const out = [];
    const walk = (node) => {
      for (const el of node.querySelectorAll('*')) {
        if (el === host || el === video) continue;
        if (el.shadowRoot) {
          // Changes inside a web component don't reach the player's watcher: watch it too.
          if (siteObs && !watchedRoots.has(el.shadowRoot)) { watchedRoots.add(el.shadowRoot); siteObs.observe(el.shadowRoot, SITE_WATCH); }
          walk(el.shadowRoot);
        }
        if (el.childElementCount > 8) continue;
        if (!squash(el.textContent).includes(needle)) continue;
        if ([...el.children].some((c) => squash(c.textContent).includes(needle))) continue; // a child holds it more tightly
        out.push(el);
      }
    };
    walk(root);
    return out.slice(0, 4);
  }

  const offHint = () => (siteSeen ? ' ' + t('Turn the site’s own subtitles off in its player.') : '');

  // ---------- translation ----------

  // Lines travel as HTML so <i>/<b> and line breaks survive the round trip.
  const toHtml = (raw) => SubLib.cleanText(raw).replace(/\n/g, '<br>');
  const fromHtml = (html) => String(html || '')
    .replace(/\s*<br\s*\/?>\s*/gi, '\n')
    .replace(/(<\/(?:i|b|u)>)\s+([.,!?;:\u2026])/g, '$1$2') // Google adds a space before punctuation after a tag
    .trim();

  // The untranslated file and its lines: what every translation starts from.
  const baseOf = () => original || { file, cues };

  // Translates the original lines into `to` (cached per language). Resolves
  // { ok, list } or { ok: false, error }.
  async function fetchTranslation(to, quiet) {
    const base = baseOf();
    const cached = translations.get(to);
    if (cached) return { ok: true, list: cached };
    if (!quiet) toast(t('Translating {n} lines to {lang}…', { n: base.cues.length, lang: SubSettings.languageName(to) }), 15000);
    const res = await chrome.runtime.sendMessage({ type: 'translate', to, texts: base.cues.map((c) => toHtml(c.text)) })
      .catch((e) => ({ ok: false, error: e.message }));
    if (!res || !res.ok) {
      toast(t('Translation didn’t work'));
      return { ok: false, error: res ? res.error : t('Translation failed.') };
    }
    if (baseOf().file !== base.file) return { ok: false, error: t('Other subtitles were loaded meanwhile.') };
    if (res.detected) origLang = res.detected;
    const list = base.cues.map((c, i) => ({ start: c.start, end: c.end, text: fromHtml(res.texts[i]) || c.text }));
    translations.set(to, list);
    return { ok: true, list };
  }

  async function translate(to) {
    if (!cues.length) return { ok: false, error: t('Nothing loaded.') };
    const r = await fetchTranslation(to);
    if (!r.ok) return r;
    showTranslation(to, r.list);
    return { ok: true, count: r.list.length };
  }

  // Second subtitles: the original or another language, at the opposite edge.
  // Two people can each read their own language (Czech and Vietnamese over a French film).
  let secondPending = null; // { lang, base }: the second translation being fetched
  function secondCues() {
    if (!settings.dual || !cues.length) return null;
    const lang = prefs.secondLang || 'orig';
    const shownLang = original ? file.translatedTo : '';
    if (lang === 'orig') return original ? original.cues : null; // the main subtitles already are the original
    if (lang === shownLang) return null;
    return translations.get(lang) || null;
  }
  async function ensureSecond() {
    const lang = prefs.secondLang || 'orig';
    const base = baseOf().file;
    if (!settings.dual || !cues.length || lang === 'orig' || translations.has(lang)) return;
    // A fetch for other subtitles doesn't count: YouTube often sends its captions
    // again while the first translation is still on its way.
    if (secondPending && secondPending.lang === lang && secondPending.base === base) return;
    const mine = secondPending = { lang, base };
    const r = await fetchTranslation(lang, true);
    if (secondPending === mine) secondPending = null;
    if (r.ok) { lastKey = ''; position(true); render(true); }
  }

  // Swaps the lines on screen for a translation and keeps the original for "Show original".
  function showTranslation(to, list, quiet) {
    if (!list.length) return;
    if (!original) original = { file, cues };
    translations.set(to, list);
    cues = list;
    const name = original.file.name.replace(/\.(web)?vtt$|\.srt$/i, '') + '.' + to + '.srt';
    file = { name, b64: SubLib.bytesToBase64(new TextEncoder().encode(SubLib.toSRT(list))), encoding: 'utf-8', usedEncoding: 'utf-8',
      translatedTo: to, origLang, original: original.file };
    lastKey = '';
    render(true);
    rememberFile();
    if (!quiet) toast(t('Translated to {lang}', { lang: SubSettings.languageName(to) }), 3000);
  }

  function showOriginal() {
    if (!original) return;
    cues = original.cues;
    file = original.file;
    original = null;
    lastKey = '';
    render(true);
    rememberFile();
    toast(t('Original subtitles'));
  }

  // ---------- fullscreen ----------

  document.addEventListener('fullscreenchange', () => {
    const fe = document.fullscreenElement;
    if (ownFullscreen && fe !== ownFullscreen.container) {
      video && (video.style.cssText = ownFullscreen.videoStyle);
      ownFullscreen = null;
      // The site sized its video for the page before; let it measure again
      // (YouTube's own fullscreen otherwise keeps the small size).
      setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    }
    if (!video || !cues.length) return;
    if (fe === video) bareFullscreen = true;
    else if (!fe && bareFullscreen) {
      bareFullscreen = false;
      setTimeout(() => toast(t('This site’s fullscreen hides subtitles. Use Alt+F instead.')), 300);
    }
    placeHost();
    position(true);
    render(true);
  });

  // Our own fullscreen: the video's parent element plus the overlay inside it.
  async function toggleFullscreen() {
    if (!video) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    const container = video.parentElement || (video.getRootNode() instanceof ShadowRoot ? video.getRootNode().host : null);
    if (!container) return;
    const videoStyle = video.style.cssText;
    try {
      await container.requestFullscreen();
      ownFullscreen = { container, videoStyle };
      for (const [k, v] of Object.entries({
        position: 'absolute', inset: '0', width: '100%', height: '100%', 'max-width': 'none',
        'max-height': 'none', 'object-fit': 'contain', transform: 'none', margin: '0',
      })) video.style.setProperty(k, v, 'important');
      fsBtn.classList.remove('on');
    } catch (e) {
      toast(t('Click the video once, then press Alt+F'));
    }
  }

  // Show the fullscreen button (not in fullscreen) and the language switches
  // (also in fullscreen) briefly when the mouse moves over the video.
  let fsTimer = 0, langsTimer = 0, mouseQueued = false;
  function onMouseMove(e) {
    if (mouseQueued || !video || !fsBtn) return;
    mouseQueued = true;
    requestAnimationFrame(() => {
      mouseQueued = false;
      const r = video.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) return;
      if (!document.fullscreenElement) {
        fsBtn.classList.add('on');
        clearTimeout(fsTimer);
        fsTimer = setTimeout(() => fsBtn.classList.remove('on'), 2000);
      }
      showLangs();
      checkCovered();
    });
  }

  // ---------- language switches (dual subtitles) ----------

  const cap = (s) => s.charAt(0).toLocaleUpperCase(SubI18n.lang) + s.slice(1);
  function langLabel(code) {
    return code ? (SubSettings.flag(code) + ' ' + cap(SubSettings.languageName(code))).trim() : t('Original');
  }

  // One switch per language while dual subtitles are on in the settings, even
  // with one of them hidden, so it can be switched back on. The top one first.
  function showLangs() {
    if (!langsEl) return;
    const second = settings.dual && cues.length && secondCues();
    if (!second) { langsEl.classList.remove('on'); return; }
    const mainLang = original ? file.translatedTo : origLang;
    const secondLang = (prefs.secondLang || 'orig') === 'orig' ? origLang : prefs.secondLang;
    const main = { label: langLabel(mainLang), on: visible, flip: () => { visible = !visible; } };
    const dual = { label: langLabel(secondLang), on: dualVisible, flip: () => { dualVisible = !dualVisible; } };
    const rows = settings.place === 'top' ? [main, dual] : [dual, main];
    langsEl.replaceChildren(...rows.map((row) => {
      const b = el('button');
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-checked', String(row.on));
      b.append(el('span', 'name', row.label), el('span', 'sw'));
      b.addEventListener('click', () => { row.flip(); lastKey = ''; position(true); render(true); showLangs(); });
      return b;
    }));
    langsEl.classList.add('on');
    clearTimeout(langsTimer);
    const hideLater = () => {
      langsTimer = setTimeout(() => (langsEl.matches(':hover') ? hideLater() : langsEl.classList.remove('on')), 2500);
    };
    hideLater();
  }
  function enableMouse(on) {
    document[on ? 'addEventListener' : 'removeEventListener']('mousemove', onMouseMove, { passive: true, capture: true });
  }

  // When paused, the loop is off, so follow layout changes from these events.
  window.addEventListener('resize', () => cues.length && position(true));
  window.addEventListener('scroll', () => cues.length && position(false), { capture: true, passive: true });

  // ---------- keyboard ----------

  function isTyping(e) {
    const t = e.composedPath ? e.composedPath()[0] : e.target;
    if (!t || !t.tagName) return false;
    if (t.isContentEditable) return true;
    if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
    if (t.tagName === 'INPUT') return !/^(button|checkbox|radio|range|submit|reset|color|file|image)$/i.test(t.type);
    return false;
  }

  // Physical keys (event.code), so Option on a Mac doesn't change the match.
  function actionFor(e) {
    if (SubSettings.sameKey(SubSettings.keyOf(e), toggleKey)) return { kind: 'toggle' };
    if (!e.altKey || e.ctrlKey || e.metaKey) return null;
    switch (e.code) {
      case 'BracketLeft': return { kind: 'offset', delta: e.shiftKey ? -1000 : -100 };
      case 'BracketRight': return { kind: 'offset', delta: e.shiftKey ? 1000 : 100 };
      case 'Digit0': return e.shiftKey ? null : { kind: 'offset-reset' };
      case 'ArrowUp': return e.shiftKey ? null : { kind: 'move', delta: 10 };
      case 'ArrowDown': return e.shiftKey ? null : { kind: 'move', delta: -10 };
      case 'KeyF': return e.shiftKey ? null : { kind: 'fullscreen' };
      case 'KeyR': return e.shiftKey ? null : { kind: 'repeat' };
      default: return null;
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat && e.code === 'KeyF') return;
    const action = actionFor(e);
    // In our own fullscreen a plain F leaves it, as in any player. Without this the
    // site's own F handler stacks its fullscreen on top of ours.
    if (!action && e.code === 'KeyF' && ownFullscreen && document.fullscreenElement === ownFullscreen.container
        && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !isTyping(e)) {
      document.exitFullscreen().catch(() => {});
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (!action || isTyping(e)) return;
    if (cues.length) runAction(action);
    else if (tabHasSubs) send({ type: 'forward-key', action });
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  function fmtOffset(ms) {
    return (ms > 0 ? '+' : ms < 0 ? '−' : '') + (Math.abs(ms) / 1000).toFixed(1) + ' s';
  }

  async function runAction(a) {
    if (a.kind === 'offset' || a.kind === 'offset-reset') {
      // Update locally first so fast repeated presses add up before the save lands.
      settings.offset = SubSettings.clamp('offset', a.kind === 'offset' ? settings.offset + a.delta : 0);
      SubSettings.save({ offset: settings.offset });
      rememberSoon();
      toast(t('Sync: {offset}', { offset: fmtOffset(settings.offset) }));
      render(true);
    } else if (a.kind === 'toggle') {
      // Anything showing -> all off; all off -> both back on.
      const on = !(visible || (dualVisible && dualOn()));
      visible = dualVisible = on;
      lastKey = '';
      position(true);
      render(true);
      if (langsEl && langsEl.classList.contains('on')) showLangs();
      toast(t(on ? 'Subtitles on' : 'Subtitles off'));
    } else if (a.kind === 'move') {
      if (settings.place === 'middle') return toast(t('Position: middle'));
      // At the top the distance counts down from the top edge, so "up" makes it smaller.
      const delta = settings.place === 'top' ? -a.delta : a.delta;
      settings.bottom = SubSettings.clamp('bottom', settings.bottom + delta);
      SubSettings.save({ bottom: settings.bottom });
      position(true);
      toast(t('Position: {n} px', { n: settings.bottom }));
    } else if (a.kind === 'fullscreen') {
      toggleFullscreen();
    } else if (a.kind === 'repeat') {
      repeatLine();
    }
  }

  // Jumps back to the start of the line on screen and plays it again. Within
  // the first moment of a line (or between lines) it repeats the one before,
  // the line you just heard.
  function repeatLine() {
    if (!video) return;
    const now = video.currentTime * 1000 - settings.offset;
    const shows = (c) => !settings.hideSounds || !!SubLib.cleanCaption(c.text);
    let i = lastStart(now, cues);
    if (i >= 0 && cues[i].end > now && now - cues[i].start < 800) i--;
    while (i >= 0 && !shows(cues[i])) i--;
    if (i < 0) return toast(t('No line to repeat'));
    video.currentTime = Math.max(0, (cues[i].start + settings.offset + 1) / 1000);
    if (video.paused) video.play().catch(() => {});
    toast('\u21ba ' + t('Repeat'), 800);
  }

  // ---------- click to copy ----------

  function lineText(c) {
    const text = settings.hideSounds ? SubLib.cleanCaption(c.text) : c.text;
    return SubLib.toRuns(text).map((r) => r.text).join('').replace(/\s*\n\s*/g, ' ').trim();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Player frames from another site may not get the clipboard API: the old way still works on a click.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.documentElement.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { /* blocked */ }
      ta.remove();
      return ok;
    }
  }

  // ---------- drag and drop ----------

  function videoAt(x, y) {
    return findVideos().find((v) => {
      const r = v.getBoundingClientRect();
      return r.width > 50 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
  }

  let dropVideo = null;
  document.addEventListener('dragover', (e) => {
    if (off || !e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    const v = videoAt(e.clientX, e.clientY);
    if (!v) return hideDrop();
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (dropVideo !== v) {
      dropVideo = v;
      if (video !== v) { if (!cues.length) attach(v); }
      ensureHost();
      dropEl.classList.add('on');
      position(true);
    }
  }, true);
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) hideDrop(); }, true);
  function hideDrop() {
    dropVideo = null;
    if (dropEl) dropEl.classList.remove('on');
  }

  document.addEventListener('drop', async (e) => {
    if (!dropVideo) return;
    const v = dropVideo;
    hideDrop();
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files[0];
    if (!f || !/\.(srt|vtt)$/i.test(f.name)) return toast(t('Drop an .srt or .vtt file'));
    const bytes = new Uint8Array(await f.arrayBuffer());
    pinned = v;
    const res = loadBytes(f.name, SubLib.bytesToBase64(bytes), 'auto', v);
    if (!res.ok) toast(res.error);
  }, true);

  // ---------- "Subtitles found" card ----------

  // Subtitle files the page just loaded (seen by the background worker),
  // offered with one-click buttons right on the video.
  // The card waits until you actually watch something: a video playing with
  // sound. Feeds like Reddit preload and autoplay muted previews, whose
  // subtitle tracks would otherwise pop up while you only scroll. Files seen
  // more than a minute before that are dropped (they belong to other posts).
  const found = [];
  const waiting = []; // { item, t }
  let foundTimer = 0;
  const WAIT_MS = 60000;

  const watched = () => findVideos().find((v) => isPlaying(v) && !v.muted && v.volume > 0 && area(v) > 0);

  const shownIds = new Set(); // found files already offered or used here, so retries don't repeat them
  let waitTimer = 0;

  function showFound(item) {
    if (off) return true; // "shown" so nobody keeps retrying
    if (!findVideos().length) return false;
    if (shownIds.has(item.id)) return true;
    if (!waiting.some((w) => w.item.id === item.id)) waiting.push({ item, t: Date.now() });
    flushFound();
    // Not watching yet (the player still starting, muted, buffering): check every
    // second too, in case the "playing" event already passed.
    if (waiting.length && !waitTimer) {
      waitTimer = setInterval(() => {
        flushFound();
        if (!waiting.length || waiting.every((w) => Date.now() - w.t > WAIT_MS)) { clearInterval(waitTimer); waitTimer = 0; }
      }, 1000);
    }
    return true;
  }

  function flushFound() {
    if (!waiting.length) return;
    const v = watched();
    if (!v) return;
    const fresh = waiting.splice(0).filter((w) => Date.now() - w.t < WAIT_MS);
    if (!fresh.length) return;
    for (const w of fresh) shownIds.add(w.item.id);
    if (!video) attach(v);
    ensureHost();
    for (const w of fresh) if (!found.some((f) => f.id === w.item.id)) found.unshift(w.item);
    found.length = Math.min(found.length, 3);
    // Automatic mode: the newest file goes straight onto the video, translated.
    // A file you loaded yourself is never replaced.
    if (prefs.autoTranslate && (!cues.length || autoLoaded)) autoShow(fresh[fresh.length - 1].item);
    else renderFound();
    position(true);
  }

  // No card here: the toast at the top says "Translating…" and then
  // "Translated to …". Only a failure opens the card, with its buttons.
  async function autoShow(item) {
    const lang = SubSettings.languageName(prefs.translateTo);
    toast(t('Translating to {lang}…', { lang }), 15000);
    let message;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'fetch-item', id: item.id });
      if (!res || !res.ok) throw new Error(res ? res.error : t('Failed.'));
      const r = loadBytes(res.name, res.b64, 'auto', video || pickVideo());
      if (!r.ok) throw new Error(r.error);
      autoLoaded = true;
      const done = await translate(prefs.translateTo);
      if (!done.ok) throw new Error(done.error);
      return;
    } catch (e) {
      message = t('Automatic translation didn’t work: {error}', { error: e.message });
    }
    renderFound(message);
  }

  // Media events don't bubble, so listen in the capture phase.
  document.addEventListener('playing', flushFound, true);
  document.addEventListener('volumechange', flushFound, true);

  function renderFound(message) {
    const head = el('div', 'found-head');
    head.append(el('span', '', t(found.length > 1 ? 'Subtitles found on this page' : 'Subtitles found')));
    const close = el('button', 'x', '×');
    close.title = t('Close');
    close.addEventListener('click', hideFound);
    head.append(close);
    const rows = found.map((item) => {
      const row = el('div', 'found-row');
      if (item.lang) row.append(el('span', 'found-lang', (SubSettings.flag(item.lang) + ' ' + item.lang).trim()));
      const episode = window === window.top ? pageTitle() : '';
      const name = el('span', 'found-name', episode || item.name);
      name.title = episode ? episode + ' (' + item.name + ')' : item.name;
      const dl = el('button', 'main', t('Download .srt'));
      dl.addEventListener('click', () => foundAction(dl, dl.textContent, { type: 'convert-item', id: item.id, format: 'srt' },
        (res) => {
          SubLib.saveText(res.text, res.filename);
          return { text: t('Saved to Downloads ({n} lines)', { n: res.count }), translate: true, saved: true };
        }));
      const use = el('button', '', t('Show over video'));
      use.addEventListener('click', () => foundAction(use, use.textContent, { type: 'fetch-item', id: item.id }, (res) => {
        const r = loadBytes(res.name, res.b64, 'auto', video || pickVideo());
        if (!r.ok) throw new Error(r.error);
        return t('Showing {n} lines.', { n: r.count }) + offHint();
      }));
      const tr = el('button', '', t('Translate to {lang}', { lang: SubSettings.languageName(prefs.translateTo) }));
      tr.title = t('Shows these subtitles over the video, translated by Google Translate. Change the language in the extension popup.');
      tr.addEventListener('click', () => foundAction(tr, tr.textContent, { type: 'fetch-item', id: item.id }, async (res) => {
        const r = loadBytes(res.name, res.b64, 'auto', video || pickVideo());
        if (!r.ok) throw new Error(r.error);
        const done = await translate(prefs.translateTo);
        if (!done.ok) throw new Error(done.error);
        return t('Showing {n} lines in {lang}.', { n: done.count, lang: SubSettings.languageName(prefs.translateTo) }) + offHint();
      }));
      row.append(name, dl, use, tr);
      return row;
    });
    foundEl.replaceChildren(head, ...rows);
    if (message) {
      const line = el('div', 'found-msg');
      line.append(el('span', message.saved ? 'saved' : '', message.text || message));
      if (message.translate) {
        const tr = el('button', '', 'translate-subtitles.com \u2197');
        tr.title = t('Opens translate-subtitles.com. Upload the downloaded file there.');
        tr.addEventListener('click', () => send({ type: 'open-translator' }));
        line.append(tr);
      }
      foundEl.append(line);
    }
    foundEl.classList.add('on');
    clearTimeout(foundTimer);
    foundTimer = setTimeout(hideFound, message ? 12000 : 20000);
  }

  async function foundAction(button, label, msg, done) {
    button.disabled = true;
    button.textContent = '…';
    let message;
    try {
      const res = await chrome.runtime.sendMessage(msg);
      if (!res || !res.ok) throw new Error(res ? res.error : t('Failed.'));
      message = await done(res);
    } catch (e) {
      message = t('Didn’t work: {error}', { error: e.message });
    }
    renderFound(message);
  }

  function hideFound() {
    clearTimeout(foundTimer);
    if (foundEl) foundEl.classList.remove('on');
    found.length = 0;
  }

  // ---------- popup / background messages ----------

  function videoList() {
    const current = video && cues.length ? video : pickVideo();
    return findVideos().map((v, index) => {
      const r = v.getBoundingClientRect();
      const tracks = [...v.textTracks].map((t, ti) => ({
        index: ti, label: t.label, language: t.language, kind: t.kind,
        count: t.cues ? t.cues.length : 0,
        preview: t.cues && t.cues.length ? String(t.cues[0].text || '').split('\n')[0] : '',
      })).filter((t) => t.count > 0);
      return {
        index, width: Math.round(r.width), height: Math.round(r.height), visible: area(v) > 0,
        playing: isPlaying(v), current: v === current, tracks,
      };
    }).filter((x) => x.visible || x.tracks.length);
  }

  // The episode or film name, for the found-subtitles cards. Players that
  // fill the system media controls know it best, then the page's share title,
  // then the tab title without a trailing " | Site name".
  function pageTitle() {
    let t = '';
    try { t = (navigator.mediaSession && navigator.mediaSession.metadata && navigator.mediaSession.metadata.title) || ''; } catch (e) { /* ignore */ }
    if (!t) {
      const og = document.querySelector('meta[property="og:title"], meta[name="twitter:title"]');
      t = (og && og.content) || document.title || '';
    }
    const host = location.hostname.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const parts = t.split(/\s+[|\u2013\u2014\-\u00b7]\s+/);
    if (parts.length > 1) {
      const last = parts[parts.length - 1].replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (last && host.includes(last)) parts.pop();
    }
    return parts.join(' \u00b7 ').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function report() {
    return {
      title: pageTitle(),
      url: location.href,
      host: location.hostname,
      top: window === window.top,
      videos: videoList(),
      siteHidden: siteHiddenLog.slice(0, 4),
      siteVisible: siteSeen,
      loaded: cues.length ? {
        name: (original ? original.file : file).name, count: cues.length,
        encoding: (original ? original.file : file).encoding, usedEncoding: (original ? original.file : file).usedEncoding,
        translatedTo: original ? file.translatedTo : '',
      } : null,
    };
  }

  // Cues from the video's own text tracks (method 1 of capture), as WebVTT text.
  function trackAsVtt(videoIndex, trackIndex) {
    const v = findVideos()[videoIndex];
    const t = v && v.textTracks[trackIndex];
    if (!t || !t.cues) return null;
    const list = [...t.cues].map((c) => ({ start: Math.round(c.startTime * 1000), end: Math.round(c.endTime * 1000), text: c.text || '' }));
    return SubLib.toVTT(list);
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (off && (msg.type === 'load' || msg.type === 'translate')) {
      reply({ ok: false, error: t('Subtitle Overlay is turned off on this site.') });
      return;
    }
    switch (msg.type) {
      case 'load': {
        const v = msg.videoIndex != null ? findVideos()[msg.videoIndex] : null;
        if (v) pinned = v;
        reply(loadBytes(msg.name, msg.b64, msg.encoding, v));
        return;
      }
      case 'set-encoding': {
        if (!file) return reply({ ok: false, error: t('Nothing loaded.') });
        const src = original ? original.file : file; // a new encoding starts again from the original
        reply(loadBytes(src.name, src.b64, msg.encoding, video));
        return;
      }
      case 'use-font':
        // The popup waits for this to say "on the video".
        SubRender.ensureFont(document, msg.font)
          .then(() => { position(true); reply({ ok: true }); }, (e) => reply({ ok: false, error: e.message }));
        return true;
      case 'clear':
        clearSubs();
        forgetPage();
        reply({ ok: true });
        return;
      case 'translate':
        translate(msg.to).then(reply);
        return true;
      case 'show-original':
        showOriginal();
        reply({ ok: true });
        return;
      case 'export':
        reply(file ? { name: file.name, b64: file.b64, encoding: file.encoding } : null);
        return;
      case 'select-video': {
        const v = findVideos()[msg.index];
        if (!v) return reply({ ok: false });
        pinned = v;
        if (cues.length) attach(v);
        reply({ ok: true });
        return;
      }
      case 'track-vtt':
        reply({ text: trackAsVtt(msg.videoIndex, msg.trackIndex) });
        return;
      case 'run-action':
        if (cues.length) runAction(msg.action);
        return;
      case 'subs-found':
        reply({ shown: showFound(msg.item) });
        return;
      case 'tab-subs':
        tabHasSubs = msg.has;
        return;
      case 'fetch-url':
        // Fallback download from inside the page, with the page's own cookies.
        fetch(msg.url, { credentials: 'include' })
          .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
          .then((buf) => reply({ ok: true, b64: SubLib.bytesToBase64(new Uint8Array(buf)) }))
          .catch((e) => reply({ ok: false, error: String(e.message || e) }));
        return true;
    }
  });

  // YouTube's CC button also switches our subtitles, when they are YouTube's
  // captions: off hides them, on shows them again (like Alt + S).
  const fromYouTube = () => { const f = original ? original.file : file; return !!f && /^youtube-/.test(f.name || ''); };
  if (/(^|\.)youtube\.com$/.test(location.hostname)) {
    let ccButton = null;
    let ytPlayer = null;
    const barWatch = new MutationObserver(liftForControls);
    const ccWatch = new MutationObserver(() => {
      if (off || !cues.length || !fromYouTube()) return;
      const on = ccButton.getAttribute('aria-pressed') === 'true';
      if (on !== (visible || dualVisible)) { visible = dualVisible = on; position(true); render(true); }
    });
    // The player (and its button) can be rebuilt when YouTube changes videos.
    setInterval(() => {
      const p = video && video.closest && video.closest('.html5-video-player');
      if (p && p !== ytPlayer) {
        barWatch.disconnect();
        ytPlayer = p;
        barWatch.observe(p, { attributes: true, attributeFilter: ['class'] });
        liftForControls();
      }
      const b = document.querySelector('.ytp-subtitles-button');
      if (!b || b === ccButton) return;
      ccWatch.disconnect();
      ccButton = b;
      ccWatch.observe(b, { attributes: true, attributeFilter: ['aria-pressed'] });
    }, 1000);
  }

  // YouTube: caption files copied from the player by youtube-hook.js.
  document.addEventListener('subtitle-overlay-yt', (e) => {
    if (off || typeof e.detail !== 'string') return;
    try {
      const { url, text } = JSON.parse(e.detail);
      send({ type: 'yt-captions', url, text });
    } catch (err) { /* ignore */ }
  });
  document.dispatchEvent(new CustomEvent('subtitle-overlay-yt-ask'));

  window.__subOverlay = { report };
  SubSettings.loadOffSites().then((list) => {
    off = SubSettings.isOff(list, site);
    if (off) return;
    checkRestore();
    // Subtitles the player loaded before this script started (a busy page can take
    // seconds to get here): offer them now instead of losing them.
    if (window === window.top || findVideos().length) {
      send({ type: 'recent-found' }).then((items) => { for (const item of items || []) showFound(item); });
    }
  });
})();
