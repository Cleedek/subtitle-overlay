// Background worker: watches network traffic for subtitle files the page
// loads (VTT, SRT, HLS subtitle playlists), counts them on the icon badge,
// and downloads/stitches them when the popup asks.
importScripts('lib/i18n.js', 'lib/locales.js', 'lib/subtitles.js', 'lib/settings.js');
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

// Segment pieces of an HLS subtitle playlist are hidden: the playlist stands for them.
function visibleItems(t) {
  const prefixes = t.items.filter((i) => i.kind === 'hls' && i.segmentPrefix).map((i) => i.segmentPrefix);
  return t.items.filter((i) => i.kind === 'hls' || !prefixes.some((p) => i.url.startsWith(p)));
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

async function addItem(tabId, item) {
  if (await tabIsOff(tabId)) return;
  const t = await getTab(tabId);
  const key = itemKey(item.url);
  const existing = t.items.find((i) => itemKey(i.url) === key);
  // YouTube changes videos without loading a new page: drop the previous video's captions.
  if (item.yt) t.items = t.items.filter((i) => !i.yt || i.yt === item.yt);
  // The card on the video only offers subtitles the player really loaded, which
  // happens once you turn them on. Tracks merely listed in a streaming playlist
  // stay in the popup until then.
  const loaded = (i) => i.kind === 'file' || !!i.segments;
  if (existing) {
    const wasLoaded = loaded(existing);
    // Keep the newest signed URL, fill in anything new we learned.
    existing.url = item.url;
    for (const k of ['lang', 'name', 'segmentPrefix', 'segments']) if (item[k] && !existing[k]) existing[k] = item[k];
    if (item.body) { existing.body = item.body; delete existing.details; }
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

const foundItem = (item) => ({ id: item.id, lang: item.lang || '', name: item.name || stripQuery(item.url).split('/').pop() });
const FOUND_FRESH_MS = 60000;

// ---------- network watching ----------

const VTT_URL = /\.(web)?vtt$/i;
const SRT_URL = /\.srt$/i;
const M3U8_URL = /\.m3u8$/i;

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
  }
}, { urls: ['<all_urls>'], types: ['xmlhttprequest', 'media', 'other'] }, ['responseHeaders']);

// A new page in the tab starts a fresh list.
chrome.webRequest.onBeforeRequest.addListener((d) => {
  if (d.tabId < 0) return;
  clearTab(d.tabId);
  frames.delete(d.tabId);
}, { urls: ['<all_urls>'], types: ['main_frame'] });

chrome.tabs.onRemoved.addListener((tabId) => {
  tabs.delete(tabId);
  chrome.storage.session.remove('cap:' + tabId).catch(() => {});
  frames.delete(tabId);
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
  if (item.kind !== 'hls') {
    const bytes = item.body ? new TextEncoder().encode(item.body) : await fetchBytes(item.url, tabId, item.frameId);
    const cues = SubLib.parse(SubLib.decode(bytes, 'auto').text);
    // YouTube's own format becomes WebVTT, so everything after this sees a normal file.
    if (item.yt) return { bytes: new TextEncoder().encode(SubLib.toVTT(cues)), cues };
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
  const base = stripQuery(item.url).split('/').pop().replace(/\.(web)?vtt$|\.srt$|\.m3u8$/i, '') || 'subtitles';
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

async function translateTexts(texts, to) {
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
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const i = next++;
      out[i] = await translateBatch(batches[i], to);
    }
  };
  await Promise.all([worker(), worker()]);
  // The language most lines were detected as names the original (for the dual subtitles switch).
  const pairs = out.flat(), votes = {};
  for (const [, lang] of pairs) if (lang) votes[lang] = (votes[lang] || 0) + 1;
  const detected = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0] || '';
  return { texts: pairs.map((p) => p[0]), detected };
}

// ---------- AI translation (Gemini or a local model) ----------

// Both speak the OpenAI-style chat API: Gemini through Google's compatibility
// endpoint, Ollama and LM Studio natively. The page sends small chunks (Google's
// version is already on screen) and swaps in each one as it comes back.
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';

