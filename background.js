// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Cleedek

// Background worker: watches network traffic for subtitle files the page
// loads (VTT, SRT, TTML, HLS subtitle playlists), counts them on the icon badge,
// and downloads/stitches them when the popup asks.
importScripts('lib/i18n.js', 'lib/subtitles.js', 'lib/settings.js', 'lib/goodbye.js', 'lib/whats-new.js');

// The "why did you leave?" page Chrome opens after the extension is removed (lib/goodbye.js).
setupGoodbye({ ext: 'subtitle-overlay', i18n: SubI18n });
// Saved subtitles past the time they were kept for go when the browser starts.
chrome.runtime.onStartup.addListener(() => { SubSettings.pruneSaved().catch(() => {}); });
// After an update, remember the version it came from, for the popup's "What's new" card (lib/whats-new.js).
chrome.runtime.onInstalled.addListener(rememberUpdate);
// A new install starts in automatic mode, translating into the browser's language.
// An update changes nothing: people who already use it keep what they have.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    // The welcome page reads the language, so it opens once that is saved.
    chrome.storage.local.set({ autoTranslate: true, translateTo: SubI18n.resolve('auto') })
      .catch(() => {})
      .then(() => chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') }))
      .catch(() => {});
  }
  // When it started being used, for the support card's 3 weeks. Someone who
  // already had it before this was counted starts from the update.
  chrome.storage.local.get('installedAt').then(({ installedAt }) => {
    if (!installedAt) chrome.storage.local.set({ installedAt: Date.now() });
  }).catch(() => {});
});
const tr = SubI18n.t; // "t" is taken: it names a tab's captured state below
SubI18n.load();

// Let content scripts read the per-page "last loaded file" memory.
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {});

// ---------- captured items per tab (kept in session storage, the worker may sleep) ----------

const tabs = new Map();    // tabId -> { items: [], seen: [] }
const loading = new Map(); // tabId -> Promise

function getTab(tabId) {
  if (tabs.has(tabId)) return Promise.resolve(tabs.get(tabId));
  if (!loading.has(tabId)) {
    loading.set(tabId, chrome.storage.session.get('cap:' + tabId).then((got) => {
      const t = got['cap:' + tabId] || { items: [], seen: [] };
      tabs.set(tabId, t);
      loading.delete(tabId);
      return t;
    }));
  }
  return loading.get(tabId);
}

function saveTab(tabId) {
  const t = tabs.get(tabId);
  if (t) chrome.storage.session.set({ ['cap:' + tabId]: t }).catch(() => {});
  updateBadge(tabId);
  chrome.runtime.sendMessage({ type: 'captured-changed', tabId }).catch(() => {});
}

function clearTab(tabId) {
  tabs.set(tabId, { items: [], seen: [] });
  saveTab(tabId);
}

// Single-page sites (Prima+) open the next episode without loading a new page,
// and every episode's file has the same name: a new address in the tab starts
// a fresh list too, or the popup and the card would offer the previous
// episode's file under the new episode's title. Only the path counts, so a
// site that notes the playing time in the address (?t=) keeps its files.
async function checkPage(tabId, url) {
  const page = stripQuery(url || '');
  const t = await getTab(tabId);
  if (!page || t.page === page) return t;
  const moved = !!t.page;
  t.page = page;
  if (moved) {
    t.items = [];
    t.seen = [];
    chrome.tabs.sendMessage(tabId, { type: 'page-changed' }).catch(() => {});
  }
  saveTab(tabId);
  return t;
}

// Segment pieces of an HLS playlist or DASH track are hidden: the track stands for them.
function visibleItems(t) {
  const prefixes = t.items.filter((i) => (i.kind === 'hls' || i.kind === 'dash') && i.segmentPrefix).map((i) => i.segmentPrefix);
  return t.items.filter((i) => i.kind === 'hls' || i.kind === 'dash' || !prefixes.some((p) => i.url.startsWith(p)));
}

function updateBadge(tabId) {
  const t = tabs.get(tabId);
  const n = t ? visibleItems(t).length : 0;
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : '' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#6d28d9' }).catch(() => {});
}

