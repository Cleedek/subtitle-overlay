// Real "shared subtitles" card over the bridge scene, for the 1.1.0 screenshot 2 proposals.
// Derived from promo-video/screens/l10n/capture.mjs (same film page, same fake Google, same 64 lines).
//   node capture-shared.mjs <extension folder> <work dir W> <ui lang, e.g. en|cs|pt|zh-CN> <target, e.g. es|cs> <line 1-8> [examples file, default bridge-<target>.json]
// The lines come from examples/bridge-<target>.json next to this file (gen-example.mjs: real Google and real
// gemma3:12b output made by the extension); the picture pauses on the given line.
// W needs film/bridge.mp4 and examples/bridge-vi.json (l10n/README.md step 1).
// Writes W/caps/<ui>/card-shared-offer.png  (Google's line on screen, the card offers the shared copy: Use)
//        W/caps/<ui>/card-shared-used.png   (after Use: gemma3:12b's line on screen, full green bar, Back to Google)
//        W/caps/<ui>/card-shared-rects.json (the card's box in each, in 720x405 CSS px; the PNGs are 2x)
// The shared copy is faked in the service worker (shareFind replaced), so nothing goes to subs.cleedek.com.
// Its lines are the real gemma3:12b output from examples/bridge-<target>.json; the tag 4F2A is a made-up example.
// Translator is Google (no AI set up), so the card shows only Use, as for anyone without an AI model.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const [EXT, SCRATCH, LANG, TARGET, LINE = '8', FILE = ''] = process.argv.slice(2);
const OUT = SCRATCH + '/caps/' + LANG;
mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9363;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.log('GLOBAL TIMEOUT'); process.exit(2); }, 180000).unref();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const profile = SCRATCH + '/shared-profile';
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });
const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--enable-unsafe-extension-debugging',
  `--user-data-dir=${profile}`, '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check',
  '--lang=en-US', '--mute-audio', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => proc.kill());
let ver;
for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const handlers = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
  } else handlers.forEach((h) => h(msg));
};
const cdp = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, { res, rej });
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('cdp timeout ' + method)); } }, 20000).unref();
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});

const { id: extId } = await cdp('Extensions.loadUnpacked', { path: EXT });
log('extension', extId);
let sw;
for (let i = 0; i < 40 && !sw; i++) {
  const { targetInfos } = await cdp('Target.getTargets');
  sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(extId));
  if (!sw) await sleep(250);
}
const { sessionId: swS } = await cdp('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
const inSw = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }, swS);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
};

async function openTab(url, init) {
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const ctx = new Map();
  handlers.push((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.executionContextCreated') ctx.set(m.params.context.id, m.params.context);
    if (m.method === 'Runtime.executionContextDestroyed') ctx.delete(m.params.executionContextId);
    if (m.method === 'Runtime.executionContextsCleared') ctx.clear();
  });
  await cdp('Page.enable', {}, sessionId);
  await cdp('Runtime.enable', {}, sessionId);
  if (init) await cdp('Page.addScriptToEvaluateOnNewDocument', { source: init }, sessionId);
  await cdp('Page.navigate', { url }, sessionId);
  const evalIn = async (expr, isolated) => {
    let id;
    if (isolated) {
      const c = [...ctx.values()].find((c) => c.auxData && c.auxData.type === 'isolated' && c.auxData.isDefault === false
        && (c.origin.includes(extId) || c.name.includes('Subtitle')) && c.auxData.frameId === targetId);
      if (!c) return undefined;
      id = c.id;
    }
    const r = await cdp('Runtime.evaluate', Object.assign({ expression: expr, returnByValue: true, awaitPromise: true },
      id ? { contextId: id } : {}), sessionId);
    if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return { targetId, sessionId, evalIn };
}
async function waitFor(fn, ms, label) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(400); }
  log('timeout waiting for', label);
  return null;
}
// The overlay's closed shadow root, from the content script's own world.
const SHADOW = `(document.querySelector('subtitle-overlay-root') && chrome.dom.openOrClosedShadowRoot(document.querySelector('subtitle-overlay-root')))`;
const subsText = (tab) => tab.evalIn(`(() => { const sh = ${SHADOW}; return sh ? [...sh.querySelectorAll('.subs')].map((e) => e.innerText.trim()).filter(Boolean) : null; })()`, true);

// ---------- film pages ----------
const CLIPS = { bridge: SCRATCH + "/film/bridge.mp4" };
createServer((req, res) => {
  const name = (/^\/(\w+)\.mp4/.exec(req.url) || [])[1];
  if (name && CLIPS[name]) {
    const buf = readFileSync(CLIPS[name]), size = buf.length;
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      const a = +m[1], b = m[2] ? +m[2] : size - 1;
      res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${a}-${b}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1 });
      return res.end(buf.subarray(a, b + 1));
    }
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': size });
    return res.end(buf);
  }
  const clip = (/[?&]clip=(\w+)/.exec(req.url) || [])[1] || 'bridge';
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!doctype html><title>Tears of Steel</title><body style="margin:0;background:#000;overflow:hidden">
<video id=v src="/${clip}.mp4" muted playsinline style="width:100vw;height:100vh;display:block;object-fit:cover;background:#000"></video></body>`);
}).listen(8778);

const EXAMPLE = JSON.parse(readFileSync(new URL('./examples/' + (FILE || 'bridge-' + TARGET + '.json'), import.meta.url), 'utf8')).rows;
const ts = (ms) => { const s = Math.floor(ms / 1000); return `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
const srt = (lines) => lines.map((l, i) => `${i + 1}\n${ts(l.start)} --> ${ts(l.end)}\n${l.text}\n`).join('\n');
const BRIDGE = Array.from({ length: 64 }, (_, i) => ({ start: 600 + i * 1750, end: 600 + i * 1750 + 1650, text: EXAMPLE[i % 8].en }));
const pair = (i, k) => EXAMPLE[i % 8][k];
const SHARED_SRT = srt(BRIDGE.map((l, i) => Object.assign({}, l, { text: pair(i, 'gemma') })));
const PAUSE_AT = (600 + (LINE - 1) * 1750 + 800) / 1000; // inside line LINE (and its repeats every 8 lines)