async function aiConfig() {
  const p = await SubSettings.loadTranslation();
  if (p.translator === 'gemini') {
    if (!p.geminiKey) throw new Error(tr('Add your Gemini API key in the extension popup.'));
    return { kind: 'gemini', base: GEMINI_BASE, key: p.geminiKey, model: p.geminiModel };
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
  if (cfg.key) h.Authorization = 'Bearer ' + cfg.key;
  return h;
}

function aiError(cfg, e) {
  if (cfg.kind === 'local' && e instanceof TypeError) {
    return new Error(tr('Can’t reach the local model at {url}. Is Ollama or LM Studio running?', { url: cfg.base.replace(/\/v1$/, '') }));
  }
  return e;
}

async function aiModels(cfg) {
  let r;
  try {
    r = await fetch(cfg.base + '/models', { headers: aiHeaders(cfg), signal: AbortSignal.timeout(15000) });
  } catch (e) { throw aiError(cfg, e); }
  if (r.status === 403 && cfg.kind === 'local') throw new Error(tr('The local model refused the extension. Allow it in Ollama (OLLAMA_ORIGINS).'));
  if (r.status === 400 || r.status === 401 || r.status === 403) throw new Error(tr('The API key was not accepted.'));
  if (!r.ok) throw new Error(tr('The model server answered HTTP {status}.', { status: r.status }));
  const data = await r.json();
  return (data.data || []).map((m) => String(m.id).replace(/^models\//, ''))
    // Gemini also lists image, speech and embedding models; only text chat ones can translate.
    .filter((id) => cfg.kind !== 'gemini' || (/^gemini|^gemma/.test(id) && !/image|tts|audio|live|embed|vision/.test(id)))
    .sort();
}

const englishName = (code) => {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code); } catch (e) { return code; }
};

const AI_PROMPT = (lang) => [
  'You translate film and TV subtitles into ' + lang + '.',
  'You get JSON: "lines" to translate and sometimes "before", the lines just before them, for context only.',
  'Answer with JSON only: {"lines": [...]} with exactly one translation per input line, in the same order.',
  'Never merge, split, skip or add lines, even when a sentence runs across two lines.',
  'Keep <i>, <b>, <u> tags and <br> line breaks where they belong.',
  'Write natural, spoken ' + lang + ' that fits a subtitle: keep names, keep the tone (slang, swearing, formal or informal address) consistent with the context.',
].join('\n');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Thinking only slows translation down. Gemini 2.5 Flash can turn it off
// ("none"), Gemini 3 and later only turn it down ("minimal"): each model's
// lowest accepted level is found once and remembered.
const EFFORTS = ['none', 'minimal', 'low'];
const effortOf = new Map(); // model -> reasoning_effort it accepts ('' = don't send one)

async function aiChat(cfg, body) {
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch(cfg.base + '/chat/completions', {
        method: 'POST', headers: aiHeaders(cfg), body: JSON.stringify(body),
        // A local model may first have to load into memory.
        signal: AbortSignal.timeout(cfg.kind === 'local' ? 240000 : 90000),
      });
    } catch (e) { throw aiError(cfg, e); }
    if (r.ok) {
      const data = await r.json();
      return String((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '');
    }
    const said = serverSays(await r.text().catch(() => ''));
    // The free Gemini tier allows only a few requests a minute: wait and try
    // again. "limit: 0" means this model has no free requests at all.
    if (r.status === 429 && attempt < 4 && !/limit: 0\b/.test(said)) {
      const wait = Number(r.headers.get('retry-after')) || 20;
      await sleep(Math.min(wait, 60) * 1000);
      continue;
    }
    if (r.status === 400 && body.reasoning_effort && /reasoning|thinking|effort|budget/i.test(said)) {
      const next = EFFORTS[EFFORTS.indexOf(body.reasoning_effort) + 1] || '';
      effortOf.set(body.model, next);
      if (next) body.reasoning_effort = next;
      else delete body.reasoning_effort;
      continue;
    }
    if (r.status === 403 && cfg.kind === 'local') throw new Error(tr('The local model refused the extension. Allow it in Ollama (OLLAMA_ORIGINS).'));
    if (r.status === 401 || r.status === 403 || /api key/i.test(said)) throw new Error(tr('The API key was not accepted.') + (said ? ' ' + said : ''));
    if (r.status === 429) throw new Error(tr('The free Gemini limit is used up for now. Try again later.') + (said ? ' ' + said : ''));
    throw new Error(tr('The model server answered HTTP {status}.', { status: r.status }) + (said ? ' ' + said : ''));
  }
}