const stripQuery = (url) => url.split(/[?#]/)[0];

// YouTube's captions all come from one address (/api/timedtext); the video,
// language and kind are in the query, so they tell the files apart.
const YT_CAPTIONS = /^https:\/\/(www\.|m\.)?youtube\.com\/api\/timedtext\b/;
function ytInfo(url) {
  const q = new URL(url).searchParams;
  return { v: q.get('v') || '', lang: q.get('tlang') || q.get('lang') || '', asr: q.get('kind') === 'asr' };
}
function itemKey(url) {
  if (!YT_CAPTIONS.test(url)) return stripQuery(url);
  const y = ytInfo(url);
  return 'yt:' + y.v + ':' + y.lang + ':' + y.asr;
}

const guessLanguage = SubLib.guessLanguage;

const NETFLIX_PAGE = /^https:\/\/www\.netflix\.com\/(?:[a-z-]+\/)?watch\/(\d+)/;
// How the card over the video names a site whose address says less.
const SITE_NAMES = { 'play.hbomax.com': 'HBO Max', 'play.max.com': 'HBO Max', 'disneyplus.com': 'Disney+', 'apps.disneyplus.com': 'Disney+' };
const PRIME_PAGE = /^https:\/\/www\.(?:primevideo\.com|amazon\.[a-z.]+)\//;

async function addItem(tabId, item) {
  if (await tabIsOff(tabId)) return;
  // The address may change just before or after the file arrives: checked here too.
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const t = tab ? await checkPage(tabId, tab.url) : await getTab(tabId);
  const key = itemKey(item.url);
  const existing = t.items.find((i) => itemKey(i.url) === key);
  // YouTube changes videos without loading a new page: drop the previous video's captions.
  if (item.yt) t.items = t.items.filter((i) => !i.yt || i.yt === item.yt);
  // The card on the video only offers subtitles the player really loaded, which
  // happens once you turn them on. Tracks merely listed in a streaming playlist
  // stay in the popup until then.
  const loaded = (i) => i.kind === 'file' || !!i.segments;
  // A piece of a DASH track arrived: the player turned that track on, so the
  // track is offered (the piece itself stays hidden, see visibleItems).
  if (item.kind === 'file') {
    const track = t.items.find((i) => i.kind === 'dash' && i.segmentPrefix && item.url.startsWith(i.segmentPrefix));
    if (track && !track.segments) { track.segments = track.pieces; track.loadedAt = Date.now(); offer(tabId, track.id); }
  }
  if (existing) {
    const wasLoaded = loaded(existing);
    // Keep the newest signed URL, fill in anything new we learned.
    existing.url = item.url;
    for (const k of ['lang', 'name', 'segmentPrefix', 'segments', 'tracks']) if (item[k] && !existing[k]) existing[k] = item[k];
    if (item.body) { existing.body = item.body; delete existing.details; }
    if (item.mpd) existing.mpd = item.mpd; // the newest signed manifest address
    if (!wasLoaded && loaded(existing)) { existing.loadedAt = Date.now(); offer(tabId, existing.id); }
  } else {
    item.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    item.time = Date.now();
    t.items.unshift(item);
    if (t.items.length > 60) t.items.length = 60;
    if (loaded(item)) offer(tabId, item.id);
  }
  saveTab(tabId);
}

// Shows a "Subtitles found" card on the video. Waits a moment first, so the
// pieces of a streaming playlist are recognised as such and never offered.
// If the page isn't ready for it yet (right after a reload a busy site can
// take seconds before the page script runs), it tries again for a while; the
// page script also asks for recent finds when it starts ('recent-found').
function offer(tabId, id, attempt = 0) {
  setTimeout(async () => {
    const t = await getTab(tabId);
    const item = visibleItems(t).find((i) => i.id === id);
    if (!item) return;
    const msg = { type: 'subs-found', item: foundItem(item) };
    // The frame that loaded the file usually holds the player; otherwise try them all.
    let res = await chrome.tabs.sendMessage(tabId, msg, { frameId: item.frameId || 0 }).catch(() => null);
    if (!res || !res.shown) res = await chrome.tabs.sendMessage(tabId, msg).catch(() => null);
    if ((!res || !res.shown) && attempt < 15) offer(tabId, id, attempt + 1);
  }, attempt ? 1000 : 1500);
}

// yt: the YouTube video the captions belong to (content.js finds its translation from last time with it).
// file: the name it gets once loaded (content.js recognises subtitles already on screen by it).
// asr: YouTube's automatic captions (speech recognition), never put on the video by themselves.
const foundItem = (item) => ({ id: item.id, lang: item.lang || '', name: item.name || stripQuery(item.url).split('/').pop(), yt: item.yt || '', file: fileName(item), asr: !!item.asr });
const FOUND_FRESH_MS = 60000;

// ---------- the site's own subtitles in your language ----------

// Streaming sites often have subtitles in the language you want, just not the
// ones you turned on. The best fit among what this tab's player listed:
// Netflix's manifest, YouTube's caption list (only ones written by people),
// HLS playlists (Disney+ and others), DASH manifests (HBO Max and others) and
// Prime Video's list of subtitle files. Forced subtitles (only the foreign
// bits) and captions for the deaf come last or not at all.
async function nativeTrack(tabId, pageUrl, lang) {
  if (!lang || lang === 'orig') return { ok: false };
  const t = await getTab(tabId);
  const best = (list, score) => list.map((x) => [x, score(x)]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0];
  const finish = (cues, name, site) => (cues && cues.length ? { ok: true, text: SubLib.toVTT(cues), name, site } : { ok: false });

  const nf = NETFLIX_PAGE.exec(pageUrl || '');
  if (nf && t.netflix && t.netflix.length) {
    const m = t.netflix.find((x) => x.movieId === nf[1]) || t.netflix[0];
    const hit = best(m.tracks, (tr) => (tr.forced ? 0 : SubLib.langMatch(tr.lang, lang) * 2 - (tr.cc ? 1 : 0)));
    if (hit) {
      for (const url of hit[0].urls) {
        try {
          const text = SubLib.decode(await fetchBytes(url, tabId, 0), 'utf-8').text;
          return finish(SubLib.parse(text), 'netflix-' + m.movieId + '.' + hit[0].lang + '.vtt', 'Netflix');
        } catch (e) { /* the next address */ }
      }
    }
    return { ok: false };
  }

  // Prime Video: TTML files from the list the player got (prime-hook.js).
  if (PRIME_PAGE.test(pageUrl || '') && t.site && t.site.tracks.length) {
    const hit = best(t.site.tracks, (tr) => (tr.forced ? 0 : SubLib.langMatch(tr.lang, lang) * 2 - (tr.cc ? 1 : 0)));
    if (!hit) return { ok: false };
    for (const url of hit[0].urls) {
      try {
        const text = SubLib.decode(await fetchBytes(url, tabId, 0), 'utf-8').text;
        const name = ('primevideo-' + (t.site.id || 'title') + '.' + hit[0].lang).replace(/[^\w.\-]+/g, '_') + '.vtt';
        return finish(SubLib.parse(text), name, 'Prime Video');
      } catch (e) { /* the next address */ }
    }
    return { ok: false };
  }

  // YouTube: the player's own caption address with another language in it
  // (only the player can get a working address, see youtube-hook.js).
  const yt = t.items.find((i) => i.yt && i.tracks && !/[?&]tlang=/.test(i.url));
  if (yt) {
    // '*': any written by people, the language of the ones loaded first.
    const hit = best(yt.tracks, (tr) => (tr.asr ? 0 : lang === '*' ? (SubLib.langMatch(tr.lang, yt.lang) ? 2 : 1) : SubLib.langMatch(tr.lang, lang)));
    if (!hit) return { ok: false };
    const u = new URL(yt.url);
    u.searchParams.set('lang', hit[0].lang);
    for (const k of ['kind', 'tlang', 'name', 'variant']) u.searchParams.delete(k);
    const text = SubLib.decode(await fetchBytes(u.href, tabId, yt.frameId), 'utf-8').text;
    const name = ('youtube-' + yt.yt + '.' + hit[0].lang).replace(/[^\w.\-]+/g, '_'); // named like fileName() names YouTube's
    return finish(SubLib.parseYouTube(text), name, 'YouTube');
  }

  // HLS and DASH (HBO Max) tracks the network watcher found; captions for the deaf come second.
  const hls = best(visibleItems(t).filter((i) => (i.kind === 'hls' || i.kind === 'dash') && !i.forced && i.lang),
    (i) => SubLib.langMatch(i.lang, lang) * 2 - (i.cc ? 1 : 0));
  if (hls) {
    const { cues } = await loadItem(tabId, hls[0]);
    const host = new URL(pageUrl || hls[0].url).hostname.replace(/^www\./, '');
    return finish(cues, fileName(hls[0]) + '.vtt', SITE_NAMES[host] || host);
  }
  return { ok: false };
}

// ---------- translation queue ----------

// The queue page (batch.html) translates files one after another in its own
// tab, and only while that tab is open.
async function queueTab() {
  const open = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
  return open.find((c) => new URL(c.documentUrl).pathname === '/batch.html') || null;
}

// A tab's subtitles join the queue (batch.js takes them from storage), which
// remembers the page: its Play button brings you back there with the
// translation on the video. The queue tab opens behind this one if needed.
// source: the file's own name; YouTube's ("youtube-…") keep the CC button working after Play.
async function addToQueue({ lines, lang, title, fileName }, tabId) {
  if (!Array.isArray(lines) || !lines.length) throw new Error(tr('No subtitle lines found.'));
  const tab = await chrome.tabs.get(tabId);
  title = title || tab.title || '';
  // Sites like Prima name every episode's file the same: the episode names the translation.
  const name = (title.replace(/\s*:\s*/g, ' - ').replace(/[\\/*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
    || String(fileName || 'subtitles').replace(SubLib.SUB_FILE, '')) + '.srt';
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await chrome.storage.local.set({ ['queue:' + id]: { id, name, source: fileName || '', lang, lines, out: [], chunks: [],
    status: 'waiting', error: '', model: '', page: tab.url, title } });
  if (!(await queueTab())) await chrome.tabs.create({ url: chrome.runtime.getURL('batch.html'), active: false });
}

async function openQueue() {
  const c = await queueTab();
  if (!c) return chrome.tabs.create({ url: chrome.runtime.getURL('batch.html') });
  await chrome.tabs.update(c.tabId, { active: true });
  await chrome.windows.update(c.windowId, { focused: true });
}

// ---------- network watching ----------

const VTT_URL = /\.(web)?vtt$/i;
const SRT_URL = /\.srt$/i;
const M3U8_URL = /\.m3u8$/i;
const MPD_URL = /\.mpd$/i;

// Sites the user turned the extension off on: nothing is collected there.
let offSites = [];
SubSettings.loadOffSites().then((l) => { offSites = l; });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.offSites) offSites = changes.offSites.newValue || [];
});
async function tabIsOff(tabId) {
  if (!offSites.length) return false;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return !!tab && SubSettings.isOff(offSites, SubSettings.siteOf(tab.url || tab.pendingUrl || ''));
}

chrome.webRequest.onCompleted.addListener((d) => {
  if (d.tabId < 0 || d.statusCode >= 400) return; // tabId -1 = our own fetches
  const path = stripQuery(d.url);
  const header = (d.responseHeaders || []).find((h) => h.name.toLowerCase() === 'content-type');
  const ctype = header ? String(header.value).toLowerCase() : '';
  if (YT_CAPTIONS.test(d.url)) {
    // Handled by youtube-hook.js: a second download of these comes back empty.
  } else if (VTT_URL.test(path) || ctype.includes('text/vtt') || SRT_URL.test(path) || ctype.includes('x-subrip')) {
    addItem(d.tabId, { kind: 'file', url: d.url, frameId: d.frameId, lang: guessLanguage(d.url) });
  } else if (M3U8_URL.test(path) || ctype.includes('mpegurl')) {
    inspectPlaylist(d.tabId, d.frameId, d.url);
  } else if (MPD_URL.test(path) || ctype.includes('dash+xml')) {
    inspectManifest(d.tabId, d.frameId, d.url);
  } else {
    const ttml = SubLib.ttmlHint(d.url, ctype);
    if (ttml === 'sure') addItem(d.tabId, { kind: 'file', url: d.url, frameId: d.frameId, lang: guessLanguage(d.url) });
    else if (ttml === 'check') inspectXml(d.tabId, d.frameId, d.url);
  }
}, { urls: ['<all_urls>'], types: ['xmlhttprequest', 'media', 'other'] }, ['responseHeaders']);

// A new page in the tab starts a fresh list.
chrome.webRequest.onBeforeRequest.addListener((d) => {
  if (d.tabId < 0) return;
  clearTab(d.tabId);
  dropFrames(d.tabId);
  dropOldSeconds();
}, { urls: ['<all_urls>'], types: ['main_frame'] });

// A new address without a new page (history.pushState): see checkPage.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url) checkPage(tabId, change.url);
});

// The second language of dual subtitles is saved with a page (content.js) for
// a day after it was last saved. Checked at most once an hour, on the next page
// opened; a page that comes back after that doesn't use it either way.
const SECOND_KEEP = 24 * 3600 * 1000;
async function dropOldSeconds() {
  try {
    const { secondsCheckedAt } = await chrome.storage.session.get('secondsCheckedAt');
    if (Date.now() - (secondsCheckedAt || 0) < 3600 * 1000) return;
    await chrome.storage.session.set({ secondsCheckedAt: Date.now() });
    const all = await chrome.storage.local.get(null);
    const old = {};
    for (const [k, r] of Object.entries(all)) {
      if (k.startsWith('mem:') && r && r.second && !(Date.now() - r.second.t < SECOND_KEEP)) { delete r.second; old[k] = r; }
    }
    if (Object.keys(old).length) await chrome.storage.local.set(old);
  } catch (e) { /* next page tries again */ }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  tabs.delete(tabId);
  chrome.storage.session.remove('cap:' + tabId).catch(() => {});
  dropFrames(tabId);
});

// ---------- HLS playlists ----------

const { parseAttrs, segmentUrls } = SubLib;

async function inspectPlaylist(tabId, frameId, url) {
  if (await tabIsOff(tabId)) return;
  const t = await getTab(tabId);
  const key = stripQuery(url);
  if (t.seen.includes(key)) return;
  t.seen.push(key);
  if (t.seen.length > 300) t.seen.splice(0, 100);
  let text;
  try {
    text = await fetchText(url, tabId, frameId);
  } catch (e) { return; }
  if (!text.startsWith('#EXTM3U')) return;
  // Master playlist: lists the subtitle tracks even before they are switched on.
  for (const track of SubLib.subtitleTracks(text, url)) addItem(tabId, Object.assign({ kind: 'hls', frameId }, track));
  // Media playlist whose pieces are WebVTT files.
  if (text.includes('#EXTINF')) {
    const segs = segmentUrls(text, url);
    if (segs.length && segs.every((s) => VTT_URL.test(stripQuery(s)))) {
      const first = stripQuery(segs[0]);
      addItem(tabId, {
        kind: 'hls', url, frameId, lang: guessLanguage(url), segments: segs.length,
        segmentPrefix: first.slice(0, first.lastIndexOf('/') + 1),
      });
    }
  }
}

// ---------- DASH manifests ----------

// HBO Max and other DASH players: the manifest lists every subtitle language.
// Each one becomes an item whose address points at the manifest (`mpd`) plus
// its own name, so the list keeps them apart; loadItem reads the manifest again.
async function inspectManifest(tabId, frameId, url) {
  if (await tabIsOff(tabId)) return;
  const t = await getTab(tabId);
  const key = stripQuery(url);
  if (t.seen.includes(key)) return;
  t.seen.push(key);
  if (t.seen.length > 300) t.seen.splice(0, 100);
  let text;
  try {
    text = await fetchText(url, tabId, frameId);
  } catch (e) { return; }
  for (const track of SubLib.dashTracks(text, url)) {
    const item = { kind: 'dash', url: dashItemUrl(url, track), mpd: url, track: track.key, frameId,
      lang: track.lang, name: track.name, forced: track.forced, cc: track.cc };
    if (track.parts) {
      // What all its pieces' addresses start with ("…/t/vi/" or "…/sub-vi-00").
      const a = stripQuery(track.parts[0]), b = stripQuery(track.parts[1] || track.parts[0]);
      let n = 0;
      while (n < a.length && a[n] === b[n]) n++;
      item.segmentPrefix = a.length === b.length && n === a.length ? a : a.slice(0, n);
      item.pieces = track.parts.length;
    }
    addItem(tabId, item);
  }
}
const dashItemUrl = (mpd, tr) => stripQuery(mpd).replace(/\.mpd$/i, '') + '/subtitles-' + (tr.lang || 'x') + '-' + tr.key.replace(/[^\w.-]+/g, '_');

async function loadDash(tabId, item) {
  const text = await fetchText(item.mpd, tabId, item.frameId);
  const track = SubLib.dashTracks(text, item.mpd).find((x) => x.key === item.track);
  if (!track) throw new Error(tr('No subtitle track in this playlist.'));
  if (track.file) {
    const cues = SubLib.parse(SubLib.decode(await fetchBytes(track.file, tabId, item.frameId), 'auto').text);
    return { bytes: new TextEncoder().encode(SubLib.toVTT(cues)), cues };
  }
  const texts = await mapLimit(track.parts, 6, (s) => fetchText(s, tabId, item.frameId));
  const cues = SubLib.stitchSegments(texts);
  if (!cues.length) throw new Error(tr('The pieces are not plain WebVTT text.'));
  return { bytes: new TextEncoder().encode(SubLib.toVTT(cues)), cues };
}

// XML with a subtitle word in its address: it only counts if it really is TTML.
async function inspectXml(tabId, frameId, url) {
  if (await tabIsOff(tabId)) return;
  const t = await getTab(tabId);
  const key = stripQuery(url);
  if (t.seen.includes(key)) return;
  t.seen.push(key);
  if (t.seen.length > 300) t.seen.splice(0, 100);
  let text;
  try {
    text = SubLib.decode(await fetchBytes(url, tabId, frameId), 'auto').text;
  } catch (e) { return; }
  const cues = SubLib.parseTTML(text);
  if (cues && cues.length) addItem(tabId, { kind: 'file', url, frameId, lang: guessLanguage(url) || SubLib.headerLanguage(text) });
}

// ---------- downloading ----------

// Download from the worker first; if the site refuses (cookies, CORS),
// ask the content script in the frame that loaded it to fetch from inside the page.
async function fetchBytes(url, tabId, frameId) {
  try {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const bytes = new Uint8Array(await r.arrayBuffer());
    // Some sites (YouTube) answer an outside request with an empty file.
    if (!bytes.length) throw new Error(tr('Empty file'));
    return bytes;
  } catch (e) {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'fetch-url', url }, { frameId: frameId || 0 }).catch(() => null);
    if (res && res.ok) return SubLib.base64ToBytes(res.b64);
    throw new Error(tr('Could not download: {error}', { error: res && res.error ? res.error : e.message }));
  }
}

async function fetchText(url, tabId, frameId) {
  return SubLib.decode(await fetchBytes(url, tabId, frameId), 'utf-8').text;
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

// Returns { bytes, cues } for an item. HLS playlists are stitched into one file.
async function loadItem(tabId, item) {
  if (item.kind === 'dash') return loadDash(tabId, item);
  if (item.kind !== 'hls') {
    const bytes = item.body ? new TextEncoder().encode(item.body) : await fetchBytes(item.url, tabId, item.frameId);
    const text = SubLib.decode(bytes, 'auto').text;
    const cues = SubLib.parse(text);
    if (!item.lang) item.lang = SubLib.headerLanguage(text);
    // YouTube's own format and TTML become WebVTT, so everything after this sees a normal file.
    if (item.yt || SubLib.isTTML(text)) return { bytes: new TextEncoder().encode(SubLib.toVTT(cues)), cues };
    return { bytes, cues };
  }
  let url = item.url;
  let text = await fetchText(url, tabId, item.frameId);
  if (!text.includes('#EXTINF')) {
    // A master playlist slipped through: follow its first subtitle track.
    const line = text.split(/\r?\n/).find((l) => l.startsWith('#EXT-X-MEDIA:') && /TYPE=SUBTITLES/.test(l));
    if (!line) throw new Error(tr('No subtitle track in this playlist.'));
    url = new URL(parseAttrs(line.slice(13)).URI, url).href;
    text = await fetchText(url, tabId, item.frameId);
  }
  const segs = segmentUrls(text, url);
  if (!segs.length) throw new Error(tr('The subtitle playlist is empty.'));
  const texts = await mapLimit(segs, 6, (s) => fetchText(s, tabId, item.frameId));
  const cues = SubLib.stitchSegments(texts);
  if (!cues.length) throw new Error(tr('The pieces are not plain WebVTT text.'));
  return { bytes: new TextEncoder().encode(SubLib.toVTT(cues)), cues };
}

function fileName(item) {
  if (item.yt) return ('youtube-' + item.yt + (item.lang ? '.' + item.lang : '')).replace(/[^\w.\-]+/g, '_');
  const base = stripQuery(item.url).split('/').pop().replace(SubLib.SUB_FILE, '').replace(/\.m3u8$/i, '') || 'subtitles';
  return (base + (item.lang && !base.includes(item.lang) ? '.' + item.lang : '')).replace(/[^\w.\-]+/g, '_');
}

// Where "Translate" sends you after downloading. The file still has to be
// uploaded there by hand: one website can't hand a file to another.
const TRANSLATOR_URL = 'https://translate-subtitles.com/en';

// ---------- translation ----------

// Google Translate's free web endpoint (the one its own widgets use, no key).
// One `q` per subtitle line comes back as one result per line, so timing stays
// line for line. Lines go as HTML so <i>/<b> and line breaks survive.
const GOOGLE_URL = 'https://translate.googleapis.com/translate_a/t?client=gtx&sl=auto&format=html&tl=';
const BATCH_CHARS = 4000;

// ---------- shared improved subtitles ----------

async function shareBase() {
  const { shareUrl } = await chrome.storage.local.get('shareUrl');
  return (shareUrl || SubSettings.SHARE_URL).replace(/\/$/, '');
}
async function shareCall(path, body) {
  const owner = await SubSettings.shareOwner();
  const res = await fetch((await shareBase()) + path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ owner }, body)), signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => ({}));
  return res.ok ? data : Object.assign({ ok: false }, data);
}
// The newest shared copy of these original lines in `lang`, with its .srt, or
// null. Only the first 5 characters of the fingerprint leave the computer:
// the answer lists every copy starting with them, and the right one is picked here.
async function shareFind(src, lang) {
  const { shareFind: on } = await chrome.storage.local.get('shareFind');
  if (!SubSettings.SHARING || on === false || !/^[0-9a-f]{64}$/.test(src || '')) return null;
  const base = await shareBase();
  const q = new URLSearchParams({ p: src.slice(0, 5), lang });
  const found = await fetch(base + '/find?' + q, { signal: AbortSignal.timeout(4000) }).then((r) => (r.ok ? r.json() : null));
  const item = found && (found.items || []).find((i) => i.src === src);
  if (!item) return null;
  const got = await fetch(base + '/get?id=' + item.id, { signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : null));
  return got && got.srt ? { item, srt: got.srt } : null;
}
// Your finished improvement, once you said yes to sharing.
async function shareSend(job) {
  const { shareMine } = await chrome.storage.local.get('shareMine');
  if (!SubSettings.SHARING || !shareMine || !job) return { ok: false, error: 'off' };
  const r = await shareCall('/share', { src: job.src, lang: job.lang, model: job.model, lines: job.lines, ms: job.ms, srt: job.srt });
  if (r && r.ok) {
    const { shareCount } = await chrome.storage.local.get('shareCount');
    await chrome.storage.local.set({ shareCount: (shareCount || 0) + 1 });
  }
  return r;
}

