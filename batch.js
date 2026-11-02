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
  // A job: { id, name, lang, lines: [{ start, end, text }], out: [text | null], chunks: [start], status, error, model }
  // status: 'waiting' | 'running' | 'done' | 'error'
  const stored = (await chrome.storage.local.get(KEY))[KEY] || {};
  let jobs = Array.isArray(stored.jobs) ? stored.jobs : [];
  let paused = !!stored.paused;
  for (const j of jobs) if (j.status === 'running') j.status = 'waiting';
  let current = null; // the job a request is out for
  let mine = false; // this tab runs the queue (another open copy only shows it)
  // A file removed or moved in a copy that doesn't run the queue, for the copy that does.
  const EDIT = 'queueEdit';
  const LOCK = 'translation-queue';

  const aiOf = () => SubSettings.AI[prefs.translator]; // undefined for Google
  const isAi = () => !!aiOf();
  const modelName = () => (aiOf() && prefs[aiOf().model]) || '';

  async function save() {
    try { await chrome.storage.local.set({ [KEY]: { jobs, paused } }); }
    catch (e) { say(t('Couldn’t save the queue: {error}', { error: e.message }), true); }
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
    local: 'A model on this computer: free and private, but slower. Needs Ollama or LM Studio; its address is set in the extension popup.',
  };
  const PLACEHOLDERS = { gemini: 'AIza…', claude: 'sk-ant-…' };
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
    for (const b of document.querySelectorAll('[data-translator]')) {
      const on = b.dataset.translator === (ai ? prefs.translator : 'google');
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
    b.addEventListener('click', () => SubSettings.saveTranslation({ translator: b.dataset.translator }));
  }
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
    if (changes[EDIT] && changes[EDIT].newValue && mine) edit(changes[EDIT].newValue);
  });

  // ---------- adding files ----------

  async function addFiles(list) {
    const added = [];
    const skipped = [];
    for (const f of list) {
      if (!/\.(srt|vtt|webvtt)$/i.test(f.name)) { skipped.push(f.name); continue; }
      const lines = SubLib.parse(SubLib.decode(new Uint8Array(await f.arrayBuffer()), 'auto').text)
        .map((c) => ({ start: c.start, end: c.end, text: c.text }));
      if (!lines.length) { skipped.push(f.name); continue; }
      added.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: f.name, lang: $('lang').value,
        lines, out: [], chunks: [], status: 'waiting', error: '', model: '' });
    }
    say(skipped.length ? t('Not subtitles, left out: {names}', { names: skipped.join(', ') }) : '', skipped.length > 0);
    if (!added.length) return;
    jobs.push(...added);
    await save();
    render();
    run();
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

  const outName = (job) => job.name.replace(/\.(web)?vtt$|\.srt$/i, '') + '.' + job.lang + '.srt';
  const outSrt = (job) => SubLib.toSRT(job.lines.map((c, i) => ({ start: c.start, end: c.end, text: job.out[i] || c.text })));
  const download = (job) => SubLib.saveText(outSrt(job), outName(job));

  async function work(job) {
    job.status = 'running';
    job.error = '';
    current = job;
    render();
    const src = job.lines.map((c) => toHtml(c.text));
    try {
      if (isAi()) {
        for (let i = 0; i < src.length; i += CHUNK) {
          if (job.chunks.includes(i)) continue;
          if (paused || !jobs.includes(job)) { job.status = 'waiting'; return; }
          // Switched to Google mid-file: Google does the rest below. Another
          // model picks up from the next chunk, and the file names the last one.
          if (!isAi()) break;
          job.model = modelName();
          const res = await chrome.runtime.sendMessage({ type: 'ai-translate', to: job.lang,
            texts: src.slice(i, i + CHUNK), before: src.slice(Math.max(0, i - 4), i) }).catch((e) => ({ ok: false, error: e.message }));
          // Paused or removed while the model worked on it: this chunk is asked again later.
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
        const res = await chrome.runtime.sendMessage({ type: 'translate', to: job.lang, texts: gaps.map((i) => src[i]) })
          .catch((e) => ({ ok: false, error: e.message }));
        if (res && res.ok) gaps.forEach((i, n) => { if (res.texts[n]) job.out[i] = fromHtml(res.texts[n]); });
        else if (!isAi()) throw new Error((res && res.error) || t('Translation failed.'));
        // With a model, a line Google couldn't do either keeps its original text.
      }
      if (!jobs.includes(job)) return;
      job.status = 'done';
      if (prefs.aiSaveFile) download(job);
      await SubSettings.keepSubtitles({ name: outName(job), lang: job.lang, model: job.model || 'Google', srt: outSrt(job) }, prefs.keepFor);
    } catch (e) {
      job.status = 'error';
      job.error = e.message;
    } finally {
      current = null;
      await save();
      render();
    }
  }

  async function run() {
    if (mine) return;
    // One open copy of this page runs the queue; another one only shows it.
    await navigator.locks.request(LOCK, { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      mine = true;
      // Chrome's Memory Saver would close a background tab, and the queue with it.
      chrome.tabs.getCurrent((tab) => { if (tab) chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {}); });
      try {
        for (let job; !paused && (job = jobs.find((j) => j.status === 'waiting'));) await work(job);
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

  // ---------- moving and removing ----------

  // change: { id, move: -1 | 1 } swaps a waiting file with the waiting file
  // above or below it (they're translated top to bottom); { id } removes it.
  // While another open copy runs the queue, its next save would undo the
  // change here, so that copy makes it.
  async function edit(change) {
    if (!mine && (await navigator.locks.query()).held.some((l) => l.name === LOCK)) {
      return chrome.storage.local.set({ [EDIT]: Object.assign({ t: Date.now() }, change) });
    }
    const job = jobs.find((j) => j.id === change.id);
    if (!job) return;
    let tops = null;
    if (change.move) {
      const waiting = jobs.filter((j) => j.status === 'waiting');
      const other = job.status === 'waiting' && waiting[waiting.indexOf(job) + change.move];
      if (!other) return;
      tops = new Map([...$('jobs').children].map((li) => [li.dataset.id, li.getBoundingClientRect().top]));
      const a = jobs.indexOf(job), b = jobs.indexOf(other);
      jobs[a] = other;
      jobs[b] = job;
    } else {
      if (current === job) stopCurrent();
      jobs = jobs.filter((j) => j !== job);
    }
    await save();
    render();
    if (tops) slide(tops, job.id);
  }

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

  // ---------- list ----------

  function render() {
    const waiting = jobs.some((j) => j.status === 'waiting' || j.status === 'running');
    const done = jobs.some((j) => j.status === 'done');
    $('empty').hidden = jobs.length > 0;
    $('pause').hidden = !waiting && !paused;
    $('pause').textContent = t(paused ? 'Resume' : 'Pause');
    $('saveAll').hidden = !done;
    $('clearDone').hidden = !done;
    // The list is drawn anew: an arrow that had the focus keeps it, on the file
    // it moved, so pressing it again moves the file further.
    const arrow = document.activeElement && document.activeElement.closest('#jobs .job-move');
    const focus = arrow && { id: arrow.closest('.job').dataset.id, move: arrow.dataset.move };
    $('jobs').replaceChildren(...jobs.map(jobRow));
    if (focus) {
      const li = [...$('jobs').children].find((r) => r.dataset.id === focus.id);
      const b = li && (li.querySelector(`.job-move[data-move="${focus.move}"]:enabled`) || li.querySelector('.job-move:enabled'));
      if (b) b.focus();
    }
  }

  function jobRow(job) {
    const li = el('li', 'job ' + job.status);
    li.dataset.id = job.id;
    const head = el('div', 'job-head');
    const name = el('span', 'job-name', job.name);
    name.title = job.name;
    const x = el('button', 'ghost job-x', '×');
    x.title = t('Remove from the queue');
    x.setAttribute('aria-label', t('Remove from the queue'));
    x.addEventListener('click', () => edit({ id: job.id }));
    head.append(name, el('span', 'job-lang', (SubSettings.flag(job.lang) + ' ' + SubSettings.languageName(job.lang)).trim()), x);

    const total = job.lines.length;
    const n = job.status === 'done' ? total : linesDone(job);
    const bar = el('div', 'job-bar');
    const fill = el('span');
    fill.style.width = Math.floor((n / total) * 100) + '%';
    bar.append(fill);

    const lines = n + ' / ' + t('{n} lines', { n: total });
    const note = job.status === 'done' ? t('Done') + ' · ' + t('{n} lines', { n: total }) + (job.model ? ' · ' + job.model : '')
      : job.status === 'error' ? t('Stopped') + ': ' + job.error
        : job.status === 'running' ? t('Translating') + ' · ' + lines
          : (paused ? t('Paused') : t('Waiting')) + (n ? ' · ' + lines : '');
    const foot = el('div', 'job-foot');
    foot.append(el('span', 'job-note', note));
    if (job.status === 'done') {
      const b = el('button', 'primary', t('Download .srt'));
      b.addEventListener('click', () => download(job));
      foot.append(b);
    } else if (job.status === 'error') {
      const b = el('button', '', t('Try again'));
      b.addEventListener('click', async () => { job.status = 'waiting'; job.error = ''; await save(); render(); run(); });
      foot.append(b);
    } else if (job.status === 'waiting') {
      // With two or more files waiting, the arrows change which goes first.
      const waiting = jobs.filter((j) => j.status === 'waiting');
      if (waiting.length > 1) {
        const at = waiting.indexOf(job);
        const order = el('span', 'job-order');
        order.append(moveButton(job, -1, at === 0), moveButton(job, 1, at === waiting.length - 1));
        foot.append(order);
      }
    }
    li.append(head, bar, foot);
    return li;
  }

  function moveButton(job, move, last) {
    const label = t(move < 0 ? 'Move up' : 'Move down');
    const b = el('button', 'ghost job-move', move < 0 ? '↑' : '↓');
    b.dataset.move = move;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.disabled = last;
    b.addEventListener('click', () => edit({ id: job.id, move }));
    return b;
  }

  // ---------- saved subtitles ----------

  async function renderSaved() {
    const items = await SubSettings.loadSaved().catch(() => []);
    $('savedEmpty').hidden = items.length > 0;
    const when = new Intl.DateTimeFormat(SubI18n.lang, { dateStyle: 'medium', timeStyle: 'short' });
    $('savedList').replaceChildren(...items.map((item) => {
      const li = el('li', 'job saved');
      const head = el('div', 'job-head');
      const name = el('span', 'job-name', item.name);
      name.title = item.name;
      const x = el('button', 'ghost job-x', '×');
      x.title = t('Delete');
      x.setAttribute('aria-label', t('Delete'));
      x.addEventListener('click', () => SubSettings.forgetSaved(item.key));
      head.append(name, el('span', 'job-lang', (SubSettings.flag(item.lang) + ' ' + SubSettings.languageName(item.lang)).trim()), x);
      const meta = el('div', 'saved-meta');
      const day = new Intl.DateTimeFormat(SubI18n.lang, { dateStyle: 'medium' });
      const life = item.until ? t('Deleted on {date}', { date: day.format(item.until) }) : t('Kept forever');
      meta.append([when.format(item.t), item.model, life].filter(Boolean).join(' · '));
      // Where it was watched, to go back to it (the subtitles come back there by themselves).
      if (item.page) {
        const a = el('a', '', item.title || new URL(item.page).hostname);
        a.href = item.page;
        a.target = '_blank';
        a.rel = 'noopener';
        meta.append(' · ', a);
      }
      const foot = el('div', 'job-foot');
      foot.append(el('span', 'job-note', ''));
      const b = el('button', 'primary', t('Download .srt'));
      b.addEventListener('click', () => SubLib.saveText(item.srt, item.name));
      foot.append(b);
      li.append(head, meta, foot);
      return li;
    }));
  }

  render();
  // "Saved subtitles" in the popup opens this page at that list.
  renderSaved().then(() => { if (location.hash === '#saved') $('saved').scrollIntoView(); });
  run();
})();
