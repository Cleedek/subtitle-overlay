// The Google vs gemma3:12b example for screenshot 2, made by the extension itself, in one target language.
//   node gen-example.mjs <extension folder> <work dir W> <target, e.g. es|cs|de|zh-CN>
// Loads the 8 English lines of the bridge scene (W/examples/bridge-vi.json "en") on the film page in headless
// Chrome (muted), clicks Translate (real Google Translate, the extension's own request) and then Improve with
// the real gemma3:12b in the local Ollama (localhost:11434), through the extension's own prompt and code.
// Ollama refuses the headless extension's origin (403), so a small pass-through on :11557 forwards each request
// unchanged except for the Origin header, and records it.
// Writes examples/bridge-<target>.json next to this file: the lines (en, google, gemma) plus every raw request
// and answer (Google and Ollama) for auditing. Nothing is edited by hand.
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { googleRows } from './google-rows.mjs';

const [EXT, SCRATCH, TARGET] = process.argv.slice(2);
const LANG = 'en';
const here = path.dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9373;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.log('GLOBAL TIMEOUT'); process.exit(2); }, 900000).unref();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// Pass-through to Ollama, recording each request and answer.
const ollamaLog = [];
createServer(async (req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = '';
  for await (const c of req) body += c;
  const r = await fetch('http://127.0.0.1:11434' + req.url, { method: req.method, headers: { 'Content-Type': 'application/json' }, body: req.method === 'POST' ? body : undefined });
  const text = await r.text();
  if (req.method === 'POST') { ollamaLog.push({ url: req.url, request: JSON.parse(body), status: r.status, response: text }); log('ollama', req.url, r.status, text.length, 'chars'); }
  res.writeHead(r.status, Object.assign({ 'Content-Type': r.headers.get('content-type') || 'application/json' }, cors));
  res.end(text);
}).listen(11557);

const profile = SCRATCH + '/gen-profile';
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
}).listen(8788);

const EN = JSON.parse(readFileSync(SCRATCH + '/examples/bridge-vi.json', 'utf8')).rows.map((r) => r.en);
const ts = (ms) => { const s = Math.floor(ms / 1000); return `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
const srt = (lines) => lines.map((l, i) => `${i + 1}\n${ts(l.start)} --> ${ts(l.end)}\n${l.text}\n`).join('\n');
const LINES = EN.map((text, i) => ({ start: 600 + i * 1750, end: 600 + i * 1750 + 1650, text }));

// Record Google's raw answers in the service worker (the request itself is the extension's own).
await inSw(`if (!self.__realFetch) self.__realFetch = self.fetch; self.__glog = [];
  self.fetch = async (url, opts) => { const r = await self.__realFetch(url, opts); const u = String(url);
    if (u.includes('translate.googleapis.com')) { const text = await r.clone().text(); self.__glog.push({ url: u, request: String(opts && opts.body || ''), status: r.status, response: text }); }
    return r; };
  return true;`);
await inSw(`await chrome.storage.local.set({ autoTranslate: false, translateTo: '${TARGET}', secondLang: 'orig', translator: 'local', localUrl: 'http://localhost:11557',
  localModel: 'gemma3:12b', uiLang: '${LANG}', aiNotices: false, keepFor: 'forever', shareFind: false, shareMine: false }); return true;`);
const tabIdOf = (url) => inSw(`const [t] = await chrome.tabs.query({ url: '${url}' }); return t.id;`);
const send = (tab, msg) => inSw(`return await chrome.tabs.sendMessage(${tab.id}, ${JSON.stringify(msg)});`);

const url = 'http://localhost:8788/?clip=bridge';
const film = await openTab(url);
await cdp('Emulation.setDeviceMetricsOverride', { width: 720, height: 405, deviceScaleFactor: 1, mobile: false }, film.sessionId);
await waitFor(() => film.evalIn('!!window.__subOverlay', true), 15000, 'content script');
film.id = await tabIdOf(url);
log('load', JSON.stringify(await send(film, { type: 'load', name: 'tears-of-steel-bridge.en.srt', b64: Buffer.from(srt(LINES)).toString('base64'), encoding: 'utf-8' })));
log('translate', JSON.stringify(await send(film, { type: 'translate', to: TARGET })));
const glog = await inSw('return self.__glog;');
const google = googleRows(glog, EN);
log('google', JSON.stringify(google));
log('improve', JSON.stringify(await send(film, { type: 'improve' })));
// Done when the improved copy is saved (Saved subtitles, keepFor forever).
const saved = await waitFor(() => inSw(`const all = await chrome.storage.local.get(null);
  const k = Object.keys(all).find((k) => k.startsWith('lib:') && all[k].model === 'gemma3:12b' && all[k].lang === '${TARGET}'); return k ? all[k] : null;`), 600000, 'improved copy saved');
if (!saved) { console.log('no improved copy'); process.exit(3); }
const gemma = saved.srt.trim().split(/\r?\n\r?\n/).map((b) => b.split(/\r?\n/).slice(2).join('\n'));
let commit = '';
try { commit = execSync('git -C ' + JSON.stringify(EXT) + ' rev-parse --short HEAD').toString().trim() + (execSync('git -C ' + JSON.stringify(EXT) + ' status --porcelain background.js content.js').toString().trim() ? ' + uncommitted changes' : ''); } catch (e) {}
const out = {
  made: new Date().toISOString(), target: TARGET, model: 'gemma3:12b (Ollama, local)', extension: commit,
  how: 'gen-example.mjs: the real extension in headless Chrome, Translate (Google) then Improve (gemma3:12b), unedited.',
  rows: EN.map((en, i) => ({ en, google: google[i], gemma: gemma[i] })),
  raw: { google: glog, ollama: ollamaLog, savedSrt: saved.srt },
};
mkdirSync(path.join(here, 'examples'), { recursive: true });
writeFileSync(path.join(here, 'examples', `bridge-${TARGET}.json`), JSON.stringify(out, null, 1));
out.rows.forEach((r, i) => log(i + 1, r.en, '|', r.google, '|', r.gemma));
proc.kill();
process.exit(0);