async function translateBatch(lines, to) {
  const body = new URLSearchParams();
  for (const l of lines) body.append('q', l);
  const r = await fetch(GOOGLE_URL + encodeURIComponent(to), { method: 'POST', body });
  if (r.status === 429) throw new Error(tr('Google Translate says "too many requests". Wait a few minutes and try again.'));
  if (!r.ok) throw new Error(tr('Google Translate answered HTTP {status}.', { status: r.status }));
  const data = await r.json();
  if (!Array.isArray(data) || data.length !== lines.length) throw new Error(tr('Google Translate sent back something unexpected.'));
  // With sl=auto each result is [text, detected language]; a single line can come back bare.
  return data.map((d) => (Array.isArray(d) ? d : [d, '']));
}

// onProgress(done, total) after each batch, in lines: the card over the video shows how far it got.
async function translateTexts(texts, to, onProgress) {
  const batches = [];
  let cur = [], size = 0;
  for (const t of texts) {
    if (cur.length && (size + t.length > BATCH_CHARS || cur.length >= 120)) { batches.push(cur); cur = []; size = 0; }
    cur.push(t);
    size += t.length;
  }
  if (cur.length) batches.push(cur);
  // Two requests at a time: fast for a full film, gentle enough not to get blocked.
  const out = new Array(batches.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < batches.length) {
      const i = next++;
      out[i] = await translateBatch(batches[i], to);
      done += batches[i].length;
      if (onProgress) onProgress(done, texts.length);
    }
  };
  await Promise.all([worker(), worker()]);
  // The language most lines were detected as names the original (for the dual subtitles switch).
  const pairs = out.flat(), votes = {};
  for (const [, lang] of pairs) if (lang) votes[lang] = (votes[lang] || 0) + 1;
  const detected = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0] || '';
  return { texts: pairs.map((p) => p[0]), detected };
}

