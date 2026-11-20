// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Cleedek

// Live subtitles (beta): listens to one tab's sound, cuts it into pieces of
// speech (each ending in a pause where possible) and writes each one down with
// Whisper, right here. The text goes to background.js, which translates it.
// One tab at a time.

const RATE = 16000;             // what speech-to-text services want
const FRAME = 320;              // 20 ms: the step for "is it quiet now?"
const MIN_MS = 2000;            // a piece is at least this long...
const MAX_MS = 10000;           // ...and at most this long, pause or not (Whisper hears up to 30 s)
const MAX_SILENT_MS = 28000;    // in the background no one waits for a line: long pieces (Whisper hears 30 s at once), fewer cuts mid-sentence
const PAUSE_MS = 400;           // a quiet stretch this long ends a piece
const SILENT = 0.004;           // a piece never louder than this is not sent

let cap = null; // { tabId, stream, playCtx, capCtx, ratio, pos, samples, frame, ... }

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'live-capture-start') {
    start(msg.tabId, msg.streamId, !!msg.silent, msg.model).then(() => reply({ ok: true }), (e) => { stop(); reply({ ok: false, error: String(e.message || e) }); });
    return true;
  }
  if (msg.type === 'live-capture-stop') {
    stop();
    reply({ ok: true });
  }
  if (msg.type === 'live-flush') {
    // The video ended: what is still being said goes in too, then wait for Whisper.
    flush().then(() => reply({ ok: true }));
    return true;
  }
});

async function flush() {
  // The speech detector catches up first (a moment), so the last piece is cut with it.
  for (let i = 0; i < 20 && cap && cap.vadOn && cap.vadQ.length; i++) await new Promise((r) => setTimeout(r, 100));
  if (cap && cap.samples.length) cut(cap.flags.length);
  while (queue.length || working) await new Promise((r) => setTimeout(r, 200));
}

// silent: transcribing in the background. Chrome mutes a captured tab, and its
// sound is not played on, so only Whisper hears it.
async function start(tabId, streamId, silent, model) {
  stop();
  if (model && model.id) picked = model;
  resetLanguage();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  });
  // A captured tab goes silent: for live subtitles, play its sound on, unchanged.
  let playCtx = null;
  if (!silent) {
    playCtx = new AudioContext();
    playCtx.createMediaStreamSource(stream).connect(playCtx.destination);
  }
  // The listening side runs at 16 kHz itself where Chrome allows it, so Chrome does the resampling.
  let capCtx, source;
  try {
    capCtx = new AudioContext({ sampleRate: RATE });
    source = capCtx.createMediaStreamSource(stream);
  } catch (e) {
    if (capCtx) capCtx.close();
    capCtx = new AudioContext();
    source = capCtx.createMediaStreamSource(stream);
  }
  await capCtx.audioWorklet.addModule('live-worklet.js');
  const tap = new AudioWorkletNode(capCtx, 'live-tap');
  source.connect(tap);
  cap = newCap({ tabId, silent, stream, playCtx, capCtx });
  tap.port.onmessage = (e) => { if (cap) take(e.data, Date.now()); };
  // Get the model ready (the first time: download it) while the first words come.
  // The speech detector starts with it (it borrows Whisper's ONNX Runtime).
  const mine = cap;
  loadWhisper(tabId).then((pipe) => loadVad(pipe)).then((session) => { if (cap === mine && session) { mine.vad = session; runVad(mine); } }, () => {});
  loadWhisper(tabId).catch((e) => {
    if (cap && cap.tabId === tabId) chrome.runtime.sendMessage({ type: 'live-failed', tabId, error: 'Whisper could not start: ' + String(e.message || e), big: picked.enc !== 'q4f16' }).catch(() => {});
  });
  for (const track of stream.getAudioTracks()) {
    track.addEventListener('ended', () => {
      if (!cap || cap.stream !== stream) return;
      const id = cap.tabId;
      stop();
      chrome.runtime.sendMessage({ type: 'live-ended', tabId: id }).catch(() => {});
    });
  }
}

