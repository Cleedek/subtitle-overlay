// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Cleedek

// Runs in every page and frame. Finds the video, draws the subtitle layer on
// top of it and keeps it in sync with the video's own clock.
(function () {
  'use strict';
  if (window.__subOverlay) return;

  const { SubLib, SubSettings, SubRender, SubI18n } = globalThis;
  const t = SubI18n.t;
  const uiReady = SubI18n.load();

  let settings = Object.assign({}, SubSettings.DEFAULTS);
  let cues = [];          // loaded subtitle lines, sorted by start (ms)
  let file = null;        // { name, b64, encoding, usedEncoding } of the loaded file
  let loadedOn = '';      // the page address the file was loaded on (Prima+ changes it without reloading)
  let stashed = null;     // previous subtitles after a video swap, for "Restore"
  let original = null;    // { file, cues } of the untranslated subtitles while a translation shows
  const translations = new Map(); // language -> translated cues, so switching back is instant
  // YouTube's automatic captions fixed by the AI in their own language (no translation):
  // shown and saved like a translation into that language, with another prompt.
  const cleaned = new WeakSet();
  let prefs = Object.assign({}, SubSettings.TRANSLATION); // language, automatic mode, hide the site's subtitles
  let autoLoaded = false; // the subtitles on screen came from automatic mode (a newer file may replace them)
  let siteFile = false; // they came from the site by themselves, or back from last time (shortForSubs)
  let prefsLoaded = false;
  let video = null;       // the video the overlay follows
  let pinned = null;      // video chosen by hand in the popup
  let visible = true;     // the main subtitles; the shortcut (Alt + S by default) hides or shows both
  let dualVisible = true; // the second subtitles, switched apart in the language panel over the video
  let shownBefore = null; // which of the two were on before everything was hidden at once
  let shortcuts = SubSettings.defaultShortcuts(); // every shortcut, changeable in the popup
  let origLang = '';      // the original's language: from the site, the file, Chrome on this computer, or Google
  let langPending = null; // while Chrome is still recognising it (findOrigLang)
  let tabHasSubs = false; // some frame in this tab has subtitles (for shortcut forwarding)
  let lastSrc = '';
  let srcPending = false; // the subtitles were put on a video with no source yet: its first one is theirs
  let lastAdAt = 0;
  let lastKey = '';
  let lastGeom = '';
  let raf = 0;
  let watchTimer = 0;
  let bareFullscreen = false;
  let ownFullscreen = null; // { container, videoStyle } while our own fullscreen is on
  let off = false;        // turned off on this site from the popup: offer, show and restore nothing
  let askEl = null;       // the one-time support card under the language switches
  let shareEl = null;     // the one-time "share it with others?" card, in the same place

  // The site is the tab's address, also inside a player frame from another domain.
  const topUrl = window === window.top ? location.href
    : (location.ancestorOrigins && location.ancestorOrigins.length ? location.ancestorOrigins[location.ancestorOrigins.length - 1] : location.href);
  const site = SubSettings.siteOf(topUrl);

  // ---------- storage ----------

  SubSettings.load().then((s) => { settings = s; refreshStyle(); });
  const prefsReady = SubSettings.loadTranslation().then((p) => { prefs = p; prefsLoaded = true; });
  SubSettings.loadShortcuts().then((k) => { shortcuts = k; refreshFsKey(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.shortcuts || changes.toggleKey || changes.keyLayout)) SubSettings.loadShortcuts(!!changes.keyLayout).then((k) => { shortcuts = k; refreshFsKey(); });
    if (area === 'local' && changes.offSites) setOff(SubSettings.isOff(changes.offSites.newValue, site));
    if (area === 'local') {
      for (const k of Object.keys(SubSettings.TRANSLATION)) {
        if (changes[k]) prefs[k] = changes[k].newValue != null ? changes[k].newValue : SubSettings.TRANSLATION[k];
      }
      if (changes.secondLang && cues.length) { wantSecond(); ensureSecond(); lastKey = ''; position(true); render(true); refreshLangs(); }
      if (['translator', 'geminiKey', 'geminiModel', 'claudeKey', 'claudeModel', 'openaiKey', 'openaiModel', 'localUrl', 'localModel'].some((k) => changes[k])) aiChanged();
    }
    if (area !== 'local' || !changes.settings) return;
    const offsetBefore = settings.offset, dualBefore = settings.dual;
    settings = SubSettings.withDefaults(changes.settings.newValue);
    if (file && settings.offset !== offsetBefore) rememberSoon();
    if (settings.dual && !dualBefore && cues.length) wantSecond();
    if (!settings.dual && dualBefore && cues.length) wantMain();
    refreshStyle();
  });

  // Dual subtitles turned on, or another second language picked, in the popup:
  // they show, also on a page where they were switched off over the video.
  function wantSecond() {
    if (shownBefore) shownBefore.dualVisible = true; else dualVisible = true;
    if (file) rememberSoon();
  }
  // Dual subtitles turned off with the main ones switched off over the video:
  // they come back, as nothing else would show and the card has no switch then.
  function wantMain() {
    const was = shownBefore || { visible, dualVisible };
    if (was.visible || !was.dualVisible) return; // all hidden (Alt + S, the CC button) stays so
    if (shownBefore) shownBefore.visible = true; else visible = true;
    if (file) rememberSoon();
  }

  // Turning off removes our subtitles and the card at once; turning back on
  // needs nothing: the next subtitles the site loads are offered again.
  function setOff(value) {
    if (value === off) return;
    off = value;
    if (!off) return;
    restorePending = null;
    waiting.length = 0;
    offered = null;
    hideFound();
    hideRestore();
    clearSubs();
    forgetPage();
  }

  // The subtitles of each page are kept on this computer (storage.local), with
  // their sync, so a later visit can bring them back. A mark in session storage
  // says they were already showing in this browser session: then a reload
  // restores them at once, a later visit only offers them (in automatic mode
  // a YouTube video, and any page whose file is found again, gets them back
  // at once: checkRestore, autoShow).
  // A YouTube video is one page whatever else its address holds (SubSettings.pageOf).
  const pageKey = (page = SubSettings.pageOf(location.href)) => 'page:' + page;
  const memKey = (page = SubSettings.pageOf(location.href)) => 'mem:' + page;
  const MEM_PAGES = 30;
  const SECOND_KEEP = 24 * 3600 * 1000; // as in background.js, which deletes it after that

  // This page's record. One saved before YouTube addresses were tidied up sits under the full address.
  async function memRecord() {
    const keys = [memKey(), 'mem:' + location.href];
    const got = await chrome.storage.local.get(keys);
    return got[keys[0]] || got[keys[1]] || null;
  }

  // The page the subtitles on screen belong to. YouTube's own captions name
  // their video ("youtube-<id>.en"): its address changes as soon as you click
  // another video, a moment before they go.
  const ytPage = (id) => 'https://www.youtube.com/watch?v=' + id;
  function pageOfSubs() {
    const m = /^youtube-([\w-]{11})(?:\.|$)/.exec(baseOf().file ? baseOf().file.name : '');
    // Elsewhere the page they were loaded on: a site that opens the next episode
    // without loading a new page (Prima+) must not get the previous episode's subtitles.
    return m ? ytPage(m[1]) : SubSettings.pageOf(loadedOn || location.href);
  }

  async function rememberFile() {
    if (!file) return;
    const page = pageOfSubs();
    const record = Object.assign({ t: Date.now(), offset: settings.offset }, file);
    // The video's length: on a later visit they come back by themselves only on one as long (checkRestore).
    if (video && Number.isFinite(video.duration) && video.duration > 0) record.dur = Math.round(video.duration);
    // The second language of dual subtitles comes along once you asked the AI
    // to improve it, for a day after it was last saved (a reload carries on and
    // shouldn't redo that work).
    const lang = prefs.secondLang;
    const second = lang && lang !== 'orig' && lang !== (original && file.translatedTo) && translations.get(lang);
    const ai = second && aiState.get(second);
    if (ai) {
      record.second = { t: record.t, lang, b64: SubLib.bytesToBase64(new TextEncoder().encode(SubLib.toSRT(second))),
        ai: { model: ai.model, done: ai.done, chunks: [...ai.chunks], stopped: ai.stopped, ms: ai.ms || 0, kept: ai.kept || 0, shared: ai.shared || null } };
    }
    // A language switched off over the video stays off after a reload (hiding
    // everything at once with the shortcut or YouTube's CC button doesn't count).
    const sw = shownBefore || { visible, dualVisible };
    if (!sw.visible || !sw.dualVisible) record.off = { main: !sw.visible, second: !sw.dualVisible };
    try { await chrome.storage.session.set({ [pageKey(page)]: { t: record.t } }); } catch (e) { /* reload just won't restore */ }
    // Newest first; everything past `keep` is removed.
    const prune = async (keep) => {
      const all = await chrome.storage.local.get(null);
      const pages = Object.keys(all).filter((k) => k.startsWith('mem:')).sort((a, b) => all[b].t - all[a].t);
      if (pages.length > keep) await chrome.storage.local.remove(pages.slice(keep));
    };
    try {
      await chrome.storage.local.set({ [memKey(page)]: record });
      await prune(MEM_PAGES);
    } catch (e) {
      // Storage full: keep only the newest few pages and try once more.
      try { await prune(5); await chrome.storage.local.set({ [memKey(page)]: record }); } catch (e2) { /* not remembered */ }
    }
  }

  function forgetPage() {
    try { chrome.storage.session.remove(pageKey()); } catch (e) { /* ignore */ }
    try { chrome.storage.local.remove([memKey(), 'mem:' + location.href]); } catch (e) { /* ignore */ }
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

  // The extension's background part can stop (Chrome failed to restart it, or
  // the extension was reloaded while this page stayed open). Found subtitles
  // then go nowhere and nothing showed why, so say it on the video, once.
  const isDeadError = (m) => /Receiving end does not exist|Could not establish connection|Extension context invalidated/i.test(String(m || ''));
  let deadWarned = false;
  function warnDead() {
    if (deadWarned) return;
    deadWarned = true;
    if (!video) { const v = liveVideo(); if (v) attach(v); }
    if (video) toast(t('Subtitle Overlay stopped working. Click its icon, press Restart, then reload this page.'), 12000);
  }
  // Reloading the extension leaves this copy running on pages already open,
  // next to nothing it can reach any more, while a reload of the page brings the
  // new one. Its subtitles, cards and messages would sit over the new copy's, so
  // it takes them off the page and stays quiet (it keeps nothing it remembered).
  const orphaned = () => { try { return !chrome.runtime || !chrome.runtime.id; } catch (e) { return true; } };
  const orphanTimer = setInterval(() => {
    if (!orphaned()) return;
    clearInterval(orphanTimer);
    off = true;
    if (host) host.remove();
  }, 2000);
  function sendOrWarn(msg) {
    try {
      // A stopped worker either fails at once or never answers (a live one settles at once, reply or not).
      const timer = setTimeout(warnDead, 5000);
      return chrome.runtime.sendMessage(msg).then(() => clearTimeout(timer), (e) => {
        clearTimeout(timer);
        if (isDeadError(e && e.message)) warnDead();
      });
    } catch (e) {
      if (isDeadError(e && e.message)) warnDead();
      return Promise.resolve();
    }
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

  // The video the subtitles are on, unless it went away or hides (an ad that ended).
  const liveVideo = () => (video && video.isConnected && area(video) ? video : pickVideo());
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

  let host, shadow, picEl, subsEl, dualEl, toastEl, hintEl, restoreEl, fsBtn, fsKeyEl, dropEl, foundEl, siteNoteEl, langsEl;

  function ensureHost() {
    if (host) { host.toggleAttribute('data-rtl', SubI18n.rtl); return; }
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
      :host([data-rtl]) :is(.toast, .hint, .fs, .drop, .found, .langs, .ask) { direction: rtl; }
      :host([data-rtl]) .langs button[aria-checked=true] .sw::after { transform: translateX(-12px); }
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
        background: rgba(20,20,20,.92); padding-block: 10px; padding-inline: 12px 10px; border-radius: 12px;
        font: 600 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff;
      }
      .found.on { display: flex; }
      .found-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .found-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .found-name { flex: 1 1 120px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; opacity: .85; }
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
        border: 0; border-radius: 8px; padding-block: 6px; padding-inline: 10px 8px; cursor: pointer; text-align: start;
      }
      .langs button:hover { background: rgba(255,255,255,.12); }
      .langs .name { flex: 1; white-space: nowrap; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
      .langs button[aria-checked=false] .name { opacity: .55; }
      .langs .sw { position: relative; flex: none; width: 28px; height: 16px; border-radius: 999px; background: rgba(255,255,255,.28); transition: background .15s; }
      .langs .sw::after { content: ""; position: absolute; top: 2px; inset-inline-start: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: transform .15s; }
      .langs button[aria-checked=true] .sw { background: #7a41e4; }
      .langs button[aria-checked=true] .sw::after { transform: translateX(12px); }
      /* How far the AI pass got: model and share, a bar, then the line count or what stopped it. */
      .langs .ai { display: flex; flex-direction: column; gap: 5px; padding: 6px 10px 7px; max-width: 240px; }
      .langs button + .ai { border-top: 1px solid rgba(255,255,255,.12); margin-top: 2px; padding-top: 8px; }
      /* The report link at the bottom, set apart by a line: it isn't part of any language.
         (Here, not in the wizard's styles, which load only once the wizard opens.) */
      .langs .report { justify-content: center; font-size: 11.5px; font-weight: 500; opacity: .7; padding-block: 7px 5px; border-top: 1px solid rgba(255,255,255,.12); border-radius: 0 0 8px 8px; margin-top: 2px; }
      .langs .report:hover { opacity: 1; }
      .ai-head { display: flex; align-items: baseline; gap: 12px; }
      .ai-head .pct { font-variant-numeric: tabular-nums; }
      /* The name stops at 200 px, so the share or check is pushed to the end of the bar itself. */
      .ai-head .pct, .ai-check { margin-inline-start: auto; }
      .ai-check { color: #86efac; font-weight: 700; }
      .ai.done .ai-bar span { background: #86efac; }
      .ai-bar { height: 4px; border-radius: 999px; background: rgba(255,255,255,.18); overflow: hidden; }
      .ai-bar span { display: block; height: 100%; border-radius: inherit; background: #7a41e4; }
      .ai.running .ai-bar span { animation: ai-pulse 1.4s ease-in-out infinite; }
      @keyframes ai-pulse { 50% { opacity: .5; } }
      .ai.waiting .ai-bar span { width: 38%; animation: ai-sweep 1.6s ease-in-out infinite; }
      @keyframes ai-sweep { from { transform: translateX(-100%); } to { transform: translateX(270%); } }
      @media (prefers-reduced-motion: reduce) { .ai.running .ai-bar span { animation: none; } }
      .ai-foot { display: flex; align-items: center; gap: 10px; }
      .ai-note { flex: 1; font-weight: 500; font-size: 11.5px; opacity: .7; }
      .langs .ai-act { flex: none; padding: 3px 9px; border-radius: 999px; background: rgba(255,255,255,.14); font-size: 11.5px; }
      .langs .ai-act:hover { background: rgba(255,255,255,.24); }
      .langs .ai-act.main { background: #7a41e4; }
      .langs .ai-act.main:hover { background: #8b55f0; }
      .langs .ai-act.ghost { background: transparent; color: rgba(255,255,255,.6); }
      .langs .ai-act.ghost:hover { background: rgba(255,255,255,.12); color: #fff; }
      .ai-foot.wrap { flex-wrap: wrap; gap: 6px; }
      .shared-chip { margin-inline-start: auto; flex: none; padding: 1px 6px; border-radius: 5px; background: rgba(134,239,172,.16); color: #86efac; font-size: 10.5px; font-weight: 650; letter-spacing: .02em; text-transform: uppercase; }
      .ai.error .ai-note { color: #fca5a5; opacity: 1; }
      /* A problem gets the whole width, its button goes under it. */
      .ai.error .ai-foot, .ai-foot.stack { flex-direction: column; align-items: flex-start; gap: 7px; }
      .ai-acts { display: flex; gap: 6px; }
      .langs .ai.error .ai-acts .ai-act:first-child { background: #7a41e4; }
      .langs .ai.error .ai-acts .ai-act:first-child:hover { background: #8b55f0; }
      .found-msg .saved::before { content: "\\2713"; color: #86efac; font-weight: 700; margin-inline-end: 6px; }
      /* The one-time "support the creator" card, under the language switches (same dark card). */
      .ask {
        position: absolute; top: 12px; right: 12px; display: none; flex-direction: column; gap: 10px; width: 300px;
        pointer-events: auto; background: rgba(20,20,20,.92); padding: 14px 12px 10px; border-radius: 12px;
        font: 500 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff; box-shadow: 0 12px 32px -8px rgba(0,0,0,.6);
      }
      .langs.on ~ .ask.on { display: flex; animation: ask-in .4s cubic-bezier(.25, 1, .5, 1) both; }
      .found.on ~ .ask { display: none !important; }
      @keyframes ask-in { from { opacity: 0; transform: translateY(-6px) scale(.98); } }
      @media (prefers-reduced-motion: reduce) { .langs.on ~ .ask.on { animation: none; } }
      .ask a, .ask button { font: inherit; color: #fff; text-decoration: none; cursor: pointer; }
      .ask svg { flex: none; }
      .ask .x { position: absolute; top: 8px; inset-inline-end: 8px; display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 7px; background: transparent; color: rgba(255,255,255,.6); }
      .ask .x:hover { background: rgba(255,255,255,.14); color: #fff; }
      .ask .hello { display: flex; flex-direction: column; gap: 3px; padding-inline-end: 24px; }
      .ask .hello strong { font-size: 14.5px; font-weight: 700; }
      .ask .hello span { font-size: 12px; color: rgba(255,255,255,.72); line-height: 1.45; }
      .ask .intro { margin: 0; padding-top: 10px; border-top: 1px solid rgba(255,255,255,.12); font-size: 12px; color: rgba(255,255,255,.72); line-height: 1.45; }
      .ask .tile { display: flex; flex-direction: column; gap: 10px; padding: 11px; border-radius: 10px; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); }
      .ask .who { display: flex; align-items: center; gap: 10px; }
      .ask .who img { flex: none; width: 38px; height: 38px; border-radius: 50%; object-fit: cover; box-shadow: 0 0 0 2px rgba(255,255,255,.14); }
      .ask .who div { display: flex; flex-direction: column; gap: 1px; line-height: 1.3; }
      .ask .who strong { font-weight: 650; font-size: 13.5px; }
      .ask .who span { font-size: 11.5px; color: rgba(255,255,255,.65); }
      .ask .logos { display: block; width: 200px; height: auto; max-width: 100%; }
      .ask .main { display: flex; align-items: center; justify-content: center; gap: 7px; padding: 9px 12px; border-radius: 8px; background: #7c3aed; font-weight: 650; font-size: 13.5px; }
      .ask .main:hover { background: #8b5cf6; }
      .ask .main:active { transform: scale(.985); }
      .ask .more { font-size: 11px; color: rgba(255,255,255,.6); }
      .ask .minor { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
      .ask .minor > * { display: flex; align-items: center; gap: 8px; padding: 8px 9px; border: 0; border-radius: 9px; background: rgba(255,255,255,.1); text-align: start; }
      .ask .minor > *:hover { background: rgba(255,255,255,.18); }
      .ask .minor svg { color: rgba(255,255,255,.7); }
      .ask .minor div { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
      .ask .minor b { font-weight: 600; font-size: 12.5px; }
      .ask .minor small { font-size: 10.5px; color: rgba(255,255,255,.55); }
      .ask .gh { display: inline-flex; align-items: center; justify-content: center; gap: 6px; align-self: center; padding: 2px 8px; color: rgba(255,255,255,.65); font-size: 11.5px; text-decoration: underline; text-decoration-color: rgba(255,255,255,.3); text-underline-offset: 3px; }
      .ask .gh:hover { color: #fff; text-decoration-color: currentColor; }
      .ask .once { margin: -2px 0 0; text-align: center; font-size: 10.5px; color: rgba(255,255,255,.5); }
      .ask .compact { display: none; }
      /* A smaller video (under 500 px tall): the photo, one sentence, the button and small links. */
      .ask.compact { width: 280px; padding: 10px; gap: 8px; }
      /* "Share it with others?" (same card as the support one). */
      .ask.share .title { font-size: 14.5px; font-weight: 700; padding-inline-end: 24px; line-height: 1.3; }
      .ask.share p { margin: 0; font-size: 12px; color: rgba(255,255,255,.75); line-height: 1.45; }
      .ask.share .info { display: flex; gap: 8px; align-items: flex-start; padding: 8px 9px; border-radius: 9px; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.1); font-size: 11.5px; line-height: 1.45; color: rgba(255,255,255,.78); }
      .ask.share .info svg { flex: none; margin-top: 1px; color: rgba(255,255,255,.6); }
      .ask.share .info a { color: #fff; text-decoration: underline; }
      .ask.share .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
      .ask.share .pair button { justify-content: center; padding: 9px 12px; border: 0; border-radius: 8px; background: rgba(255,255,255,.12); font-weight: 650; font-size: 13.5px; }
      .ask.share .pair button:hover { background: rgba(255,255,255,.2); }
      .ask.share .pair button.main { background: #7c3aed; }
      .ask.share .pair button.main:hover { background: #8b5cf6; }
      .ask.share .never { align-self: center; border: 0; background: none; padding: 2px 6px; font-size: 11.5px; color: rgba(255,255,255,.55); text-decoration: underline; text-decoration-color: rgba(255,255,255,.25); text-underline-offset: 3px; }
      .ask.share .never:hover { color: #fff; }
      .ask.compact > :not(.compact, .x) { display: none; }
      .ask.compact .compact { display: flex; flex-direction: column; gap: 8px; }
      .ask.compact .who { padding-inline-end: 22px; gap: 9px; }
      .ask.compact .who img { width: 34px; height: 34px; }
      .ask.compact .who strong { font-weight: 700; font-size: 13px; }
      .ask.compact .main { padding: 7px 10px; font-size: 13px; }
      .ask .links { display: flex; justify-content: center; flex-wrap: wrap; gap: 2px 4px; font-size: 11.5px; color: rgba(255,255,255,.4); }
      .ask .links > * { border: 0; background: none; padding: 1px 4px; border-radius: 5px; color: rgba(255,255,255,.75); font-size: 11.5px; }
      .ask .links > :first-child { color: #fff; font-weight: 600; }
      .ask .links > *:hover { background: rgba(255,255,255,.12); color: #fff; }
      .covered { visibility: hidden !important; } /* something of the page lies over the video here */
      /* The overlay covers the whole player; the subtitles sit on the picture inside it. */
      .pic { position: absolute; pointer-events: none; }
      /* A narrow player (Shorts, a small window): the cards in the top right go
         below the fullscreen button instead of over it. */
      :host([data-narrow]) .langs, :host([data-narrow]) .found { top: 56px; max-height: max(calc(100% - 68px), 180px); overflow: auto; }
    `;
    picEl = el('div', 'pic');
    subsEl = el('div', 'subs');
    dualEl = el('div', 'subs');
    picEl.append(subsEl, dualEl);
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
    fsGo.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path/></svg>';
    fsKeyEl = el('kbd');
    fsGo.append(el('span'), fsKeyEl);
    fsGo.addEventListener('click', (e) => { e.stopPropagation(); toggleFullscreen(); });
    fsBtn.append(fsGo);
    setFsMode(false);
    dropEl = el('div', 'drop', t('Drop .srt, .vtt or .ttml subtitles here'));
    foundEl = el('div', 'found');
    siteNoteEl = el('div', 'site-note');
    const noteText = el('span', '');
    noteText.append(el('b', '', t('Two sets of subtitles.') + ' '), t('Turn the site’s own subtitles off in its player (CC button).'));
    const noteClose = el('button', '', '\u00d7');
    noteClose.title = t('Dismiss');
    noteClose.addEventListener('click', () => { siteDismissed = true; setSiteNote(siteSeen); });
    siteNoteEl.append(noteText, noteClose);
    langsEl = el('div', 'langs');
    askEl = el('div', 'ask'); // filled the first time it shows (fillAsk)
    askEl.setAttribute('role', 'dialog');
    shareEl = el('div', 'ask share'); // filled each time it shows (fillShareAsk)
    shareEl.setAttribute('role', 'dialog');
    for (const node of [langsEl, askEl, shareEl]) {
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick']) node.addEventListener(type, (e) => e.stopPropagation());
    }
    shadow.append(style, picEl, toastEl, hintEl, restoreEl, fsBtn, dropEl, foundEl, siteNoteEl, langsEl, askEl, shareEl);
    placeHost();
    useFont();
  }

  // The same button enters our fullscreen and, inside it, leaves it again
  // (a cross and "Exit fullscreen", with Esc as its key).
  const FS_ENTER = 'M2 6V3.5C2 2.7 2.7 2 3.5 2H6M10 2h2.5c.8 0 1.5.7 1.5 1.5V6M14 10v2.5c0 .8-.7 1.5-1.5 1.5H10M6 14H3.5C2.7 14 2 13.3 2 12.5V10';
  const FS_EXIT = 'M4 4l8 8M12 4l-8 8';
  function setFsMode(exit) {
    if (!fsBtn) return;
    fsBtn.classList.toggle('exit', exit);
    fsBtn.querySelector('path').setAttribute('d', exit ? FS_EXIT : FS_ENTER);
    fsBtn.querySelector('span').textContent = t(exit ? 'Exit fullscreen' : 'Fullscreen with subtitles');
    refreshFsKey();
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

  // What it is doing by itself (loading, translating, done). The Behaviour tab can turn
  // these off. Errors and what answers your own keys and clicks still use toast().
  function notice(text, ms) {
    if (settings.statusNotices !== false) toast(text, ms);
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

  // The box the overlay covers, with the cards and buttons in its corners:
  // YouTube's whole player, so with a tall video they keep to its corners
  // instead of crowding the narrow picture; elsewhere the video element.
  function stageOf(v) {
    const player = v.closest && v.closest('.html5-video-player');
    const fe = document.fullscreenElement;
    // Our own fullscreen shows just the video's parent: then the video it is.
    return player && (!fe || containsDeep(fe, player)) ? player : v;
  }

  // The stage cut to the window's width. Some players (Netflix in its own
  // fullscreen or a full window) make the video element wider than the screen,
  // which pushed the language switches in the right corner off the edge.
  function visibleBox(b) {
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const left = Math.max(b.left, 0), right = Math.min(b.right, vw);
    if (right - left < 200) return b; // mostly off screen: leave it as it is
    return { left, top: b.top, width: right - left, height: b.height, right, bottom: b.bottom };
  }

  // YouTube's small players: the miniplayer in the corner (and the hover
  // preview on lists of videos). Nothing of ours belongs on those: no
  // subtitles, no buttons, no language switches, no fullscreen.
  const smallPlayer = (v) => !!(v && v.closest && v.closest('.ytp-player-minimized, ytd-miniplayer, ytd-video-preview'));

  function position(force) {
    if (!host || !video) return;
    let box = stageOf(video).getBoundingClientRect();
    // While a site swaps in the next episode the old video can have no size
    // for a moment (0 px at the page's left edge): the centred fullscreen
    // button then hung half off screen. In our fullscreen the screen is the
    // box; anywhere else nothing shows until the video has a size again.
    if (box.width < 40 || box.height < 40) {
      const fe = document.fullscreenElement;
      if (ownFullscreen && fe === ownFullscreen.container) box = fe.getBoundingClientRect();
    }
    const small = smallPlayer(video) || box.width < 40 || box.height < 40;
    host.style.setProperty('display', small ? 'none' : 'block', 'important');
    if (small) { lastGeom = ''; fsBtn.classList.remove('on'); langsEl.classList.remove('on'); return; }
    const s = visibleBox(box);
    const r = pictureRect(video);
    const geom = [s.left, s.top, s.width, s.height, r.left, r.top, r.width, r.height].map(Math.round).join(',');
    if (!force && geom === lastGeom) return;
    lastGeom = geom;
    const hs = host.style;
    hs.setProperty('left', Math.round(s.left) + 'px', 'important');
    hs.setProperty('top', Math.round(s.top) + 'px', 'important');
    hs.setProperty('width', Math.round(s.width) + 'px', 'important');
    hs.setProperty('height', Math.round(s.height) + 'px', 'important');
    // The cards reach 420 px from the right; below this they'd cover the centred fullscreen button.
    host.toggleAttribute('data-narrow', s.width < 1130);
    const ps = picEl.style;
    ps.left = Math.round(r.left - s.left) + 'px';
    ps.top = Math.round(r.top - s.top) + 'px';
    ps.width = Math.round(r.width) + 'px';
    ps.height = Math.round(r.height) + 'px';
    // A layer moving to the other edge (the second language taking the main
    // one's place, or giving it back) jumps there: sliding from a lifted
    // bottom to the top would sweep across the picture.
    const placeBefore = [subsEl.dataset.place, dualEl.dataset.place];
    SubRender.applyStyle(subsEl, settings, r.height, r.width);
    SubRender.applyStyle(dualEl, dualSettings(), r.height, r.width);
    const jumped = [subsEl, dualEl].filter((layer, i) => placeBefore[i] && layer.dataset.place !== placeBefore[i]);
    for (const layer of jumped) layer.style.transition = 'none';
    liftForControls();
    for (const layer of jumped) { getComputedStyle(layer).transform; layer.style.transition = ''; }
  }

  // YouTube's control bar (progress bar and buttons) covers the bottom of the
  // video while you hover or pause. Lift the subtitles above it, as YouTube does
  // with its own captions, and drop them back when the bar hides. Subtitles at
  // the top step down the same way below our fullscreen button while it shows.
  function liftForControls() {
    if (!subsEl) return;
    const bar = controlBar();
    // Never in fullscreen: there the subtitles stay put and the bar may cover them,
    // instead of jumping up and down every time the mouse moves.
    const shows = bar && host && !document.fullscreenElement;
    const fsShows = fsBtn.classList.contains('on') && !fsBtn.classList.contains('covered');
    const b = shows && bar.getBoundingClientRect(), f = fsShows && fsBtn.getBoundingClientRect();
    const h = (shows || fsShows) && picEl.getBoundingClientRect();
    // Each layer by its own distance (with dual subtitles the bottom one may be the original).
    for (const layer of [subsEl, dualEl]) {
      const dist = parseFloat(layer.style.getPropertyValue('--bottom')) || 0;
      let lift = 0, drop = 0;
      if (layer.dataset.place === 'top') {
        if (fsShows && f.height) drop = Math.max(0, Math.round(f.bottom + 6 - (h.top + dist)));
      } else if (shows && b.height && b.top < h.bottom && b.bottom > h.top) {
        lift = Math.max(0, Math.round(h.bottom - b.top + 8 - dist));
      }
      layer.style.setProperty('--lift', lift + 'px');
      layer.style.setProperty('--drop', drop + 'px');
    }
  }

  // The player's own control bar while it shows, or null. Netflix fades its
  // controls out (or takes them away) when the mouse rests.
  var onNetflix = location.hostname === 'www.netflix.com'; // var: position() may run before this line
  function controlBar() {
    const player = video && video.closest && video.closest('.html5-video-player');
    if (player) return !player.classList.contains('ytp-autohide') && player.querySelector('.ytp-chrome-bottom');
    if (!onNetflix) return null;
    const bar = document.querySelector('.watch-video--bottom-controls-container');
    if (!bar) return null;
    for (let n = bar; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.1) return null;
    }
    return bar;
  }

  function refreshStyle() {
    if (!subsEl) return;
    useFont();
    position(true);
    render(true);
    ensureSecond();
    refreshLangs(); // dual subtitles or their place changed in the popup
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
  // Most sites don't mark their ads. But subtitles the site itself loaded that
  // go on long after a short video ends can't belong to it: it's the ad or trailer
  // before the real video, which may play in the same element. Not for a file
  // you loaded yourself: that always shows.
  function shortForSubs() {
    if (!siteFile || !video || !cues.length) return false;
    const d = video.duration;
    // Under 2 minutes: Prima+'s preview of a film runs 3, with the film's own subtitles.
    return Number.isFinite(d) && d > 0 && d < 120 && cues[cues.length - 1].end / 1000 > d + 30;
  }
  function inAd() {
    const ad = !!(video && video.closest && video.closest('.ad-showing')) || shortForSubs();
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
    syncSiteSubs();
    let idx = [], idxDual = [];
    const hide = !cues.length || inAd() || (video.paused && settings.onPause === 'hide');
    const now = video.currentTime * 1000 - settings.offset;
    if (!hide && visible) idx = activeAt(now);
    const second = secondCues();
    if (!hide && dualVisible && second) idxDual = activeAt(now, second);
    const key = idx.join(',') + '|' + idxDual.join(',');
    if (!force && key === lastKey) return;
    lastKey = key;
    // Also lines translated earlier with a second version in brackets (see SubLib.dropAlternative).
    const clean = (list) => list.map((c) => {
      const text = SubLib.dropAlternative(settings.hideSounds ? SubLib.cleanCaption(c.text) : c.text);
      return text === c.text ? c : Object.assign({}, c, { text });
    }).filter((c) => c.text);
    shownCues = clean(idx.map((i) => cues[i]));
    shownDual = clean(idxDual.map((i) => second[i]));
    for (const layer of [subsEl, dualEl]) layer.classList.toggle('copy', !!settings.clickCopy);
    SubRender.renderCues(subsEl, shownCues);
    SubRender.renderCues(dualEl, shownDual);
    if (!siteStyle) return; // none of ours on: the site's own subtitles show
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
    const r = stageOf(video).getBoundingClientRect();
    const geom = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
    if (coverRoot && coverGeom === geom && containsDeep(coverRoot, video)) return coverRoot;
    // The biggest ancestor that is still no bigger than the overlay: the player
    // with its own controls and overlays, but not the page around it.
    let root = video, n = video;
    for (;;) {
      n = n.parentNode || (n instanceof ShadowRoot ? n.host : null);
      if (!n || n === document.body || n === document.documentElement || n.nodeType !== 1) break;
      const p = n.getBoundingClientRect();
      const fits = p.left >= r.left - 8 && p.top >= r.top - 8 && p.right <= r.right + 8 && p.bottom <= r.bottom + 8;
      // A letterboxed video sits in the middle of its player, with black bars
      // around it: that box is the player too, with the controls in it.
      const centred = Math.abs(r.left - p.left - (p.right - r.right)) <= 8 && Math.abs(r.top - p.top - (p.bottom - r.bottom)) <= 8;
      if (!fits && !centred) break;
      root = n;
    }
    coverGeom = geom;
    return (coverRoot = root);
  }
  // Players often lay an invisible box over the video to catch clicks. It paints
  // nothing, so it covers nothing; what lies under it is what counts.
  function paints(e) {
    if (/^(IMG|VIDEO|CANVAS|IFRAME|EMBED|OBJECT|svg)$/.test(e.tagName)) return true;
    const st = getComputedStyle(e);
    if (+st.opacity === 0) return false;
    if (st.backgroundImage !== 'none' || st.backdropFilter && st.backdropFilter !== 'none') return true;
    if (!/^(transparent|rgba\(.*,\s*0\))$/.test(st.backgroundColor)) return true;
    if (parseFloat(st.borderTopWidth) > 0 && st.borderTopStyle !== 'none' && !/,\s*0\)$|^transparent$/.test(st.borderTopColor)) return true;
    return [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
  }
  function covered(el) {
    if (el !== subsEl && el !== dualEl) return coveredBox(el.getBoundingClientRect());
    // A subtitle layer is as wide as the longest allowed line: test the box
    // around its lines (one box, as each test costs the page a moment).
    const boxes = [...el.querySelectorAll('.front .line')].map((line) => line.getBoundingClientRect()).filter((b) => b.width && b.height);
    if (!boxes.length) return false;
    const left = Math.min(...boxes.map((b) => b.left)), right = Math.max(...boxes.map((b) => b.right));
    const top = Math.min(...boxes.map((b) => b.top)), bottom = Math.max(...boxes.map((b) => b.bottom));
    return coveredBox({ left, right, top, bottom, width: right - left, height: bottom - top });
  }
  function coveredBox(b) {
    if (!b.width || !b.height) return false;
    const root = playerRoot();
    const pts = [[b.left + 3, b.top + 3], [b.right - 3, b.top + 3], [b.left + 3, b.bottom - 3], [b.right - 3, b.bottom - 3], [(b.left + b.right) / 2, (b.top + b.bottom) / 2]];
    for (const [x, y] of pts) {
      const top = document.elementsFromPoint(x, y).find((e) => e !== host && (containsDeep(root, e) || containsDeep(e, video) || paints(e)));
      if (top && top !== document.documentElement && top !== document.body && !containsDeep(root, top) && !containsDeep(top, video)) return true;
    }
    return false;
  }
  function checkCovered() {
    if (!host || !video || !host.isConnected) return;
    coverAt = performance.now();
    for (const el of [subsEl, dualEl, langsEl, askEl, shareEl, fsBtn, foundEl, hintEl, restoreEl, siteNoteEl, toastEl, helpEl]) {
      // The notice only fades out and keeps its size: testing it while gone costs as much as shown.
      if (!el || (el === toastEl && !el.classList.contains('on'))) continue;
      el.classList.toggle('covered', !document.fullscreenElement && covered(el));
    }
  }
  // Each point tested costs a big page like YouTube about a millisecond, and a
  // check tests some twenty: twice a second is plenty while nothing was clicked.
  function checkCoveredSoon() {
    if (performance.now() - coverAt > 500) checkCovered();
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
    srcPending = false;
    for (const ev of VIDEO_EVENTS) v.addEventListener(ev, kick);
    v.addEventListener('loadstart', onSourceChange);
    v.addEventListener('emptied', onSourceChange);
    lastDuration = v.duration;
    v.addEventListener('durationchange', onDuration);
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
    video.removeEventListener('durationchange', onDuration);
    clearTimeout(swapTimer);
    swapWaits = false;
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
      if (!cues.length && !stashed && !restorePending && !offered) return stopWatch();
      if (restorePending) return tryRestore();
      // Gone, or hidden while another plays: Prima+'s ad has its own element, which stays on the page.
      if (!video || !video.isConnected || !area(video)) {
        const next = pickVideo();
        if (next && next !== video) {
          const sameSrc = (next.currentSrc || next.src) === lastSrc;
          attach(next);
          if (!sameSrc) onSourceChange();
        }
        return;
      }
      if ((video.currentSrc || video.src || '') !== lastSrc) onSourceChange();
      inAd();
      checkCoveredSoon(); // also while paused, when the playing loop doesn't check
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
    if (srcPending) { srcPending = false; return; }
    // Ads in the same element change the source too; don't drop subtitles for
    // them. Unless YouTube already shows another video: then the ad comes before that one.
    const otherVideo = !!SubSettings.youTubeId(location.href) && pageOfSubs() !== SubSettings.pageOf(location.href);
    if ((inAd() || Date.now() - lastAdAt < 5000) && !otherVideo) return;
    if (!cues.length) return;
    // Same page, new stream: Prima+ loads one when you pick another audio language.
    // As long as the new one is equally long, it's the same film.
    if (Number.isFinite(lastDuration) && lastDuration > 0 && pageOfSubs() === SubSettings.pageOf(location.href)) {
      swapWaits = true;
      clearTimeout(swapTimer);
      swapTimer = setTimeout(newVideo, 8000);
      return;
    }
    newVideo();
  }
  let lastDuration = NaN, swapWaits = false, swapTimer = 0;
  function onDuration() {
    const d = video.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    if (swapWaits && Math.abs(d - lastDuration) > 2) return newVideo();
    clearTimeout(swapTimer);
    swapWaits = false;
    lastDuration = d;
  }
  function newVideo() {
    clearTimeout(swapTimer);
    swapWaits = false;
    if (!cues.length) return;
    lastDuration = video ? video.duration : NaN;
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
    show.addEventListener('click', () => { hideRestore(); restoreRecord(record, liveVideo()); });
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

  // The language the loaded subtitles are in, known before anything goes to
  // Google: the site says it (it ends up in the file name, "….cs.vtt",
  // "youtube-….cs"), the file says it ("Language: cs" in a WebVTT header,
  // xml:lang in TTML), or Chrome recognises it on this computer from a sample
  // of the lines. Google's answer to the first translation still corrects it.
  function findOrigLang(name, text, list) {
    langPending = null;
    // Only after a dot and only a language we translate to ("cze" counts as cs): "film.the.srt" is no language.
    const tail = /\.([a-z]{2,3}(?:[-_][a-z0-9]{2,4})?)$/i.exec(name.replace(SubLib.SUB_FILE, ''));
    const known = tail && SubSettings.LANGUAGES.find((l) => SubLib.langMatch(tail[1], l[0]) > 0);
    const fromName = known ? (tail[1].includes('-') || tail[1].includes('_') ? tail[1].replace('_', '-') : known[0]) : '';
    const said = SubLib.headerLanguage(text) || fromName;
    if (said) { origLang = said.toLowerCase(); return; }
    if (!chrome.i18n || !chrome.i18n.detectLanguage) return;
    // Up to 80 lines from all over the file: the first minutes are often only names and music.
    const step = Math.max(1, Math.floor(list.length / 80));
    const sample = list.filter((c, i) => i % step === 0).slice(0, 80)
      .map((c) => SubLib.cleanCaption ? SubLib.cleanCaption(c.text) : c.text).join('\n').replace(/<[^>]+>/g, '');
    let job = null;
    job = langPending = new Promise((done) => chrome.i18n.detectLanguage(sample, (r) => {
      try {
        const best = r && r.isReliable && r.languages && r.languages[0];
        // Only while these are still the subtitles on screen and Google hasn't answered meanwhile.
        if (best && best.language !== 'und' && best.percentage >= 60 && baseOf().cues === list && !origLang) {
          origLang = best.language;
          refreshLangs();
        }
      } finally {
        if (langPending === job) langPending = null;
        done();
      }
    }));
  }

  // asr: YouTube's automatic captions, which the AI can clean up in their own language.
  function loadBytes(name, b64, encoding, targetVideo, asr) {
    const bytes = SubLib.base64ToBytes(b64);
    const { text, encoding: used } = SubLib.decode(bytes, encoding || 'auto');
    const parsed = SubLib.parse(text);
    if (!parsed.length) return { ok: false, error: t('No subtitle lines found in this file.') };
    const v = targetVideo || pickVideo();
    if (!v) return { ok: false, error: t('No video found on this page.') };
    cues = parsed;
    file = { name, b64, encoding: encoding || 'auto', usedEncoding: used };
    if (asr) file.asr = true;
    loadedOn = location.href;
    autoLoaded = false;
    siteFile = false;
    siteDismissed = false;
    original = null;
    translations.clear();
    origLang = '';
    findOrigLang(name, text, parsed);
    stashed = null;
    if (hintEl) hintEl.classList.remove('on');
    hideRestore();
    attach(v);
    // They belong to what the video plays now. A reload can restore them before
    // the player has started (YouTube): then what it starts with is no new video.
    lastSrc = v.currentSrc || v.src || '';
    srcPending = !lastSrc;
    afterLoad();
    rememberFile();
    notice(t('Loaded {n} lines', { n: parsed.length }) + (settings.offset ? ' · ' + t('Sync: {offset}', { offset: fmtOffset(settings.offset) }) : ''));
    return { ok: true, count: parsed.length, encoding: used };
  }

  // Hiding everything at once (Alt + S, YouTube's CC button) remembers which
  // languages were on, so showing again brings back exactly those. A language
  // switched off in the panel over the video stays off.
  function hideAll() {
    if (visible || dualVisible) shownBefore = { visible, dualVisible };
    visible = dualVisible = false;
  }
  function showAll() {
    const was = shownBefore;
    shownBefore = null;
    if (was && (was.visible || was.dualVisible)) ({ visible, dualVisible } = was);
    else visible = dualVisible = true;
    ensureSecond(); // not translated while it was off
  }

  // Languages switched off over the video in the record restoreRecord is
  // loading, for afterLoad: { main, second }.
  let offAfterLoad = null;

  function afterLoad() {
    const off = offAfterLoad;
    offAfterLoad = null;
    if (off) {
      // Switched off before a reload: they stay off (the main one only while there are second ones to switch it back on).
      shownBefore = null;
      visible = !(off.main && settings.dual);
      dualVisible = !off.second;
    } else {
      // The subtitles just loaded always show; the second ones keep their switch
      // (YouTube may download the same captions again when CC goes back on).
      if (!visible && !dualVisible) showAll();
      visible = true;
    }
    lastKey = '';
    startWatch();
    enableMouse(true);
    position(true);
    render(true);
    kick();
    ensureSecond();
    refreshLangs(); // a card up shows these subtitles now
    send({ type: 'subs-state', has: true });
  }

  function clearSubs(keepStash) {
    hideSiteSubs(false);
    stopSiteWatch();
    autoLoaded = false;
    siteFile = false;
    cues = [];
    file = null;
    original = null;
    translations.clear();
    origLang = '';
    if (!keepStash) stashed = null;
    lastKey = '';
    if (subsEl) subsEl.replaceChildren();
    if (dualEl) dualEl.replaceChildren();
    enableMouse(!!offered);
    if (fsBtn) fsBtn.classList.remove('on');
    if (langsEl) langsEl.classList.remove('on');
    send({ type: 'subs-state', has: false });
  }

  // The last subtitles of this exact page: after a reload they come back at
  // once; on a later visit a card offers them once you watch the video (in
  // automatic mode they come back by themselves: YouTube at once, other sites
  // on a video of the same length).
  let restorePending = null; // { record, ask: false | true | 'length', since }
  async function checkRestore() {
    try {
      const record = await memRecord();
      if (!record) return;
      let ask = true;
      try { ask = !(await chrome.storage.session.get(pageKey()))[pageKey()]; } catch (e) { /* treat as a new visit */ }
      // In automatic mode a YouTube video's subtitles come back by themselves:
      // its address names the video (a feed's address doesn't, so there they're offered).
      // Other sites' addresses may show another episode or a trailer first, so
      // there they come back by themselves only on a video exactly as long as
      // the one they were on ('length': tryRestore); records saved before the
      // length was kept are still offered.
      if (ask) {
        await prefsReady;
        if (prefs.autoTranslate) ask = SubSettings.youTubeId(location.href) ? false : (record.dur > 0 ? 'length' : true);
      }
      restorePending = { record, ask, since: Date.now() };
      startWatch();
      tryRestore();
    } catch (e) { /* no storage access */ }
  }
  function tryRestore() {
    if (!restorePending) return;
    if (cues.length) { restorePending = null; return; } // something else loaded first
    if (restorePending.ask === 'length') {
      const v = watched();
      if (!v) return;
      const { record } = restorePending;
      // Not this video (or an ad still plays): wait, and offer them after a minute.
      if (!(Math.abs(v.duration - record.dur) <= 3)) {
        if (Date.now() - restorePending.since > 60000) restorePending.ask = true;
        return;
      }
      restorePending = null;
      const back = restoreRecord(record, v);
      if (!back || !back.ok) return;
      autoLoaded = true; // the site's own file, if it comes, may still replace them (autoShow)
      const ai = record.ai && record.ai.model;
      notice(t('Subtitles from last time:') + ' ' + (record.translatedTo ? SubSettings.languageName(record.translatedTo) : record.name) + (ai ? ' · ' + ai : ''), 4000);
      if (aiReady()) showLangs();
      return;
    }
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
    offAfterLoad = f.off || null;
    if (!f.original) {
      const r = loadBytes(f.name, f.b64, f.encoding, v, f.asr);
      offAfterLoad = null;
      siteFile = r.ok;
      if (r.ok && restoreSecond(f)) resumeShown();
      return r;
    }
    // A translation was showing: bring back the original, then the saved translation (no new request).
    const r = loadBytes(f.original.name, f.original.b64, f.original.encoding, v, f.original.asr);
    offAfterLoad = null;
    siteFile = r.ok;
    if (r.ok && f.origLang) origLang = f.origLang;
    if (!r.ok) return r;
    const list = savedList(f.b64, f.ai);
    if (f.native) nativeSite.set(list, f.native);
    if (f.clean) cleaned.add(list);
    showTranslation(f.translatedTo, list, true);
    restoreSecond(f);
    resumeShown();
    return r;
  }
  // Saved lines and how far the AI pass got with them.
  function savedList(b64, ai) {
    const list = SubLib.parse(SubLib.decode(SubLib.base64ToBytes(b64), 'utf-8').text);
    if (ai && ai.model) {
      aiState.set(list, { model: ai.model, done: Math.min(ai.done, list.length), total: list.length,
        chunks: new Set(ai.chunks), running: false, error: '', stopped: !!ai.stopped, ms: ai.ms || 0, kept: ai.kept || 0, shared: ai.shared || null });
    }
    return list;
  }
  // The second language, if saved within the last day. True when it came back.
  function restoreSecond(f) {
    const s = f.second;
    if (!s || !(Date.now() - s.t < SECOND_KEEP)) return false;
    const list = savedList(s.b64, s.ai);
    if (list.length !== baseOf().cues.length) return false;
    translations.set(s.lang, list);
    lastKey = '';
    position(true);
    render(true);
    return true;
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
    .ytp-caption-window-container .caption-window, .ytp-caption-segment,
    .player-timedtext, .atvwebplayersdk-captions-overlay { visibility: hidden !important; }`;
  let siteStyle = null;
  let hiddenTracks = [];

  // The site's own subtitles stay hidden whenever we have subtitles loaded,
  // even with both of our languages switched off (Alt + S): you see the
  // site's own ones only with the extension turned off on that site.
  function syncSiteSubs() {
    const want = !off && cues.length > 0;
    if (want === !!siteStyle) return;
    hideSiteSubs(want);
    if (!want) stopSiteWatch();
  }

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

  // YouTube's player keeps its captions in known boxes, hidden by
  // SITE_SUBS_CSS. Searching its text as well never finds anything (the
  // boxes are hidden) and on every change in the player, so it only cost
  // time: up to 86 ms at once while the page scrolled.
  const knownPlayer = () => !!(video && video.closest && video.closest('.html5-video-player'));

  function startSiteWatch() {
    if (siteObs || !video || knownPlayer()) return;
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
    if (!video || !cues.length || !siteStyle || knownPlayer()) return setSiteNote(false);
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

  // Translates the original lines into `to` with Google (cached per language).
  // The AI never starts here: only the Improve button starts it. Resolves
  // { ok, list } or { ok: false, error }.
  async function fetchTranslation(to, quiet) {
    const base = baseOf();
    const cached = translations.get(to);
    if (cached) return { ok: true, list: cached };
    // The site has subtitles in that language itself (Netflix, YouTube, Disney+…):
    // those are used as they are. Nothing to translate, and people wrote them.
    const own = await siteTrack(to);
    if (baseOf().file !== base.file) return { ok: false, error: t('Other subtitles were loaded meanwhile.') };
    if (translations.has(to)) return { ok: true, list: translations.get(to) };
    if (own) {
      nativeSite.set(own.list, own.site);
      translations.set(to, own.list);
      countOwn();
      if (!quiet) notice(t('Subtitles from {site}: {lang}', { site: own.site, lang: SubSettings.languageName(to) }), 4000);
      return { ok: true, list: own.list };
    }
    // Translated and improved before on this computer (Saved subtitles): used
    // as it is, the model's work isn't done again and Google isn't asked.
    const kept = await keptTranslation(base, to);
    if (baseOf().file !== base.file) return { ok: false, error: t('Other subtitles were loaded meanwhile.') };
    if (translations.has(to)) return { ok: true, list: translations.get(to) };
    if (kept) {
      translations.set(to, kept);
      countOwn();
      return { ok: true, list: kept };
    }
    // Shared by someone else: asked at the same time as Google, so Google's lines never wait for it long.
    const lookup = sharedTranslation(base, to);
    if (!quiet) notice(t('Translating {n} lines to {lang}…', { n: base.cues.length, lang: SubSettings.languageName(to) }), 15000);
    const res = await chrome.runtime.sendMessage({ type: 'translate', to, texts: base.cues.map((c) => toHtml(c.text)) })
      .catch((e) => ({ ok: false, error: e.message }));
    if (!res || !res.ok) {
      toast(t('Translation didn’t work'));
      return { ok: false, error: res ? res.error : t('Translation failed.') };
    }
    if (baseOf().file !== base.file) return { ok: false, error: t('Other subtitles were loaded meanwhile.') };
    // Brought back meanwhile (a reload restores a saved one, with the AI's lines): that one stays.
    if (translations.has(to)) return { ok: true, list: translations.get(to) };
    if (res.detected) origLang = res.detected;
    const list = base.cues.map((c, i) => ({ start: c.start, end: c.end, text: fromHtml(res.texts[i]) || c.text }));
    translations.set(to, list);
    // For the rating card in the popup: background.js counts each page once.
    chrome.runtime.sendMessage({ type: 'count-video', page: pageOfSubs(), lines: list.length }).catch(() => {});
    // A shared copy found in time is offered (or used at once with "Use shared automatically");
    // one that comes later is offered when it comes.
    const LATE = {};
    const found = await Promise.race([lookup, new Promise((r) => setTimeout(() => r(LATE), 1500))]);
    if (found === LATE) { lookup.then((f) => offerShared(to, list, f)); return { ok: true, list }; }
    if (found && translations.get(to) === list) {
      if (prefs.shareAuto) { googleOf.set(found.list, list); translations.set(to, found.list); return { ok: true, list: found.list }; }
      sharedOffer.set(list, found);
    }
    return { ok: true, list };
  }

  // The fingerprint of the original lines (SubSettings.sourceKey), worked out once per file.
  const srcKeys = new WeakMap(); // base file -> Promise of the key ('' when it can't be made)
  function srcKeyOf(base) {
    if (!srcKeys.has(base.file)) srcKeys.set(base.file, SubSettings.sourceKey(base.cues).catch(() => ''));
    return srcKeys.get(base.file);
  }
  // The copy of these original lines in `to` from Saved subtitles, as cues with
  // the original's timing (and its AI state when a model made it), or null.
  async function keptTranslation(base, to) {
    if (!SubSettings.REUSE_SAVED) return null;
    const src = await srcKeyOf(base);
    const item = src && (await SubSettings.findKept(src, to).catch(() => null) || await adoptOlderCopy(base, to, src).catch(() => null));
    if (!item || !item.srt) return null;
    const list = SubLib.parse(item.srt);
    if (list.length !== base.cues.length) return null;
    list.forEach((c, i) => { c.start = base.cues[i].start; c.end = base.cues[i].end; });
    if (item.model && item.model !== 'Google') {
      const chunks = new Set();
      for (let i = 0; i < list.length; i += AI_CHUNK) chunks.add(i);
      aiState.set(list, { model: item.model, done: list.length, total: list.length, chunks, running: false, error: '', stopped: false,
        ms: item.ms || 0, kept: item.t || Date.now() });
    }
    return list;
  }

  // Copies saved before they got a fingerprint (1.0.18 and early 1.0.19) can't
  // be found by it. Their lines still have the original's timing, though: same
  // number of lines, each starting and ending where the original's does (give
  // or take 150 ms, all moved by one offset if a sync shift was on). A match
  // gets the fingerprint, so next time it's found at once like any other.
  // Short files are skipped: a few lines' timing could match by chance.
  const olderChecked = new WeakMap(); // base file -> Set of languages already looked for
  async function adoptOlderCopy(base, to, src) {
    const cues = base.cues;
    if (cues.length < 20) return null;
    if (!olderChecked.has(base.file)) olderChecked.set(base.file, new Set());
    const seen = olderChecked.get(base.file);
    if (seen.has(to)) return null;
    seen.add(to);
    for (const item of await SubSettings.loadSaved()) {
      if (item.src || item.lang !== to || !item.srt) continue;
      const list = SubLib.parse(item.srt);
      if (list.length !== cues.length) continue;
      const shift = list[0].start - cues[0].start;
      const same = list.every((c, i) => Math.abs(c.start - shift - cues[i].start) <= 150 && Math.abs(c.end - shift - cues[i].end) <= 150);
      if (!same) continue;
      const { key, ...kept } = item;
      await chrome.storage.local.set({ [key]: Object.assign(kept, { src }), ['src:' + src + '|' + to]: key });
      return Object.assign({ key }, kept);
    }
    return null;
  }

  // ---------- shared improved subtitles ----------
  // Someone else improved the same original lines with a good model and shared
  // them (~/subtitle-share). The card over the video offers them in place of
  // Improve, or they're used at once with "Use shared automatically".
  const sharedOffer = new WeakMap(); // Google's cues -> { list, item }: a shared copy offered over them
  const googleOf = new WeakMap();    // shared cues -> Google's cues they replaced
  const noShared = new WeakMap();    // base file -> Set of languages whose shared copy you turned down
  const turnedDown = (base, to) => !!(noShared.get(base.file) || new Set()).has(to);
  function turnDown(to) {
    const f = baseOf().file;
    if (!noShared.has(f)) noShared.set(f, new Set());
    noShared.get(f).add(to);
  }
  // The newest shared copy of these lines in `to` as { list, item }, or null.
  async function sharedTranslation(base, to) {
    try {
      if (!SubSettings.SHARING || !prefs.shareFind || turnedDown(base, to)) return null;
      const src = await srcKeyOf(base);
      const res = src && await send({ type: 'share-find', src, lang: to });
      if (!res || !res.srt || !res.item) return null;
      const list = SubLib.parse(res.srt);
      if (list.length !== base.cues.length) return null;
      list.forEach((c, i) => { c.start = base.cues[i].start; c.end = base.cues[i].end; });
      const chunks = new Set();
      for (let i = 0; i < list.length; i += AI_CHUNK) chunks.add(i);
      aiState.set(list, { model: res.item.model, done: list.length, total: list.length, chunks, running: false, error: '', stopped: false,
        ms: res.item.ms || 0, shared: { id: res.item.id, tag: res.item.tag, t: res.item.t } });
      return { list, item: res.item };
    } catch (e) { return null; }
  }
  // A copy that came after Google's lines were already on screen.
  function offerShared(to, googleList, found) {
    if (!found || translations.get(to) !== googleList) return;
    if (prefs.shareAuto) return useShared(to, googleList, found);
    sharedOffer.set(googleList, found);
    refreshLangs();
    if (googleList === cues || googleList === secondCues()) showLangs(8000);
  }
  // Puts another version of a language's lines on screen (main or second subtitles).
  function swapTranslation(lang, list, old = translations.get(lang)) {
    translations.set(lang, list);
    if (original && file.translatedTo === lang && cues === old) showTranslation(lang, list, true);
    else { lastKey = ''; position(true); render(true); rememberFile(); }
    refreshLangs();
  }
  function useShared(lang, googleList, found) {
    sharedOffer.delete(googleList);
    googleOf.set(found.list, googleList);
    swapTranslation(lang, found.list, googleList);
  }
  // Back to Google's quick version (asked for now if the shared copy came instead of it).
  async function backToGoogle(lang, list) {
    turnDown(lang);
    const g = googleOf.get(list);
    if (g) return swapTranslation(lang, g, list);
    translations.delete(lang);
    const r = await fetchTranslation(lang, true);
    if (r.ok) swapTranslation(lang, r.list, list);
  }
  // Your own model instead: over Google's lines, or over a copy of the shared ones.
  function improveMyself(lang, list, offer) {
    turnDown(lang);
    if (offer) { sharedOffer.delete(list); improve(lang, baseOf(), list, false); return; }
    const copy = list.map((c) => ({ start: c.start, end: c.end, text: c.text }));
    swapTranslation(lang, copy, list);
    improve(lang, baseOf(), copy, false);
  }
  // "2 days ago" in the interface language.
  function agoText(ts) {
    const rtf = new Intl.RelativeTimeFormat(SubI18n.lang, { numeric: 'auto' });
    const sec = (ts - Date.now()) / 1000;
    for (const [unit, n] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
      if (Math.abs(sec) >= n) return rtf.format(Math.round(sec / n), unit);
    }
    return rtf.format(0, 'second');
  }
  // "🇨🇿 gemma3:12b  SHARED", "Improved 2 days ago by user #4F2A", then Use (offer)
  // or Back to Google (in use) and Improve myself. Reporting a bad copy is in
  // "Report a problem" > "Translation is wrong" (checkFor).
  function sharedRow(lang, list, s, offer) {
    const info = s ? Object.assign({ model: s.model }, s.shared) : offer.item;
    const row = el('div', 'ai' + (s ? ' done' : ''));
    const head = el('div', 'ai-head');
    head.append(el('span', 'name', (SubSettings.flag(lang) + ' ' + info.model).trim()), el('span', 'shared-chip', '\u267b ' + t('Shared')));
    row.append(head);
    if (s) {
      const bar = el('div', 'ai-bar');
      const fill = el('span');
      fill.style.width = '100%';
      bar.append(fill);
      row.append(bar);
    }
    row.append(el('div', 'ai-note', t('Improved {ago} by user #{tag}', { ago: agoText(info.t), tag: info.tag })));
    const foot = el('div', 'ai-foot wrap');
    const act = (label, cls, fn, title) => {
      const b = el('button', 'ai-act' + (cls ? ' ' + cls : ''), label);
      if (title) b.title = title;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); showLangs(); });
      foot.append(b);
    };
    if (offer) act(t('Use'), 'main', () => useShared(lang, list, offer));
    else act(t('Back to Google'), '', () => backToGoogle(lang, list));
    if (aiReady()) act(t('Improve myself'), '', () => improveMyself(lang, list, offer), t('Rewrites the lines with {model}, starting where the video is now.', { model: aiModel() }));
    row.append(foot);
    return row;
  }

  // ---------- "share it with others?" ----------
  // After a good model finished improving (SubSettings.shareable): sent at once
  // when you said yes before; otherwise the card asks, the first time and then
  // again after 3 more, until you say yes or "Don't ask again".
  let shareAsking = null; // the finished pass the card asks about: { src, lang, model, lines, ms, srt, tag }
  async function afterImproved(to, list, state, base) {
    try {
      // Shared copies are looked up only when translating: a cleaned-up copy would never be found.
      if (cleaned.has(list)) return;
      if (!SubSettings.SHARING || !SubSettings.shareable(prefs.translator, state.model)) return;
      const src = await srcKeyOf(base);
      if (!src) return;
      // Only the formatting the server takes (italic, bold, underline).
      const srt = SubLib.toSRT(list).replace(/<\/?(?!(?:i|b|u)\b)[a-z][^>]*>/gi, '');
      const job = { src, lang: to, model: state.model, lines: list.length, ms: Math.round(state.ms || 0), srt };
      if (prefs.shareMine) { send({ type: 'share-send', job }); return; }
      const got = await chrome.storage.local.get(['shareAsk', 'shareImproved']);
      const n = (got.shareImproved || 0) + 1;
      await chrome.storage.local.set({ shareImproved: n });
      const a = got.shareAsk;
      if (a === 'never' || a === 'yes' || (a && a.next && n < a.next)) return;
      job.tag = await SubSettings.shareTag(await SubSettings.shareOwner());
      shareAsking = job;
      shareEl.replaceChildren();
      if (list === cues || list === secondCues()) showLangs(20000);
    } catch (e) { /* nothing shared, nothing asked */ }
  }
  async function answerShare(kind) {
    const job = shareAsking;
    shareAsking = null;
    shareEl.classList.remove('on');
    if (kind === 'yes') {
      prefs.shareMine = true;
      await chrome.storage.local.set({ shareMine: true, shareAsk: 'yes' }).catch(() => {});
      const r = job && await send({ type: 'share-send', job });
      toast(r && r.ok ? t('Thanks! Shared.') : t('Sharing didn’t work this time. The next ones will be shared.'), 3500);
    } else if (kind === 'never') {
      await chrome.storage.local.set({ shareAsk: 'never' }).catch(() => {});
    } else {
      const { shareImproved } = await chrome.storage.local.get('shareImproved').catch(() => ({}));
      await chrome.storage.local.set({ shareAsk: { next: (shareImproved || 0) + 3 } }).catch(() => {});
    }
  }
  // "38 minutes" / "50 seconds" in the interface language.
  function durationText(ms) {
    const min = ms >= 60000;
    return new Intl.NumberFormat(SubI18n.lang, { style: 'unit', unit: min ? 'minute' : 'second', unitDisplay: 'long' })
      .format(Math.max(1, Math.round(ms / (min ? 60000 : 1000))));
  }
  function fillShareAsk() {
    const job = shareAsking;
    const close = el('button', 'x');
    close.innerHTML = ICON.close;
    close.title = t('Not now');
    close.addEventListener('click', () => answerShare('later'));
    const title = el('strong', 'title', job.ms >= 1000 ? t('Done in {time}. Save it for others?', { time: durationText(job.ms) }) : t('Improved. Share it with others?'));
    const intro = el('p', '', t('Share the improved subtitles and the next person with the same video gets them at once. Their computer doesn’t have to do the work again.'));
    const info = el('div', 'info');
    info.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';
    const text = el('span', '', t('Only the subtitles and the model’s name are sent, signed anonymously as #{tag}. The page address, the video’s name and your name are not sent.', { tag: job.tag }) + ' ');
    const more = el('a', '', t('More about privacy'));
    more.href = SubSettings.PRIVACY_URL;
    more.target = '_blank';
    more.rel = 'noopener';
    text.append(more);
    info.append(text);
    const pair = el('div', 'pair');
    const yes = el('button', 'main', t('Share'));
    yes.addEventListener('click', () => answerShare('yes'));
    const later = el('button', '', t('Not now'));
    later.addEventListener('click', () => answerShare('later'));
    pair.append(yes, later);
    const never = el('button', 'never', t('Don’t ask again'));
    never.addEventListener('click', () => answerShare('never'));
    shareEl.setAttribute('aria-label', t('Share improved subtitles'));
    shareEl.append(close, title, intro, info, pair, never);
  }

  // Translations that are really the site's own subtitles in that language:
  // list -> the site's name. Their lines have their own timing, so the AI
  // (which rewrites Google's lines one by one) never works on them.
  const nativeSite = new WeakMap();
  // A video watched with the site's own subtitles in your language counts for
  // the support card like a translated one (it's still our overlay, style and
  // dual subtitles), but adds no translated lines.
  const countOwn = () => chrome.runtime.sendMessage({ type: 'count-video', page: pageOfSubs(), lines: 0 }).catch(() => {});
  // The site's own subtitles in a language, as { list, site, name, text }, or null.
  async function siteTrack(lang) {
    const res = await chrome.runtime.sendMessage({ type: 'native-track', lang }).catch(() => null);
    if (!res || !res.ok) return null;
    const list = SubLib.parse(res.text);
    return list.length ? { list, site: res.site, name: res.name, text: res.text } : null;
  }

  // A better AI pass (Gemini, Claude, OpenAI or a local model) over Google's quick
  // version, started with the Improve button: a key costs money and a local
  // model keeps the computer busy, so it never starts by itself. Small chunks
  // from where the video is now, each swapped in as it arrives. Chunks already
  // done (before a reload, or before the pass stopped) are skipped while the
  // model stays the same; another model starts over.
  const AI_CHUNK = 30;
  const improving = new Map(); // language -> { file, model } of the pass running for it
  // How far the AI pass got, shown in the card over the video.
  const aiState = new WeakMap(); // translated cues -> { model, done, total, chunks, running, error, stopped }
  // done counts the lines the pass went through (a line the model left out keeps Google's), so a finished pass is 100 %.
  const aiFinished = (s) => s.chunks.size >= Math.ceil(s.total / AI_CHUNK);
  const aiOf = () => SubSettings.AI[prefs.translator]; // undefined for Google
  const aiModel = () => (aiOf() && prefs[aiOf().model]) || '';
  // An AI translator with its key (if it needs one) and a model: Improve can start.
  const aiReady = () => { const ai = aiOf(); return !!ai && (!ai.key || !!prefs[ai.key]) && !!prefs[ai.model]; };
  // The queue tab gives way to a pass started here and lists it, so it hears
  // how the pass goes. Files you moved above it there go first: the queue asks
  // for that again and again, so closing its tab lets the pass carry on by itself.
  const QUEUE_FIRST_MS = 90000;
  let queueFirstUntil = 0;
  function reportLive(to, state) {
    send({ type: 'ai-live', to, model: state.model, done: state.done, total: state.total, paused: !!state.paused,
      name: (window === window.top && location.href === loadedOn && pageTitle()) || baseOf().file.name, page: loadedOn || location.href });
  }
  // quiet: carrying on after a reload. A pass stopped with "Stop" stays
  // stopped then; only Continue or Improve starts it again.
  async function improve(to, base, list, quiet) {
    if (!aiReady() || nativeSite.has(list)) return;
    const model = aiModel();
    const clean = cleaned.has(list);
    const busy = improving.get(to);
    if (busy && busy.file === base.file && busy.model === model) return;
    const prev = aiState.get(list);
    const state = prev && prev.model === model ? prev
      : { model, done: 0, total: list.length, chunks: new Set(), running: false, error: '', stopped: false, ms: 0 };
    if (aiFinished(state) || (state.stopped && quiet)) return;
    state.stopped = false;
    const run = { file: base.file, model };
    improving.set(to, run); // a pass with another model sees this and stops
    aiState.set(list, state);
    state.running = true;
    state.error = '';
    state.found = null;
    refreshLangs();
    reportLive(to, state);
    const src = base.cues.map((c) => toHtml(c.text));
    const now = video ? video.currentTime * 1000 - settings.offset : 0;
    const from = Math.max(0, base.cues.findIndex((c) => c.end >= now));
    const starts = [];
    for (let i = from - (from % AI_CHUNK); i < src.length; i += AI_CHUNK) starts.push(i);
    for (let i = 0; i < from - (from % AI_CHUNK); i += AI_CHUNK) starts.push(i);
    // Another model chosen meanwhile: the background would already ask that one, so this pass stops.
    const stillWanted = () => baseOf().file === base.file && improving.get(to) === run &&
      !!aiOf() && aiModel() === model;
    const shown = () => original && cues === list && file.translatedTo === to;
    // Only a language on screen gets translated: one switched off (over the
    // video, Alt + S, YouTube's CC button, dual subtitles off) waits and carries on when it's back.
    const onScreen = () => (visible && list === cues) || (dualVisible && list === secondCues());
    const mayRun = () => onScreen() && Date.now() >= queueFirstUntil;
    // Remembered at once, so a reload right after Improve carries on.
    if (shown()) showTranslation(to, list, true); else rememberFile();
    let said = quiet, savedAt = Date.now();
    try {
      // Who is who, from the whole file, for every chunk. Google's lines stay on screen meanwhile.
      // How long the model worked on it (state.ms, pauses not counted): said when it's done.
      let t0 = Date.now();
      // Cleaning up captions in their own language needs no notes on who calls whom what.
      const sheetRes = clean ? null : await chrome.runtime.sendMessage({ type: 'ai-sheet', to, texts: src }).catch(() => null);
      state.ms = (state.ms || 0) + Date.now() - t0;
      if (!stillWanted()) return;
      const sheet = (sheetRes && sheetRes.sheet) || '';
      for (let k = 0; k < starts.length; k++) {
        const i = starts[k];
        if (state.chunks.has(i)) continue;
        // A new main translation lands on screen a moment after its pass starts: no "Paused" for that.
        for (let n = 0; stillWanted() && !mayRun(); n++) {
          if (n === 1) { state.paused = true; refreshLangs(); reportLive(to, state); }
          await new Promise((r) => setTimeout(r, 500));
        }
        if (state.paused) { state.paused = false; refreshLangs(); reportLive(to, state); }
        if (!stillWanted()) return;
        // Subtitles switched off (or the pass stopped, or a queued file moved
        // above it) while the model works on a chunk: the request stops at once,
        // so a local model stops working too, and the chunk is asked again later.
        let offMidway = false;
        const watch = setInterval(() => {
          if (stillWanted() && mayRun()) return;
          offMidway = stillWanted();
          clearInterval(watch);
          send({ type: 'ai-stop', to });
        }, 500);
        t0 = Date.now();
        const res = await chrome.runtime.sendMessage({ type: 'ai-translate', to,
          texts: src.slice(i, i + AI_CHUNK), before: src.slice(Math.max(0, i - 4), i), sheet, clean })
          .catch((e) => ({ ok: false, error: e.message }))
          .finally(() => clearInterval(watch));
        if (!stillWanted()) return;
        if (res && res.stopped && offMidway) { k--; continue; }
        if (!res || !res.ok) {
          const err = new Error(res ? res.error || t('Translation failed.') : t('Translation failed.'));
          err.found = (res && res.found) || null; // Ollama or LM Studio answers at its usual address instead
          throw err;
        }
        state.ms += Date.now() - t0;
        res.texts.forEach((text, k) => { const c = list[i + k]; if (c) c.text = fromHtml(text) || c.text; });
        state.chunks.add(i);
        state.done += res.texts.length;
        // Said once the first chunk is back: said earlier, "Translated to …" would cover it.
        if (!said && cues === list) { said = true; if (prefs.aiNotices) notice(t(clean ? 'Cleaning up the captions with {model}…' : 'Improving the translation with {model}…', { model }), 4000); }
        if (cues === list) { lastKey = ''; render(true); }
        // Every little while the remembered file gets the better lines, so a reload carries on from here.
        if (Date.now() - savedAt > 10000) { savedAt = Date.now(); if (shown()) showTranslation(to, list, true); else rememberFile(); }
        refreshLangs();
        reportLive(to, state);
      }
      // Done: the saved and downloadable file gets the better lines too.
      if (shown()) {
        showTranslation(to, list, true);
        if (prefs.aiNotices) notice(t(clean ? 'Captions cleaned up by {model}' : 'Translation improved by {model}', { model }), 3000);
      } else rememberFile();
      if (prefs.aiSaveFile) saveImproved(to, list);
      // For the support card: background.js counts each improved page once.
      send({ type: 'count-video', page: pageOfSubs(), ai: true });
      // The episode the subtitles were loaded on, even if the site moved on to the next one meanwhile.
      // With the original's fingerprint, so the same subtitles get it back without asking the model again.
      const keep = { name: improvedName(to), lang: to, model, page: loadedOn || location.href, ms: state.ms,
        title: window === window.top && location.href === loadedOn ? pageTitle() : '', srt: SubLib.toSRT(list) };
      srcKeyOf(base).then((src) => SubSettings.keepSubtitles(Object.assign({ src }, keep), prefs.keepFor)).catch(() => {});
      afterImproved(to, list, state, base);
    } catch (e) {
      if (improving.get(to) !== run) return; // replaced by a pass with another model
      state.error = e.message;
      state.found = e.found || null;
      // Said in the language card, next to Try again (a toast on top of it said it twice).
      // The card opens by itself and stays a while, so it's seen without hovering.
      if (cues === list) showLangs(10000);
    } finally {
      if (improving.get(to) === run) improving.delete(to);
      state.running = state.paused = false;
      refreshLangs();
      if (!improving.has(to)) send({ type: 'ai-live', to, end: true });
    }
  }

  // A reload in the middle of a pass you started: it carries on, while the
  // same model is chosen. Nothing else starts by itself.
  function resumeShown() {
    if (!aiReady() || !cues.length) return;
    const base = baseOf();
    for (const to of [original && file.translatedTo, prefs.secondLang]) {
      const list = to && translations.get(to);
      const s = list && aiState.get(list);
      if (s && s.model === aiModel() && (list === cues || list === secondCues())) improve(to, base, list, true);
    }
  }

  // Another translator or model chosen: a pass running with the old one stops
  // (it would not start again by itself), and the card offers the new one.
  function aiChanged() {
    for (const [to] of [...improving]) {
      const list = translations.get(to);
      const s = list && aiState.get(list);
      if (s && (!aiReady() || s.model !== aiModel())) stopImproving(to, list, true);
    }
    refreshLangs();
  }

  // "Stop" in the card over the video: the chunk being worked on is dropped
  // and Google's lines stay where the model hasn't been yet.
  function stopImproving(to, list, quiet) {
    const state = aiState.get(list);
    if (!state) return;
    state.stopped = true;
    if (improving.has(to)) { improving.delete(to); send({ type: 'ai-stop', to }); }
    state.running = state.paused = false;
    if (original && cues === list && file.translatedTo === to) showTranslation(to, list, true); else rememberFile();
    refreshLangs();
    if (list === cues && !quiet) toast(t(cleaned.has(list) ? 'Stopped cleaning up, the rest stays as YouTube wrote it' : 'Stopped improving, Google’s version stays'), 3000);
  }

  // The main translation on its way: { to, done, total } in lines, for the bar
  // in the card over the video (background.js reports after each batch).
  let translating = null;
  async function translate(to) {
    if (!cues.length) return { ok: false, error: t('Nothing loaded.') };
    const mine = translating = { to, done: 0, total: baseOf().cues.length };
    refreshLangs();
    const r = await fetchTranslation(to);
    if (translating === mine) { translating = null; refreshLangs(); }
    if (!r.ok) return r;
    showTranslation(to, r.list);
    // With an AI translator set up, the card over the video shows its Improve button for a moment.
    if (aiReady()) showLangs();
    return { ok: true, count: r.list.length };
  }

  // Second subtitles: the original or another language, at the opposite edge.
  // Two people can each read their own language (Czech and Vietnamese over a French film).
  let secondPending = null; // { lang, base }: the second translation being fetched
  // The language the second subtitles are in ('orig' for the original), or ''
  // when there are none: dual subtitles off, or the same language as the main ones.
  // The second language you chose, or 'orig' when that is the language the
  // original is in anyway (Czech second over a Czech film): no Google pass, and
  // no two "Czech" switches while the main translation is still on its way.
  // "cs", "cze" and "cs-CZ" are one language, "zh-CN" and "zh-TW" are not.
  const sameLanguage = (a, b) => SubLib.langMatch(a, b) > 0;
  function secondWanted() {
    const lang = prefs.secondLang || 'orig';
    return lang !== 'orig' && origLang && sameLanguage(lang, origLang) ? 'orig' : lang;
  }
  function secondLanguage() {
    if (!settings.dual || !cues.length) return '';
    const lang = secondWanted();
    // The main subtitles already are the original, or its cleaned-up copy in the same language.
    if (lang === 'orig') return original && !cleaned.has(cues) ? lang : '';
    return lang === (original ? file.translatedTo : '') ? '' : lang;
  }
  function secondCues() {
    const lang = secondLanguage();
    if (!lang) return null;
    return lang === 'orig' ? original.cues : translations.get(lang) || null;
  }
  // Switched off, they aren't translated: that waits until they're switched on.
  async function ensureSecond() {
    // The original's language first: a second language that is the original's own needs no Google.
    if (langPending) await langPending;
    const lang = secondWanted();
    const base = baseOf().file;
    if (!settings.dual || !cues.length || !dualVisible || lang === 'orig' || translations.has(lang)) return;
    // A fetch for other subtitles doesn't count: YouTube often sends its captions
    // again while the first translation is still on its way.
    if (secondPending && secondPending.lang === lang && secondPending.base === base) return;
    const mine = secondPending = { lang, base };
    const r = await fetchTranslation(lang, true);
    if (secondPending === mine) secondPending = null;
    if (r.ok) { lastKey = ''; position(true); render(true); refreshLangs(); }
  }

  // Swaps the lines on screen for a translation and keeps the original for "Show original".
  function showTranslation(to, list, quiet) {
    if (!list.length) return;
    if (!original) original = { file, cues };
    translations.set(to, list);
    cues = list;
    const name = original.file.name.replace(SubLib.SUB_FILE, '') + '.' + to + '.srt';
    const ai = aiState.get(list);
    file = { name, b64: SubLib.bytesToBase64(new TextEncoder().encode(SubLib.toSRT(list))), encoding: 'utf-8', usedEncoding: 'utf-8',
      translatedTo: to, origLang, original: original.file, native: nativeSite.get(list) || '', clean: cleaned.has(list),
      // That you asked the AI to improve it and which chunks it already rewrote, so a reload shows it and carries on.
      ai: ai ? { model: ai.model, done: ai.done, chunks: [...ai.chunks], stopped: ai.stopped, ms: ai.ms || 0, kept: ai.kept || 0, shared: ai.shared || null } : null };
    lastKey = '';
    render(true);
    refreshLangs();
    rememberFile();
    // The site's own subtitles in that language: fetchTranslation already said where they came from.
    if (!quiet && !nativeSite.has(list)) notice(t('Translated to {lang}', { lang: SubSettings.languageName(to) }), 3000);
  }

  function showOriginal() {
    if (!original) return;
    cues = original.cues;
    file = original.file;
    original = null;
    lastKey = '';
    render(true);
    refreshLangs();
    rememberFile();
    toast(t('Original subtitles'));
  }

  // ---------- fullscreen ----------

  document.addEventListener('fullscreenchange', () => {
    const fe = document.fullscreenElement;
    if (ownFullscreen && fe !== ownFullscreen.container) {
      video && (video.style.cssText = ownFullscreen.videoStyle);
      ownFullscreen = null;
      setFsMode(false);
      fsBtn.classList.remove('on');
      // The site sized its video for the page before; let it measure again
      // (YouTube's own fullscreen otherwise keeps the small size).
      setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    }
    if (!video || !cues.length) return;
    if (fe === video) bareFullscreen = true;
    else if (!fe && bareFullscreen) {
      bareFullscreen = false;
      if (shortcuts.fullscreen) setTimeout(() => toast(t('This site’s fullscreen hides subtitles. Use {key} instead.', { key: fsKeyText() })), 300);
    }
    placeHost();
    position(true);
    render(true);
  });

  // Our own fullscreen: the video's parent element plus the overlay inside it.
  async function toggleFullscreen() {
    if (!video || smallPlayer(video)) return;
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
      setFsMode(true);
    } catch (e) {
      toast(shortcuts.fullscreen ? t('Click the video once, then press {key}', { key: fsKeyText() }) : t('Click the video once, then try again'));
    }
  }

  // Show the fullscreen button (its exit form in our own fullscreen, nothing
  // in the site's fullscreen) and the language switches
  // (also in fullscreen) briefly when the mouse moves over the video.
  let fsTimer = 0, langsTimer = 0, mouseQueued = false;
  // Runs on every frame the mouse moves, so it only keeps what is already up
  // a while longer: building the card again or testing what covers it each
  // frame made the whole page lag (YouTube with dual subtitles).
  function onMouseMove(e) {
    if (mouseQueued || !video || !fsBtn) return;
    mouseQueued = true;
    requestAnimationFrame(() => {
      mouseQueued = false;
      const r = stageOf(video).getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside || smallPlayer(video)) return;
      let fsAppeared = false, appeared = false;
      const ours = ownFullscreen && document.fullscreenElement === ownFullscreen.container;
      if (ours || (!document.fullscreenElement && cues.length)) {
        fsAppeared = !fsBtn.classList.contains('on');
        fsBtn.classList.add('on');
        clearTimeout(fsTimer);
        fsTimer = setTimeout(() => { fsBtn.classList.remove('on'); liftForControls(); }, 2000);
      }
      if (langsEl.classList.contains('on')) keepLangs();
      else { showLangs(); appeared = langsEl.classList.contains('on'); }
      // Something that just appeared is checked at once, the rest a few times a second.
      if (fsAppeared || appeared) checkCovered(); else checkCoveredSoon();
      if (fsAppeared) liftForControls(); // subtitles at the top step below the button
    });
  }

  // ---------- the one-time "support the creator" card ----------

  // Under the language switches, once SubSettings.supportAskDue says so: on 3
  // videos at most, and any click on it (the cross too) ends it for good.
  const KOFI = 'https://ko-fi.com/cleedek';
  const STORE = 'https://chromewebstore.google.com/detail/subtitle-overlay/kfiihdconjdcclppmdhopeejkbmkkalo';
  const GITHUB = 'https://github.com/Cleedek/subtitle-overlay';
  const ICON = {
    heart: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13.5S2 10 2 6a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 4-6 7.5-6 7.5Z" fill="currentColor"/></svg>',
    share: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 10V2M5 5l3-3 3 3M3.5 8v5.5h9V8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    star: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.6l1.95 4.02 4.43.62-3.22 3.1.78 4.4L8 11.65l-3.94 2.09.78-4.4L1.62 6.24l4.43-.62L8 1.6Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    github: '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>',
    close: '<svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3 3 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  };
  let askData = null; // { stats, installedAt, supportAsk } from storage
  chrome.storage.local.get(['stats', 'installedAt', 'supportAsk']).then((v) => { askData = v; }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !askData) return;
    for (const k of ['stats', 'installedAt', 'supportAsk']) if (changes[k]) askData[k] = changes[k].newValue;
    if (changes.supportAsk && askData.supportAsk && askData.supportAsk.done && askEl) askEl.classList.remove('on');
  });

  // Due, over a translation, on a video tall enough (a small one waits for a
  // bigger one), and on one of its 3 pages. A 4th page ends it for good.
  function askWanted() {
    if (!askData || !original || !cues.length || !video) return false;
    const a = askData.supportAsk || {};
    if (a.done || !SubSettings.supportAskDue(askData.stats, askData.installedAt)) return false;
    if (stageOf(video).getBoundingClientRect().height < 300) return false;
    const pages = a.pages || [];
    const id = SubSettings.fingerprint(String(pageOfSubs()));
    if (pages.includes(id)) return true;
    if (pages.length >= SubSettings.SUPPORT_ASK.pages) { endAsk(); return false; }
    askData.supportAsk = Object.assign({}, a, { pages: pages.concat(id) });
    send({ type: 'support-ask', page: id });
    return true;
  }

  function endAsk() {
    if (askData) askData.supportAsk = Object.assign({}, askData.supportAsk, { done: true });
    send({ type: 'support-ask', done: true });
    if (askEl) askEl.classList.remove('on');
  }

  // With the language switches: right under them, compact on a smaller video.
  function updateAsk() {
    if (!askEl) return;
    // "Share it with others?" goes first: the support card waits while it's there.
    const shareOn = langsEl.classList.contains('on') && !!shareAsking && !!video;
    if (shareOn && !shareEl.firstChild) fillShareAsk();
    shareEl.classList.toggle('on', shareOn);
    if (shareOn) shareEl.style.top = (langsEl.offsetTop + langsEl.offsetHeight + 8) + 'px';
    const on = langsEl.classList.contains('on') && !shareOn && askWanted();
    if (on && !askEl.firstChild) fillAsk();
    askEl.classList.toggle('on', on);
    if (!on) return;
    // The switches step down below the fullscreen button at times: right under wherever they are.
    askEl.style.top = (langsEl.offsetTop + langsEl.offsetHeight + 8) + 'px';
    askEl.classList.toggle('compact', stageOf(video).getBoundingClientRect().height < 500);
  }

  function fillAsk() {
    const stats = (askData && askData.stats) || {};
    const n = stats.videos || 0;
    const link = (cls, href) => {
      const a = el('a', cls);
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.addEventListener('click', endAsk);
      return a;
    };
    const share = (cls) => {
      const b = el('button', cls);
      b.addEventListener('click', async () => {
        endAsk();
        try { await navigator.clipboard.writeText(STORE); toast(t('The link is copied. Send it to someone who’d like it.'), 3500); }
        catch (e) { toast(STORE, 6000); }
      });
      return b;
    };
    const photo = (size) => {
      const img = el('img');
      img.src = chrome.runtime.getURL('icons/support/filip.jpg');
      img.width = img.height = size;
      img.alt = '';
      img.addEventListener('error', () => img.remove()); // a page that blocks it: the card works without
      return img;
    };
    const two = (strong, small, tagStrong, tagSmall) => {
      const d = el('div');
      d.append(el(tagStrong || 'b', '', strong), el(tagSmall || 'small', '', small));
      return d;
    };

    const close = el('button', 'x');
    close.innerHTML = ICON.close;
    close.title = close.ariaLabel = t('Close (it won’t come back)');
    close.addEventListener('click', endAsk);

    const hello = el('div', 'hello');
    hello.append(el('strong', '', t('{n} videos translated', { n })));
    if (stats.lines) hello.append(el('span', '', t('That’s {count} translated lines. Nice!', { n: stats.lines, count: stats.lines.toLocaleString(SubI18n.lang) })));
    // The why, under a thin line, apart from the numbers.
    const intro = el('p', 'intro', t('I make Subtitle Overlay on my own, for free. Any support helps me keep giving it the care it deserves.'));

    const tile = el('div', 'tile');
    const who = el('div', 'who');
    who.append(photo(38), two(t('Send me any tip you like'), t('No account needed'), 'strong', 'span'));
    const logos = el('img', 'logos');
    logos.src = chrome.runtime.getURL('icons/support/pay-logos-dark.svg');
    logos.alt = 'Google Pay, Apple Pay, PayPal, Visa, Mastercard';
    logos.addEventListener('error', () => logos.remove());
    const main = link('main', KOFI);
    main.innerHTML = ICON.heart;
    main.append(t('Support the creator'));
    tile.append(who, logos, main, el('span', 'more', t('More ways to pay in the extension popup')));

    const minor = el('div', 'minor');
    const shareBtn = share('');
    shareBtn.innerHTML = ICON.share;
    shareBtn.append(two(t('Share with a friend'), t('Copies the link')));
    const review = link('', STORE + '/reviews');
    review.innerHTML = ICON.star;
    review.append(two(t('Write a review'), t('In the Chrome Web Store')));
    minor.append(shareBtn, review);

    const gh = link('gh', GITHUB);
    gh.innerHTML = ICON.github;
    gh.append(t('Or give it a star on GitHub'));

    // The smaller video's version.
    const compact = el('div', 'compact');
    const cWho = el('div', 'who');
    cWho.append(photo(34), two(t('{n} videos translated', { n }), t('I make it on my own, for free. Will you support me?'), 'strong', 'span'));
    const cMain = link('main', KOFI);
    cMain.innerHTML = ICON.heart;
    cMain.append(t('Support the creator'));
    const links = el('div', 'links');
    const cShare = share('');
    cShare.textContent = t('Share with a friend');
    const cReview = link('', STORE + '/reviews');
    cReview.textContent = t('Write a review');
    const cGh = link('', GITHUB);
    cGh.textContent = 'GitHub ★';
    links.append(cShare, '·', cReview, '·', cGh);
    compact.append(cWho, cMain, links);

    askEl.setAttribute('aria-label', t('Support the creator'));
    askEl.append(close, hello, intro, tile, minor, gh, el('p', 'once', t('You’ll only see this once.')), compact);
  }

  // ---------- help: "turn the site's subtitles on" and "report a problem" ----------

  // Many sites send their subtitles only once you switch them on in their own
  // player. When a video has played a while with sound and none came, a card
  // in the bottom right says so (once per site). After that a small "Help"
  // label shows there while the mouse moves over the video. Both open a short
  // check that fixes the common cases and ends in a problem report, which
  // sends only the site's name and the checks shown (background.js).
  const HELP_AFTER_MS = 10000;
  const PROBLEMS = {
    no_subs: 'Subtitles don’t show',
    bad_translation: 'Translation is wrong',
    timing: 'Subtitles are out of sync',
    other: 'Something else',
  };
  let helpEl = null;
  let helpVideo = null;   // the video being watched for it
  let helpPlayed = 0;     // ms it played with sound, no subtitles
  let helpArmed = false;  // played long enough: the label may show
  let helpMode = '';      // '' | 'hint' | 'pill' | 'wizard'
  let helpTimer = 0, pillTimer = 0, helpMouseQueued = false;
  let wiz = null;         // { step, problem, note, sending }
  const hasSubs = () => !!(offered || cues.length);

  const HELP_CSS = `
    :host([data-rtl]) .help { direction: rtl; }
    .help {
      position: absolute; inset-inline-end: 12px; bottom: max(76px, 14%); display: none; pointer-events: auto;
      font: 500 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff;
    }
    .help.on { display: block; }
    .help button, .help textarea { font: inherit; color: #fff; }
    .help button { cursor: pointer; border: 0; }
    .help .pill {
      display: flex; align-items: center; gap: 7px; padding: 7px 12px 7px 10px; border-radius: 999px;
      background: rgba(20,20,20,.86); font-weight: 600; font-size: 12.5px;
    }
    .help .pill:hover { background: rgba(40,40,40,.95); }
    .help .pill i { font-style: normal; display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: #7a41e4; font-size: 11px; font-weight: 800; }
    .help .pill u { text-decoration: none; color: #c4b5fd; }
    .help .card {
      position: relative; width: 300px; max-width: calc(100vw - 24px); max-height: var(--help-max, 420px); overflow: auto;
      display: flex; flex-direction: column; gap: 10px; padding: 14px 12px 12px; border-radius: 12px;
      background: rgba(20,20,20,.94); box-shadow: 0 12px 32px -8px rgba(0,0,0,.6);
      animation: help-in .35s cubic-bezier(.25, 1, .5, 1) both;
    }
    @keyframes help-in { from { opacity: 0; transform: translateY(6px) scale(.98); } }
    @media (prefers-reduced-motion: reduce) { .help .card { animation: none; } }
    .help .head { display: flex; align-items: center; gap: 6px; padding-inline-end: 26px; min-height: 24px; }
    .help .head strong { font-size: 14.5px; font-weight: 700; line-height: 1.3; }
    .help .x, .help .back { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border-radius: 7px; background: transparent; color: rgba(255,255,255,.65); flex: none; }
    .help .x { position: absolute; top: 10px; inset-inline-end: 8px; }
    .help .x:hover, .help .back:hover { background: rgba(255,255,255,.14); color: #fff; }
    :host([data-rtl]) .help .back svg { transform: scaleX(-1); }
    .help p { margin: 0; }
    .help .lead { font-size: 13.5px; font-weight: 600; }
    .help .soft { font-size: 12px; color: rgba(255,255,255,.7); line-height: 1.45; }
    .help .acts { display: flex; gap: 6px; flex-wrap: wrap; }
    .help .btn { padding: 7px 12px; border-radius: 8px; background: rgba(255,255,255,.14); font-weight: 600; font-size: 12.5px; }
    .help .btn:hover { background: rgba(255,255,255,.24); }
    .help .btn.main { background: #7c3aed; }
    .help .btn.main:hover { background: #8b5cf6; }
    .help .btn:disabled { opacity: .6; cursor: default; }
    .help .link { align-self: flex-start; padding: 2px 4px; margin: -4px -4px 0; border-radius: 5px; background: none; color: rgba(255,255,255,.55); font-size: 11.5px; }
    .help .link:hover { color: #fff; background: rgba(255,255,255,.1); }
    .help .chips { display: flex; flex-direction: column; gap: 6px; }
    .help .chip { text-align: start; padding: 9px 11px; border-radius: 9px; background: rgba(255,255,255,.08); font-weight: 600; }
    .help .chip:hover { background: rgba(255,255,255,.16); }
    .help .steps { display: flex; flex-direction: column; gap: 9px; margin: 0; padding: 0; list-style: none; }
    .help .steps li { display: grid; grid-template-columns: 20px 1fr; gap: 8px; align-items: start; }
    .help .dot { width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; font-size: 10.5px; font-weight: 800; margin-top: 1px; }
    .help .dot.ok { background: rgba(134,239,172,.18); color: #86efac; }
    .help .dot.now { background: rgba(252,211,77,.2); color: #fcd34d; }
    .help .dot.todo { box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.28); color: rgba(255,255,255,.6); }
    .help .steps b { display: block; font-weight: 600; }
    .help .steps small { display: block; margin-top: 2px; font-size: 11.5px; color: rgba(255,255,255,.66); line-height: 1.45; }
    .help .steps .btn { margin-top: 6px; padding: 4px 10px; font-size: 11.5px; }
    .help .good { display: flex; gap: 8px; align-items: center; padding: 9px 10px; border-radius: 9px; background: rgba(134,239,172,.12); color: #bbf7d0; font-weight: 600; }
    .help dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 0; padding: 9px 10px; border-radius: 9px; background: rgba(255,255,255,.07); font-size: 12px; }
    .help dt { color: rgba(255,255,255,.6); }
    .help dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
    .help textarea {
      resize: vertical; min-height: 56px; padding: 8px 10px; border-radius: 9px; border: 1px solid rgba(255,255,255,.16);
      background: rgba(255,255,255,.06); font-size: 12.5px;
    }
    .help textarea:focus { outline: 2px solid #7c3aed; outline-offset: 0; border-color: transparent; }
    .help button:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }
  `;
  const BACK_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function ensureHelp() {
    ensureHost();
    if (helpEl) return;
    const style = document.createElement('style');
    style.textContent = HELP_CSS;
    helpEl = el('div', 'help');
    helpEl.setAttribute('role', 'dialog');
    // Clicks and keys stay ours: no pause, no fullscreen, no player shortcuts while typing.
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'keydown', 'keyup', 'keypress', 'wheel']) {
      helpEl.addEventListener(type, (e) => e.stopPropagation());
    }
    helpEl.addEventListener('mouseleave', () => { if (helpMode === 'pill') hidePillSoon(1200); });
    shadow.append(style, helpEl);
  }

  // A video plays somewhere on the page: watch it for a while. "timeupdate"
  // too, for a video that started before this script did (autoplay).
  function onHelpPlay(e) {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement) || off || hasSubs()) return;
    if (v === helpVideo && helpTimer) return;
    if (v !== helpVideo) {
      if (helpVideo && helpVideo.isConnected && isPlaying(helpVideo) && area(helpVideo) >= area(v)) return; // a preview next to the main one
      helpVideo = v; helpPlayed = 0; helpArmed = false;
    }
    if (!helpTimer && isPlaying(v)) helpTimer = setInterval(helpWatch, 1000);
  }
  document.addEventListener('playing', onHelpPlay, true);
  document.addEventListener('timeupdate', onHelpPlay, true);

  function stopHelpWatch() {
    clearInterval(helpTimer);
    helpTimer = 0;
  }

  function helpWatch() {
    if (helpMode === 'wizard') renderWizard(); // its checks follow what happens
    const v = helpVideo;
    if (!v || !v.isConnected || off) { if (helpMode !== 'wizard') stopHelpWatch(); return; }
    if (hasSubs()) {
      if (helpMode === 'hint' || helpMode === 'pill') hideHelp();
      helpArmed = false;
      helpPlayed = 0;
      if (helpMode !== 'wizard') stopHelpWatch();
      return;
    }
    if (!isPlaying(v)) { if (helpMode !== 'wizard') stopHelpWatch(); return; } // the next "playing" starts it again
    const watching = !v.muted && v.volume > 0 && area(v) > 0 && !smallPlayer(v)
      && !(v.closest && v.closest('.ad-showing')) && document.visibilityState === 'visible';
    if (!watching) return;
    helpPlayed += 1000;
    if (!helpArmed && helpPlayed >= HELP_AFTER_MS) armHelp(v);
  }

  async function armHelp(v) {
    helpArmed = true;
    const r = stageOf(v).getBoundingClientRect();
    if (r.width < 360 || r.height < 200) return; // a preview or a small embed
    if (video !== v && !cues.length) attach(v); // the overlay sits over this video
    ensureHelp();
    position(true);
    enableHelpMouse(true);
    const st = await chrome.storage.local.get(['helpSites', 'helpOff']).catch(() => ({}));
    if (hasSubs() || helpMode) return;
    const sites = Array.isArray(st.helpSites) ? st.helpSites : [];
    if (st.helpOff || !site || sites.includes(site)) return;
    chrome.storage.local.set({ helpSites: sites.concat(site).slice(-200) }).catch(() => {});
    showHint();
  }

  function enableHelpMouse(on) {
    document[on ? 'addEventListener' : 'removeEventListener']('mousemove', onHelpMouse, { passive: true, capture: true });
  }
  function onHelpMouse(e) {
    if (helpMouseQueued || !helpArmed || helpMode === 'hint' || helpMode === 'wizard' || hasSubs() || !helpVideo || off) return;
    helpMouseQueued = true;
    requestAnimationFrame(() => {
      helpMouseQueued = false;
      if (smallPlayer(helpVideo)) return;
      const r = stageOf(helpVideo).getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      showPill();
    });
  }

  function setHelp(mode, nodes) {
    ensureHelp();
    helpMode = mode;
    helpEl.replaceChildren(...nodes);
    helpEl.classList.toggle('on', !!mode);
    if (!mode) return;
    if (video) position(true);
    const h = stageOf(video || helpVideo).getBoundingClientRect().height;
    helpEl.style.setProperty('--help-max', Math.max(200, Math.round(h * 0.86 - 76)) + 'px');
    checkCovered();
  }
  function hideHelp() {
    clearTimeout(pillTimer);
    wiz = null;
    if (helpEl) setHelp('', []);
  }

  function button(cls, text, onClick) {
    const b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  function closeButton(onClick) {
    const b = button('x', '', onClick);
    b.innerHTML = ICON.close;
    b.title = t('Close');
    b.setAttribute('aria-label', t('Close'));
    return b;
  }

  // The card once per site: turn the subtitles on in the player.
  function showHint() {
    const card = el('div', 'card');
    card.setAttribute('aria-label', t('Turn on subtitles in the player'));
    const head = el('div', 'head');
    head.append(el('strong', '', t('Turn on subtitles in the player')));
    const never = button('link', t('Don’t show this again'), () => {
      chrome.storage.local.set({ helpOff: true }).catch(() => {});
      hideHelp();
    });
    card.append(closeButton(hideHelp), head,
      el('p', 'lead', t('Then I’ll translate them: {lang}', { lang: langLabel(prefs.translateTo) })),
      el('p', 'soft', t('Some sites send their subtitles only once you turn them on in their player. Until then I can’t see them. Any language works.')));
    const acts = el('div', 'acts');
    acts.append(button('btn main', t('Got it'), hideHelp), button('btn', t('Still nothing?'), () => openWizard('no_subs')));
    card.append(acts, never);
    setHelp('hint', [card]);
  }

  // The small label while the mouse moves over a video without subtitles.
  function showPill() {
    if (helpMode !== 'pill') {
      const pill = button('pill', '', () => openWizard('no_subs'));
      pill.append(el('i', '', '?'), t('No subtitles?'), ' ', el('u', '', t('Help')));
      setHelp('pill', [pill]);
    }
    hidePillSoon(2500);
  }
  function hidePillSoon(ms) {
    clearTimeout(pillTimer);
    pillTimer = setTimeout(() => {
      if (helpMode !== 'pill') return;
      if (helpEl.matches(':hover')) return hidePillSoon(1200);
      hideHelp();
    }, ms);
  }

  // ---------- the check and the report ----------

  function openWizard(problem) {
    ensureHelp();
    helpEl.dataset.key = helpEl.dataset.step = '';
    wiz = { step: problem ? (problem === 'other' ? 'send' : 'check') : 'pick', problem: problem || '', note: '', from: problem ? 'video' : 'langs' };
    if (!helpTimer) helpTimer = setInterval(helpWatch, 1000);
    renderWizard();
    const first = helpEl.querySelector('.chip, .btn.main, textarea');
    if (first) first.focus({ preventScroll: true });
  }

  function step(dotKind, mark, title, note, extra) {
    const li = el('li');
    const body = el('div');
    body.append(el('b', '', title));
    if (note) body.append(el('small', '', note));
    if (extra) body.append(extra);
    li.append(el('span', 'dot ' + dotKind, mark), body);
    return li;
  }

  function renderWizard() {
    if (!wiz) return;
    // Re-drawing every second would throw away what you type and where the focus is.
    if (wiz.step === 'send' || wiz.step === 'sent' || wiz.step === 'failed') {
      if (helpMode === 'wizard' && helpEl.dataset.step === wiz.step) return;
    }
    const key = wiz.step + ':' + hasSubs() + ':' + !!(video || helpVideo);
    if (helpMode === 'wizard' && helpEl.dataset.key === key) return;
    helpEl.dataset.key = key;
    helpEl.dataset.step = wiz.step;

    const card = el('div', 'card');
    const head = el('div', 'head');
    if (wiz.step === 'check' || wiz.step === 'send' || wiz.step === 'failed') {
      const back = button('back', '', () => {
        wiz.step = wiz.step === 'check' || !wiz.problem || wiz.problem === 'other' ? 'pick' : 'check';
        if (wiz.step === 'pick') wiz.problem = '';
        renderWizard();
      });
      back.innerHTML = BACK_SVG;
      back.title = t('Back');
      back.setAttribute('aria-label', t('Back'));
      head.append(back);
    }
    const titles = { pick: 'What’s wrong?', check: 'Let’s try to fix it', send: 'Send a report', sent: 'Thank you', failed: 'Couldn’t send it' };
    head.append(el('strong', '', t(titles[wiz.step])));
    card.setAttribute('aria-label', t(titles[wiz.step]));
    card.append(closeButton(hideHelp), head);

    if (wiz.step === 'pick') {
      const chips = el('div', 'chips');
      for (const [k, label] of Object.entries(PROBLEMS)) {
        chips.append(button('chip', t(label), () => {
          wiz.problem = k;
          wiz.step = k === 'other' ? 'send' : 'check';
          renderWizard();
        }));
      }
      card.append(chips);
    } else if (wiz.step === 'check') {
      card.append(...checkFor(wiz.problem));
    } else if (wiz.step === 'send') {
      card.append(...sendForm());
    } else if (wiz.step === 'sent') {
      card.append(el('p', 'soft', t('Only the site’s name and the checks went out. I look at every site that comes up, and the most reported ones first.')));
      const acts = el('div', 'acts');
      acts.append(button('btn main', t('Close'), hideHelp));
      card.append(acts);
    } else if (wiz.step === 'failed') {
      card.append(el('p', 'soft', t('Check your connection and try again in a moment.')));
      const acts = el('div', 'acts');
      acts.append(button('btn main', t('Try again'), () => { wiz.step = 'send'; sendReport(); }), button('btn', t('Close'), hideHelp));
      card.append(acts);
    }
    setHelp('wizard', [card]);
  }

  function checkFor(problem) {
    const out = [];
    const acts = el('div', 'acts');
    const report = (label) => button('btn' + (label ? '' : ' main'), t(label || 'Still nothing, report it'), () => { wiz.step = 'send'; renderWizard(); });
    if (problem === 'no_subs') {
      if (hasSubs()) {
        const good = el('div', 'good');
        good.append('✓ ', t('It works now. The subtitles arrived.'));
        out.push(good);
        acts.append(button('btn main', t('Close'), hideHelp), report('Report it anyway'));
        out.push(acts);
        return out;
      }
      const list = el('ol', 'steps');
      const hasVideo = !!(video || helpVideo);
      list.append(
        step(hasVideo ? 'ok' : 'now', hasVideo ? '✓' : '!', t(hasVideo ? 'Video found' : 'No video found yet'), hasVideo ? '' : t('Start the video, then open this again.')),
        step('now', '2', t('Turn on subtitles in the player'), t('Use the CC or Subtitles button in the site’s player and let the video play a few seconds. This check updates by itself.')),
        step('todo', '3', t('Still nothing? Reload the page'), t('Needed after the extension updates. Then start the video again.'),
          button('btn', t('Reload page'), () => location.reload())),
        step('todo', '4', t('Not every video has subtitles'), t('If the player offers none, there is nothing to translate.')),
      );
      out.push(list);
      acts.append(report());
    } else {
      // Shared subtitles on screen: reporting them (3 reports hide them for everyone) and Google's version back.
      const sharedOn = problem === 'bad_translation' && [[cues, original && file.translatedTo], [secondCues(), secondLanguage()]]
        .find(([list]) => list && aiState.get(list) && aiState.get(list).shared);
      if (sharedOn) {
        const [list, lang] = sharedOn;
        const info = aiState.get(list).shared;
        out.push(el('p', 'soft', t('These are shared subtitles from user #{tag}.', { tag: info.tag })));
        const fix = el('div', 'acts');
        fix.append(button('btn main', t('Report them and go back to Google'), () => {
          send({ type: 'share-report', id: info.id });
          backToGoogle(lang, list);
          hideHelp();
          toast(t('Thanks, reported. Back to Google’s version.'), 3500);
        }));
        out.push(fix);
      }
      const tips = problem === 'timing'
        ? [['Shift the subtitles', 'Open the extension and use Sync to move them earlier or later.']]
        : [['Try Improve with AI', 'In the language switches over the video or in the extension. AI translation reads the whole scene, so it sounds more natural.'],
          ['Check the language', 'The language you translate into is in the extension, on the Subtitles tab.']];
      const list = el('ol', 'steps');
      tips.forEach(([title, note], i) => list.append(step('todo', String(i + 1), t(title), t(note))));
      out.push(list);
      acts.append(report('Report it'));
    }
    out.push(acts);
    return out;
  }

  function reportData() {
    return {
      site,
      problem: wiz.problem || 'other',
      checks: { video: !!(video || helpVideo), siteSubs: hasSubs() },
      translateTo: prefs.translateTo || '',
      lang: SubI18n.lang,
      note: wiz.note.trim(),
    };
  }

  function sendForm() {
    const d = reportData();
    const yes = t('Yes'), no = t('No');
    const dl = el('dl');
    for (const [k, v] of [['Site', d.site], ['Problem', t(PROBLEMS[d.problem])], ['Video', d.checks.video ? yes : no],
      ['Subtitles from the site', d.checks.siteSubs ? yes : no], ['Version', chrome.runtime.getManifest().version]]) {
      dl.append(el('dt', '', t(k)), el('dd', '', v));
    }
    const note = el('textarea');
    note.rows = 3;
    note.maxLength = 1000;
    note.placeholder = t('Anything to add? (optional)');
    note.setAttribute('aria-label', t('Anything to add? (optional)'));
    note.value = wiz.note;
    note.addEventListener('input', () => { wiz.note = note.value; });
    const acts = el('div', 'acts');
    const go = button('btn main', t('Send'), sendReport);
    go.disabled = !!wiz.sending || !site;
    acts.append(go);
    return [dl, note, acts, el('p', 'soft', t('Only the site’s name and the details above are sent, never the page address or what you watch.'))];
  }

  async function sendReport() {
    if (!wiz || wiz.sending) return;
    wiz.sending = true;
    const go = helpEl.querySelector('.btn.main');
    if (go) { go.disabled = true; go.textContent = t('Sending…'); }
    const res = await send({ type: 'report-problem', report: reportData() });
    if (!wiz) return;
    wiz.sending = false;
    wiz.step = res && res.ok ? 'sent' : 'failed';
    renderWizard();
  }

  window.addEventListener('scroll', () => helpMode && !cues.length && position(false), { capture: true, passive: true });

  // ---------- language switches (dual subtitles) ----------

  const cap = (s) => s.charAt(0).toLocaleUpperCase(SubI18n.lang) + s.slice(1);
  function langLabel(code) {
    return code ? (SubSettings.flag(code) + ' ' + cap(SubSettings.languageName(code))).trim() : t('Original');
  }

  // One language on or off (its switch over the video, or its shortcut). The
  // page remembers it, so a reload keeps it off; one switched on is translated
  // now if it wasn't yet. True when it is on now.
  function flipLang(second) {
    const on = second ? (dualVisible = !dualVisible) : (visible = !visible);
    // The last one switched off: everything is off now, like after Alt + S or
    // YouTube's CC button, and switching back on with those brings back this one.
    shownBefore = visible || dualVisible ? null : { visible: !second, dualVisible: second };
    lastKey = '';
    position(true);
    render(true);
    ensureSecond();
    rememberFile();
    return on;
  }

  // The names of the main and the second subtitles, with their flags.
  function langLabels() {
    const mainLang = original ? file.translatedTo : origLang;
    const secondLang = secondWanted() === 'orig' ? origLang : secondWanted();
    return { main: langLabel(mainLang), second: langLabel(secondLang) };
  }

  // One switch per language while dual subtitles are on in the settings, even
  // with one of them hidden, so it can be switched back on. Below them, for each
  // translation on screen (not the original): how far the AI got with it, or
  // its Improve button. The top one first. False when there is nothing to show.
  function fillLangs() {
    if (!cues.length) {
      // Nothing on the video, but the site has subtitles (the card went away, or
      // you removed them): one click brings them, the way the card would.
      const item = offered;
      if (!item || foundEl.classList.contains('on')) return false;
      const b = el('button', 'offer', t('Show over video'));
      b.title = item.lang ? (SubSettings.flag(item.lang) + ' ' + item.lang).trim() : item.name;
      b.addEventListener('click', async () => {
        b.disabled = true;
        if (prefs.autoTranslate) await autoShow(item);
        else {
          // loadBytes says how many lines came; only a problem needs more than that.
          const res = await chrome.runtime.sendMessage({ type: 'fetch-item', id: item.id }).catch((e) => ({ ok: false, error: e.message }));
          const r = res && res.ok ? loadBytes(res.name, res.b64, 'auto', liveVideo(), res.asr) : { ok: false, error: res ? res.error : t('Failed.') };
          if (!r.ok) toast(t('Didn’t work: {error}', { error: r.error }), 5000);
        }
        showLangs();
      });
      langsEl.replaceChildren(b);
      return true;
    }
    const second = secondCues();
    // Switched off before it was ever translated, the second language still gets its switch.
    const hasSecond = !!second || (!dualVisible && !!secondLanguage());
    const labels = langLabels();
    const main = { label: labels.main, lang: original && file.translatedTo, list: cues, on: visible, second: false };
    const dual = { label: labels.second, lang: secondWanted(), list: second, on: dualVisible, second: true };
    // With one language the card is its on/off switch: no shortcut to remember.
    const rows = !hasSecond ? [main] : settings.place === 'top' ? [main, dual] : [dual, main];
    const switches = rows.map((row) => {
      const b = el('button');
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-checked', String(row.on));
      b.append(el('span', 'name', row.label), el('span', 'sw'));
      b.addEventListener('click', () => {
        if (hasSecond) flipLang(row.second); else runAction(ACTIONS.toggle);
        showLangs();
      });
      return b;
    });
    const progress = rows.filter((row) => row.list && row.lang && row.lang !== 'orig' && !nativeSite.has(row.list) && (aiState.has(row.list) || aiReady() || sharedOffer.has(row.list) || queueJobFor(row.lang)))
      .map((row) => aiRow(row.lang, row.list));
    if (cleanable() && aiReady()) progress.push(cleanRow());
    // While Google translates: its bar, in place of the switch the new language gets when it's done.
    if (translating) progress.unshift(translatingRow(translating));
    const report = el('button', 'report', t('Report a problem'));
    report.addEventListener('click', () => { langsEl.classList.remove('on'); openWizard(''); });
    langsEl.replaceChildren(...switches, ...progress, report);
    return switches.length + progress.length > 0;
  }

  // YouTube's automatic captions on screen as they came, in the language you read:
  // nothing to translate, but the AI can add punctuation and fix misheard words.
  function cleanable() {
    return !original && !!file && !!file.asr && cues.length > 0 && !!origLang && sameLanguage(origLang, prefs.translateTo);
  }
  // "🇨🇿 gemma3:12b", "YouTube auto captions · 640 lines", then Improve (the same button as for a translation).
  function cleanRow() {
    const row = el('div', 'ai');
    const head = el('div', 'ai-head');
    head.append(el('span', 'name', (SubSettings.flag(prefs.translateTo) + ' ' + aiModel()).trim()));
    const foot = el('div', 'ai-foot');
    const b = el('button', 'ai-act', t('Improve'));
    b.title = t('Fixes punctuation, misheard words and broken sentences with {model}, starting where the video is now.', { model: aiModel() });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      startClean();
      showLangs();
    });
    foot.append(b);
    row.append(head, el('div', 'ai-note', t('YouTube auto captions') + ' · ' + t('{n} lines', { n: cues.length })), foot);
    return row;
  }
  // A copy of the captions goes on screen like a translation into their own
  // language, and the AI rewrites it chunk by chunk. Cleaned before (then
  // "Show original"): that copy comes back and carries on.
  function startClean() {
    if (!cleanable()) return;
    const to = prefs.translateTo;
    const base = baseOf();
    let list = translations.get(to);
    if (!list || !cleaned.has(list)) {
      list = base.cues.map((c) => ({ start: c.start, end: c.end, text: c.text }));
      cleaned.add(list);
    }
    showTranslation(to, list, true);
    improve(to, base, list, false);
  }

  // "🇻🇳 Google 47 %", a bar, and "Translating · 300 / 640 lines". Before the
  // first batch is back the bar only runs to and fro: no share to tell yet.
  function translatingRow(job) {
    const row = el('div', 'ai running' + (job.done ? '' : ' waiting'));
    const head = el('div', 'ai-head');
    const share = Math.floor((job.done / job.total) * 100) / 100;
    head.append(el('span', 'name', (SubSettings.flag(job.to) + ' Google').trim()));
    if (job.done) head.append(el('span', 'pct', new Intl.NumberFormat(SubI18n.lang, { style: 'percent' }).format(share)));
    const bar = el('div', 'ai-bar');
    const fill = el('span');
    if (job.done) fill.style.width = share * 100 + '%';
    bar.append(fill);
    const lines = t('{n} lines', { n: job.total });
    const foot = el('div', 'ai-foot');
    foot.append(el('div', 'ai-note', t('Translating') + ' · ' + (job.done ? job.done + ' / ' + lines : lines)));
    row.append(head, bar, foot);
    return row;
  }

  // For the popup: which model worked on these lines and whether it's still at it.
  function aiReport(list) {
    const s = aiState.get(list);
    return s ? { model: s.model, running: s.running, finished: aiFinished(s) } : null;
  }

  // The improved lines as an .srt in Downloads, named like the file they came from.
  const improvedName = (lang) => baseOf().file.name.replace(SubLib.SUB_FILE, '') + '.' + lang + '.srt';
  function saveImproved(lang, list) {
    SubLib.saveText(SubLib.toSRT(list), improvedName(lang));
  }

  // "🇨🇿 gemini-2.5-flash 47 %", a bar, and "Improving · 300 / 640 lines".
  // Not asked yet, or asked with another model than the one chosen now: Improve.
  function aiRow(lang, list) {
    const s = aiState.get(list);
    // In the translation queue (and not being improved here, nor already its finished copy): how far it got.
    const q = queueJobFor(lang);
    if (q && q.status === 'done' && !queueApplied.has(q.id) && showsQueued(list, q)) queueApplied.add(q.id);
    if (q && !(s && s.running) && !(q.status === 'done' && queueApplied.has(q.id) && s)) return queueRow(lang, list, q);
    if (s && s.shared && !s.running) return sharedRow(lang, list, s, null);
    if (!s && sharedOffer.has(list)) return sharedRow(lang, list, null, sharedOffer.get(list));
    if (!s || (aiReady() && s.model !== aiModel() && !s.running)) return offerRow(lang, list, s);
    // A finished pass is all of it, also for a count saved before the count went by lines gone through.
    const done = aiFinished(s) ? s.total : Math.min(s.done, s.total);
    const share = Math.floor((done / s.total) * 100) / 100;
    const finished = aiFinished(s);
    const row = el('div', 'ai' + (s.running && !s.paused ? ' running' : '') + (s.error ? ' error' : '') + (finished ? ' done' : ''));
    const head = el('div', 'ai-head');
    // Finished: a green bar and a check, as the queue shows a finished file.
    head.append(el('span', 'name', (SubSettings.flag(lang) + ' ' + s.model).trim()),
      finished ? el('span', 'ai-check', '✓') : el('span', 'pct', new Intl.NumberFormat(SubI18n.lang, { style: 'percent' }).format(share)));
    const bar = el('div', 'ai-bar');
    const fill = el('span');
    fill.style.width = share * 100 + '%';
    bar.append(fill);
    const note = s.error ? t('Stopped') + ': ' + s.error
      : finished && s.kept ? t('Improved on this computer · {date}', { date: new Intl.DateTimeFormat(SubI18n.lang, { day: 'numeric', month: 'numeric' }).format(s.kept) })
      : t(s.running ? (s.paused ? 'Paused' : 'Improving') : aiFinished(s) ? 'Improved' : 'Stopped') + ' · ' + done + ' / ' + t('{n} lines', { n: s.total });
    const foot = el('div', 'ai-foot');
    foot.append(el('div', 'ai-note', note));
    // Stop a pass (a local model can keep the computer busy for minutes), or carry on with a stopped one.
    if (!aiFinished(s) && (s.running || aiReady())) {
      const b = el('button', 'ai-act', t(s.running ? 'Stop' : s.error ? 'Try again' : 'Continue'));
      b.title = s.running ? t('Stops improving. The lines done so far stay.') : t('Carries on improving from here.');
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (s.running) stopImproving(lang, list);
        else improve(lang, baseOf(), list, false);
        showLangs();
      });
      // The address set doesn't answer, but the usual one does: fixed from here.
      if (s.error && s.found) {
        const use = el('button', 'ai-act', t('Use {url}', { url: s.found.url.replace(/^https?:\/\//, '') }));
        use.title = t('{name} is running at {url}', { name: s.found.name, url: s.found.url });
        use.addEventListener('click', async (e) => {
          e.stopPropagation();
          await chrome.storage.local.set({ localUrl: s.found.url });
          improve(lang, baseOf(), list, false);
          showLangs();
        });
        const acts = el('div', 'ai-acts');
        acts.append(use, b);
        foot.append(acts);
      } else if (s.running) {
        // A running pass is in the translation queue too, where it can be moved ahead or behind.
        const open = el('button', 'ai-act', t('Open the queue') + ' ↗');
        open.addEventListener('click', (e) => { e.stopPropagation(); send({ type: 'open-queue' }); });
        const acts = el('div', 'ai-acts');
        acts.append(open, b);
        foot.classList.add('stack');
        foot.append(acts);
      } else foot.append(b);
    } else if (aiFinished(s)) {
      const b = el('button', 'ai-act', t('Download .srt'));
      b.title = t('Saves the improved subtitles to your Downloads folder.');
      b.addEventListener('click', (e) => { e.stopPropagation(); saveImproved(lang, list); });
      foot.append(b);
    }
    row.append(head, bar, foot);
    return row;
  }

  // "🇨🇿 gemma3:12b", then "Google · 640 lines" (or how far the previous model
  // got), then Improve and Add to queue. Nothing is sent to the AI before you click one.
  function offerRow(lang, list, prev) {
    const model = aiModel();
    const row = el('div', 'ai');
    const head = el('div', 'ai-head');
    head.append(el('span', 'name', (SubSettings.flag(lang) + ' ' + model).trim()));
    const pct = prev && new Intl.NumberFormat(SubI18n.lang, { style: 'percent' }).format(aiFinished(prev) ? 1 : Math.floor((prev.done / prev.total) * 100) / 100);
    const clean = cleaned.has(list);
    const note = queued.has(list) ? t('Added to the translation queue')
      : prev ? prev.model + ' · ' + pct : clean ? t('YouTube auto captions') + ' · ' + t('{n} lines', { n: list.length }) : 'Google · ' + t('{n} lines', { n: list.length });
    const foot = el('div', 'ai-foot');
    const b = el('button', 'ai-act', t('Improve'));
    b.title = clean ? t('Fixes punctuation, misheard words and broken sentences with {model}, starting where the video is now.', { model })
      : t('Rewrites the lines with {model}, starting where the video is now.', { model });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      improve(lang, baseOf(), list, false);
      showLangs();
    });
    // The queue translates; it has no clean-up pass.
    if (clean) foot.append(b); else foot.append(b, queueButton(lang, list, model));
    row.append(head, el('div', 'ai-note', note), foot);
    return row;
  }

  // Add to queue: the queue tab translates the whole file with the same model
  // while you watch something else, and its Play brings the result back here.
  const queued = new WeakSet(); // translations sent to the queue from this card
  function queueButton(lang, list, model) {
    const b = el('button', 'ai-act', queued.has(list) ? t('Open the queue') + ' ↗' : t('Add to queue'));
    if (!queued.has(list)) b.title = t('Translates the whole file with {model} in the translation queue, in the background. Its Play button brings it back here.', { model });
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (queued.has(list)) return send({ type: 'open-queue' });
      b.disabled = true;
      const base = baseOf();
      const res = await send({ type: 'add-to-queue', lang, title: window === window.top ? pageTitle() : '', fileName: base.file.name,
        lines: base.cues.map((c) => ({ start: c.start, end: c.end, text: c.text })) });
      b.disabled = false;
      if (!res || !res.ok) return toast(t('Didn’t work: {error}', { error: res ? res.error : t('Failed.') }), 5000);
      queued.add(list);
      showLangs();
    });
    return b;
  }

  // ---------- this video's file in the translation queue ----------

  // Added to the queue and still watching: the card over the video shows how
  // far the queue tab got with it (the queue saves after every chunk), and
  // the finished file replaces Google's lines on screen.
  let queueJobs = [];           // the queue's jobs plus files it hasn't taken in yet
  const queueApplied = new Set(); // job ids already put on screen here
  const queueSeen = new Map();  // job id -> status at the last look (to notice it finishing)
  let queuePaused = false;
  function readQueue(all) {
    const q = all.batchQueue || {};
    queuePaused = !!q.paused;
    const inbox = Object.keys(all).filter((k) => k.startsWith('queue:') && all[k]).map((k) => all[k]);
    queueJobs = (Array.isArray(q.jobs) ? q.jobs : []).concat(inbox);
  }
  chrome.storage.local.get(null).then((all) => {
    readQueue(all);
    for (const j of queueJobs) if (j && j.id) queueSeen.set(j.id, j.status);
    refreshLangs();
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !Object.keys(changes).some((k) => k === 'batchQueue' || k.startsWith('queue:'))) return;
    chrome.storage.local.get(null).then((all) => {
      readQueue(all);
      queueFinished();
      refreshLangs();
    }).catch(() => {});
  });
  // The newest job for this page in `lang`, with lines matching what's on screen.
  function queueJobFor(lang) {
    if (!cues.length || !lang) return null;
    let page = '';
    try { page = pageOfSubs(); } catch (e) { return null; }
    const base = baseOf();
    const total = base.cues ? base.cues.length : 0;
    for (let i = queueJobs.length - 1; i >= 0; i--) {
      const j = queueJobs[i];
      if (j && j.lang === lang && j.page && Array.isArray(j.lines) && j.lines.length === total
        && SubSettings.pageOf(j.page) === page) return j;
    }
    return null;
  }
  const queueDone = (j) => (j.status === 'done' ? j.lines.length
    : (j.chunks || []).reduce((n, i) => n + Math.min(AI_CHUNK, j.lines.length - i), 0));
  // The queue's lines as a translation of what's on screen (with its AI state).
  function applyQueued(lang, j) {
    const base = baseOf();
    const old = translations.get(lang);
    if (!old || !base.cues || j.lines.length !== base.cues.length) return false;
    const list = base.cues.map((c, i) => ({ start: c.start, end: c.end, text: (j.out && j.out[i]) || c.text }));
    if (j.model) {
      const chunks = new Set();
      for (let i = 0; i < list.length; i += AI_CHUNK) chunks.add(i);
      aiState.set(list, { model: j.model, done: list.length, total: list.length, chunks, running: false, error: '', stopped: false,
        ms: 0, kept: Date.now() });
    }
    queueApplied.add(j.id);
    swapTranslation(lang, list, old);
    return true;
  }
  // These lines are already the queue's finished copy (after Play, or a reload).
  const showsQueued = (list, j) => !!list && list.length === j.lines.length
    && list.every((c, i) => c.text === ((j.out && j.out[i]) || j.lines[i].text));
  // A job for this video just finished: its lines go on screen, and the card shows it for a moment.
  function queueFinished() {
    for (const j of queueJobs) {
      if (!j || !j.id) continue;
      const before = queueSeen.get(j.id);
      queueSeen.set(j.id, j.status);
      if (j.status !== 'done' || !before || before === 'done' || queueApplied.has(j.id)) continue;
      if (queueJobFor(j.lang) !== j) continue;
      const cur = translations.get(j.lang);
      if (cur && aiState.has(cur) && aiState.get(cur).running) continue; // an Improve pass here owns these lines
      if (applyQueued(j.lang, j)) showLangs(6000);
    }
  }
  // "🇨🇿 gemma3:12b 47 %", a bar, and "Translating · 300 / 640 lines" (or Waiting, Paused, Stopped, Done).
  function queueRow(lang, list, j) {
    const total = j.lines.length;
    const done = j.status === 'done';
    const n = queueDone(j);
    const share = Math.floor((n / total) * 100) / 100;
    const running = j.status === 'running' && !queuePaused;
    const row = el('div', 'ai' + (running ? ' running' : '') + (j.status === 'error' ? ' error' : '') + (done ? ' done' : ''));
    const head = el('div', 'ai-head');
    head.append(el('span', 'name', (SubSettings.flag(lang) + ' ' + (j.model || (done ? 'Google' : aiModel() || 'Google'))).trim()),
      done ? el('span', 'ai-check', '✓') : el('span', 'pct', new Intl.NumberFormat(SubI18n.lang, { style: 'percent' }).format(share)));
    const bar = el('div', 'ai-bar');
    const fill = el('span');
    fill.style.width = (done ? 100 : share * 100) + '%';
    bar.append(fill);
    const lines = n + ' / ' + t('{n} lines', { n: total });
    const note = done ? t('Done') + ' · ' + t('{n} lines', { n: total })
      : j.status === 'error' ? t('Stopped') + ': ' + j.error
        : j.status === 'running' && !queuePaused ? t('Translating') + ' · ' + lines
          : (queuePaused ? t('Paused') : t('Waiting')) + (n ? ' · ' + lines : '');
    const foot = el('div', 'ai-foot');
    foot.append(el('div', 'ai-note', t('Translation queue') + ' · ' + note));
    const acts = el('div', 'ai-acts');
    if (done && !queueApplied.has(j.id)) {
      const show = el('button', 'ai-act', t('Show'));
      show.addEventListener('click', (e) => {
        e.stopPropagation();
        applyQueued(lang, j);
        showLangs();
      });
      acts.append(show);
    }
    if (!done || !queueApplied.has(j.id)) {
      const open = el('button', 'ai-act', t('Open the queue') + ' ↗');
      open.addEventListener('click', (e) => { e.stopPropagation(); send({ type: 'open-queue' }); });
      acts.append(open);
    }
    if (acts.childNodes.length) { foot.classList.add('stack'); foot.append(acts); }
    row.append(head, bar, foot);
    return row;
  }

  function showLangs(ms) {
    if (!langsEl) return;
    if (!fillLangs()) { langsEl.classList.remove('on'); return; }
    langsEl.classList.add('on');
    keepLangs(ms);
    updateAsk();
  }
  // Keeps the card up a while longer, without building it again.
  function keepLangs(ms) {
    clearTimeout(langsTimer);
    const hideLater = (wait) => {
      langsTimer = setTimeout(() => (langsEl.matches(':hover') || askEl.matches(':hover') || shareEl.matches(':hover') ? hideLater(2500) : langsEl.classList.remove('on')), wait);
    };
    hideLater(ms || 2500);
  }
  // New progress while the card is open (it stays as long as it would anyway).
  function refreshLangs() {
    if (langsEl && langsEl.classList.contains('on') && !fillLangs()) langsEl.classList.remove('on');
  }
  function enableMouse(on) {
    document[on ? 'addEventListener' : 'removeEventListener']('mousemove', onMouseMove, { passive: true, capture: true });
  }

  // When paused, the loop is off, so follow layout changes from these events.
  window.addEventListener('resize', () => cues.length && position(true));
  // YouTube's miniplayer comes and goes with a page change; a paused video
  // the same size in both would otherwise keep the overlay on (or off).
  document.addEventListener('yt-navigate-finish', () => setTimeout(() => position(true), 400));
  window.addEventListener('scroll', () => cues.length && position(false), { capture: true, passive: true });

  // ---------- keyboard ----------

  function isTyping(e) {
    const t = e.composedPath ? e.composedPath()[0] : e.target;
    if (!t || !t.tagName) return false;
    // Our own report form, inside the closed shadow root: the event only shows the host.
    if (t === host && shadow && shadow.activeElement && /^(TEXTAREA|INPUT)$/.test(shadow.activeElement.tagName)) return true;
    if (t.isContentEditable) return true;
    if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
    if (t.tagName === 'INPUT') return !/^(button|checkbox|radio|range|submit|reset|color|file|image)$/i.test(t.type);
    return false;
  }

  // Physical keys (event.code), so Option on a Mac doesn't change the match.
  const ACTIONS = {
    toggle: { kind: 'toggle' },
    main: { kind: 'toggle-one', second: false },
    second: { kind: 'toggle-one', second: true },
    earlier: { kind: 'offset', delta: -100 },
    later: { kind: 'offset', delta: 100 },
    earlierMore: { kind: 'offset', delta: -1000 },
    laterMore: { kind: 'offset', delta: 1000 },
    syncReset: { kind: 'offset-reset' },
    up: { kind: 'move', delta: 10 },
    down: { kind: 'move', delta: -10 },
    bigger: { kind: 'size', delta: 2 },
    smaller: { kind: 'size', delta: -2 },
    fullscreen: { kind: 'fullscreen' },
    repeat: { kind: 'repeat' },
  };
  function actionFor(e) {
    return ACTIONS[SubSettings.shortcutFor(shortcuts, SubSettings.keyOf(e))] || null;
  }
  const fsKeyText = () => SubSettings.keyText(shortcuts.fullscreen, /Mac/.test(navigator.platform));
  // The key shown on the fullscreen button follows the shortcut (none when it's switched off).
  function refreshFsKey() {
    if (!fsKeyEl) return;
    // Esc always leaves fullscreen, whatever the shortcut is.
    if (fsBtn.classList.contains('exit')) { fsKeyEl.hidden = false; fsKeyEl.textContent = 'Esc'; return; }
    fsKeyEl.hidden = !shortcuts.fullscreen;
    if (shortcuts.fullscreen) fsKeyEl.textContent = fsKeyText();
  }

  window.addEventListener('keydown', (e) => {
    const action = actionFor(e);
    if (e.repeat && action && action.kind === 'fullscreen') return;
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
      // Anything showing -> all off; all off -> back to the languages that were on.
      const on = !(visible || (dualVisible && dualOn()));
      if (on) showAll(); else hideAll();
      lastKey = '';
      position(true);
      render(true);
      if (langsEl && langsEl.classList.contains('on')) showLangs();
      toast(t(on ? 'Subtitles on' : 'Subtitles off'));
    } else if (a.kind === 'toggle-one') {
      // Just the main or just the second subtitles, like their switch over the video.
      if (a.second && !secondLanguage()) return toast(t('No second subtitles. Turn them on in the popup.'));
      const on = flipLang(a.second);
      if (langsEl && langsEl.classList.contains('on')) showLangs();
      const labels = langLabels();
      toast(t(on ? '{lang}: on' : '{lang}: off', { lang: a.second ? labels.second : labels.main }));
    } else if (a.kind === 'move') {
      if (settings.place === 'middle') return toast(t('Position: middle'));
      // At the top the distance counts down from the top edge, so "up" makes it smaller.
      const delta = settings.place === 'top' ? -a.delta : a.delta;
      settings.bottom = SubSettings.clamp('bottom', settings.bottom + delta);
      SubSettings.save({ bottom: settings.bottom });
      position(true);
      toast(t('Position: {n} px', { n: settings.bottom }));
    } else if (a.kind === 'size') {
      // Saved like the Size slider in the popup; your presets stay as they are.
      settings.size = SubSettings.clamp('size', settings.size + a.delta);
      SubSettings.save({ size: settings.size });
      refreshStyle();
      toast(t('Size: {n} px', { n: settings.size }));
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
    if (!f || !SubLib.SUB_FILE.test(f.name)) return toast(t('Drop an .srt, .vtt or .ttml file'));
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
  // more than a minute before that are dropped (they belong to other posts),
  // unless you turn the sound on for the video that was playing when they came
  // (Facebook starts every video muted and loads its subtitles right away).
  const found = [];
  const waiting = []; // { item, t, video }
  let foundTimer = 0;
  const WAIT_MS = 60000;
  const SETTLE_MS = 5000; // a small preview may start a moment before the main video

  const watched = () => findVideos().find((v) => isPlaying(v) && !v.muted && v.volume > 0 && area(v) > 0);

  const shownIds = new Set(); // found files already offered or used here, so retries don't repeat them
  let offered = null; // the newest of them: its button stays over the video (fillLangs)
  let waitTimer = 0;

  // asked: you turned YouTube's CC on for it (askForCaptions), so it comes
  // again even if it was offered before, and doesn't wait for sound.
  function showFound(item, asked) {
    if (off) return true; // "shown" so nobody keeps retrying
    if (!findVideos().length) return false;
    if (shownIds.has(item.id) && !asked) return true;
    const w = waiting.find((x) => x.item.id === item.id);
    if (w) w.asked = w.asked || !!asked;
    else waiting.push({ item, t: Date.now(), asked: !!asked });
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
    // Automatic mode decides below: not before we know whether it's on.
    if (!prefsLoaded) { prefsReady.then(flushFound); return; }
    const biggest = pickVideo();
    if (biggest) {
      for (const w of waiting) {
        const age = Date.now() - w.t;
        // Also a paused video: subtitles turned on during a pause wait for it, however long the pause.
        if (age < SETTLE_MS || (isPlaying(biggest) && !w.video && age < WAIT_MS)) w.video = biggest;
      }
    }
    const v = watched() || (waiting.some((w) => w.asked) && biggest);
    if (!v) return;
    const fresh = waiting.splice(0).filter((w) => Date.now() - w.t < WAIT_MS || w.video === v);
    if (!fresh.length) return;
    for (const w of fresh) shownIds.add(w.item.id);
    if (!video || !area(video)) attach(v);
    ensureHost();
    offered = fresh[fresh.length - 1].item;
    enableMouse(true);
    startWatch(); // the card and its button follow the player when an ad ends
    for (const w of fresh) if (!found.some((f) => f.id === w.item.id)) found.unshift(w.item);
    found.length = Math.min(found.length, 3);
    // Automatic mode: the newest file goes straight onto the video, translated.
    // A file you loaded yourself is never replaced. The very captions already
    // on screen (brought back after a reload) aren't offered again: the card
    // would only cover the language switches for a while.
    const item = fresh[fresh.length - 1].item;
    if (showing(item)) return;
    // Our own press made the player download its default captions: not news,
    // and they must not replace the ones on screen.
    if (item.yt && cues.length && Date.now() - ccPressedAt < 5000) return;
    if (prefs.autoTranslate) {
      // Subtitles you put on yourself (or brought back) stay, and no card asks
      // about the new file: its button waits in the language panel (offered).
      if (!cues.length || autoLoaded) autoShow(item);
    } else { renderFound(); offerSaved(item); }
    position(true);
  }

  // The subtitles on screen started from this file. YouTube's captions are
  // named by video and language, the way background.js names them.
  // Other sites' captions by the file's name on the page they were loaded on:
  // a reload brings them back before the player downloads them again.
  function showing(item) {
    const base = baseOf().file;
    if (!base) return false;
    if (item.yt) return base.name === ('youtube-' + item.yt + (item.lang ? '.' + item.lang : '')).replace(/[^\w.\-]+/g, '_');
    return !!item.file && pageOfSubs() === SubSettings.pageOf(location.href) && (base.name === item.file || base.name.startsWith(item.file + '.'));
  }

  // The last subtitles of the page a found file belongs to, or null. YouTube's
  // captions name their video: its address may already show the next one.
  async function savedFor(item) {
    try {
      if (!item.yt) return await memRecord();
      const key = 'mem:' + ytPage(item.yt);
      return (await chrome.storage.local.get(key))[key] || null;
    } catch (e) { return null; }
  }

  // Without automatic mode the card offers the file, and this video's
  // subtitles from last time are offered next to it. YouTube changes videos
  // without loading a page, so they weren't offered when it started.
  async function offerSaved(item) {
    if (!item.yt) return;
    const saved = await savedFor(item);
    if (!saved || cues.length) return;
    restorePending = null;
    if (hintEl) hintEl.classList.remove('on'); // "New video" would hide it
    offerRestore(saved);
  }

  // No card here: the toast at the top says "Translating…" and then
  // "Translated to …". Only a failure opens the card, with its buttons.
  // This page's translation from last time comes back instead, as it was
  // (with the AI's lines and your sync), rather than a new one from Google.
  async function autoShow(item) {
    const lang = SubSettings.languageName(prefs.translateTo);
    // Already in that language: shown as they are, nothing goes to Google.
    const from = (item.lang || '').toLowerCase();
    let sameLang = from === prefs.translateTo.toLowerCase() || from.split('-')[0] === prefs.translateTo;
    if (!sameLang && !item.asr) notice(t('Translating to {lang}…', { lang }), 15000);
    let message;
    try {
      const saved = await savedFor(item);
      const res = await chrome.runtime.sendMessage({ type: 'fetch-item', id: item.id });
      // A reload brought this page's subtitles back meanwhile (checkRestore):
      // loading them again would only translate the second language twice.
      if (cues.length && !autoLoaded) return;
      if (!res || !res.ok) throw new Error(res ? res.error : t('Failed.'));
      // Another site's file must be the one those subtitles started from.
      if (saved && saved.translatedTo === prefs.translateTo && (item.yt || (saved.original || saved).name === res.name)) {
        const back = restoreRecord(saved, liveVideo());
        if (back && back.ok) {
          autoLoaded = true;
          restorePending = null;
          const ai = saved.ai && saved.ai.model;
          notice(t('Subtitles from last time:') + ' ' + lang + (ai ? ' · ' + ai : ''), 4000);
          if (aiReady()) showLangs();
          return;
        }
      }
      let name = res.name, b64 = res.b64;
      let autoCaps = false; // only YouTube's automatic captions: say they may be wrong
      // YouTube's automatic captions (speech recognition) are often wrong, and
      // a translation of them worse. Captions written by people go first: in
      // your language as they are, else in another one, translated.
      if (item.asr) {
        const bytes64 = (text) => SubLib.bytesToBase64(new TextEncoder().encode(text));
        const own = await siteTrack(prefs.translateTo);
        const human = own || await siteTrack('*');
        if (cues.length && !autoLoaded) return;
        // With none, the automatic ones are used after all (translated if
        // needed): automatic mode never stops at a card asking you to do it.
        if (human) {
          name = human.name;
          b64 = bytes64(human.text);
          sameLang = !!own;
        } else autoCaps = true;
        if (!sameLang) notice(t('Translating to {lang}…', { lang }), 15000);
      }
      const r = loadBytes(name, b64, 'auto', liveVideo(), autoCaps);
      if (!r.ok) throw new Error(r.error);
      autoLoaded = siteFile = true;
      const autoNote = () => notice(t('YouTube auto-captions: may have mistakes'), 2500);
      if (item.asr && sameLang) {
        if (autoCaps) autoNote();
        else notice(t('Subtitles from {site}: {lang}', { site: 'YouTube', lang }), 4000);
        countOwn();
      }
      if (sameLang) return;
      const done = await translate(prefs.translateTo);
      if (!done.ok) throw new Error(done.error);
      if (autoCaps) autoNote(); // in place of "Translated to …"
      return;
    } catch (e) {
      message = t('Automatic translation didn’t work: {error}', { error: e.message });
    }
    renderFound(message);
  }

  // Media events don't bubble, so listen in the capture phase.
  document.addEventListener('playing', flushFound, true);
  // A real video (not a short clip or a tiny preview) started here: the background keeps the
  // website for the "why did you leave?" page (lib/goodbye.js). At most once a minute per page.
  // Recent video sites for the uninstall page (switched on 2026-11-12, in the privacy policy).
  const RECENT_SITES = true;
  // Also on "timeupdate": a video that autoplays has already fired "playing" before this script loads.
  let siteToldAt = 0;
  const onSitePlay = (event) => {
    const v = event.target;
    if (!(v instanceof HTMLVideoElement) || Date.now() - siteToldAt < 60000) return;
    if (!RECENT_SITES || v.paused || v.duration < 30 || area(v) < 200 * 120) return;
    siteToldAt = Date.now();
    chrome.runtime.sendMessage({ type: 'video-site' }).catch(() => {});
  };
  document.addEventListener('playing', onSitePlay, true);
  document.addEventListener('timeupdate', onSitePlay, true);
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
        const r = loadBytes(res.name, res.b64, 'auto', liveVideo(), res.asr);
        if (!r.ok) throw new Error(r.error);
        return t('Showing {n} lines.', { n: r.count }) + offHint();
      }));
      const tr = el('button', '', t('Translate to {lang}', { lang: SubSettings.languageName(prefs.translateTo) }));
      tr.title = t('Shows these subtitles over the video, translated by Google Translate. Change the language in the extension popup.');
      tr.addEventListener('click', () => foundAction(tr, tr.textContent, { type: 'fetch-item', id: item.id }, async (res) => {
        const r = loadBytes(res.name, res.b64, 'auto', liveVideo(), res.asr);
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
        ai: original ? aiReport(cues) : null,
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
        reply(loadBytes(msg.name, msg.b64, msg.encoding, v, msg.asr));
        return;
      }
      case 'set-encoding': {
        if (!file) return reply({ ok: false, error: t('Nothing loaded.') });
        const src = original ? original.file : file; // a new encoding starts again from the original
        reply(loadBytes(src.name, src.b64, msg.encoding, video, src.asr));
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
      case 'translate-progress':
        if (translating && translating.to === msg.to && msg.done > translating.done) {
          translating.done = msg.done;
          refreshLangs();
        }
        return;
      case 'show-original':
        showOriginal();
        reply({ ok: true });
        return;
      case 'improve':
        // "Improve with …" in the popup: the translation on the video.
        if (!original) return reply({ ok: false, error: t('Nothing loaded.') });
        if (!aiReady()) return reply({ ok: false, error: t('Choose a model in the extension popup.') });
        if (nativeSite.has(cues)) return reply({ ok: false, error: t('Subtitles from {site}: {lang}', { site: nativeSite.get(cues), lang: SubSettings.languageName(file.translatedTo) }) });
        improve(file.translatedTo, baseOf(), cues, false);
        showLangs();
        reply({ ok: true });
        return;
      case 'ai-live-check':
        // The queue tab: is this pass still going, and may it go now?
        if (msg.queueFirst != null) queueFirstUntil = msg.queueFirst ? Date.now() + QUEUE_FIRST_MS : 0;
        reply({ running: improving.has(msg.to) });
        return;
      case 'ai-live-stop':
        // × on this pass in the queue tab.
        if (translations.has(msg.to)) stopImproving(msg.to, translations.get(msg.to), true);
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
        // YouTube downloads its captions right after you turn CC on: those count as asked for.
        reply({ shown: showFound(msg.item, !!msg.item.yt && Date.now() - ccAskedAt < 10000) });
        return;
      case 'page-changed':
        // Another episode without a new page: files found before belong to the previous one.
        waiting.length = 0;
        offered = null;
        hideFound();
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
  // captions (or came by themselves in automatic mode): off hides them, on
  // shows them again (like Alt + S). With none of ours on screen, turning it
  // on asks for subtitles.
  const fromYouTube = () => { const f = original ? original.file : file; return !!f && (/^youtube-/.test(f.name || '') || autoLoaded); };
  let ccAskedAt = 0;
  let ccPressedAt = 0; // when we last pressed YouTube's button for you (syncCcButton)
  // This video's captions go through the same steps as a new find: in
  // automatic mode the translation from last time or a new one from Google
  // (with Improve in the card), otherwise the card. Also when they were
  // offered before, and without waiting for sound. If the player hasn't
  // downloaded them yet, it does so now and 'subs-found' sees ccAskedAt.
  async function askForCaptions() {
    const id = SubSettings.youTubeId(location.href);
    if (!id) return;
    ccAskedAt = Date.now();
    const items = await send({ type: 'recent-found', all: true });
    const item = (items || []).find((i) => i.yt === id);
    if (item && !cues.length) showFound(item, true);
  }
  if (/(^|\.)youtube\.com$/.test(location.hostname)) {
    let ccButton = null;
    let ytPlayer = null;
    const barWatch = new MutationObserver(liftForControls);
    // YouTube also flips the button by itself now and then (seen while
    // nothing was touched, around ads, and going fullscreen), so only your
    // own use of it switches ours: a press on it or on its settings menu, or
    // the C key. The press, not the click: the button may switch first.
    let ccTouchedAt = 0;
    let ccHid = null; // shownBefore when the button hid ours: switching back on by itself brings them back
    document.addEventListener('pointerdown', (e) => {
      if (e.isTrusted && e.composedPath().some((n) => n.classList && (n.classList.contains('ytp-subtitles-button') || n.classList.contains('ytp-settings-menu')))) ccTouchedAt = Date.now();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.isTrusted && (e.code === 'KeyC' || /^c$/i.test(e.key)) && !e.altKey && !e.ctrlKey && !e.metaKey && !isTyping(e)) ccTouchedAt = Date.now();
    }, true);
    let ccBefore = null; // the button's state before our press, while that press stands (null: it's your own)
    // You switched the button off while ours were still on their way (the player had
    // the captions, we hadn't shown them yet): the video id, so they arrive hidden.
    let ccOffEarly = '';
    const CC_MEMORY = 'yt-player-caption-persistence';
    let ccMemory = null; // what YouTube remembered before that press
    // Ours can show with the button off (brought back in automatic mode, or
    // captions the player loaded by itself). Press it for you, so one press
    // from you switches them off instead of a first press that seems to do
    // nothing. A press we made is taken back when ours go away, or YouTube's
    // own captions would appear. At most one try in 5 s: nothing fights
    // YouTube if it refuses or flips it back.
    function syncCcButton() {
      if (!ccButton || !ccButton.isConnected || ccButton.getAttribute('aria-disabled') === 'true' || !ccButton.offsetParent) return;
      const now = Date.now();
      if (now - ccTouchedAt < 1500 || now - ccPressedAt < 5000) return;
      if (document.querySelector('.html5-video-player.ad-showing')) return;
      const on = ccButton.getAttribute('aria-pressed') === 'true';
      if (ccOffEarly && ccOffEarly !== SubSettings.youTubeId(location.href)) ccOffEarly = '';
      if (ccOffEarly && cues.length && !on && fromYouTube()) {
        // They came after you switched the button off: hidden, and the button stays off.
        // Switching it on shows them, translated meanwhile.
        ccOffEarly = '';
        if (visible || dualVisible) {
          hideAll();
          ccHid = shownBefore;
          lastKey = '';
          position(true);
          render(true);
          refreshLangs();
        }
        return;
      }
      let want = on;
      if (off || !cues.length) want = ccBefore === null ? on : ccBefore;
      // The button follows ours: all of ours switched off over the video turns
      // it off too, or YouTube's own captions would show in their place.
      else if (fromYouTube()) want = visible || dualVisible;
      if (want === on) return;
      if (ccBefore === null) { ccBefore = on; ccMemory = localStorage.getItem(CC_MEMORY); }
      ccPressedAt = now;
      ccButton.click();
      keepCcMemory();
      // Back where you had it: your own state again.
      if (want === ccBefore) ccBefore = null;
    }
    // YouTube remembers the button's state for later videos: that stays your
    // own choice. It writes a moment after the press, once the captions have
    // loaded, so this repeats for as long as the press is ours.
    function keepCcMemory() {
      if (ccMemory === null) localStorage.removeItem(CC_MEMORY);
      else localStorage.setItem(CC_MEMORY, ccMemory);
    }
    const ccWatch = new MutationObserver(() => {
      const yours = Date.now() - ccTouchedAt < 1500;
      if (yours) ccBefore = null;
      if (off) return;
      const on = ccButton.getAttribute('aria-pressed') === 'true';
      if (!cues.length) {
        if (on) { ccOffEarly = ''; askForCaptions(); } else if (yours) ccOffEarly = SubSettings.youTubeId(location.href) || '';
        return;
      }
      if (!fromYouTube() || on === (visible || dualVisible)) return;
      // Off and on again by itself: back as they were, unless you switched something meanwhile.
      if (on && (yours || (ccHid && ccHid === shownBefore))) showAll();
      else if (!on && yours) { hideAll(); ccHid = shownBefore; }
      else return;
      position(true);
      render(true);
      refreshLangs();
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
      if (b && b !== ccButton) {
        ccWatch.disconnect();
        ccButton = b;
        ccWatch.observe(b, { attributes: true, attributeFilter: ['aria-pressed'] });
      }
      syncCcButton();
      if (ccBefore !== null) keepCcMemory();
    }, 1000);
  }

  // YouTube: caption files copied from the player by youtube-hook.js.
  document.addEventListener('subtitle-overlay-yt', (e) => {
    if (off || typeof e.detail !== 'string') return;
    try {
      const { url, text, tracks } = JSON.parse(e.detail);
      // An ad before the video is another video with its own captions: not the ones you came for.
      const page = SubSettings.youTubeId(location.href);
      if (page && new URL(url).searchParams.get('v') !== page && document.querySelector('.html5-video-player.ad-showing')) return;
      sendOrWarn({ type: 'yt-captions', url, text, tracks });
    } catch (err) { /* ignore */ }
  });
  document.dispatchEvent(new CustomEvent('subtitle-overlay-yt-ask'));

  // Netflix: subtitle files copied from the player by netflix-hook.js.
  if (onNetflix) {
    // The controls come and go with the mouse: lift the subtitles above them meanwhile.
    // Checked at most once a frame, plus a late look once a fade-out has finished.
    let liftQueued = false, liftLate = 0;
    const queueLift = () => {
      if (liftQueued) return;
      liftQueued = true;
      requestAnimationFrame(() => { liftQueued = false; liftForControls(); });
      clearTimeout(liftLate);
      liftLate = setTimeout(liftForControls, 400);
    };
    let nfRoot = null;
    const nfWatch = new MutationObserver(queueLift);
    setInterval(() => {
      const root = document.querySelector('.watch-video') || (video && video.parentElement);
      if (root && root !== nfRoot) {
        nfWatch.disconnect();
        nfRoot = root;
        nfWatch.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
        queueLift();
      }
    }, 1000);
    document.addEventListener('mousemove', queueLift, { passive: true });
    document.addEventListener('subtitle-overlay-page', (e) => {
      if (!off && typeof e.detail === 'string') send({ type: 'page-subtitles', text: e.detail });
    });
    document.dispatchEvent(new CustomEvent('subtitle-overlay-page-ask'));
    // The title's subtitle languages, for using Netflix's own ones in your language.
    document.addEventListener('subtitle-overlay-nf-tracks', (e) => {
      if (off || typeof e.detail !== 'string') return;
      try {
        const { movieId, tracks } = JSON.parse(e.detail);
        send({ type: 'nf-tracks', movieId, tracks });
      } catch (err) { /* ignore */ }
    });
    document.dispatchEvent(new CustomEvent('subtitle-overlay-nf-tracks-ask'));
    // The language you translate into, for netflix-hook.js: it asks Netflix for
    // those subtitles even where Netflix doesn't list them. Netflix's own codes
    // differ for a few languages. Turned off on Netflix: nothing is asked.
    const NF_LOCALE = { 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant', tl: 'fil', no: 'nb' };
    const keepLocale = () => {
      try {
        if (off || !prefs.translateTo) localStorage.removeItem('subtitleOverlayLang');
        else localStorage.setItem('subtitleOverlayLang', NF_LOCALE[prefs.translateTo] || prefs.translateTo);
      } catch (err) { /* storage blocked: Netflix's own list only */ }
    };
    Promise.all([prefsReady, SubSettings.loadOffSites()]).then(([, list]) => {
      if (SubSettings.isOff(list, site)) off = true;
      keepLocale();
    });
    chrome.storage.onChanged.addListener((c, area) => {
      if (area === 'local' && (c.translateTo || c.offSites)) setTimeout(keepLocale, 0); // after the listener above updated prefs and off
    });
  }

  // Prime Video: the title's subtitle languages, listed by prime-hook.js, for
  // using Amazon's own ones in your language.
  document.addEventListener('subtitle-overlay-site-tracks', (e) => {
    if (off || typeof e.detail !== 'string') return;
    try {
      const { site, id, tracks } = JSON.parse(e.detail);
      send({ type: 'site-tracks', site, id, tracks });
    } catch (err) { /* ignore */ }
  });
  document.dispatchEvent(new CustomEvent('subtitle-overlay-site-tracks-ask'));

  window.__subOverlay = { report };
  // The interface text waits for its language file, so labels built below aren't left in English.
  Promise.all([SubSettings.loadOffSites(), uiReady]).then(([list]) => {
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