// ---------- AI translation (Gemini, Claude, OpenAI or a local model) ----------

// OpenAI, Gemini, Ollama and LM Studio speak the OpenAI-style chat API (Gemini
// through Google's compatibility endpoint); Claude gets the same request turned
// into its own Messages API in aiChat. The page sends small chunks (Google's
// version is already on screen) and swaps in each one as it comes back.
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
const CLAUDE_BASE = 'https://api.anthropic.com/v1';
const OPENAI_BASE = 'https://api.openai.com/v1';

async function aiConfig() {
  const p = await SubSettings.loadTranslation();
  if (p.translator === 'gemini') {
    if (!p.geminiKey) throw new Error(tr('Add your Gemini API key in the extension popup.'));
    return { kind: 'gemini', base: GEMINI_BASE, key: p.geminiKey, model: /omni/.test(p.geminiModel) ? '' : p.geminiModel }; // Omni makes video: an old default, not a choice
  }
  if (p.translator === 'claude') {
    if (!p.claudeKey) throw new Error(tr('Add your Claude API key in the extension popup.'));
    return { kind: 'claude', base: CLAUDE_BASE, key: p.claudeKey, model: p.claudeModel };
  }
  if (p.translator === 'openai') {
    if (!p.openaiKey) throw new Error(tr('Add your OpenAI API key in the extension popup.'));
    return { kind: 'openai', base: OPENAI_BASE, key: p.openaiKey, model: p.openaiModel };
  }
  if (p.translator === 'local') {
    const cfg = { kind: 'local', base: String(p.localUrl || '').replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1', model: p.localModel };
    await allowLocal(cfg.base);
    return cfg;
  }
  return null;
}

// Ollama turns away (403) every request that says it comes from an extension
// (the Origin header) unless OLLAMA_ORIGINS allows it. Our own requests to the
// local server go out without that header; requests from websites keep it.
async function allowLocal(base) {
  let origin;
  try { origin = new URL(base).origin; } catch (e) { return; }
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      condition: { urlFilter: '|' + origin + '/', tabIds: [-1], resourceTypes: ['xmlhttprequest', 'other'] }, // -1: not from a tab, so from this worker
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'remove' }] },
    }],
  }).catch(() => { /* then OLLAMA_ORIGINS is the way, as the error says */ });
}

// What the server said went wrong: Google wraps it as [{ error: { message } }],
// local servers as { error: { message } } or { error: "..." }.
function serverSays(detail) {
  try {
    const j = JSON.parse(detail);
    const e = (Array.isArray(j) ? j[0] : j).error;
    return String((e && e.message) || e || '').slice(0, 200);
  } catch (err) { return ''; }
}