// base: which sample of the whole recording samples[0] is; total: samples taken so far.
// vad*: the speech detector, running beside the cutting (see "is anyone talking?").
function newCap(o) {
  return Object.assign({
    maxMs: o.silent ? MAX_SILENT_MS : MAX_MS, ratio: o.capCtx.sampleRate / RATE, pos: 0,
    samples: [], frame: [], flags: [], quietFor: 0, level: 0.02, seq: 0, base: 0, total: 0,
    vad: null, vadOn: false, vadBusy: false, vadIn: [], vadQ: [], vadCtx: new Float32Array(VAD_CTX), vadState: null, vadP: new Map(), vadQuietMs: 0,
  }, o);
}

function stop() {
  if (!cap) return;
  for (const track of cap.stream.getTracks()) track.stop();
  if (cap.playCtx) cap.playCtx.close().catch(() => {});
  cap.capCtx.close().catch(() => {});
  cap = null;
}

// A block of sound at the listening side's rate: down to 16 kHz (only if
// Chrome couldn't), then 20 ms frames. at: when it arrived here. Every sample
// gets the moment it was played in the tab (sampleAt), so a line can go
// exactly where it was said: the block's length and the way here come off.
const CAPTURE_LAG_MS = 0; // measured in tests: see the timing check in the notes
function take(block, at) {
  const c = cap;
  c.sampleAt = at - (block.length / c.capCtx.sampleRate) * 1000 - CAPTURE_LAG_MS;
  if (c.ratio === 1) {
    for (let i = 0; i < block.length; i++) push(block[i]);
    return;
  }
  while (c.pos < block.length) {
    push(block[Math.floor(c.pos)]);
    c.pos += c.ratio;
  }
  c.pos -= block.length;
}

function push(s) {
  const c = cap;
  c.total++;
  c.vadIn.push(s);
  if (c.vadIn.length === VAD_WIN) { c.vadQ.push({ w: c.total / VAD_WIN - 1, x: Float32Array.from(c.vadIn) }); c.vadIn = []; runVad(c); }
  if (!c.frame.length) c.frameAt = c.sampleAt;
  c.sampleAt += 1000 / RATE;
  c.frame.push(s);
  if (c.frame.length < FRAME) return;
  let sum = 0;
  for (const x of c.frame) sum += x * x;
  const rms = Math.sqrt(sum / FRAME);
  if (!c.samples.length) c.pieceAt = c.frameAt;
  for (const x of c.frame) c.samples.push(x);
  c.frame = [];
  // Films have music under the talking: "quiet" means clearly quieter than
  // the last second or two, not silent.
  c.level = c.level * 0.985 + rms * 0.015;
  const quiet = rms < Math.max(0.003, c.level * 0.5);
  c.flags.push({ rms, quiet });
  c.quietFor = quiet ? c.quietFor + 20 : 0;
  const ms = (c.samples.length / RATE) * 1000;
  // A pause is a stretch with no talking: as the speech detector hears it once it
  // runs (music under the talking doesn't hide a pause from it), else a quieter stretch.
  const pause = c.vadOn ? c.vadQuietMs >= PAUSE_MS : c.quietFor >= PAUSE_MS;
  if (ms >= MIN_MS && pause) cut(c.flags.length);
  else if (ms >= c.maxMs) cut((c.vadOn && leastSpeechFrame(c)) || softestFrame(c.flags));
}