// One chunk of lines (HTML, like the Google path) -> the same number of translated lines.
async function aiTranslate(lines, before, to) {
  const cfg = await aiConfig();
  if (!cfg) throw new Error(tr('No AI translator is chosen.'));
  if (!cfg.model) throw new Error(tr('Choose a model in the extension popup.'));
  const lang = englishName(to);
  const body = {
    model: cfg.model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: AI_PROMPT(lang) },
      { role: 'user', content: JSON.stringify(before.length ? { before, lines } : { lines }) },
    ],
  };
  if (cfg.kind === 'gemini') {
    const effort = effortOf.has(cfg.model) ? effortOf.get(cfg.model) : EFFORTS[0];
    if (effort) body.reasoning_effort = effort;
  }
  // Two tries: small models now and then lose count of the lines.
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = (await aiChat(cfg, body)).replace(/<think>[\s\S]*?<\/think>/g, '');
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    let out = null;
    try { out = JSON.parse(json).lines; } catch (e) { /* try again */ }
    if (Array.isArray(out) && out.length === lines.length) return { texts: out.map(String), model: cfg.model };
  }
  throw new Error(tr('The model returned a different number of lines.'));
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

// ---------- messages ----------

const frames = new Map(); // tabId -> Set of frameIds that show subtitles

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = msg.tabId != null ? msg.tabId : sender.tab && sender.tab.id;
  switch (msg.type) {
    case 'recent-found':
      // A page script that just started: files the player loaded in the last minute.
      getTab(tabId).then((t) => reply(visibleItems(t)
        .filter((i) => (i.kind === 'file' || i.segments) && Date.now() - (i.loadedAt || i.time) < FOUND_FRESH_MS)
        .map(foundItem)));
      return true;

    case 'yt-captions': {
      // A caption file YouTube's player just received (youtube-hook.js via content.js).
      if (!sender.tab || !YT_CAPTIONS.test(msg.url)) return;
      const cues = SubLib.parseYouTube(msg.text);
      if (!cues || !cues.length) return;
      const y = ytInfo(msg.url);
      addItem(tabId, { kind: 'file', url: msg.url, frameId: sender.frameId, lang: y.lang, yt: y.v || 'video', body: msg.text,
        name: y.asr ? 'YouTube auto-captions' : 'YouTube captions' });
      return;
    }

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
          if (item.kind === 'hls') {
            item.details = Object.assign({}, item.details, { count: cues.length, preview: SubLib.preview(cues) });
            saveTab(tabId);
          }
          reply({ ok: true, b64: SubLib.bytesToBase64(bytes), name: fileName(item), count: cues.length });
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

    case 'translate':
      translateTexts(msg.texts, msg.to).then((r) => reply({ ok: true, texts: r.texts, detected: r.detected }), (e) => reply({ ok: false, error: e.message }));
      return true;

    case 'ai-translate':
      aiTranslate(msg.texts, msg.before || [], msg.to).then((r) => reply(Object.assign({ ok: true }, r)), (e) => reply({ ok: false, error: e.message }));
      return true;

    case 'ai-models':
      // The popup's model list: whatever the key or the local server offers.
      aiConfig().then((cfg) => (cfg ? aiModels(cfg) : [])).then((models) => reply({ ok: true, models }), (e) => reply({ ok: false, error: e.message }));
      return true;

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
      const set = frames.get(tabId) || new Set();
      if (msg.has) set.add(sender.frameId); else set.delete(sender.frameId);
      frames.set(tabId, set);
      chrome.tabs.sendMessage(tabId, { type: 'tab-subs', has: set.size > 0 }).catch(() => {});
      return;
    }

    case 'forward-key': {
      // A shortcut pressed in a frame without subtitles goes to the frames that have them.
      for (const frameId of frames.get(tabId) || []) {
        chrome.tabs.sendMessage(tabId, { type: 'run-action', action: msg.action }, { frameId }).catch(() => {});
      }
      return;
    }
  }
});