function aiHeaders(cfg) {
  const h = { 'Content-Type': 'application/json' };
  if (cfg.kind === 'claude') {
    // Anthropic turns away requests that carry an Origin (ours: the extension) without this.
    Object.assign(h, { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
  } else if (cfg.key) h.Authorization = 'Bearer ' + cfg.key;
  return h;
}

function aiError(cfg, e) {
  if (cfg.kind === 'local' && e instanceof TypeError) {
    const err = new Error(tr('Can’t reach the local model at {url}. Is Ollama or LM Studio running?', { url: cfg.base.replace(/\/v1$/, '') }));
    err.unreachable = true; // the address is what's wrong: the popup says it there
    return err;
  }
  return e;
}

// Nothing answers at the address set: maybe it's only a typo in the port, or the
// other app. Asks Ollama's and LM Studio's usual addresses; any answer at all
// (even a refusal) means the server is there. Returns { name, url } or null.
const LOCAL_SERVERS = [['Ollama', 11434], ['LM Studio', 1234]];
async function findLocal(base) {
  let set = null;
  try { set = new URL(base); } catch (e) { /* any address is new */ }
  for (const [name, port] of LOCAL_SERVERS) {
    if (set && /^(localhost|127\.0\.0\.1)$/.test(set.hostname) && +set.port === port) continue;
    const url = 'http://localhost:' + port;
    try {
      await fetch(url + '/v1/models', { signal: AbortSignal.timeout(1500) });
      return { name, url };
    } catch (e) { /* not this one */ }
  }
  return null;
}
// What a failed request tells the popup and the card over the video.
async function aiFailure(e) {
  if (!e.unreachable) return { ok: false, error: e.message };
  const p = await SubSettings.loadTranslation();
  return { ok: false, error: e.message, unreachable: true, found: await findLocal(p.localUrl) };
}

async function aiModels(cfg) {
  let r;
  try {
    r = await fetch(cfg.base + '/models' + (cfg.kind === 'claude' ? '?limit=100' : ''), { headers: aiHeaders(cfg), signal: AbortSignal.timeout(15000) });
  } catch (e) { throw aiError(cfg, e); }
  if (r.status === 403 && cfg.kind === 'local') throw new Error(tr('The local model refused the extension. Allow it in Ollama (OLLAMA_ORIGINS).'));
  if (r.status === 400 || r.status === 401 || r.status === 403) throw new Error(tr('The API key was not accepted.'));
  if (!r.ok) throw new Error(tr('The model server answered HTTP {status}.', { status: r.status }));
  const data = await r.json();
  return (data.data || []).map((m) => String(m.id).replace(/^models\//, ''))
    // Gemini and OpenAI also list image, speech and embedding models; only text chat ones can translate.
    .filter((id) => cfg.kind !== 'gemini' || (/^gemini|^gemma/.test(id) && !/image|tts|audio|live|embed|vision|video|omni|transcribe|robotics/.test(id)))
    // OpenAI: no dated copies of the same model, no Pro (Responses API only, and costly).
    .filter((id) => cfg.kind !== 'openai' || (/^gpt-/.test(id) && !/image|tts|audio|realtime|live|transcribe|whisper|search|codex|cyber|oss|instruct|-pro\b|\d{4}-\d\d-\d\d/.test(id)))
    .sort();
}

// The popup's setup guide: downloads a model into Ollama (its /api/pull), so
// nobody has to open Terminal. Progress goes to storage.session `localPull`
// ({ model, state: running|done|error, completed, total, error, at }), so a
// popup opened again later still sees it. Ollama keeps what it already has, so
// a stopped download continues where it was when started again.
let pulling = null;
function pullModel(model) {
  if (pulling) return pulling;
  pulling = (async () => {
    const save = (s) => chrome.storage.session.set({ localPull: Object.assign({ model, at: Date.now() }, s) });
    const parts = {}; // Ollama sends progress per layer: digest -> { total, completed }
    try {
      const p = await SubSettings.loadTranslation();
      const root = String(p.localUrl || '').replace(/\/+$/, '').replace(/\/v1$/, '');
      await allowLocal(root + '/v1');
      await save({ state: 'running', completed: 0, total: 0 });
      let r;
      try {
        r = await fetch(root + '/api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: true }) });
      } catch (e) { throw new Error(tr('Can’t reach the local model at {url}. Is Ollama or LM Studio running?', { url: root })); }
      if (!r.ok) throw new Error(serverSays(await r.text()) || tr('The model server answered HTTP {status}.', { status: r.status }));
      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      let shown = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const j = JSON.parse(line);
          if (j.error) throw new Error(String(j.error).slice(0, 200));
          if (j.digest && j.total) parts[j.digest] = { total: j.total, completed: j.completed || 0 };
        }
        // Twice a second is enough for a progress bar (and each save keeps the worker awake).
        if (Date.now() - shown > 500) {
          shown = Date.now();
          const all = Object.values(parts);
          await save({ state: 'running', total: all.reduce((s, x) => s + x.total, 0), completed: all.reduce((s, x) => s + x.completed, 0) });
        }
      }
      await save({ state: 'done' });
    } catch (e) {
      await save({ state: 'error', error: e.message });
    } finally {
      pulling = null;
    }
  })();
  return pulling;
}

const englishName = (code) => {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code); } catch (e) { return code; }
};

const AI_PROMPT = (lang, sheet) => [
  'You translate film and TV subtitles into ' + lang + '.',
  ...(sheet ? [
    'Notes on who is who, made earlier from the whole subtitle file (they can be incomplete, and the lines themselves win if they disagree):',
    '"""\n' + sheet + '\n"""',
    'Use the notes to work out who is probably speaking to whom, then pick gender, forms of address and name spellings that fit, the same way throughout.',
  ] : []),
  'You get JSON: "lines", numbered subtitle lines to translate, and sometimes "before", the lines just before them, for context only.',
  'Answer with JSON only: the same numbers, each with "src", that line copied exactly, and "tr", the translation of that one line.',
  'A line is often only part of a sentence that goes on in the next line: translate it as that part, so the lines read naturally one after another, and never move words to another number.',
  'Keep <i>, <b>, <u> tags and <br> line breaks where they belong.',
  'Give exactly one translation for each line: never a second version, no "(or: ...)", no notes or explanations.',
  'Write natural, spoken ' + lang + ' that fits a subtitle: keep names, keep the tone (slang, swearing, formal or informal address) consistent with the context.',
].join('\n');

// Automatic captions (YouTube's speech recognition) in the language you read:
// nothing to translate, but they have no punctuation, cut sentences anywhere
// and mishear words. The model fixes that in the same language.
const CLEAN_PROMPT = (lang) => [
  'You fix automatic captions of a video: ' + lang + ' made by speech recognition, so they have little or no punctuation, wrong capital letters and some misheard words.',
  'You get JSON: "lines", numbered caption lines to fix, and sometimes "before", the lines just before them, for context only.',
  'Answer with JSON only: the same numbers, each with "src", that line copied exactly, and "tr", the fixed line, in ' + lang + '.',
  'Change as little as possible: add missing punctuation and capital letters, correct spelling, and replace a word only where it was clearly misheard (it makes no sense there and a word that sounds alike does).',
  'Everything else stays as it was said: every word, its form and the word order, also informal or ungrammatical spoken language, names and slang. Only a word said twice by stammering ("but but") becomes one.',
  'Keep numbers as digits, and keep markers such as &gt;&gt; or [laughter] as they are.',
  'Never translate, summarise, shorten or add anything. A line is often only part of a sentence that goes on in the next line: fix it as that part, and never move words to another number.',
  'Give exactly one version for each line: no "(or: ...)", no notes or explanations.',
].join('\n');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The chunk each page is waiting for, so the page can stop it ("Stop" over the
// video, or its subtitles switched off): "tab:frame:language" -> AbortController.
const aiRuns = new Map();
const STOPPED = new Error('stopped');

// Thinking only slows translation down. Gemini 2.5 Flash and OpenAI's GPT-6
// models can turn it off ("none"), Gemini 3 and later only turn it down
// ("minimal"), older OpenAI models take no level at all: each model's lowest
// accepted level is found once and remembered.
const EFFORTS = ['none', 'minimal', 'low'];
const effortOf = new Map(); // model -> reasoning_effort it accepts ('' = don't send one)

// The OpenAI-style request as Claude's Messages API wants it: the system
// prompt on its own, and a limit on the answer's length.
function claudeBody(body) {
  const out = { model: body.model, max_tokens: 8192, system: body.messages[0].content, messages: body.messages.slice(1) };
  if (body.temperature != null) out.temperature = body.temperature;
  return out;
}

async function aiChat(cfg, body, signal) {
  const claude = cfg.kind === 'claude';
  let loops = 0; // answers a model got stuck in (see below)
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch(cfg.base + (claude ? '/messages' : '/chat/completions'), {
        method: 'POST', headers: aiHeaders(cfg), body: JSON.stringify(claude ? claudeBody(body) : body),
        // A local model may first have to load into memory. Stopping from the
        // page closes the connection, and Ollama or LM Studio stop generating.
        signal: AbortSignal.any([signal, AbortSignal.timeout(cfg.kind === 'local' ? 240000 : 90000)]),
      });
    } catch (e) { throw signal.aborted ? STOPPED : aiError(cfg, e); }
    if (r.ok) {
      const data = await r.json();
      if (claude) return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
      return String((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '');
    }
    const said = serverSays(await r.text().catch(() => ''));
    // The free Gemini tier allows only a few requests a minute: wait and try
    // again. "limit: 0" means this model has no free requests at all.
    // Claude answers 529 when it's overloaded: the same wait helps. OpenAI's
    // 429 also means an account with no credit left ("billing"): waiting won't help.
    if ((r.status === 429 || r.status === 529) && attempt < 4 && !/limit: 0\b/.test(said) && !(cfg.kind === 'openai' && /billing/i.test(said))) {
      const wait = Number(r.headers.get('retry-after')) || 20;
      await sleep(Math.min(wait, 60) * 1000);
      if (signal.aborted) throw STOPPED;
      continue;
    }
    // Ollama cuts off a model that writes the same word over and over ("token
    // repeat limit reached", HTTP 500). A small local model does that now and
    // then on lines like "hahaha"; asked again, a little less strictly, it
    // usually gets through, so it's tried twice more before the pass stops.
    if (r.status === 500 && /repeat limit/i.test(said) && loops < 2) {
      loops++;
      if (body.temperature != null) body.temperature = 0.2 + 0.2 * loops;
      if (signal.aborted) throw STOPPED;
      continue;
    }
    if (r.status === 400 && body.reasoning_effort && /reasoning|thinking|effort|budget/i.test(said)) {
      const next = EFFORTS[EFFORTS.indexOf(body.reasoning_effort) + 1] || '';
      effortOf.set(body.model, next);
      if (next) body.reasoning_effort = next;
      else delete body.reasoning_effort;
      continue;
    }
    // Some models only take their own default temperature (OpenAI's thinking ones, for one).
    if (r.status === 400 && body.temperature != null && /temperature/i.test(said)) {
      noTemperature.add(body.model);
      delete body.temperature;
      continue;
    }
    if (r.status === 400 && body.response_format && /response_format|schema|structured/i.test(said)) {
      noSchema.add(body.model);
      delete body.response_format;
      continue;
    }
    if (r.status === 403 && cfg.kind === 'local') throw new Error(tr('The local model refused the extension. Allow it in Ollama (OLLAMA_ORIGINS).'));
    if (r.status === 401 || r.status === 403 || /api key/i.test(said)) throw new Error(tr('The API key was not accepted.') + (said ? ' ' + said : ''));
    if (r.status === 429 && cfg.kind === 'gemini') throw new Error(tr('The free Gemini limit is used up for now. Try again later.') + (said ? ' ' + said : ''));
    if (r.status === 429 || r.status === 529) throw new Error(tr('The AI is busy or the limit is used up for now. Try again later.') + (said ? ' ' + said : ''));
    throw new Error(tr('The model server answered HTTP {status}.', { status: r.status }) + (said ? ' ' + said : ''));
  }
}

// Subtitle lines are often halves of a sentence, and a model given a plain
// list merges them (gemma3:4b gave back 22 of 30 YouTube lines). So lines go
// numbered, a JSON schema makes the server hold the answer to the same
// numbers, and each answer first copies its line: without the copy the words
// still drifted a line or two away from where they are said. A copy that
// doesn't match shows the translation drifted, and that line keeps Google's.
// "L01": a key like "01" or "10" would let JavaScript reorder the lines.
const keyOf = (i) => 'L' + String(i + 1).padStart(2, '0');
const noSchema = new Set(); // models whose server refused response_format
const noTemperature = new Set(); // models that refused a temperature of their own
const bare = (html) => String(html || '').replace(/<[^>]*>|&#?\w+;/g, '').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();

// One chunk of lines (HTML, like the Google path) -> the same number of
// translated lines; one the model left out comes back '' (Google's stays).
async function aiTranslate(lines, before, to, signal, sheet, clean) {
  const cfg = await aiConfig();
  if (!cfg) throw new Error(tr('No AI translator is chosen.'));
  if (!cfg.model) throw new Error(tr('Choose a model in the extension popup.'));
  const lang = englishName(to);
  // One request -> the lines it got back, '' where the model left one out (null: no JSON at all).
  async function ask(lines, before) {
    const keys = lines.map((l, i) => keyOf(i));
    const numbered = Object.fromEntries(keys.map((k, i) => [k, lines[i]]));
    const body = {
      model: cfg.model,
      temperature: noTemperature.has(cfg.model) ? undefined : 0.2,
      messages: [
        { role: 'system', content: clean ? CLEAN_PROMPT(lang) : AI_PROMPT(lang, sheet) },
        { role: 'user', content: JSON.stringify(before.length ? { before, lines: numbered } : { lines: numbered }) },
      ],
    };
    // Claude holds the format from the prompt; the copied "src" still catches drift.
    if (cfg.kind !== 'claude' && !noSchema.has(cfg.model)) {
      body.response_format = { type: 'json_schema', json_schema: { name: 'subtitles', strict: true, schema: {
        type: 'object', required: keys, additionalProperties: false, properties: Object.fromEntries(keys.map((k) => [k, {
          type: 'object', properties: { src: { type: 'string' }, tr: { type: 'string' } }, required: ['src', 'tr'], additionalProperties: false,
        }])),
      } } };
    }
    if (cfg.kind === 'gemini' || cfg.kind === 'openai') {
      const effort = effortOf.has(cfg.model) ? effortOf.get(cfg.model) : EFFORTS[0];
      if (effort) body.reasoning_effort = effort;
    }
    const text = (await aiChat(cfg, body, signal)).replace(/<think>[\s\S]*?<\/think>/g, '');
    let out = null;
    try { out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch (e) { return null; }
    if (out && out.lines && typeof out.lines === 'object') out = out.lines;
    return keys.map((k, i) => {
      const a = out && out[k];
      const s = a && typeof a === 'object' ? (bare(a.src) === bare(lines[i]) ? a.tr : '') : a;
      return typeof s === 'string' ? SubLib.dropAlternative(s.trim()) : '';
    });
  }
  // A second try of the whole chunk only when many lines are missing: the
  // whole chunk again would take a local model another half a minute.
  let best = [];
  for (let attempt = 0; attempt < 2 && best.filter(Boolean).length < lines.length * 0.8; attempt++) {
    const texts = await ask(lines, before);
    if (texts && texts.filter(Boolean).length > best.filter(Boolean).length) best = texts;
  }
  if (!best.some(Boolean)) throw new Error(tr('The model did not send back the translated lines.'));
  // A few lines left out: one short request for just those. A line with no
  // words in it (♪, …) isn't worth one; whatever is still missing keeps Google's.
  const missing = lines.map((l, i) => i).filter((i) => !best[i] && bare(lines[i]));
  if (missing.length) {
    const first = missing[0];
    const again = await ask(missing.map((i) => lines[i]), lines.slice(Math.max(0, first - 4), first)).catch((e) => {
      if (e === STOPPED) throw e;
      return null;
    });
    if (again) missing.forEach((i, n) => { if (again[n]) best[i] = again[n]; });
  }
  return { texts: best, model: cfg.model };
}

// A chunk of 30 lines can't tell who is who, and many languages need to know:
// Vietnamese pronouns depend on the age and relationship of the two people, and
// many others mark gender or formal address. So the model first reads the whole
// file once and writes short notes that go along with every chunk.
const SHEET_PROMPT = (lang) => [
  'Below are all the subtitle lines of a film or TV episode, in order. They will be translated into ' + lang + ' in small chunks, by someone who sees only these notes and the chunk.',
  'Write the notes, in English, plain text, at most 300 words:',
  'PEOPLE: each named character: gender, rough age, role, relationship to the others.',
  'ADDRESS: for each pair who talk to each other, the exact ' + lang + ' words: what A calls B, and what A calls themself when talking to B, then the same for B. The lines are in another language and won\'t show these words: choose them yourself from the two people\'s ages and relationship, as ' + lang + ' speakers normally would. Not just "formal" or "informal". Add what changes if their relationship changes during the story. Skip this only if ' + lang + ' has no such distinctions.',
  'NAMES: names of people, places and things that must stay spelled the same.',
  'Under PEOPLE, write only what the lines support, and "unknown" where they don\'t say. Start directly with PEOPLE, no introduction.',
].join('\n');
// A local model usually can't hold a whole film at once, and would quietly lose
// the beginning: it gets evenly spread parts instead.
const SHEET_MAX_CHARS = { local: 12000, other: 200000 };
const SHEET_MAX_ANSWER = 4000;

function sheetSource(lines, max) {
  const text = lines.join('\n');
  if (text.length <= max) return text;
  const PARTS = 8;
  const each = Math.floor(lines.length / PARTS);
  const room = Math.floor(max / PARTS);
  const parts = [];
  for (let p = 0; p < PARTS; p++) parts.push(lines.slice(p * each, (p + 1) * each).join('\n').slice(0, room));
  return parts.join('\n[...]\n');
}

// The notes for one file, or '' if they can't be made: translation works without
// them. Remembered until the browser closes, so a reload doesn't pay for them again.
async function aiSheet(texts, to, signal) {
  const cfg = await aiConfig();
  if (!cfg || !cfg.model) return '';
  const lines = texts.map((t) => String(t).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (lines.length < 2) return '';
  const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(lines.join('\n')));
  const key = 'sheet:' + [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('') + ':' + to + ':' + cfg.model;
  const kept = await chrome.storage.session.get(key);
  if (kept[key]) return kept[key];
  const body = {
    model: cfg.model,
    temperature: noTemperature.has(cfg.model) ? undefined : 0.2,
    messages: [
      { role: 'system', content: SHEET_PROMPT(englishName(to)) },
      { role: 'user', content: sheetSource(lines, cfg.kind === 'local' ? SHEET_MAX_CHARS.local : SHEET_MAX_CHARS.other) },
    ],
  };
  if (cfg.kind === 'gemini' || cfg.kind === 'openai') {
    const effort = effortOf.has(cfg.model) ? effortOf.get(cfg.model) : EFFORTS[0];
    if (effort) body.reasoning_effort = effort;
  }
  const sheet = (await aiChat(cfg, body, signal)).replace(/<think>[\s\S]*?<\/think>/g, '').trim().slice(0, SHEET_MAX_ANSWER);
  if (sheet) await chrome.storage.session.set({ [key]: sheet }).catch(() => {});
  return sheet;
}

// ---------- Google Fonts ----------

// Font files are handed to the page as bytes (not as a link), so sites whose
// security rules block outside fonts still show the chosen one.
let fontList = null;
const fontCache = new Map(); // family -> Promise of faces

async function fontWeights(family) {
  if (!fontList) fontList = await (await fetch(chrome.runtime.getURL('lib/google-fonts.json'))).json();
  const entry = fontList.find((f) => f[0] === family);
  if (!entry) throw new Error(tr('Unknown font: {name}', { name: family }));
  const wanted = entry[2].filter((w) => w === 400 || w === 600 || w === 700);
  // Fonts without the usual weights: take the one closest to Regular.
  return wanted.length ? wanted : [entry[2].slice().sort((a, b) => Math.abs(a - 400) - Math.abs(b - 400))[0]];
}

async function loadFont(family, subset) {
  const weights = await fontWeights(family);
  const url = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family).replace(/%20/g, '+') +
    (weights.length === 1 && weights[0] === 400 ? '' : ':wght@' + weights.join(';')) + '&display=swap';
  const res = await fetch(url);
  if (!res.ok) throw new Error(tr('Google Fonts answered {status}', { status: res.status }));
  const css = await res.text();
  // One block per subset and weight; keep only the alphabets subtitles here need.
  // (Chrome gets one block per alphabet, each labelled; other browsers get one unlabelled block.)
  const blocks = [...css.matchAll(/(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*{([^}]*)}/g)];
  const wantedSubsets = ['latin', 'latin-ext', 'vietnamese'].concat(subset ? [subset] : []);
  const keep = blocks.filter((b) => !b[1] || wantedSubsets.includes(b[1]));
  // All files download at once; a variable font shares one file across weights.
  const files = new Map();
  const faces = [];
  for (const [, , body] of keep.length ? keep : blocks.slice(0, 3)) {
    const get = (prop) => ((new RegExp(prop + ':\\s*([^;]+);')).exec(body) || [])[1];
    const src = /url\((https:[^)]+)\)/.exec(body);
    if (!src) continue;
    if (!files.has(src[1])) {
      files.set(src[1], fetch(src[1]).then((r) => {
        if (!r.ok) throw new Error(tr('Font file answered {status}', { status: r.status }));
        return r.arrayBuffer();
      }).then((b) => SubLib.bytesToBase64(new Uint8Array(b))));
    }
    faces.push({ weight: get('font-weight') || '400', style: get('font-style') || 'normal', unicodeRange: get('unicode-range'), b64: files.get(src[1]) });
  }
  if (!faces.length) throw new Error(tr('No font files found.'));
  for (const f of faces) f.b64 = await f.b64;
  return faces;
}

// Shows subtitles on the tab's video: the frame already showing subtitles
// keeps them, otherwise the largest playing (or largest visible) video wins.
async function loadIntoTab(tabId, name, b64) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => (window.__subOverlay ? window.__subOverlay.report() : null),
  });
  const reports = results.filter((r) => r.result);
  const loaded = reports.find((r) => r.result.loaded);
  const videos = reports.flatMap((r) => r.result.videos.filter((v) => v.visible).map((v) => Object.assign({ frameId: r.frameId }, v)));
  let target = loaded && videos.find((v) => v.frameId === loaded.frameId && v.current);
  if (!target) {
    const playing = videos.filter((v) => v.playing);
    target = (playing.length ? playing : videos).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  }
  if (!target) return { ok: false, error: tr('No video found on this page.') };
  if (loaded && loaded.frameId !== target.frameId) {
    await chrome.tabs.sendMessage(tabId, { type: 'clear' }, { frameId: loaded.frameId }).catch(() => {});
  }
  return chrome.tabs.sendMessage(tabId, { type: 'load', name, b64, encoding: 'auto', videoIndex: target.index }, { frameId: target.frameId });
}