const shot = async (tab, file) => {
  const r = await cdp('Page.captureScreenshot', { format: 'png' }, tab.sessionId);
  writeFileSync(OUT + '/' + file, Buffer.from(r.data, 'base64'));
  log('saved', file);
};
const viewport = (tab, width, height) => cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }, tab.sessionId);
const wiggle = async (tab) => {
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y: 300 }, tab.sessionId);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 320 }, tab.sessionId);
  await sleep(400);
};
const hideFs = (tab) => tab.evalIn(`(() => { const sh = ${SHADOW}; const s = document.createElement('style'); s.textContent = '.fs{display:none!important}'; sh.append(s); return true; })()`, true);

// Fake Google (the real Vietnamese Google lines) and a fake shared copy (the real gemma3:12b lines).
const GOOGLE = Object.fromEntries(EXAMPLE.map((r, i) => [r.en, pair(i, 'google')]));
await inSw(`if (!self.__realFetch) self.__realFetch = self.fetch; const G = ${JSON.stringify(GOOGLE)};
  self.fetch = async (url, opts) => { const u = String(url);
    if (!u.includes('translate.googleapis.com/translate_a')) return self.__realFetch(url, opts);
    const qs = new URLSearchParams(String(opts && opts.body || '')).getAll('q');
    return new Response(JSON.stringify(qs.map((q) => [G[q] || q, 'en'])), { headers: { 'Content-Type': 'application/json' } }); };
  self.shareFind = async (src, lang) => ({ item: { id: 'demo', src, lang, model: 'gemma3:12b', tag: '4F2A', t: Date.now() - 2 * 86400e3 - 3600e3, lines: 64 },
    srt: ${JSON.stringify(SHARED_SRT)} });
  return typeof shareFind === 'function' && shareFind === self.shareFind;`).then((ok) => log('fakes in place', ok));
await inSw(`await chrome.storage.local.set({ autoTranslate: false, translateTo: '${TARGET}', secondLang: 'orig', translator: 'google', uiLang: '${LANG}',
  aiNotices: false, keepFor: 'forever', shareFind: true, shareAuto: false }); return true;`);
const tabIdOf = (url) => inSw(`const [t] = await chrome.tabs.query({ url: '${url}' }); return t.id;`);
const send = (tab, msg) => inSw(`return await chrome.tabs.sendMessage(${tab.id}, ${JSON.stringify(msg)});`);
const seek = (tab, t) => tab.evalIn(`(() => { const v = document.getElementById('v'); v.currentTime = ${t}; v.pause(); return true; })()`);
const cardRect = (tab) => tab.evalIn(`(() => { const sh = ${SHADOW}; const c = sh && sh.querySelector('.langs.on'); if (!c) return null;
  const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, text: c.innerText.replace(/\\n+/g, ' | ') }; })()`, true);

const url = 'http://localhost:8778/?clip=bridge';
const film = await openTab(url);
await viewport(film, 720, 405);
await waitFor(() => film.evalIn('!!window.__subOverlay', true), 15000, 'content script');
film.id = await tabIdOf(url);
await film.evalIn(`(async () => { const v = document.getElementById('v'); await v.play().catch(() => {}); return true; })()`);
log('load', JSON.stringify(await send(film, { type: 'load', name: 'tears-of-steel.en.srt', b64: Buffer.from(srt(BRIDGE)).toString('base64'), encoding: 'utf-8' })));
log('translate', JSON.stringify(await send(film, { type: 'translate', to: TARGET })).slice(0, 120));
await seek(film, PAUSE_AT);
await sleep(1500);
await hideFs(film);
await sleep(4000); // "Translated to Vietnamese" toast fades
await wiggle(film);
const rects = {};
await waitFor(async () => { await wiggle(film); const r = await cardRect(film); return r && /4F2A/.test(r.text); }, 15000, 'shared offer');
rects.offer = await cardRect(film);
log('offer', JSON.stringify(rects.offer), JSON.stringify(await subsText(film)));
await shot(film, 'card-shared-offer.png');

// Use: the button in the card, clicked as a person would (the handler swaps in the shared lines).
log('use', await film.evalIn(`(() => { const sh = ${SHADOW}; const b = sh.querySelector('.langs .ai-act.main'); if (!b) return 'no button'; b.click(); return b.textContent; })()`, true));
await sleep(1200);
await seek(film, PAUSE_AT);
await sleep(800);
await wiggle(film);
await waitFor(async () => { await wiggle(film); const r = await cardRect(film); return r && /4F2A/.test(r.text); }, 10000, 'shared in use');
rects.used = await cardRect(film);
log('used', JSON.stringify(rects.used), JSON.stringify(await subsText(film)));
await shot(film, 'card-shared-used.png');
writeFileSync(OUT + '/card-shared-rects.json', JSON.stringify(rects, null, 1));
proc.kill();
process.exit(0);