// The speech detector beside the cutting: each 32 ms of the recording, in order,
// one step at a time, keeping its memory (state) from step to step. vadP: window
// number -> chance it was speech; vadQuietMs: how long no one has talked.
const VAD_SPEECH = 0.5, VAD_QUIET = 0.35, VAD_BACKLOG = 2000; // a minute's backlog at most while the model loads
async function runVad(c) {
  if (c.vadBusy || !c.vad) {
    if (c.vadQ.length > VAD_BACKLOG) c.vadQ.splice(0, c.vadQ.length - VAD_BACKLOG);
    return;
  }
  c.vadBusy = true;
  try {
    while (c.vadQ.length && cap === c) {
      const { w, x } = c.vadQ.shift();
      const p = await vadStep(c, x);
      c.vadP.set(w, p);
      c.vadQuietMs = p < VAD_QUIET ? c.vadQuietMs + (VAD_WIN / RATE) * 1000 : 0;
      c.vadOn = true;
    }
    // Only what the pieces still being cut can need.
    const oldest = Math.floor(c.base / VAD_WIN) - 1;
    for (const w of c.vadP.keys()) { if (w >= oldest) break; c.vadP.delete(w); }
  } catch (e) {
    console.warn('Silero VAD:', e);
    c.vad = null;
    c.vadOn = false; // back to loudness
  } finally { c.vadBusy = false; }
}
async function vadStep(c, x) {
  const input = new Float32Array(VAD_CTX + VAD_WIN);
  input.set(c.vadCtx, 0);
  input.set(x, VAD_CTX);
  c.vadCtx = x.slice(VAD_WIN - VAD_CTX);
  if (!c.vadState) c.vadState = ortOf(new TensorType('float32', new Float32Array(2 * 128), [2, 1, 128]));
  const out = await vadRun(c.vad, { input: ortOf(new TensorType('float32', input, [1, VAD_CTX + VAD_WIN])), state: c.vadState, sr: vadRate() });
  c.vadState = out.stateN;
  return out.output.data[0];
}
let vadSr = null;
const vadRate = () => vadSr || (vadSr = ortOf(new TensorType('int64', BigInt64Array.from([BigInt(RATE)]), [])));
// The detector's answers for samples [from, from + len) of the whole recording,
// or null while it hasn't got that far (its last 128 ms may still be on the way).
function vadRange(c, from, len) {
  const w0 = Math.floor(from / VAD_WIN), w1 = Math.floor((from + len - 1) / VAD_WIN);
  const out = [];
  for (let w = w0; w <= w1; w++) {
    const p = c.vadP.get(w);
    if (p == null) { if (w1 - w < 4) break; return null; }
    out.push({ w, p });
  }
  return out;
}
// No pause in time: the piece ends at the frame of its last few seconds where the
// detector heard the least talking (three steps together), or null to go by loudness.
function leastSpeechFrame(c) {
  const n = c.flags.length;
  const from = Math.max(1, n - LOOK_BACK), to = n - MIN_REST;
  if (to <= from) return null;
  const got = vadRange(c, c.base + from * FRAME, (to - from) * FRAME);
  if (!got || got.length < 3) return null;
  let best = null, low = Infinity;
  for (let i = 1; i < got.length - 1; i++) {
    const r = got[i - 1].p + got[i].p + got[i + 1].p;
    if (r < low) { low = r; best = got[i].w; }
  }
  const frame = Math.round((best * VAD_WIN - c.base) / FRAME);
  return frame > 0 && frame < n ? frame : null;
}

// No pause long enough (talking over music, or fast speech): rather than cut
// in the middle of a word, the piece ends at the quietest moment of its last
// few seconds, usually the gap between two words, and the rest starts the next one.
const LOOK_BACK = 4000 / 20, MIN_REST = 5;
function softestFrame(flags) {
  let best = flags.length, low = Infinity;
  for (let k = Math.max(1, flags.length - LOOK_BACK); k < flags.length - MIN_REST; k++) {
    // Three frames together (60 ms): one quiet frame inside a word isn't a gap.
    const r = flags[k - 1].rms + flags[k].rms + flags[k + 1].rms;
    if (r < low) { low = r; best = k + 1; }
  }
  return best;
}

