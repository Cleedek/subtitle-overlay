// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Cleedek

// Translation queue: subtitle files translated one after another in this tab,
// with the translator chosen here or in the popup (the same setting; a local
// model is free, so it can take its time). The queue is stored, so a reload carries on where it was.
(async function () {
  'use strict';
  const { SubLib, SubSettings, SubI18n } = globalThis;
  const $ = (id) => document.getElementById(id);
  const t = SubI18n.t;
  await SubI18n.load();
  SubI18n.translatePage(document.body);

  const CHUNK = 30; // as in content.js
  // The model's mark for a transcript line that was never said ("###", sometimes as "tr: ###").
  const NOT_SAID = /^[^\p{L}\p{N}]*(tr\b[^\p{L}\p{N}]*)?#{3,}[^\p{L}\p{N}]*$/iu;
  const KEY = 'batchQueue';
  // Lines travel as HTML so <i>/<b> and line breaks survive the round trip (as in content.js).
  const toHtml = (raw) => SubLib.cleanText(raw).replace(/\n/g, '<br>');
  const fromHtml = (html) => String(html || '')
    .replace(/\s*<br\s*\/?>\s*/gi, '\n')
    .replace(/(<\/(?:i|b|u)>)\s+([.,!?;:…])/g, '$1$2')
    .trim();
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  let prefs = await SubSettings.loadTranslation();
  // A job: { id, name, lang, lines: [{ start, end, text }], out: [text | null], chunks: [start], status, error, model,
  //   retry, page, title, ahead }
  // status: 'waiting' | 'running' | 'done' | 'error'; retry: the error of a request that is asked again soon.
  // page, title: the tab it was added from with "Add to queue" (popup or the card over the video), so it can be
  // played there; source: that file's own name (YouTube's captions start with "youtube-").
  // ahead: moved above the pass started over a video (see "passes over a video").
  let jobs = [];
  let paused = false;
  async function loadJobs() {
    const stored = (await chrome.storage.local.get(KEY))[KEY] || {};
    jobs = Array.isArray(stored.jobs) ? stored.jobs : [];
    paused = !!stored.paused;
    for (const j of jobs) {
      if (j.status === 'running') j.status = 'waiting';
      j.retry = '';
    }
  }
  await loadJobs();
  // Improve passes running over videos, as the background keeps them: { key, tabId, frameId, to, name, page, model, done, total, paused }
  const LIVE = 'live:';
  const liveNow = await chrome.storage.session.get(null);
  let live = Object.keys(liveNow).filter((k) => k.startsWith(LIVE)).sort().map((k) => liveNow[k]);
  let current = null; // the job a request is out for
  let mine = false; // this tab runs the queue (another open copy only shows it)
  // Files the popup added ("Add to queue"), one storage key each, until the copy that runs the queue takes them.
  const INBOX = 'queue:';
  // A file removed or moved in a copy that doesn't run the queue, for the copy that does.
  const EDIT = 'queueEdit';
  const LOCK = 'translation-queue';

  const aiOf = () => SubSettings.AI[prefs.translator]; // undefined for Google
  const isAi = () => !!aiOf();
  const modelName = () => (aiOf() && prefs[aiOf().model]) || '';

  async function save() {
    try { await chrome.storage.local.set({ [KEY]: { jobs, paused } }); }
    catch (e) { say(t('Couldn’t save the queue: {error}', { error: e.message }), true); }
    checkLive();
    wakeUp();
  }
  function say(text, error) {
    $('msg').hidden = !text;
    $('msg').textContent = text || '';
    $('msg').classList.toggle('error', !!error);
  }

  // ---------- settings ----------

  const cap = (s) => s.charAt(0).toLocaleUpperCase(SubI18n.lang) + s.slice(1);
  $('lang').replaceChildren(...SubSettings.LANGUAGES.map(([code]) => {
    const o = el('option', '', (SubSettings.flag(code) + ' ' + cap(SubSettings.languageName(code))).trim());
    o.value = code;
    return o;
  }));
  $('lang').value = prefs.translateTo;
  $('lang').addEventListener('change', () => SubSettings.saveTranslation({ translateTo: $('lang').value }));
  $('aiSaveFile').checked = prefs.aiSaveFile;
  $('aiSaveFile').addEventListener('change', () => SubSettings.saveTranslation({ aiSaveFile: $('aiSaveFile').checked }));
  keepPicker($('keepFor'));
  $('keepFor').value = prefs.keepFor;
  $('keepFor').addEventListener('change', () => SubSettings.saveTranslation({ keepFor: $('keepFor').value }));

  // "Keep improved subtitles": Don't keep, 1 day … Forever.
  function keepPicker(select) {
    const names = { off: t('Don’t keep'), 1: t('1 day'), 7: t('7 days'), 30: t('1 month'), 90: t('3 months'), forever: t('Forever') };
    select.replaceChildren(...SubSettings.KEEP_FOR.map((v) => { const o = el('option', '', names[v]); o.value = v; return o; }));
  }

  // ---------- translator: the popup's setting, switchable here ----------

  const HINTS = {
    google: 'Fast and free. Translates line by line.',
    gemini: 'Rewrites Google’s lines with the whole scene in mind. Needs your Gemini API key.',
    claude: 'Rewrites Google’s lines with the whole scene in mind. Needs your Claude API key.',
    openai: 'Rewrites Google’s lines with the whole scene in mind. Needs your OpenAI API key.',
    local: 'A model on this computer: free and private, but slower. Needs Ollama or LM Studio; its address is set in the extension popup.',
  };
  const PLACEHOLDERS = { gemini: 'AIza…', claude: 'sk-ant-…', openai: 'sk-…' };
  function aiMsg(text, isError) {
    $('aiMsg').hidden = !text;
    $('aiMsg').textContent = text || '';
    $('aiMsg').classList.toggle('error', !!isError);
  }

  // The model list comes from the key or the local server (as in the popup).
  let modelsAsked = 0;
  let modelsFor = '';
  async function loadModels() {
    const ask = ++modelsAsked;
    const ai = aiOf();
    modelsFor = prefs.translator + '|' + (ai.key ? prefs[ai.key] : prefs.localUrl);
    $('aiModel').replaceChildren();
    aiMsg(t('Loading models…'));
    const res = await chrome.runtime.sendMessage({ type: 'ai-models' }).catch((e) => ({ ok: false, error: e.message }));
    if (ask !== modelsAsked) return;
    // A key that wasn't accepted can be replaced right here.
    if (ai.key && (!res || !res.ok || !res.models.length)) $('keyRow').hidden = false;
    if (!res || !res.ok) return aiMsg(res ? res.error : t('Translation failed.'), true);
    if (!res.models.length) {
      return aiMsg(prefs.translator === 'local' ? t('No models installed. In Terminal run: ollama pull gemma3:12b') : t('No models found for this key.'), true);
    }
    $('aiModel').replaceChildren(...res.models.map((m) => Object.assign(el('option', '', m), { value: m })));
    const saved = prefs[ai.model];
    const pick = SubSettings.pickModel(prefs.translator, res.models, saved);
    $('aiModel').value = pick;
    aiMsg('');
    if (pick !== saved) await SubSettings.saveTranslation({ [ai.model]: pick });
  }

  function showTranslator() {
    const ai = aiOf();
    $('aiOn').checked = !!ai;
    $('aiPicker').hidden = !ai;
    for (const b of document.querySelectorAll('[data-translator]')) {
      const on = b.dataset.translator === prefs.translator;
      b.setAttribute('aria-checked', String(on));
      b.setAttribute('aria-selected', String(on));
    }
    $('translatorHint').textContent = t(HINTS[ai ? prefs.translator : 'google']);
    const needsKey = !!(ai && ai.key && !prefs[ai.key]);
    $('keyRow').hidden = !needsKey;
    if (ai && ai.key) $('aiKey').placeholder = PLACEHOLDERS[prefs.translator];
    $('modelRow').hidden = !ai || needsKey;
    if (!ai || needsKey) { modelsAsked++; aiMsg(''); return; }
    // Ask the server again only when the translator, key or address changed.
    if (modelsFor !== prefs.translator + '|' + (ai.key ? prefs[ai.key] : prefs.localUrl)) loadModels();
    else if (prefs[ai.model] && $('aiModel').value !== prefs[ai.model]) $('aiModel').value = prefs[ai.model];
  }
  for (const b of document.querySelectorAll('[data-translator]')) {
    b.addEventListener('click', () => SubSettings.saveTranslation({ translator: b.dataset.translator, aiPick: b.dataset.translator }));
  }
  // Off = Google alone. On = the model picked last time (Local at first), as in the popup.
  $('aiOn').addEventListener('change', () => {
    const known = prefs.aiPick === 'local' || !!SubSettings.AI[prefs.aiPick];
    SubSettings.saveTranslation({ translator: $('aiOn').checked ? (known ? prefs.aiPick : 'local') : 'google' });
  });
  $('aiKey').addEventListener('change', () => {
    const v = $('aiKey').value.trim();
    if (v && aiOf() && aiOf().key) SubSettings.saveTranslation({ [aiOf().key]: v });
    $('aiKey').value = '';
  });
  $('aiModel').addEventListener('change', () => SubSettings.saveTranslation({ [aiOf().model]: $('aiModel').value }));
  showTranslator();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const k of Object.keys(SubSettings.TRANSLATION)) {
      if (changes[k]) prefs[k] = changes[k].newValue != null ? changes[k].newValue : SubSettings.TRANSLATION[k];
    }
    if (changes.translateTo) $('lang').value = prefs.translateTo;
    if (changes.aiSaveFile) $('aiSaveFile').checked = prefs.aiSaveFile;
    if (changes.keepFor) $('keepFor').value = prefs.keepFor;
    if (Object.keys(changes).some((k) => k.startsWith('lib:'))) renderSaved();
    showTranslator();
    // Another open copy of this page runs the queue: show what it does.
    if (changes[KEY] && !mine) {
      const v = changes[KEY].newValue || {};
      jobs = v.jobs || [];
      paused = !!v.paused;
      render();
    }
    const added = Object.keys(changes).filter((k) => k.startsWith(INBOX) && changes[k].newValue);
    if (added.length) { if (mine) takeInbox(added); else run(); }
    if (changes[EDIT] && changes[EDIT].newValue && mine) edit(changes[EDIT].newValue);
  });

  // The popup's files join the end of the queue. Only the copy that runs the
  // queue takes them: another copy's list would be overwritten by its next save.
  async function takeInbox(keys) {
    const got = keys ? await chrome.storage.local.get(keys)
      : Object.fromEntries(Object.entries(await chrome.storage.local.get(null)).filter(([k]) => k.startsWith(INBOX)));
    const list = Object.values(got).filter((j) => j && Array.isArray(j.lines) && j.lines.length)
      .sort((a, b) => (a.added || 0) - (b.added || 0) || (a.seq || 0) - (b.seq || 0));
    await chrome.storage.local.remove(Object.keys(got));
    if (!list.length) return;
    for (const j of list) if (!jobs.some((x) => x.id === j.id)) place(j);
    if (live.length) sortAhead();
    await save();
    render();
  }

  // A transcript from the audio goes before the files that aren't: you've
  // already waited for it to be written down. The file being translated now
  // lets it go after its current chunk (see overtaken), and carries on later.
  function place(job) {
    const at = job.audio ? jobs.findIndex((j) => active(j) && !j.audio) : -1;
    if (at >= 0) jobs.splice(at, 0, job);
    else jobs.push(job);
  }

  // ---------- sorting ----------

  // Natural order: "Episode 2" before "Episode 10", case and accents aside.
  const byName = new Intl.Collator(SubI18n.lang, { numeric: true, sensitivity: 'base' });
  const nameOf = (j) => j.title || j.name;
  // Jobs from before "added" was kept stay where they were (their place in the list).
  const addedOf = (j) => j.added || 0;
  const SORTS = {
    name: (a, b) => byName.compare(nameOf(a), nameOf(b)),
    oldest: (a, b) => addedOf(a) - addedOf(b),
    newest: (a, b) => addedOf(b) - addedOf(a),
  };
  // Reorders the waiting files in the places they hold; the one being translated,
  // finished and failed files stay put. Transcripts from the audio stay first.
  function sortWaiting(how) {
    const waiting = jobs.filter((j) => j.status === 'waiting');
    const sorted = waiting.map((j, i) => [j, i])
      .sort(([a, i], [b, k]) => (b.audio ? 1 : 0) - (a.audio ? 1 : 0) || SORTS[how](a, b) || i - k)
      .map(([j]) => j);
    jobs = jobs.map((j) => (j.status === 'waiting' ? sorted.shift() : j));
    if (live.length) sortAhead();
  }

  // ---------- adding files ----------

  async function addFiles(list) {
    const added = [];
    const skipped = [];
    for (const f of list) {
      if (!SubLib.SUB_FILE.test(f.name)) { skipped.push(f.name); continue; }
      const lines = SubLib.parse(SubLib.decode(new Uint8Array(await f.arrayBuffer()), 'auto').text)
        .map((c) => ({ start: c.start, end: c.end, text: c.text }));
      if (!lines.length) { skipped.push(f.name); continue; }
      added.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: f.name, lang: $('lang').value,
        lines, out: [], chunks: [], status: 'waiting', error: '', model: '' });
    }
    say(skipped.length ? t('Not subtitles, left out: {names}', { names: skipped.join(', ') }) : '', skipped.length > 0);
    if (!added.length) return;
    // Files added together line up by name (episode 11, 12, 13 … whatever order the system gave them).
    const now = Date.now();
    added.sort((a, b) => byName.compare(a.name, b.name)).forEach((j, i) => { j.added = now; j.seq = i; });
    // The same way in as the popup's files, so a copy that doesn't run the
    // queue can't overwrite the list of the one that does.
    await chrome.storage.local.set(Object.fromEntries(added.map((j) => [INBOX + j.id, j])));
  }
  $('pick').addEventListener('click', () => $('files').click());
  $('files').addEventListener('change', () => { addFiles([...$('files').files]); $('files').value = ''; });
  // The whole page takes dropped files, the box lights up.
  let depth = 0;
  document.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; $('drop').classList.add('over'); });
  document.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('drop').classList.remove('over'); } });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    $('drop').classList.remove('over');
    addFiles([...e.dataTransfer.files]);
  });

  // ---------- running ----------

  // Lines a chunk-by-chunk pass went through, so a finished file is 100 %.
  const linesDone = (job) => job.chunks.reduce((n, i) => n + Math.min(CHUNK, job.lines.length - i), 0);

  const outName = (job) => job.name.replace(SubLib.SUB_FILE, '') + '.' + job.lang + '.srt';
  const outSrt = (job) => SubLib.toSRT(job.lines.map((c, i) => ({ start: c.start, end: c.end, text: job.out[i] || c.text })));
  const download = (job) => SubLib.saveText(outSrt(job), outName(job));

  // Left overnight, a queue meets a model server that restarts, a network that
  // drops for a moment, or a background script that Chrome restarts and whose
  // answer never comes. A request with no answer after STALL_MS is given up;
  // a failed one is asked again after each wait in RETRY_S, then the file stops.
  const STALL_MS = 20 * 60 * 1000;
  const RETRY_S = [30, 120];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function ask(msg) {
    let timer = 0;
    return Promise.race([
      chrome.runtime.sendMessage(msg).catch((e) => ({ ok: false, error: e.message })),
      new Promise((r) => { timer = setTimeout(() => r({ ok: false, stalled: true, error: t('The translator didn’t answer.') }), STALL_MS); }),
    ]).finally(() => clearTimeout(timer));
  }
  async function request(job, msg) {
    for (let attempt = 0; ; attempt++) {
      const res = await ask(msg);
      if (res && (res.ok || res.stopped)) return res;
      if (res && res.stalled) stopCurrent();
      if (attempt >= RETRY_S.length) return res;
      job.retry = (res && res.error) || t('Translation failed.');
      render();
      for (const end = Date.now() + RETRY_S[attempt] * 1000; Date.now() < end && !halted(job);) await sleep(1000);
      job.retry = '';
      render();
      // Paused, removed or overtaken while it waited: as if stopped mid-request.
      if (halted(job)) return { ok: false, stopped: true };
    }
  }

  async function work(job) {
    job.status = 'running';
    job.error = '';
    current = job;
    render();
    try {
      // Made from a video's sound: the model first fixes what Whisper heard, in
      // the language that was spoken (punctuation, misheard words, made-up
      // lines), and those fixed lines become the original that gets translated.
      const improve = job.audio ? prefs.audioImprove || 'both' : 'translation';
      if (job.audio && job.spoken && !job.cleaned && !job.chunks.length && isAi() && (improve === 'both' || improve === 'transcript')) {
        job.cleanChunks = job.cleanChunks || [];
        for (let i = 0; i < job.lines.length; i += CHUNK) {
          if (job.cleanChunks.includes(i)) continue;
          if (halted(job)) { job.status = 'waiting'; return; }
          if (!isAi()) break;
          job.model = modelName();
          const res = await request(job, { type: 'ai-translate', to: job.spoken, clean: 'audio',
            texts: job.lines.slice(i, i + CHUNK).map((c) => toHtml(c.text)),
            doubt: job.lines.slice(i, i + CHUNK).map((c) => !!c.doubt),
            before: job.lines.slice(Math.max(0, i - 4), i).map((c) => toHtml(c.text)) });
          if (res && res.stopped) { job.status = 'waiting'; return; }
          // A failed chunk keeps Whisper's words; the translation still runs.
          // "###": the model says the line was never said (made up over music or noise).
          if (res && res.ok) res.texts.forEach((text, k) => { const fixed = fromHtml(text).trim(); if (fixed) job.lines[i + k].text = NOT_SAID.test(fixed) ? '' : fixed; });
          job.cleanChunks.push(i);
          await save();
          render();
        }
        if (job.cleanChunks.length >= Math.ceil(job.lines.length / CHUNK)) {
          job.cleaned = true;
          job.lines = job.lines.filter((l) => l.text);
          await save();
        }
      }
      const src = job.lines.map((c) => toHtml(c.text));
      // Spoken in the language it's wanted in: the (fixed) transcript is the result.
      if (job.audio && job.spoken === job.lang.split('-')[0]) src.forEach((s, i) => { job.out[i] = job.out[i] || job.lines[i].text; });
      if (isAi() && (improve === 'both' || improve === 'translation')) {
        // Who is who, from the whole file, kept with the job so a restart doesn't ask again.
        if (job.sheet === undefined && src.some((s, i) => !job.out[i])) {
          const res = await ask({ type: 'ai-sheet', to: job.lang, texts: src });
          if (res && res.stopped) { job.status = 'waiting'; return; }
          job.sheet = (res && res.sheet) || '';
          await save();
        }
        for (let i = 0; i < src.length; i += CHUNK) {
          if (job.chunks.includes(i)) continue;
          if (halted(job)) { job.status = 'waiting'; return; }
          // Switched to Google mid-file: Google does the rest below. Another
          // model picks up from the next chunk, and the file names the last one.
          if (!isAi()) break;
          job.model = modelName();
          if (!src.slice(i, i + CHUNK).some((x, k) => !job.out[i + k])) { job.chunks.push(i); continue; }
          const res = await request(job, { type: 'ai-translate', to: job.lang,
            texts: src.slice(i, i + CHUNK), before: src.slice(Math.max(0, i - 4), i), sheet: job.sheet });
          // Paused, removed or overtaken while the model worked on it: this chunk is asked again later.
          if (res && res.stopped) { job.status = 'waiting'; return; }
          if (!res || !res.ok) throw new Error((res && res.error) || t('Translation failed.'));
          res.texts.forEach((text, k) => { job.out[i + k] = fromHtml(text) || null; });
          job.chunks.push(i);
          await save();
          render();
        }
      }
      // Every line with Google, or the few the model left out.
      const gaps = src.map((s, i) => i).filter((i) => !job.out[i]);
      if (gaps.length) {
        const res = await request(job, { type: 'translate', to: job.lang, texts: gaps.map((i) => src[i]) });
        if (res && res.stopped) { job.status = 'waiting'; return; }
        if (res && res.ok) gaps.forEach((i, n) => { if (res.texts[n]) job.out[i] = fromHtml(res.texts[n]); });
        else if (!isAi()) throw new Error((res && res.error) || t('Translation failed.'));
        // With a model, a line Google couldn't do either keeps its original text.
      }
      if (!jobs.includes(job)) return;
      job.status = 'done';
      if (prefs.aiSaveFile) download(job);
      // With the original's fingerprint: the same subtitles on a video get this copy instead of a new translation.
      const srcKey = await SubSettings.sourceKey(job.lines).catch(() => '');
      await SubSettings.keepSubtitles({ name: outName(job), lang: job.lang, model: job.model || 'Google', srt: outSrt(job), ...(job.audio ? { audio: true } : {}),
        page: job.page, title: job.title, src: srcKey }, prefs.keepFor);
    } catch (e) {
      job.status = 'error';
      job.error = e.message;
    } finally {
      current = null;
      if (job.ahead) letGoUntil = Date.now() + 2000;
      await save();
      render();
    }
  }

  let asking = false; // waiting for another open copy to finish or close
  async function run() {
    if (mine || asking) return;
    asking = true;
    // One open copy of this page runs the queue; another one shows it and
    // waits its turn, so closing the copy that runs it doesn't stop the queue.
    await navigator.locks.request(LOCK, async () => {
      asking = false;
      mine = true;
      // The copy that ran before saved its last state; carry on from there.
      await loadJobs();
      await takeInbox();
      render();
      // Chrome's Memory Saver would close a background tab, and the queue with it.
      chrome.tabs.getCurrent((tab) => { if (tab) chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {}); });
      try {
        for (let job; !paused && (job = jobs.find((j) => j.status === 'waiting'));) {
          if (giveWay(job)) await nap(5000);
          else await work(job);
        }
      } finally {
        mine = false;
        chrome.tabs.getCurrent((tab) => { if (tab) chrome.tabs.update(tab.id, { autoDiscardable: true }).catch(() => {}); });
        render();
      }
    });
  }

  // Stops the request that's out now (a local model stops working too).
  function stopCurrent() {
    if (current) chrome.runtime.sendMessage({ type: 'ai-stop', to: current.lang }).catch(() => {});
  }

  $('pause').addEventListener('click', async () => {
    paused = !paused;
    if (paused) stopCurrent();
    await save();
    render();
    if (!paused) run();
  });
  $('saveAll').addEventListener('click', async () => {
    // A moment between files, or the browser may drop some of them.
    for (const job of jobs.filter((j) => j.status === 'done')) { download(job); await new Promise((r) => setTimeout(r, 400)); }
  });
  $('clearDone').addEventListener('click', async () => {
    jobs = jobs.filter((j) => j.status !== 'done');
    await save();
    render();
  });

  // ---------- passes over a video ----------

  // Improve clicked over a video goes first: the queue stops its current
  // request (the chunk is asked again later) and waits. A pass paused because
  // its subtitles are off isn't using the model, so the queue carries on then.
  // The pass shows in the list, and the arrows can put files above it (ahead);
  // those go first and the pass waits, until the next Improve you click.
  const active = (j) => j.status === 'waiting' || j.status === 'running';
  // A pass let go on says it's running half a second later: nothing starts in that gap.
  let letGoUntil = 0;
  const giveWay = (job) => !job.ahead && (live.some((l) => !l.paused) || (live.length > 0 && Date.now() < letGoUntil));
  // A transcript from the audio waits above this file (placed there when it came in).
  const overtaken = (job) => !job.audio && jobs.slice(0, jobs.indexOf(job)).some((j) => j.audio && j.status === 'waiting');
  const halted = (job) => paused || !jobs.includes(job) || giveWay(job) || overtaken(job);
  const queueFirst = () => !paused && live.length > 0 && jobs.some((j) => j.ahead && active(j));
  let wakeUp = () => {};
  const nap = (ms) => new Promise((r) => { const id = setTimeout(r, ms); wakeUp = () => { clearTimeout(id); r(); }; });

  // Asks each pass if it's still going (a closed tab or a reload never says
  // goodbye) and, from the copy that runs the queue, if it may go now.
  const forgetLive = (l) => chrome.storage.session.remove(l.key).catch(() => {});
  function checkLive() {
    for (const l of live) {
      chrome.tabs.sendMessage(l.tabId, { type: 'ai-live-check', to: l.to, queueFirst: mine ? queueFirst() : undefined }, { frameId: l.frameId })
        .then((res) => { if (!res || !res.running) forgetLive(l); }, () => forgetLive(l));
    }
  }
  setInterval(checkLive, 20000);

  const queueRunsElsewhere = async () => !mine && (await navigator.locks.query()).held.some((l) => l.name === LOCK);

  chrome.storage.onChanged.addListener(async (changes, area) => {
    const keys = area === 'session' ? Object.keys(changes).filter((k) => k.startsWith(LIVE)) : [];
    if (!keys.length) return;
    for (const k of keys) {
      live = live.filter((l) => l.key !== k);
      if (changes[k].newValue) live.push(changes[k].newValue);
    }
    live.sort((a, b) => (a.key < b.key ? -1 : 1));
    // A new Improve: your click beats any order set for the one before.
    const started = keys.some((k) => changes[k].newValue && !changes[k].oldValue);
    if (started && jobs.some((j) => j.ahead) && !(await queueRunsElsewhere())) {
      for (const j of jobs) delete j.ahead;
      await save();
    }
    if (current && giveWay(current)) stopCurrent();
    checkLive();
    wakeUp();
    render();
  });

  // Top to bottom: the files ahead, the passes, the other files. null marks the passes.
  function waitingOrder() {
    const waiting = jobs.filter((j) => j.status === 'waiting');
    if (!live.length) return waiting;
    return [...waiting.filter((j) => j.ahead), null, ...waiting.filter((j) => !j.ahead)];
  }
  // The files ahead come first in the list too, in the places unfinished files hold.
  function sortAhead() {
    const list = jobs.filter(active);
    const sorted = [...list.filter((j) => j.ahead), ...list.filter((j) => !j.ahead)];
    jobs = jobs.map((j) => (active(j) ? sorted.shift() : j));
  }

  // ---------- moving and removing ----------

  // change: { id, move: -1 | 1 } swaps a waiting file with the waiting file
  // above or below it (they're translated top to bottom), or the pass over a
  // video between them; { live: true, move } moves that pass; { id } removes a file.
  // While another open copy runs the queue, its next save would undo the
  // change here, so that copy makes it.
  async function edit(change) {
    if (await queueRunsElsewhere()) {
      return chrome.storage.local.set({ [EDIT]: Object.assign({ t: Date.now() }, change) });
    }
    const job = jobs.find((j) => j.id === change.id);
    if (!job && !change.live && !change.sort) return;
    const tops = (change.move || change.sort) && new Map([...$('jobs').children].map((li) => [li.dataset.id, li.getBoundingClientRect().top]));
    if (change.sort) {
      if (!SORTS[change.sort]) return;
      sortWaiting(change.sort);
    } else if (change.live) {
      // The file just above the passes (even one being translated) goes below them, or the one below above them.
      const other = change.move < 0 ? jobs.filter((j) => j.ahead && active(j)).pop() : jobs.find((j) => !j.ahead && j.status === 'waiting');
      if (!other) return;
      other.ahead = change.move > 0;
    } else if (change.move) {
      const order = waitingOrder();
      const at = job.status === 'waiting' ? order.indexOf(job) : -1;
      const other = at < 0 ? undefined : order[at + change.move];
      if (other === undefined) return;
      if (other === null) job.ahead = change.move < 0;
      else {
        const a = jobs.indexOf(job), b = jobs.indexOf(other);
        jobs[a] = other;
        jobs[b] = job;
      }
    } else {
      if (current === job) stopCurrent();
      jobs = jobs.filter((j) => j !== job);
    }
    if (live.length) { sortAhead(); letGoUntil = Date.now() + 2000; }
    if (current && giveWay(current)) stopCurrent();
    await save();
    render();
    if (tops) slide(tops, change.sort ? '' : change.live ? live[0] && live[0].key : job.id);
  }

  // "Sort": a small menu under the button, as "Show on…" has.
  const sortMenu = el('div', 'tab-menu sort-menu');
  sortMenu.popover = 'auto';
  sortMenu.setAttribute('role', 'menu');
  sortMenu.append(el('div', 'tab-menu-title', t('Sort the waiting files')), ...[
    ['name', t('By name'), t('Episode 2 before episode 10')],
    ['oldest', t('Oldest added first'), ''],
    ['newest', t('Newest added first'), ''],
  ].map(([how, label, sub]) => {
    const b = el('button', 'sort-row');
    b.setAttribute('role', 'menuitem');
    b.append(el('span', '', label), ...(sub ? [el('span', 'sort-sub', sub)] : []));
    b.addEventListener('click', () => { sortMenu.hidePopover(); edit({ sort: how }); });
    return b;
  }));
  document.body.append(sortMenu);
  $('sort').popoverTargetElement = sortMenu;
  $('sort').addEventListener('click', (e) => {
    e.preventDefault();
    if (sortMenu.matches(':popover-open')) return sortMenu.hidePopover();
    sortMenu.showPopover();
    const r = $('sort').getBoundingClientRect();
    sortMenu.style.top = (r.bottom + scrollY + 6) + 'px';
    sortMenu.style.left = Math.max(12 + scrollX, r.right + scrollX - sortMenu.offsetWidth) + 'px';
    $('sort').setAttribute('aria-expanded', 'true');
    sortMenu.querySelector('.sort-row').focus();
  });
  sortMenu.addEventListener('toggle', (e) => { if (e.newState === 'closed') $('sort').setAttribute('aria-expanded', 'false'); });

  // After a move the cards glide to their new places, so the eye can follow
  // the file; the one that was moved passes over the other.
  function slide(tops, movedId) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const li of $('jobs').children) {
      const was = tops.get(li.dataset.id);
      const dy = was == null ? 0 : was - li.getBoundingClientRect().top;
      if (!dy) continue;
      if (li.dataset.id === movedId) li.style.zIndex = '1';
      li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.25, 1, .5, 1)' });
    }
  }

  // ---------- playing where they came from ----------

  // "Play": the page opens (or reloads, if it's open) and shows the subtitles
  // over its video. They go where content.js keeps each page's last subtitles,
  // marked as showing in this browser session, so it puts them on at once, as
  // after a reload, instead of only offering them.
  const b64 = (text) => SubLib.bytesToBase64(new TextEncoder().encode(text));
  async function play(page, file) {
    // Kept as content.js looks for it: a YouTube video under one address whatever else the link held.
    const key = 'mem:' + SubSettings.pageOf(page);
    const before = (await chrome.storage.local.get(key))[key];
    const record = Object.assign({ t: Date.now() }, file);
    // The sync set for that page stays.
    if (before && typeof before.offset === 'number') record.offset = before.offset;
    await chrome.storage.local.set({ [key]: record });
    await chrome.storage.session.set({ ['page:' + SubSettings.pageOf(page)]: { t: record.t } });
    const open = (await chrome.tabs.query({})).find((tab) => tab.url && SubSettings.pageOf(tab.url) === SubSettings.pageOf(page));
    if (!open) return chrome.tabs.create({ url: page });
    await chrome.tabs.update(open.id, { active: true });
    await chrome.windows.update(open.windowId, { focused: true });
    await chrome.tabs.reload(open.id);
  }
  // A finished job as a translation of its original lines: "Show original" and
  // dual subtitles work there as usual, and a model's finished pass shows as done.
  // The original keeps its own name, so on YouTube the CC button still switches them.
  function playJob(job) {
    const ai = job.model && job.chunks.length >= Math.ceil(job.lines.length / CHUNK);
    return play(job.page, { name: outName(job), b64: b64(outSrt(job)), encoding: 'utf-8', usedEncoding: 'utf-8',
      translatedTo: job.lang, origLang: '', original: { name: job.source || job.name, b64: b64(SubLib.toSRT(job.lines)), encoding: 'utf-8', usedEncoding: 'utf-8' },
      ai: ai ? { model: job.model, done: job.lines.length, chunks: [...job.chunks], stopped: false } : null });
  }
  function playButton(onClick) {
    const b = el('button', 'primary', t('Play'));
    b.title = t('Opens the page these subtitles came from and shows them over its video.');
    b.addEventListener('click', () => onClick().catch((e) => say(e.message, true)));
    return b;
  }
  const siteName = (page) => { try { return new URL(page).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

  // ---------- "Show on…": over a video in another open tab ----------
  // For subtitles that don't know their page (a file added here by hand), and for
  // the same film on another site. A menu lists the open tabs with a video, the one
  // looked at last first; the pick gets the subtitles at once, as a file loaded in
  // the popup does, without a reload.
  const shownOn = new Map(); // row id -> { text, error } said under it after a pick (while this page is open)
  let menuFor = ''; // row id of the open menu
  const menu = el('div', 'tab-menu');
  menu.popover = 'auto';
  menu.setAttribute('role', 'menu');
  document.body.append(menu);
  const markOpen = () => {
    for (const b of document.querySelectorAll('.show-on')) b.setAttribute('aria-expanded', String(b.dataset.menu === menuFor));
  };
  menu.addEventListener('toggle', (e) => { if (e.newState === 'closed') { menuFor = ''; markOpen(); } });

  async function videoTabs() {
    const tabs = (await chrome.tabs.query({})).filter((tab) => /^https?:/.test(tab.url || '') && !tab.discarded && !tab.frozen);
    // Each tab gets a moment to answer. Without injectImmediately Chrome waits for
    // every frame to finish loading, and an ad frame that never does (Prima+) would
    // keep the whole menu on "Looking for videos…".
    // null when the tab can't be used (browser pages, the Web Store) or didn't answer.
    const run = (tab, how, ms) => Promise.race([
      chrome.scripting.executeScript(Object.assign({ target: { tabId: tab.id, allFrames: true }, injectImmediately: true }, how)).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
    const ask = (tab) => run(tab, { func: () => { try { return window.__subOverlay ? window.__subOverlay.report() : null; } catch (e) { return null; } } }, 2000);
    // A tab opened before the extension was installed, reloaded or updated has no
    // content script until the page is reloaded; start it there instead.
    const files = chrome.runtime.getManifest().content_scripts[0].js;
    const found = await Promise.all(tabs.map(async (tab) => {
      let results = await ask(tab);
      if (results && results.length && !results.some((r) => r && r.result) && await run(tab, { files }, 3000)) results = await ask(tab);
      results = results || [];
      const frames = results.filter((r) => r && r.result && Array.isArray(r.result.videos)).map((r) => ({ frameId: r.frameId, report: r.result }));
      const videos = frames.flatMap((f) => f.report.videos.map((v) => Object.assign({ frameId: f.frameId }, v)));
      if (!videos.length) return null;
      const top = frames.find((f) => f.frameId === 0);
      return { tab, frames, videos, title: (top && top.report.title) || tab.title || tab.url };
    }));
    return found.filter(Boolean).sort((a, b) => (b.tab.lastAccessed || 0) - (a.tab.lastAccessed || 0));
  }

  // The video they go to, picked as the popup picks it: the one showing subtitles
  // now, else one playing, else the largest.
  function targetOf(found) {
    const lf = found.frames.find((f) => f.report.loaded);
    const current = found.videos.filter((v) => v.current && v.visible);
    const showing = lf && current.find((v) => v.frameId === lf.frameId);
    if (showing) return showing;
    const playing = current.filter((v) => v.playing);
    const pool = playing.length ? playing : current.length ? current : found.videos.filter((v) => v.visible);
    return (pool.length ? pool : found.videos).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  }

  async function showOnTab(found, id, file) {
    const v = targetOf(found);
    const lf = found.frames.find((f) => f.report.loaded);
    if (lf && lf.frameId !== v.frameId) await chrome.tabs.sendMessage(found.tab.id, { type: 'clear' }, { frameId: lf.frameId }).catch(() => {});
    const res = await chrome.tabs.sendMessage(found.tab.id, { type: 'load', name: file.name, b64: b64(file.text), encoding: 'utf-8', videoIndex: v.index, made: file.made }, { frameId: v.frameId })
      .catch(() => null);
    const ok = res && res.ok;
    shownOn.set(id, ok ? { text: t('Showing on {site}', { site: siteName(found.tab.url) }) }
      : { text: (res && res.error) || t('The page didn’t answer. Reload the page and try again.'), error: true });
    render();
    renderSaved();
    if (!ok) return;
    await chrome.tabs.update(found.tab.id, { active: true });
    await chrome.windows.update(found.tab.windowId, { focused: true });
  }

  function tabRow(found, last, id, file) {
    const r = el('button', 'tab-row');
    r.setAttribute('role', 'menuitem');
    const site = siteName(found.tab.url);
    const fav = el('span', 'fav', (site[0] || '?').toUpperCase());
    if (/^(https?|data):/.test(found.tab.favIconUrl || '')) {
      const img = el('img');
      img.alt = '';
      img.addEventListener('load', () => { fav.classList.add('img'); fav.replaceChildren(img); });
      img.src = found.tab.favIconUrl;
    }
    r.append(fav, el('span', 'tab-name', found.title), el('span', 'tab-site', site));
    if (last) r.append(el('span', 'tab-tag', t('Last viewed')));
    r.title = found.title;
    r.addEventListener('click', () => {
      menu.hidePopover();
      showOnTab(found, id, file).catch((e) => { shownOn.set(id, { text: e.message, error: true }); render(); renderSaved(); });
    });
    return r;
  }

  async function openMenu(button, id, file) {
    menuFor = id;
    markOpen();
    menu.replaceChildren(el('div', 'tab-empty', t('Looking for videos…')));
    if (!menu.matches(':popover-open')) menu.showPopover();
    // Under the button, its right edge on the button's, in page coordinates so the
    // page scrolls it along; above the button when it wouldn't fit below (the last
    // saved file sits at the bottom of the page, and the menu can't extend the page).
    const r = button.getBoundingClientRect();
    const at = { top: r.top + scrollY, bottom: r.bottom + scrollY, right: r.right + scrollX };
    const place = () => {
      const h = menu.offsetHeight;
      const below = at.bottom - scrollY + 6 + h <= innerHeight - 8;
      const fitsAbove = at.top - scrollY - 6 - h >= 8;
      menu.style.top = (below || !fitsAbove ? at.bottom + 6 : at.top - 6 - h) + 'px';
      menu.style.left = Math.max(12 + scrollX, at.right - menu.offsetWidth) + 'px';
    };
    place();
    const list = await videoTabs().catch(() => []);
    if (menuFor !== id) return; // closed, or opened for another file meanwhile
    if (!list.length) {
      const e = el('div', 'tab-empty');
      e.append(el('strong', '', t('No open tab has a video')), t('Open the video in another tab and start it, then try again.'));
      menu.replaceChildren(e);
      return place();
    }
    menu.replaceChildren(el('div', 'tab-menu-title', t('Show on')), ...list.map((found, i) => tabRow(found, i === 0, id, file)),
      el('div', 'tab-foot', t('Only tabs with a video are listed.')));
    place();
    menu.querySelector('.tab-row').focus();
  }

  // file: () => { name, text }, read when the menu opens.
  function showOnButton(id, file, primary) {
    const b = el('button', 'show-on' + (primary ? ' primary' : ''), t('Show on…'));
    b.insertAdjacentHTML('beforeend', '<svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>');
    b.title = t('Shows these subtitles over a video in another open tab.');
    b.dataset.menu = id;
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', String(menuFor === id));
    // As the menu's invoker, a click on it doesn't count as a click outside (which
    // would close the menu and this click open it again); what it does is up to us.
    b.popoverTargetElement = menu;
    b.addEventListener('click', (e) => {
      e.preventDefault();
      if (menuFor === id) return menu.hidePopover();
      openMenu(b, id, file()).catch((err) => menu.replaceChildren(el('div', 'tab-empty', err.message)));
    });
    return b;
  }
  function shownNote(id, note) {
    const s = shownOn.get(id);
    if (s && s.error) note.classList.add('error-text');
    if (s) note.textContent = (note.textContent ? note.textContent + ' · ' : '') + s.text;
    if (s && !s.error) note.classList.add('showing');
    return note;
  }

  // ---------- list ----------

  function render() {
    const waiting = jobs.some((j) => j.status === 'waiting' || j.status === 'running');
    const done = jobs.some((j) => j.status === 'done');
    $('empty').hidden = jobs.length > 0 || live.length > 0;
    $('pause').hidden = !waiting && !paused;
    $('sort').hidden = jobs.filter((j) => j.status === 'waiting').length < 2;
    $('pause').textContent = t(paused ? 'Resume' : 'Pause');
    $('saveAll').hidden = !done;
    $('clearDone').hidden = !done;
    // The list is drawn anew: an arrow that had the focus keeps it, on the file
    // it moved, so pressing it again moves the file further.
    const arrow = document.activeElement && document.activeElement.closest('#jobs .job-move');
    const focus = arrow && { id: arrow.closest('.job').dataset.id, move: arrow.dataset.move };
    const rows = jobs.map(jobRow);
    if (live.length) {
      // Above the first file that waits for them, else after the last unfinished one, else last.
      const next = jobs.findIndex((j) => active(j) && !j.ahead);
      const last = jobs.map(active).lastIndexOf(true);
      rows.splice(next >= 0 ? next : last >= 0 ? last + 1 : jobs.length, 0, ...live.map(liveRow));
    }
    $('jobs').replaceChildren(...rows);
    if (focus) {
      const li = [...$('jobs').children].find((r) => r.dataset.id === focus.id);
      const b = li && (li.querySelector(`.job-move[data-move="${focus.move}"]:enabled`) || li.querySelector('.job-move:enabled'));
      if (b) b.focus();
    }
  }

  // Subtitles written down from the video's sound (the popup's "Make subtitles
  // from the audio"): marked, so no one expects the care of subtitles a person made.
  function audioChip() {
    const c = el('span', 'audio-chip');
    c.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 7v2M5 4.5v7M8 2v12M11 4.5v7M14 7v2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    c.append(t('From audio'));
    c.title = t('Written down from the video’s sound by a speech model, so it can have mistakes that subtitles made by a person wouldn’t.');
    return c;
  }

  function jobRow(job) {
    const li = el('li', 'job ' + job.status);
    li.dataset.id = job.id;
    const head = el('div', 'job-head');
    if (job.status === 'done') head.append(el('span', 'job-check', '✓'));
    const name = el('span', 'job-name', job.title || job.name);
    name.title = job.title || job.name;
    const x = el('button', 'ghost job-x', '×');
    x.title = t('Remove from the queue');
    x.setAttribute('aria-label', t('Remove from the queue'));
    x.addEventListener('click', () => edit({ id: job.id }));
    head.append(name, ...(job.audio ? [audioChip()] : []), el('span', 'job-lang', (SubSettings.flag(job.lang) + ' ' + SubSettings.languageName(job.lang)).trim()), x);

    const total = job.lines.length;
    const n = job.status === 'done' ? total : linesDone(job);
    const bar = el('div', 'job-bar');
    const fill = el('span');
    fill.style.width = Math.floor((n / total) * 100) + '%';
    bar.append(fill);

    const lines = n + ' / ' + t('{n} lines', { n: total });
    const note = job.status === 'done' ? t('Done') + ' · ' + t('{n} lines', { n: total }) + (job.model ? ' · ' + job.model : '')
      : job.status === 'error' ? t('Stopped') + ': ' + job.error
        : job.status === 'running' ? (job.retry ? t('Didn’t work, trying again soon: {error}', { error: job.retry }) : t('Translating') + ' · ' + lines)
          : (paused ? t('Paused') : t('Waiting')) + (n ? ' · ' + lines : '');
    const foot = el('div', 'job-foot');
    foot.append(job.status === 'done' ? shownNote(job.id, el('span', 'job-note', note)) : el('span', 'job-note', note));
    if (job.status === 'done') {
      if (job.page) foot.append(playButton(() => playJob(job)));
      foot.append(showOnButton(job.id, () => ({ name: outName(job), text: outSrt(job), made: { lang: job.lang, model: job.model || 'Google', from: 'queue', audio: !!job.audio } }), !job.page));
      const b = el('button', '', t('Download .srt'));
      b.addEventListener('click', () => download(job));
      foot.append(b);
    } else if (job.status === 'error') {
      const b = el('button', '', t('Try again'));
      b.addEventListener('click', async () => { job.status = 'waiting'; job.error = ''; await save(); render(); run(); });
      foot.append(b);
    } else if (job.status === 'waiting') {
      // With two or more in line, the arrows change which goes first.
      const waiting = waitingOrder();
      if (waiting.length > 1) {
        const at = waiting.indexOf(job);
        const order = el('span', 'job-order');
        order.append(moveButton({ id: job.id, move: -1 }, at === 0), moveButton({ id: job.id, move: 1 }, at === waiting.length - 1));
        foot.append(order);
      }
    }
    li.append(head, bar, foot);
    // The page it was added from, where Play shows it.
    if (job.page) {
      const from = el('div', 'saved-meta', siteName(job.page));
      from.title = job.page;
      li.insertBefore(from, bar);
    }
    return li;
  }

  // A pass started over a video, while it runs: only shown here, with its own
  // tab doing the work. × stops it, as Stop does in the card over the video.
  function liveRow(l) {
    const li = el('li', 'job ' + (l.paused ? 'waiting' : 'running'));
    li.dataset.id = l.key;
    const head = el('div', 'job-head');
    const name = el('span', 'job-name', l.name);
    name.title = l.name;
    const x = el('button', 'ghost job-x', '×');
    x.title = t('Stop');
    x.setAttribute('aria-label', t('Stop'));
    x.addEventListener('click', () => chrome.tabs.sendMessage(l.tabId, { type: 'ai-live-stop', to: l.to }, { frameId: l.frameId }).catch(() => forgetLive(l)));
    head.append(name, el('span', 'job-lang', (SubSettings.flag(l.to) + ' ' + SubSettings.languageName(l.to)).trim()), x);
    const from = el('div', 'saved-meta', siteName(l.page));
    from.title = l.page;
    const bar = el('div', 'job-bar');
    const fill = el('span');
    fill.style.width = Math.floor((l.done / l.total) * 100) + '%';
    bar.append(fill);
    const foot = el('div', 'job-foot');
    const above = jobs.some((j) => j.ahead && active(j));
    const below = jobs.some((j) => !j.ahead && j.status === 'waiting');
    foot.append(el('span', 'job-note', t(l.paused && above ? 'Waiting' : l.paused ? 'Paused' : 'Improving') + ' · ' + l.model + ' · ' + l.done + ' / ' + t('{n} lines', { n: l.total })));
    if (above || below) {
      const order = el('span', 'job-order');
      order.append(moveButton({ live: true, move: -1 }, !above), moveButton({ live: true, move: 1 }, !below));
      foot.append(order);
    }
    li.append(head, from, bar, foot);
    return li;
  }

  function moveButton(change, last) {
    const move = change.move;
    const label = t(move < 0 ? 'Move up' : 'Move down');
    const b = el('button', 'ghost job-move', move < 0 ? '↑' : '↓');
    b.dataset.move = move;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.disabled = last;
    b.addEventListener('click', () => edit(change));
    return b;
  }

  // ---------- saved subtitles ----------

  async function renderSaved() {
    const items = await SubSettings.loadSaved().catch(() => []);
    $('savedEmpty').hidden = items.length > 0;
    const when = new Intl.DateTimeFormat(SubI18n.lang, { dateStyle: 'medium', timeStyle: 'short' });
    $('savedList').replaceChildren(...items.map((item) => {
      const li = el('li', 'job saved done');
      const head = el('div', 'job-head');
      // The video's name leads, as in the queue; the file name (often "youtube-<id>.en.vi.srt") goes underneath.
      // Its name links back to where it was watched (the subtitles come back there by themselves).
      const title = item.title || item.name;
      const name = el(item.page ? 'a' : 'span', 'job-name', title);
      name.title = title;
      if (item.page) {
        name.href = item.page;
        name.target = '_blank';
        name.rel = 'noopener';
      }
      const x = el('button', 'ghost job-x', '×');
      x.title = t('Delete');
      x.setAttribute('aria-label', t('Delete'));
      x.addEventListener('click', () => SubSettings.forgetSaved(item.key));
      head.append(el('span', 'job-check', '✓'), name, ...(item.audio ? [audioChip()] : []), el('span', 'job-lang', (SubSettings.flag(item.lang) + ' ' + SubSettings.languageName(item.lang)).trim()), x);
      const meta = el('div', 'saved-meta');
      const day = new Intl.DateTimeFormat(SubI18n.lang, { dateStyle: 'medium' });
      const life = item.until ? t('Deleted on {date}', { date: day.format(item.until) }) : t('Kept forever');
      meta.append([when.format(item.t), item.model, life].filter(Boolean).join(' · '));
      const file = el('div', 'saved-meta saved-file', item.name);
      file.title = item.name;
      const foot = el('div', 'job-foot');
      foot.append(shownNote('saved:' + item.key, el('span', 'job-note', '')));
      const made = { lang: item.lang, model: item.model || 'Google', from: 'saved', audio: !!item.audio };
      if (item.page) foot.append(playButton(() => play(item.page, { name: item.name, b64: b64(item.srt), encoding: 'utf-8', usedEncoding: 'utf-8', made })));
      foot.append(showOnButton('saved:' + item.key, () => ({ name: item.name, text: item.srt, made }), !item.page));
      const b = el('button', '', t('Download .srt'));
      b.addEventListener('click', () => SubLib.saveText(item.srt, item.name));
      foot.append(b);
      li.append(head, meta, ...(title !== item.name ? [file] : []), foot);
      return li;
    }));
  }

  render();
  // "Saved subtitles" in the popup opens this page at that list.
  renderSaved().then(() => { if (location.hash === '#saved') $('saved').scrollIntoView(); });
  run();
})();