// ---------- translated videos, for the rating card and the support card ----------

// A page counts once: the last 100 are kept as short fingerprints, not their
// addresses. Written here only, one after another, so two frames can't lose a count.
// ai: an AI pass finished improving it, counted apart (and once) for the support card.
const STATS_PAGES = 100;
let statsWrite = Promise.resolve();
function countVideo(page, lines, ai) {
  statsWrite = statsWrite.then(async () => {
    const { stats = { videos: 0, lines: 0, pages: [] } } = await chrome.storage.local.get('stats');
    const id = SubSettings.fingerprint(String(page));
    const key = ai ? 'aiPages' : 'pages';
    const seen = stats[key] || [];
    if (seen.includes(id)) return;
    stats[key] = seen.concat(id).slice(-STATS_PAGES);
    if (ai) stats.aiVideos = (stats.aiVideos || 0) + 1;
    else { stats.videos++; stats.lines += Number(lines) || 0; }
    await chrome.storage.local.set({ stats });
  }).catch(() => {});
}

// The support card over the video: the pages it showed on, and done for good
// after any click on it (or once it showed on its last page).
function supportAsk(msg) {
  statsWrite = statsWrite.then(async () => {
    const { supportAsk: a = { pages: [] } } = await chrome.storage.local.get('supportAsk');
    if (a.done) return;
    if (msg.done) a.done = true;
    else if (msg.page && !a.pages.includes(msg.page)) a.pages = a.pages.concat(msg.page);
    await chrome.storage.local.set({ supportAsk: a });
  }).catch(() => {});
}