const LEAD = 0.15 * RATE, TAIL = 0.25 * RATE; // a little room around the talking
// Sends the first `upTo` frames to Whisper; anything after them stays for the next piece.
function cut(upTo) {
  const c = cap;
  const flags = c.flags.slice(0, upTo), all = c.samples.slice(0, upTo * FRAME);
  const base = c.base;
  c.flags = c.flags.slice(upTo);
  c.samples = c.samples.slice(upTo * FRAME);
  c.base += upTo * FRAME;
  c.pieceAt += (upTo * FRAME / RATE) * 1000;
  c.quietFor = 0;
  for (let k = c.flags.length - 1; k >= 0 && c.flags[k].quiet; k--) c.quietFor += 20;
  // Where the talking starts and stops (60 ms of sound in a row, not a click):
  // the silence around it is cut off before Whisper hears it, as Whisper puts
  // the start of a sentence at the start of what it's given.
  let onset = null, lastLoud = null, loud = 0;
  for (let k = 0; k < flags.length; k++) {
    loud = Math.max(loud, flags[k].rms);
    if (flags[k].quiet) continue;
    lastLoud = (k + 1) * FRAME;
    if (onset == null && k + 2 < flags.length && !flags[k + 1].quiet && !flags[k + 2].quiet) onset = k * FRAME;
  }
  if (loud < SILENT || onset == null) return;
  // The speech detector knows better where talking starts and stops, also over
  // music; a piece with none at all never goes to Whisper, which would make
  // something up for it.
  const heard = c.vadOn ? vadRange(c, base, all.length) : null;
  if (heard) {
    const said = heard.filter((h) => h.p >= VAD_SPEECH);
    if (!said.length) return;
    onset = Math.max(0, said[0].w * VAD_WIN - base);
    lastLoud = Math.min(all.length, (said[said.length - 1].w + 1) * VAD_WIN - base);
  }
  const from = Math.max(0, onset - LEAD);
  const to = Math.min(all.length, Math.max(lastLoud || all.length, onset + FRAME) + TAIL);
  const samples = all.slice(from, to);
  const pieceAt = c.pieceAt - (upTo * FRAME / RATE) * 1000 + (from / RATE) * 1000;
  const ms = Math.round((samples.length / RATE) * 1000);
  // Live: waiting is fine, but not without end: when Whisper falls far behind, the
  // oldest goes. In the background every word counts, so nothing is dropped.
  if (!c.silent && queue.length >= MAX_QUEUE) queue.shift();
  queue.push({ tabId: c.tabId, seq: c.seq++, ms, saidAt: Math.round(pieceAt), audio: Float32Array.from(samples) });
  work();
}