// ---------- messages ----------

// Frames of a tab that show subtitles, kept in session storage too: the worker
// may sleep while a video plays, and shortcuts are forwarded by this list.
const frames = new Map(); // tabId -> Promise of a Set of frameIds

function getFrames(tabId) {
  if (!frames.has(tabId)) {
    frames.set(tabId, chrome.storage.session.get('frames:' + tabId)
      .then((got) => new Set(got['frames:' + tabId] || []), () => new Set()));
  }
  return frames.get(tabId);
}

function dropFrames(tabId) {
  frames.delete(tabId);
  chrome.storage.session.remove('frames:' + tabId).catch(() => {});
}

// Snap Translate, the creator's other extension, asks whether Subtitle Overlay is
// installed, so it doesn't suggest it. That is the only thing answered to other extensions.
chrome.runtime.onMessageExternal.addListener((msg, sender, reply) => {
  if (msg && msg.type === 'hello') reply({ app: 'subtitle-overlay' });
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = msg.tabId != null ? msg.tabId : sender.tab && sender.tab.id;
  switch (msg.type) {
    case 'ping':
      // The popup checks that this worker is alive (see deadCard in popup.js).
      reply({ ok: true });
      return;

    case 'ui-strings':
      SubI18n.read(msg.lang).then(reply, () => reply(null));
      return true;
    case 'recent-found':
      // A page script that just started: files the player loaded in the last minute.
      // all: any time (YouTube's CC button turned on asks for its captions again).
      getTab(tabId).then((t) => reply(visibleItems(t)
        .filter((i) => (i.kind === 'file' || i.segments) && (msg.all || Date.now() - (i.loadedAt || i.time) < FOUND_FRESH_MS))
        .map(foundItem)));
      return true;

    case 'yt-captions': {
      // A caption file YouTube's player just received (youtube-hook.js via content.js).
      if (!sender.tab || !YT_CAPTIONS.test(msg.url)) return;
      const cues = SubLib.parseYouTube(msg.text);
      if (!cues || !cues.length) return;
      const y = ytInfo(msg.url);
      addItem(tabId, { kind: 'file', url: msg.url, frameId: sender.frameId, lang: y.lang, yt: y.v || 'video', body: msg.text, asr: y.asr,
        tracks: Array.isArray(msg.tracks) ? msg.tracks.slice(0, 200) : undefined,
        name: y.asr ? 'YouTube auto-captions' : 'YouTube captions' });
      return;
    }

    case 'page-subtitles': {
      // A TTML file the Netflix player just received (netflix-hook.js via content.js).
      // Its address tells nothing and may work only once, so it is kept as WebVTT
      // under a name of its own: each language and version is a separate entry.
      if (!sender.tab || !NETFLIX_PAGE.test(sender.tab.url || '')) return;
      const cues = SubLib.parseTTML(msg.text);
      if (!cues || !cues.length) return;
      const lang = SubLib.headerLanguage(msg.text);
      const title = NETFLIX_PAGE.exec(sender.tab.url)[1];
      addItem(tabId, { kind: 'file', url: 'https://www.netflix.com/subtitles/netflix-' + title + (lang ? '-' + lang : '') + '-' + cues.length + '.vtt',
        frameId: sender.frameId, lang, body: SubLib.toVTT(cues), name: 'Netflix subtitles' });
      return;
    }

    case 'nf-tracks': {
      // The subtitle languages in the Netflix player's manifest (netflix-hook.js).
      // Kept for a few titles: the player may fetch the next episode's early.
      if (!sender.tab || !/^https:\/\/www\.netflix\.com\//.test(sender.tab.url || '') || !Array.isArray(msg.tracks)) return;
      getTab(tabId).then((t) => {
        const list = (t.netflix || []).filter((m) => m.movieId !== String(msg.movieId));
        list.unshift({ movieId: String(msg.movieId), tracks: msg.tracks.slice(0, 120), time: Date.now() });
        t.netflix = list.slice(0, 4);
        chrome.storage.session.set({ ['cap:' + tabId]: t }).catch(() => {});
      });
      return;
    }

    case 'site-tracks': {
      // Prime Video's subtitle files for the title playing (prime-hook.js).
      // Only the newest list is kept: it belongs to what is on screen.
      if (!sender.tab || !PRIME_PAGE.test(sender.tab.url || '') || !Array.isArray(msg.tracks)) return;
      const tracks = msg.tracks.slice(0, 150).filter((x) => x && typeof x.lang === 'string' && Array.isArray(x.urls))
        .map((x) => ({ lang: x.lang, name: String(x.name || ''), cc: !!x.cc, forced: !!x.forced, urls: x.urls.filter((u) => /^https:/.test(u)).slice(0, 3) }));
      getTab(tabId).then((t) => {
        t.site = { site: 'Prime Video', id: String(msg.id || ''), tracks, time: Date.now() };
        chrome.storage.session.set({ ['cap:' + tabId]: t }).catch(() => {});
      });
      return;
    }

    case 'native-track':
      // Subtitles the site itself has in this language: used as they are instead
      // of a translation. Replies { ok, text (WebVTT), name, site } or { ok: false }.
      nativeTrack(tabId, sender.tab && sender.tab.url, msg.lang).then(reply, () => reply({ ok: false }));
      return true;

    case 'site-off':
      // Turned off from the popup: forget what this tab found and clear the badge.
      clearTab(tabId);
      return;

    case 'get-captured':
      getTab(tabId).then((t) => reply(visibleItems(t)));
      return true;

    case 'item-details':
      (async () => {
        const t = await getTab(tabId);
        const item = t.items.find((i) => i.id === msg.id);
        if (!item) return reply({ ok: false, error: tr('This file is gone. Reload the page.') });
        if (item.details) return reply({ ok: true, details: item.details });
        try {
          let details;
          if (item.kind === 'hls') {
            const text = await fetchText(item.url, tabId, item.frameId);
            details = { pieces: text.includes('#EXTINF') ? segmentUrls(text, item.url).length : null };
          } else if (item.kind === 'dash') {
            // Only the manifest is read here; the pieces download when the track is used.
            const track = SubLib.dashTracks(await fetchText(item.mpd, tabId, item.frameId), item.mpd).find((x) => x.key === item.track);
            details = { pieces: track && track.parts ? track.parts.length : null };
          } else {
            const { bytes, cues } = await loadItem(tabId, item);
            const text = SubLib.decode(bytes, 'auto').text;
            if (!item.lang) item.lang = SubLib.headerLanguage(text);
            details = { count: cues.length, preview: SubLib.preview(cues) };
          }
          item.details = details;
          saveTab(tabId);
          reply({ ok: true, details, lang: item.lang });
        } catch (e) {
          reply({ ok: false, error: e.message });
        }
      })();
      return true;

    case 'fetch-item':
      (async () => {
        const t = await getTab(tabId);
        const item = t.items.find((i) => i.id === msg.id);
        if (!item) return reply({ ok: false, error: tr('This file is gone. Reload the page.') });
        try {
          const { bytes, cues } = await loadItem(tabId, item);
          if (!cues.length) throw new Error(tr('No subtitle lines found.'));
          if (item.kind === 'hls' || item.kind === 'dash') {
            item.details = Object.assign({}, item.details, { count: cues.length, preview: SubLib.preview(cues) });
            saveTab(tabId);
          }
          reply({ ok: true, b64: SubLib.bytesToBase64(bytes), name: fileName(item), count: cues.length, asr: !!item.asr });
        } catch (e) {
          reply({ ok: false, error: e.message });
        }
      })();
      return true;

    case 'load-font':
      // Czech and Vietnamese letters always, plus the alphabet of the language you translate into.
      SubSettings.loadTranslation().then(({ translateTo }) => {
        const subset = SubSettings.SUBSETS[SubSettings.language(translateTo)[2]] || '';
        const key = msg.family + '|' + subset;
        if (!fontCache.has(key)) {
          fontCache.set(key, loadFont(msg.family, subset).catch((e) => { fontCache.delete(key); throw e; }));
        }
        return fontCache.get(key);
      }).then((faces) => reply({ ok: true, faces }), (e) => reply({ ok: false, error: e.message }));
      return true;

    case 'open-translator':
      chrome.tabs.create({ url: TRANSLATOR_URL });
      return;

    // Shared improved subtitles (~/subtitle-share). Every problem is just "nothing found / not sent".
    case 'share-find':
      shareFind(msg.src, msg.lang).then(reply, () => reply(null));
      return true;
    case 'share-send':
      shareSend(msg.job).then(reply, (e) => reply({ ok: false, error: e.message }));
      return true;
    case 'share-report':
      shareCall('/report', { id: msg.id }).then(reply, () => reply({ ok: false }));
      return true;
    case 'share-delete':
      shareCall('/delete', {}).then(async (r) => { if (r && r.ok) await chrome.storage.local.set({ shareCount: 0 }); reply(r); }, (e) => reply({ ok: false, error: e.message }));
      return true;

    case 'add-to-queue':
      // "Add to queue" in the popup or in the card over the video.
      addToQueue(msg, tabId).then(() => reply({ ok: true }), (e) => reply({ ok: false, error: e.message }));
      return true;

    case 'open-queue':
      openQueue().catch(() => {});
      return;

    case 'translate':
      translateTexts(msg.texts, msg.to, (done, total) => {
        // Only the frame that asked: its card shows the bar. The last batch is the answer itself.
        if (tabId != null && done < total) chrome.tabs.sendMessage(tabId, { type: 'translate-progress', to: msg.to, done, total }, { frameId: sender.frameId || 0 }).catch(() => {});
      }).then((r) => reply({ ok: true, texts: r.texts, detected: r.detected }), (e) => reply({ ok: false, error: e.message }));
      return true;

    case 'report-problem':
      // "Report a problem" over the video (content.js): the site's name and its checks.
      sendProblemReport(msg.report).then(reply, () => reply({ ok: false }));
      return true;

    case 'count-video':
      // A page showed a new translation (content.js).
      countVideo(msg.page, msg.lines, msg.ai);
      return;

    case 'support-ask':
      supportAsk(msg);
      return;

    case 'video-site':
      // A video played on this tab (content.js): its website, for the page after removal (lib/goodbye.js).
      if (sender.tab && !sender.tab.incognito) rememberGoodbyeSite(sender.tab.url);
      return;

    case 'ai-translate': {
      const key = tabId + ':' + sender.frameId + ':' + msg.to;
      const run = new AbortController();
      if (aiRuns.has(key)) aiRuns.get(key).abort();
      aiRuns.set(key, run);
      aiTranslate(msg.texts, msg.before || [], msg.to, run.signal, msg.sheet || '', !!msg.clean)
        .then((r) => reply(Object.assign({ ok: true }, r)),
          (e) => (e === STOPPED ? reply({ ok: false, stopped: true }) : aiFailure(e).then(reply)))
        .finally(() => { if (aiRuns.get(key) === run) aiRuns.delete(key); });
      return true;
    }

    // Notes on who is who, asked once before a file's first chunk. Stoppable
    // like a chunk. Any failure just means translating without them.
    case 'ai-sheet': {
      const key = tabId + ':' + sender.frameId + ':' + msg.to;
      const run = new AbortController();
      if (aiRuns.has(key)) aiRuns.get(key).abort();
      aiRuns.set(key, run);
      aiSheet(msg.texts, msg.to, run.signal)
        .then((sheet) => reply({ ok: true, sheet }),
          (e) => reply(e === STOPPED ? { ok: false, stopped: true } : { ok: true, sheet: '' }))
        .finally(() => { if (aiRuns.get(key) === run) aiRuns.delete(key); });
      return true;
    }

    case 'ai-stop': {
      const run = aiRuns.get(tabId + ':' + sender.frameId + ':' + msg.to);
      if (run) run.abort();
      return;
    }

    // A page's own Improve pass, for the queue tab: it gives way to it and lists
    // it. Kept in session storage, one key each, as this worker can restart meanwhile.
    case 'ai-live': {
      const key = 'live:' + tabId + ':' + sender.frameId + ':' + msg.to;
      if (msg.end) chrome.storage.session.remove(key);
      else {
        chrome.storage.session.set({ [key]: { key, tabId, frameId: sender.frameId, to: msg.to, name: msg.name, page: msg.page,
          model: msg.model, done: msg.done, total: msg.total, paused: msg.paused } });
      }
      return;
    }

    case 'ai-models':
      // The popup's model list: whatever the key or the local server offers.
      aiConfig().then((cfg) => (cfg ? aiModels(cfg) : [])).then((models) => reply({ ok: true, models }), (e) => aiFailure(e).then(reply));
      return true;

    case 'ai-pull':
      // The setup guide's "Download Gemma 3": answers at once, progress goes to storage.session.
      pullModel(String(msg.model || 'gemma3:12b'));
      reply({ ok: true });
      return;

    case 'convert-item':
      // "Download .srt" on the card over the video: the page saves the text itself.
      (async () => {
        const t = await getTab(tabId);
        const item = t.items.find((i) => i.id === msg.id);
        if (!item) return reply({ ok: false, error: tr('This file is gone. Reload the page.') });
        try {
          const { cues } = await loadItem(tabId, item);
          if (!cues.length) throw new Error(tr('No subtitle lines found.'));
          const format = msg.format === 'vtt' ? 'vtt' : 'srt';
          reply({ ok: true, count: cues.length, filename: fileName(item) + '.' + format,
            text: format === 'vtt' ? SubLib.toVTT(cues) : SubLib.toSRT(cues) });
        } catch (e) {
          reply({ ok: false, error: e.message });
        }
      })();
      return true;

    // ---- used by the DevTools panel ----

    case 'fetch-bytes':
      fetchBytes(msg.url, tabId, msg.frameId || 0)
        .then((bytes) => reply({ ok: true, b64: SubLib.bytesToBase64(bytes) }))
        .catch((e) => reply({ ok: false, error: e.message }));
      return true;

    case 'load-into-tab':
      loadIntoTab(tabId, msg.name, msg.b64).then(reply, (e) => reply({ ok: false, error: e.message }));
      return true;

    case 'subs-state': {
      if (!sender.tab) return;
      getFrames(tabId).then((set) => {
        if (msg.has) set.add(sender.frameId); else set.delete(sender.frameId);
        chrome.storage.session.set({ ['frames:' + tabId]: [...set] }).catch(() => {});
        chrome.tabs.sendMessage(tabId, { type: 'tab-subs', has: set.size > 0 }).catch(() => {});
      });
      return;
    }

    case 'forward-key':
      // A shortcut pressed in a frame without subtitles goes to the frames that have them.
      getFrames(tabId).then((set) => {
        for (const frameId of set) {
          chrome.tabs.sendMessage(tabId, { type: 'run-action', action: msg.action }, { frameId }).catch(() => {});
        }
      });
      return;
  }
});

// ---------- problem reports ----------

// Goes to the same small service as the feedback form, which counts reports per
// site for Filip's dashboard. Only the site's name (example.com) and the checks
// shown in the form, never the page address. One report per install, site,
// problem and day: the key is a hash of those with a random number kept here,
// so nothing in it points back to this computer.
const REPORT_URL = 'https://feedback.cleedek.com/report';
async function sendProblemReport(r) {
  if (!r || !r.site) return { ok: false };
  let { reportSalt } = await chrome.storage.local.get('reportSalt');
  if (!reportSalt) {
    reportSalt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    await chrome.storage.local.set({ reportSalt });
  }
  const day = new Date().toISOString().slice(0, 10);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode([reportSalt, r.site, r.problem, day].join('|')));
  const key = [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  const ua = navigator.userAgentData;
  const brands = (ua && ua.brands) || [];
  const brand = brands.find((b) => !/not.?a.?brand|chromium/i.test(b.brand)) || brands.find((b) => /chromium/i.test(b.brand));
  const body = {
    ext: 'subtitle-overlay', site: String(r.site), problem: r.problem, key,
    checks: { video: !!(r.checks && r.checks.video), siteSubs: !!(r.checks && r.checks.siteSubs) },
    version: chrome.runtime.getManifest().version,
    browser: brand ? brand.brand + ' ' + brand.version : '', os: (ua && ua.platform) || '',
    lang: r.lang || '', translateTo: r.translateTo || '', note: String(r.note || '').slice(0, 1000),
  };
  try {
    const res = await fetch(REPORT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: res.ok };
  } catch (e) {
    return { ok: false };
  }
}