// ---------- Whisper, on this computer ----------
// Transformers.js runs OpenAI's open Whisper model here on the graphics chip
// (WebGPU): the one picked in the popup ("Speech model", SubSettings.AUDIO_MODELS,
// sent by background.js with every start), or the small base model on the
// processor where there is no WebGPU. A model downloads once from Hugging Face
// and stays in the browser's cache; nothing of the sound leaves the computer.
const MAX_QUEUE = 6;
const NO_GPU = { id: 'onnx-community/whisper-base', device: 'wasm', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } };
const NO_F16 = { id: 'onnx-community/whisper-large-v3-turbo', device: 'webgpu', dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' } };
let picked = { id: 'onnx-community/whisper-large-v3-turbo', enc: 'q4f16', dec: 'q4f16' };
const queue = [];
let whisper = null; // Promise of the pipeline
let whisperOf = ''; // which model it is
let TensorType = null;
let working = false;

function loadWhisper(tabId) {
  const key = picked.id + ' ' + picked.enc + ' ' + picked.dec;
  if (whisper && whisperOf === key) return whisper;
  // Another model was picked since: the old one leaves the graphics memory first.
  const old = whisper;
  whisperOf = key;
  const mine = whisper = (async () => {
    if (old) await old.then((p) => p.dispose(), () => {});
    const { pipeline, env, Tensor } = await import('./lib/vendor/transformers/transformers.min.js');
    TensorType = Tensor;
    const dir = chrome.runtime.getURL('lib/vendor/transformers/');
    // Its code comes with the extension; only the model itself is downloaded.
    env.backends.onnx.wasm.wasmPaths = { mjs: dir + 'ort-wasm-simd-threaded.asyncify.mjs', wasm: dir + 'ort-wasm-simd-threaded.asyncify.wasm' };
    env.allowLocalModels = false;
    env.useWasmCache = false; // it comes with the extension: nothing to cache (and the cache refuses chrome-extension:// addresses)
    const adapter = navigator.gpu && await navigator.gpu.requestAdapter().catch(() => null);
    const m = !adapter ? NO_GPU
      // All three picks need half-precision numbers (fp16), which some graphics
      // chips lack, often older built-in ones on Windows. Those get the same
      // model squeezed without them (about 760 MB).
      : !adapter.features.has('shader-f16') ? NO_F16
        : { id: picked.id, device: 'webgpu', dtype: { encoder_model: picked.enc, decoder_model_merged: picked.dec } };
    const files = new Map(); // file -> [loaded, total]
    let shown = -1;
    const progress = (p) => {
      if (p.status !== 'progress' || !p.total) return;
      files.set(p.file, [p.loaded, p.total]);
      let loaded = 0, total = 0;
      for (const [l, t] of files.values()) { loaded += l; total += t; }
      const pct = Math.floor((loaded / total) * 100);
      if (pct !== shown && total > 5e6) {
        shown = pct;
        chrome.runtime.sendMessage({ type: 'live-progress', tabId, pct, mb: Math.round(total / 1e6) }).catch(() => {});
      }
    };
    let pipe, used = m;
    try {
      pipe = await pipeline('automatic-speech-recognition', m.id, { device: m.device, dtype: m.dtype, progress_callback: progress });
    } catch (e) {
      // The no-fp16 model on a chip that can't run it either: the processor can.
      if (m !== NO_F16) throw e;
      used = NO_GPU;
      pipe = await pipeline('automatic-speech-recognition', NO_GPU.id, { device: NO_GPU.device, dtype: NO_GPU.dtype, progress_callback: progress });
    }
    if (used === m && m.device === 'webgpu') dropOtherModels(m); // not after the fallback: it would delete the real model
    chrome.runtime.sendMessage({ type: 'live-progress', tabId, ready: true, model: used.id.split('/').pop() }).catch(() => {});
    return pipe;
  })();
  mine.catch(() => { if (whisper === mine) whisper = null; });
  return mine;
}

// Only the picked speech model stays on the computer: once it has loaded, the
// model files of ones picked before (up to GBs) leave the browser's cache.
// Transformers.js names a file part + dtype suffix (encoder_model_q4f16.onnx).
const DTYPE_SUFFIX = { fp32: '', fp16: '_fp16', q8: '_quantized', int8: '_int8', uint8: '_uint8', q4: '_q4', q4f16: '_q4f16', bnb4: '_bnb4' };
async function dropOtherModels(m) {
  const keep = Object.entries(m.dtype).map(([part, d]) => `/${m.id}/resolve/main/onnx/${part}${DTYPE_SUFFIX[d] ?? '_' + d}.onnx`);
  try {
    const cache = await caches.open('transformers-cache');
    for (const req of await cache.keys()) {
      const path = new URL(req.url).pathname;
      if (/\.onnx(_data)?$/.test(path) && !keep.some((k) => path.endsWith(k))) await cache.delete(req);
    }
  } catch (e) {
    console.warn('Old speech models:', e);
  }
}

// One piece at a time, in order.
async function work() {
  if (working) return;
  working = true;
  try {
    while (queue.length) {
      const piece = queue.shift();
      let pipe;
      try {
        pipe = await loadWhisper(piece.tabId);
      } catch (e) {
        queue.length = 0;
        chrome.runtime.sendMessage({ type: 'live-failed', tabId: piece.tabId, error: 'Whisper could not start: ' + String(e.message || e), big: picked.enc !== 'q4f16' }).catch(() => {});
        return;
      }
      if (!cap || cap.tabId !== piece.tabId) continue; // stopped meanwhile
      const started = performance.now();
      let text = '';
      const parts = []; // [{ text, from, to }] in ms from the piece's start
      const probs = await speechOf(pipe, piece.audio);
      if (probs && !probs.some((p) => p >= VAD_SPEECH)) {
        chrome.runtime.sendMessage({ type: 'live-heard', tabId: piece.tabId, seq: piece.seq, text: '', parts: [], ms: piece.ms, saidAt: piece.saidAt, took: 0, noSpeech: true }).catch(() => {});
        continue;
      }
      try {
        const language = await languageOf(pipe, piece);
        // With Whisper's own timestamps: where in the piece each sentence starts and ends.
        const out = await pipe(piece.audio, { task: 'transcribe', language, return_timestamps: true });
        const len = piece.ms / 1000;
        for (const ch of (out && out.chunks) || []) {
          const said = keepable(String(ch.text || ''));
          if (!said) continue;
          const [a, b] = ch.timestamp || [];
          const from = Math.min(Math.max(0, Number.isFinite(a) ? a : 0), len);
          const to = Math.min(Number.isFinite(b) && b > from ? b : len, len);
          parts.push({ text: said, from: Math.round(from * 1000), to: Math.round(to * 1000) });
        }
        snapStarts(parts, piece.audio);
        markSpeech(parts, probs);
        if (!parts.length && out && out.text) {
          const said = keepable(String(out.text));
          if (said) parts.push({ text: said, from: 0, to: piece.ms });
        }
        text = parts.map((p) => p.text).join(' ');
      } catch (e) {
        console.warn('Whisper:', e);
      }
      chrome.runtime.sendMessage({ type: 'live-heard', tabId: piece.tabId, seq: piece.seq, text, parts, ms: piece.ms, saidAt: piece.saidAt,
        took: Math.round(performance.now() - started) }).catch(() => {});
    }
  } finally { working = false; }
}

// ---------- is anyone talking? (Silero VAD) ----------
// Whisper writes something down over music too. A small model made only to tell
// speech from everything else (Silero VAD, MIT, 2 MB, comes with the extension)
// listens to the same piece in 32 ms steps; each line gets the share of its time
// that was speech (part.speech, 0 to 1). content.js marks lines with little of it
// as doubtful, and only lines with almost none may be dropped without a second look.
// It runs on the ONNX Runtime that came with Transformers.js (its session class,
// taken from Whisper's own session), on the processor: under a millisecond a step.
const VAD_WIN = 512, VAD_CTX = 64; // 32 ms at 16 kHz, plus the 64 samples before it that the model wants
let vad = null;
function loadVad(pipe) {
  if (vad) return vad;
  const mine = vad = (async () => {
    const session = pipe.model && pipe.model.sessions && Object.values(pipe.model.sessions)[0];
    const Session = session && session.constructor;
    if (!Session || typeof Session.create !== 'function' || !TensorType) throw new Error('no ONNX Runtime session class');
    const bytes = new Uint8Array(await (await fetch(chrome.runtime.getURL('lib/vendor/silero/silero_vad.onnx'))).arrayBuffer());
    return Session.create(bytes, { executionProviders: ['wasm'] });
  })();
  // Not working here: lines go on without it (the old words-per-second guess in content.js).
  mine.catch((e) => console.warn('Silero VAD:', e));
  return mine;
}
const ortOf = (t) => t.ort_tensor || t;
// One step at a time on the detector: the cutting and the per-line check share it,
// and a session runs one thing at once.
let vadChain = Promise.resolve();
function vadRun(session, feeds) {
  const r = vadChain.then(() => session.run(feeds));
  vadChain = r.catch(() => {});
  return r;
}
async function speechSteps(session, audio) {
  const n = Math.floor(audio.length / VAD_WIN);
  const probs = new Float32Array(n);
  let state = ortOf(new TensorType('float32', new Float32Array(2 * 128), [2, 1, 128]));
  const sr = ortOf(new TensorType('int64', BigInt64Array.from([BigInt(RATE)]), []));
  const x = new Float32Array(VAD_CTX + VAD_WIN);
  for (let k = 0; k < n; k++) {
    x.fill(0, 0, VAD_CTX);
    if (k) x.set(audio.subarray(k * VAD_WIN - VAD_CTX, k * VAD_WIN), 0);
    x.set(audio.subarray(k * VAD_WIN, (k + 1) * VAD_WIN), VAD_CTX);
    const out = await vadRun(session, { input: ortOf(new TensorType('float32', Float32Array.from(x), [1, VAD_CTX + VAD_WIN])), state, sr });
    probs[k] = out.output.data[0];
    state = out.stateN;
  }
  return probs;
}
// Each 32 ms of a piece: the chance it was speech, or null when the detector can't run here.
async function speechOf(pipe, audio) {
  try { return await speechSteps(await loadVad(pipe), audio); } catch (e) { return null; }
}
// Each line: the share of its time that was speech.
function markSpeech(parts, probs) {
  if (!probs || !parts.length) return;
  const stepMs = (VAD_WIN / RATE) * 1000;
  for (const p of parts) {
    const a = Math.floor(p.from / stepMs), b = Math.max(a + 1, Math.ceil(p.to / stepMs));
    let said = 0, all = 0;
    for (let k = a; k < b && k < probs.length; k++, all++) if (probs[k] >= VAD_SPEECH) said++;
    if (all) p.speech = Math.round((said / all) * 100) / 100;
  }
}

// Transformers.js can't detect the language yet (it assumes English), so
// this asks Whisper itself: the first word it would write after "start of
// transcript" is a language tag. The first pieces vote; once one language has
// won three times, or twice in a row, the rest of the video keeps it.
// Whisper often starts a sentence where the one before it stopped, not where
// the talking starts again (up to half a second early). A start that falls in
// a quieter moment moves to just before the sound comes back (60 ms in a row), at
// most 1.5 s later and never past the sentence's own middle.
function snapStarts(parts, audio) {
  const F = FRAME, n = Math.floor(audio.length / F);
  if (!n || !parts.length) return;
  const rms = new Float32Array(n);
  let sum = 0;
  for (let k = 0; k < n; k++) {
    let e = 0;
    for (let j = k * F; j < (k + 1) * F; j++) e += audio[j] * audio[j];
    rms[k] = Math.sqrt(e / F);
    sum += rms[k];
  }
  const quietBelow = Math.max(0.003, (sum / n) * 0.5);
  const frameMs = (F / RATE) * 1000;
  for (const p of parts) {
    let k = Math.floor(p.from / frameMs);
    if (k >= n || rms[k] >= quietBelow) continue;
    const last = Math.min(n - 3, Math.floor(Math.min(p.from + 1500, (p.from + p.to) / 2) / frameMs));
    for (; k <= last; k++) {
      // 60 ms earlier: a word starts softer than this test notices.
      if (rms[k] >= quietBelow && rms[k + 1] >= quietBelow && rms[k + 2] >= quietBelow) { p.from = Math.max(p.from, Math.round(k * frameMs) - 60); break; }
    }
  }
}

let votes = new Map(), lastVote = '', language = '';
function resetLanguage() { votes = new Map(); lastVote = ''; language = ''; }
async function languageOf(pipe, piece) {
  if (language) return language;
  let code = '';
  try {
    const cfg = pipe.model.generation_config;
    const inputs = await pipe.processor(piece.audio);
    const ids = new TensorType('int64', BigInt64Array.from([BigInt(cfg.decoder_start_token_id)]), [1, 1]);
    const { logits } = await pipe.model(Object.assign({}, inputs, { decoder_input_ids: ids }));
    const scores = logits.type === 'float16' && !(logits.data instanceof Float32Array) && typeof Float16Array === 'undefined' ? halfs(logits.data) : logits.data;
    let best = -Infinity;
    for (const [tag, id] of Object.entries(cfg.lang_to_id)) {
      const v = Number(scores[id]);
      if (v > best) { best = v; code = tag.slice(2, -2); }
    }
  } catch (e) {
    console.warn('Whisper language check:', e);
    return undefined; // Whisper's own default for this piece
  }
  const n = (votes.get(code) || 0) + 1;
  votes.set(code, n);
  if (n >= 3 || code === lastVote) {
    language = code;
    chrome.runtime.sendMessage({ type: 'live-progress', tabId: piece.tabId, language: code }).catch(() => {});
  }
  lastVote = code;
  return code;
}
function halfs(u16) {
  const out = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) {
    const h = u16[i], e = (h >> 10) & 31, f = h & 1023, sign = h >> 15 ? -1 : 1;
    out[i] = sign * (e === 0 ? f * 2 ** -24 : e === 31 ? (f ? NaN : Infinity) : (1 + f / 1024) * 2 ** (e - 15));
  }
  return out;
}

// Whisper was trained on lots of video with captions, and on music or silence
// it sometimes "hears" their closing words. Those, and sound tags, are dropped.
const MADE_UP = /^(thank(s| you) (so much )?for watching|please subscribe|subtitles by|transcribed by|amara\.org|you$|bye\.?$|the end\.?$|\.+$)/i;
let lastText = '', sameCount = 0;
function keepable(text) {
  text = text.replace(/\[[^\]]*\]|\([^)]*(music|applause|laugh)[^)]*\)|[♪♫]+/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!/[\p{L}\p{N}]/u.test(text) || MADE_UP.test(text)) return '';
  // The same line again and again: Whisper stuck on a loop, not someone talking.
  sameCount = text === lastText ? sameCount + 1 : 0;
  lastText = text;
  return sameCount >= 2 ? '' : text;
}
