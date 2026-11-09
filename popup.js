// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Cleedek

// Popup: loads files, lists found subtitles, edits settings (applied live).
(async function () {
  'use strict';
  const { SubLib, SubSettings, SubRender, SubI18n } = globalThis;
  const $ = (id) => document.getElementById(id);
  const t = SubI18n.t;
  await SubI18n.load();
  SubI18n.translatePage(document.body);

  // ---------- tabs ----------

  // Three tabs fixed at the top: Subtitles (load, translate, sync), Style, Behaviour.
  // The last one used is remembered, so the popup opens where you left it.
  const tabs = [...document.querySelectorAll('.tabbar [role=tab]')];
  let onStyleShown = () => {}; // set once the preview exists; it measures its width when shown
  function showTab(tabBtn, focus) {
    for (const b of tabs) {
      const on = b === tabBtn;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      $(b.getAttribute('aria-controls')).classList.toggle('active', on);
    }
    if (focus) tabBtn.focus();
    window.scrollTo(0, 0);
    try { localStorage.setItem('popupTab', tabBtn.id); } catch (e) { /* just not remembered */ }
    if (tabBtn.id === 'tabStyle') onStyleShown();
  }
  for (const b of tabs) {
    b.addEventListener('click', () => showTab(b));
    b.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      showTab(tabs[(tabs.indexOf(b) + step + tabs.length) % tabs.length], true);
    });
  }
  try {
    const saved = $(localStorage.getItem('popupTab'));
    if (saved && tabs.includes(saved)) showTab(saved);
  } catch (e) { /* first tab */ }

  // ---------- something stopped working ----------

  // One card above the tabs, so a problem doesn't hide inside a folded section.
  // Hidden with × until the problem changes (remembered until the browser closes).
  const isDeadError = (m) => /Receiving end does not exist|Could not establish connection|Extension context invalidated/i.test(String(m || ''));
  let alertNow = null; // { id, sig, onMain }
  async function showAlert({ id, title, text, main, onMain, tips }) {
    const sig = id + ':' + text;
    try {
      const { alertHidden } = await chrome.storage.session.get('alertHidden');
      if (alertHidden === sig) return;
    } catch (e) { /* shown */ }
    alertNow = { id, sig, onMain };
    $('alertTitle').textContent = title;
    $('alertText').textContent = text;
    $('alertMain').textContent = main;
    $('alertTips').replaceChildren(...(tips || []).map((tip) => {
      const li = document.createElement('li');
      // `code` parts can be selected and copied at once.
      tip.split(/`([^`]+)`/).forEach((part, i) => li.append(i % 2 ? Object.assign(document.createElement('code'), { textContent: part }) : part));
      return li;
    }));
    $('alertTips').hidden = true;
    $('alertMore').hidden = !(tips && tips.length);
    $('alertMore').textContent = t('Tips');
    $('alertCard').hidden = false;
  }
  function hideAlert(id) {
    if (alertNow && alertNow.id === id) { $('alertCard').hidden = true; alertNow = null; }
  }
  $('alertMain').addEventListener('click', () => alertNow && alertNow.onMain());
  $('alertMore').addEventListener('click', () => {
    $('alertTips').hidden = !$('alertTips').hidden;
    $('alertMore').textContent = $('alertTips').hidden ? t('Tips') : t('Hide tips');
  });
  $('alertClose').addEventListener('click', () => {
    if (alertNow) chrome.storage.session.set({ alertHidden: alertNow.sig }).catch(() => {});
    $('alertCard').hidden = true;
    alertNow = null;
  });

  // The background part does the finding, the translating and the AI. When
  // Chrome fails to start it again, all of that stops without a word.
  function showDead() {
    showAlert({
      id: 'dead',
      title: t('Subtitle Overlay stopped in the background'),
      text: t('Subtitles from videos, translations and the AI can’t work until it starts again. After Restart, reload the video page.'),
      main: t('Restart'),
      onMain: () => chrome.runtime.reload(),
      tips: [
        t('Chrome sometimes fails to start an extension again after an update or after the computer sleeps.'),
        t('If it keeps happening, open `chrome://extensions` and look at Errors under Subtitle Overlay.'),
      ],
    });
  }
  // A stopped worker either fails at once ("Receiving end does not exist") or never answers.
  Promise.race([
    chrome.runtime.sendMessage({ type: 'ping' }).then(() => 'ok', (e) => (isDeadError(e && e.message) ? 'dead' : 'ok')),
    new Promise((r) => setTimeout(() => r('dead'), 4000)),
  ]).then((state) => { if (state === 'dead') showDead(); });

  // ---------- support the creator ----------

  // The name is a link, so the sentence is split around {name} instead of translated as page text.
  const [before, after] = t('Created with 💜 by {name} in Vietnam').split('{name}');
  const author = Object.assign(document.createElement('a'), { href: 'https://cleedek.com', target: '_blank', rel: 'noopener', textContent: 'Cleedek' });
  $('credit').append(before, author, after || '');

  function showSupport(on) {
    document.body.classList.toggle('support', on);
    window.scrollTo(0, 0);
    (on ? $('supportBack') : $('supportOpen')).focus();
  }
  $('supportOpen').addEventListener('click', () => showSupport(true));
  $('supportBack').addEventListener('click', () => showSupport(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('support')) { e.preventDefault(); showSupport(false); }
  });
  const payTabs = document.querySelectorAll('#supportView .segmented [role=tab]');
  function selectPayTab(tabBtn) {
    for (const b of payTabs) {
      b.setAttribute('aria-selected', String(b === tabBtn));
      $(b.getAttribute('aria-controls')).hidden = b !== tabBtn;
    }
  }
  for (const tabBtn of payTabs) tabBtn.addEventListener('click', () => selectPayTab(tabBtn));

  // Local bank QR as the default tab, only for Czech or Vietnamese speakers: the language picked
  // in the extension decides first, then the browser's own language. Location plays no part.
  const browserLang = (chrome.i18n ? chrome.i18n.getUILanguage() : navigator.language || '').toLowerCase().split('-')[0];
  const bankLang = [SubI18n.lang, browserLang].find((l) => l === 'cs' || l === 'vi');
  const localTab = { cs: $('tabBankCz'), vi: $('tabBankVn') }[bankLang];
  if (localTab) {
    localTab.hidden = false;
    selectPayTab(localTab);
  }
  for (const btn of document.querySelectorAll('.pay-card .copy')) {
    const label = btn.textContent;
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(btn.dataset.copy); btn.textContent = t('Copied'); }
      catch (e) { btn.textContent = t('Copy failed'); }
      setTimeout(() => { btn.textContent = label; }, 1500);
    });
  }

  // ---------- Snap Translate, the creator's other extension ----------

  // Its ID is known once it is in the Chrome Web Store (the store link goes in popup.html then).
  // Until then the card can't tell whether Snap Translate is installed.
  const SNAP_TRANSLATE_ID = '';

  setupFeedback({ ext: 'subtitle-overlay', name: 'Subtitle Overlay', i18n: SubI18n });

  // A card in the footer, hidden for good once closed. Not shown when Snap Translate is
  // already installed: it answers a "hello" from another extension, and nothing else is asked.
  (async () => {
    const { sisterClosed } = await chrome.storage.local.get('sisterClosed');
    if (sisterClosed) return;
    const installed = !!SNAP_TRANSLATE_ID && await chrome.runtime.sendMessage(SNAP_TRANSLATE_ID, { type: 'hello' }).then(Boolean, () => false);
    if (!installed) $('sister').hidden = false;
  })();
  $('sisterClose').addEventListener('click', () => {
    $('sister').hidden = true;
    chrome.storage.local.set({ sisterClosed: true });
    $('supportOpen').focus();
  });

  const style = document.createElement('style');
  style.textContent = SubRender.CSS;
  document.head.appendChild(style);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let frames = [];      // [{ frameId, report }]
  let settings = await SubSettings.load();

  // ---------- page state ----------

  async function scan() {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => (window.__subOverlay ? window.__subOverlay.report() : null),
      });
      frames = results.filter((r) => r.result).map((r) => ({ frameId: r.frameId, report: r.result }));
    } catch (e) {
      frames = null;
    }
    renderPage();
  }

  const allVideos = () => (frames || []).flatMap((f) => f.report.videos.map((v) => Object.assign({ frameId: f.frameId, host: f.report.host }, v)));
  const loadedFrame = () => (frames || []).find((f) => f.report.loaded);

  // The video subtitles go to: the one showing them now, else the content
  // script's own pick in the top-most frame that has one, else the largest.
  function targetVideo() {
    const vids = allVideos();
    const chosen = $('videoSelect').value;
    if (chosen) {
      const [frameId, index] = chosen.split(':').map(Number);
      const v = vids.find((x) => x.frameId === frameId && x.index === index);
      if (v) return v;
    }
    const lf = loadedFrame();
    const current = vids.filter((v) => v.current && v.visible);
    if (lf) return current.find((v) => v.frameId === lf.frameId) || current[0];
    const playing = current.filter((v) => v.playing);
    const pool = playing.length ? playing : current.length ? current : vids.filter((v) => v.visible);
    return pool.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  }

  function renderPage() {
    if (frames === null) {
      $('status').textContent = t('This page can’t be used (browser pages, the Web Store and PDFs are off limits).');
      for (const id of ['pick', 'clear']) $(id).disabled = true;
      $('captured').replaceChildren();
      return;
    }
    const vids = allVideos().filter((v) => v.visible);
    const lf = loadedFrame();
    const anyPlaying = vids.some((v) => v.playing);
    $('status').textContent = vids.length
      ? t(anyPlaying ? '{n} videos on this page, playing' : '{n} videos on this page', { n: vids.length })
      : t('No video found yet. Start playing one, then reopen this.');

    $('loaded').hidden = !lf;
    $('clear').hidden = !lf;
    $('syncSection').hidden = !lf; // nothing on the video, nothing to sync
    renderRate(lf && lf.report.loaded);
    $('pick').textContent = t(lf ? 'Load a different file' : 'Load .srt / .vtt file');
    $('pick').classList.toggle('primary', !lf); // with a file loaded, Translate is the main action
    if (lf) {
      const l = lf.report.loaded;
      $('loadedName').textContent = l.name;
      $('loadedCount').textContent = '· ' + t('{n} lines', { n: l.count });
      $('encoding').value = l.encoding;
      const auto = $('encoding').querySelector('option[value=auto]');
      auto.textContent = t('Auto') + (l.encoding === 'auto' ? ' (' + l.usedEncoding + ')' : '');
      renderTranslate(l);
      const r = lf.report;
      $('siteHidden').hidden = !(r.siteHidden && r.siteHidden.length) && !r.siteVisible;
      $('siteHidden').classList.toggle('warn', !!r.siteVisible);
      $('siteHidden').textContent = r.siteVisible
        ? t('The site\u2019s own subtitles are still showing. Turn them off in its player.')
        : t('Site\u2019s own subtitles hidden: {list}', { list: (r.siteHidden || []).join(', ') });
    }

    // Video picker only when there is a real choice.
    $('videoPicker').hidden = vids.length < 2;
    if (vids.length > 1) {
      const target = targetVideo();
      $('videoSelect').replaceChildren(...vids.map((v, i) => {
        const o = document.createElement('option');
        o.value = v.frameId + ':' + v.index;
        o.textContent = t('Video {n}', { n: i + 1 }) + ' · ' + v.width + '×' + v.height + (v.playing ? ' · ' + t('playing') : '') + (v.frameId ? ' · ' + v.host : '');
        return o;
      }));
      if (target) $('videoSelect').value = target.frameId + ':' + target.index;
    }

    $('preview').hidden = anyPlaying;
    renderPreview();
    renderCaptured();
  }

  // ---------- loading into the page ----------

  async function loadIntoPage(name, b64) {
    const target = targetVideo();
    if (!target) return { ok: false, error: t('No video found on this page.') };
    const lf = loadedFrame();
    if (lf && lf.frameId !== target.frameId) {
      await chrome.tabs.sendMessage(tab.id, { type: 'clear' }, { frameId: lf.frameId }).catch(() => {});
    }
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'load', name, b64, encoding: 'auto', videoIndex: target.index }, { frameId: target.frameId })
      .catch((e) => ({ ok: false, error: t('The page didn’t answer. Reload the page and try again.') }));
    await scan();
    return res;
  }

  $('pick').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', async () => {
    const f = $('file').files[0];
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const res = await loadIntoPage(f.name, SubLib.bytesToBase64(bytes));
    if (!res.ok) $('status').textContent = res.error;
    $('file').value = '';
  });

  $('toggleSubs').addEventListener('click', async () => {
    const lf = loadedFrame();
    if (lf) await chrome.tabs.sendMessage(tab.id, { type: 'run-action', action: { kind: 'toggle' } }, { frameId: lf.frameId }).catch(() => {});
  });

  $('clear').addEventListener('click', async () => {
    const lf = loadedFrame();
    if (lf) await chrome.tabs.sendMessage(tab.id, { type: 'clear' }, { frameId: lf.frameId }).catch(() => {});
    scan();
  });

  $('encoding').addEventListener('change', async () => {
    const lf = loadedFrame();
    if (!lf) return;
    await chrome.tabs.sendMessage(tab.id, { type: 'set-encoding', encoding: $('encoding').value }, { frameId: lf.frameId }).catch(() => {});
    scan();
  });

  $('videoSelect').addEventListener('change', async () => {
    const t = targetVideo();
    const lf = loadedFrame();
    if (!t) return;
    if (lf && lf.frameId !== t.frameId) {
      // Move the loaded file to a video in another frame.
      const file = await chrome.tabs.sendMessage(tab.id, { type: 'export' }, { frameId: lf.frameId }).catch(() => null);
      if (file) await loadIntoPage(file.name, file.b64);
    } else {
      await chrome.tabs.sendMessage(tab.id, { type: 'select-video', index: t.index }, { frameId: t.frameId }).catch(() => {});
      scan();
    }
  });

  // ---------- translation ----------

  // The language picker sits right next to the button; whatever you pick is
  // remembered as your favourite and used by every Translate button.
  const prefs = await SubSettings.loadTranslation();
  let lang = prefs.translateTo;
  for (const key of ['autoTranslate', 'aiNotices', 'aiSaveFile']) {
    $(key).checked = prefs[key];
    $(key).addEventListener('change', () => SubSettings.saveTranslation({ [key]: $(key).checked }));
  }
  // How long improved subtitles stay under Saved subtitles.
  const keepNames = { off: t('Don’t keep'), 1: t('1 day'), 7: t('7 days'), 30: t('1 month'), 90: t('3 months'), forever: t('Forever') };
  $('keepFor').replaceChildren(...SubSettings.KEEP_FOR.map((v) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = keepNames[v];
    return o;
  }));
  $('keepFor').value = prefs.keepFor;
  $('keepFor').addEventListener('change', () => SubSettings.saveTranslation({ keepFor: $('keepFor').value }));
  const cap = (s) => s.charAt(0).toLocaleUpperCase(SubI18n.lang) + s.slice(1);
  const langOption = ([code]) => {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = (SubSettings.flag(code) + ' ' + cap(SubSettings.languageName(code))).trim();
    return o;
  };
  $('lang').replaceChildren(...SubSettings.LANGUAGES.map(langOption));
  $('lang').value = lang;

  // Second subtitles: the original file or any translation language.
  const orig = document.createElement('option');
  orig.value = 'orig';
  orig.textContent = t('Original');
  $('secondLang').replaceChildren(orig, ...SubSettings.LANGUAGES.map(langOption));
  $('secondLang').value = prefs.secondLang || 'orig';
  $('secondLang').addEventListener('change', () => SubSettings.saveTranslation({ secondLang: $('secondLang').value }));

  // Translator: Google alone, or Google first and then, when you click Improve,
  // Gemini, Claude, OpenAI or a local model rewrites the lines (slower, but reads more
  // naturally). It never starts by itself: a key costs money, a local model the
  // computer's time.
  const TRANSLATOR_HINTS = {
    google: 'Fast and free. Translates line by line.',
    gemini: 'Google translates at once. Click Improve and Gemini rewrites it with the whole scene in mind. Needs an API key.',
    claude: 'Google translates at once. Click Improve and Claude rewrites it with the whole scene in mind. Needs an API key.',
    openai: 'Google translates at once. Click Improve and OpenAI rewrites it with the whole scene in mind. Needs an API key.',
    local: 'Google translates at once. Click Improve and a model on this computer rewrites it. Free, and the rewrite stays on your computer, but slower. Needs Ollama or LM Studio.',
  };
  let translator = prefs.translator;
  $('geminiKey').value = prefs.geminiKey;
  $('claudeKey').value = prefs.claudeKey;
  $('openaiKey').value = prefs.openaiKey;
  $('localUrl').value = prefs.localUrl;
  const modelKey = () => SubSettings.AI[translator].model;

  function aiMsg(text, isError) {
    $('aiMsg').hidden = !text;
    $('aiMsg').textContent = text || '';
    $('aiMsg').classList.toggle('error', !!isError);
    if (isError) $('aiDetails').open = true; // a problem shouldn't stay folded away
  }

  // "Improve with gemma3:12b" under the translation on the video, once the AI
  // translator has its key and model. While that model works on it, or once
  // it's done, a line says so instead.
  const improveModel = () => {
    const ai = SubSettings.AI[translator];
    return ai && !(ai.key && !$(ai.key).value.trim()) ? $('aiModel').value : '';
  };
  function renderImprove() {
    const lf = loadedFrame();
    const l = lf && lf.report.loaded;
    const model = l && l.translatedTo ? improveModel() : '';
    const ai = model && l.ai && l.ai.model === model ? l.ai : null;
    const busy = !!ai && (ai.running || ai.finished);
    $('improveBtn').hidden = !model || busy;
    $('improveBtn').textContent = t('Improve with {model}', { model });
    $('improveNote').hidden = !busy;
    $('improveNote').textContent = busy ? t(ai.running ? 'Improving the translation with {model}…' : 'Translation improved by {model}', { model }) : '';
  }

  // The AI can't be reached: said at the top too, with what to check. Google's
  // translation doesn't depend on it, only Improve does.
  function aiProblem(error, found) {
    $('aiSummary').textContent = t('Not connected');
    $('aiSummary').classList.add('error');
    showAlert({
      id: 'ai',
      title: t('{name} isn’t working', { name: t(SubSettings.AI[translator].name) }),
      text: error + ' ' + t('Google’s translation still works, only Improve needs the AI.'),
      // Found at its usual address: fixed from here. Otherwise to the field that's wrong.
      main: found ? t('Use {url}', { url: found.url.replace(/^https?:\/\//, '') }) : t('Show settings'),
      onMain: found ? () => useAddress(found.url) : () => {
        showTab($('tabSubs'));
        $('aiDetails').open = true;
        const field = !$('urlMsg').hidden ? $('localUrl') : $('aiDetails');
        field.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (field === $('localUrl')) field.focus({ preventScroll: true });
      },
      tips: translator === 'local' ? [
        t('Start Ollama (open the app), or turn on the server in LM Studio.'),
        t('Check the address: Ollama uses `http://localhost:11434`, LM Studio `http://localhost:1234`.'),
        t('See which models are installed. In Terminal: `ollama list`'),
        t('If the server refuses the extension, allow it with OLLAMA_ORIGINS.'),
      ] : [
        t('Check that the API key is copied whole, with no spaces.'),
        t('Check that the account has credit or billing turned on.'),
        t('Check your internet connection.'),
      ],
    });
  }

  // Fills the model list from what the key or the local server offers.
  let modelsAsked = 0;
  // The line on top of the AI settings: connecting, connected, or not.
  function aiStatus(state, text) {
    $('aiStatus').hidden = false;
    $('aiStatus').className = 'ai-status' + (state ? ' ' + state : '');
    $('aiStatusText').textContent = text;
    $('aiRetry').hidden = state !== 'bad';
  }
  $('aiRetry').addEventListener('click', () => loadModels());

  // Nothing answers at the address: said under the address, not at the model
  // list (empty then, and not what's wrong). found: Ollama or LM Studio answers
  // at its usual address instead, one click away.
  function addressProblem(error, found) {
    $('localUrl').setAttribute('aria-invalid', 'true');
    $('urlMsg').textContent = error;
    $('urlMsg').hidden = false;
    $('urlFound').hidden = !found;
    if (found) {
      $('urlFoundText').textContent = t('{name} is running at {url}', { name: found.name, url: found.url.replace(/^https?:\/\//, '') });
      $('urlUse').textContent = t('Use');
      $('urlUse').onclick = () => useAddress(found.url);
    }
    $('aiModel').replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: t('Connect first') }));
    $('aiModel').disabled = true;
    $('aiDetails').open = true;
  }
  function clearAddressProblem() {
    $('localUrl').removeAttribute('aria-invalid');
    $('urlMsg').hidden = true;
    $('urlFound').hidden = true;
    $('aiModel').disabled = false;
  }
  async function useAddress(url) {
    $('localUrl').value = url;
    await SubSettings.saveTranslation({ localUrl: url });
    renderTranslator();
  }

  async function loadModels() {
    const ask = ++modelsAsked;
    const saved = (await SubSettings.loadTranslation())[modelKey()];
    $('aiModel').replaceChildren();
    clearAddressProblem();
    $('aiSummary').textContent = saved || '';
    aiStatus('', t('Connecting…'));
    aiMsg('');
    const res = await chrome.runtime.sendMessage({ type: 'ai-models' }).catch((e) => ({ ok: false, error: e.message }));
    if (ask !== modelsAsked) return;
    if (!res || !res.ok) {
      const error = res ? res.error : t('Translation failed.');
      aiStatus('bad', t('Not connected'));
      if (isDeadError(error)) {
        showDead();
        return aiMsg(t('The extension’s background part isn’t running. Press Restart at the top.'), true);
      }
      aiProblem(error, res && res.found);
      if (res && res.unreachable) return addressProblem(error, res.found);
      return aiMsg(error, true);
    }
    if (!res.models.length) {
      const error = translator === 'local' ? t('No models installed. In Terminal run: ollama pull gemma3:12b') : t('No models found for this key.');
      aiStatus('bad', t('Connected, but no models'));
      aiProblem(error);
      return aiMsg(error, true);
    }
    aiStatus('ok', t('Connected'));
    hideAlert('ai');
    $('aiSummary').classList.remove('error');
    $('aiModel').replaceChildren(...res.models.map((m) => Object.assign(document.createElement('option'), { value: m, textContent: m })));
    const pick = SubSettings.pickModel(translator, res.models, saved);
    $('aiModel').value = pick;
    $('aiSummary').textContent = pick;
    if (pick !== saved) await SubSettings.saveTranslation({ [modelKey()]: pick });
    aiMsg('');
    renderImprove();
  }

  function renderTranslator() {
    for (const b of document.querySelectorAll('[data-translator]')) {
      // aria-checked for screen readers, aria-selected for the shared segmented style.
      b.setAttribute('aria-checked', String(b.dataset.translator === translator));
      b.setAttribute('aria-selected', String(b.dataset.translator === translator));
    }
    $('translatorHint').textContent = t(TRANSLATOR_HINTS[translator] || TRANSLATOR_HINTS.google);
    $('geminiFields').hidden = translator !== 'gemini';
    $('claudeFields').hidden = translator !== 'claude';
    $('openaiFields').hidden = translator !== 'openai';
    $('localFields').hidden = translator !== 'local';
    const keyField = SubSettings.AI[translator] && SubSettings.AI[translator].key;
    const needsKey = !!keyField && !$(keyField).value.trim();
    // The AI settings stay folded once set up (the model shows on the fold); a missing key opens them.
    $('aiDetails').hidden = translator === 'google';
    if (translator === 'google') hideAlert('ai');
    $('aiStatus').hidden = true;
    clearAddressProblem();
    $('aiSummary').classList.remove('error');
    if (needsKey) {
      $('aiDetails').open = true;
      $('aiSummary').textContent = '';
    }
    $('modelField').hidden = translator === 'google' || needsKey;
    if (!$('modelField').hidden) loadModels();
    renderImprove();
  }
  for (const b of document.querySelectorAll('[data-translator]')) {
    b.addEventListener('click', async () => {
      translator = b.dataset.translator;
      await SubSettings.saveTranslation({ translator });
      renderTranslator();
    });
  }
  $('geminiKey').addEventListener('change', async () => {
    await SubSettings.saveTranslation({ geminiKey: $('geminiKey').value.trim() });
    renderTranslator();
  });
  $('claudeKey').addEventListener('change', async () => {
    await SubSettings.saveTranslation({ claudeKey: $('claudeKey').value.trim() });
    renderTranslator();
  });
  $('openaiKey').addEventListener('change', async () => {
    await SubSettings.saveTranslation({ openaiKey: $('openaiKey').value.trim() });
    renderTranslator();
  });
  $('localUrl').addEventListener('change', async () => {
    await SubSettings.saveTranslation({ localUrl: $('localUrl').value.trim() || SubSettings.TRANSLATION.localUrl });
    renderTranslator();
  });
  $('aiModel').addEventListener('change', () => {
    $('aiSummary').textContent = $('aiModel').value;
    SubSettings.saveTranslation({ [modelKey()]: $('aiModel').value });
    renderImprove();
  });
  renderTranslator();

  function renderTranslate(l) {
    const showing = l.translatedTo;
    $('translatedRow').hidden = !showing;
    $('translatedLang').textContent = showing ? SubSettings.languageName(showing) : '';
    // Already showing the picked language: nothing to translate.
    $('translateBtn').hidden = showing === lang;
    $('translateBtn').textContent = t('Translate to {lang}', { lang: SubSettings.languageName(lang) });
    renderImprove();
  }

  function translateMsg(text) {
    $('translateMsg').hidden = !text;
    $('translateMsg').textContent = text || '';
  }

  // Asks the frame with the subtitles to translate them (the background does the Google request).
  async function translateLoaded(frameId) {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'translate', to: lang }, { frameId })
      .catch(() => ({ ok: false, error: t('The page didn’t answer. Reload the page and try again.') }));
    await scan();
    return res;
  }

  $('lang').addEventListener('change', async () => {
    lang = $('lang').value;
    await SubSettings.saveTranslation({ translateTo: lang });
    translateMsg('');
    const lf = loadedFrame();
    if (lf) renderTranslate(lf.report.loaded);
    renderCaptured();
    renderLangChip();
    if (googleFonts.length) renderFonts();
    renderPreview(true);
  });

  $('translateBtn').addEventListener('click', async () => {
    const lf = loadedFrame();
    if (!lf) return;
    const b = $('translateBtn');
    b.disabled = true;
    b.textContent = t('Translating…');
    translateMsg('');
    const res = await translateLoaded(lf.frameId);
    b.disabled = false;
    const lf2 = loadedFrame();
    if (lf2) renderTranslate(lf2.report.loaded);
    if (!res || !res.ok) translateMsg(res ? res.error : t('Translation failed.'));
  });

  // The page starts the AI on the translation it shows (the background does the requests).
  $('improveBtn').addEventListener('click', async () => {
    const lf = loadedFrame();
    if (!lf) return;
    $('improveBtn').disabled = true;
    translateMsg('');
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'improve' }, { frameId: lf.frameId })
      .catch(() => ({ ok: false, error: t('The page didn’t answer. Reload the page and try again.') }));
    await scan();
    $('improveBtn').disabled = false;
    if (!res || !res.ok) translateMsg(res ? res.error : t('Translation failed.'));
  });

  $('showOriginal').addEventListener('click', async () => {
    const lf = loadedFrame();
    if (lf) await chrome.tabs.sendMessage(tab.id, { type: 'show-original' }, { frameId: lf.frameId }).catch(() => {});
    scan();
  });

  // The background queue: its own tab, so it keeps going while the popup is closed.
  for (const [id, hash] of [['openBatch', ''], ['openSaved', '#saved']]) {
    $(id).addEventListener('click', () => { chrome.tabs.create({ url: chrome.runtime.getURL('batch.html' + hash) }); window.close(); });
  }

  $('downloadTranslated').addEventListener('click', async () => {
    const lf = loadedFrame();
    const file = lf && await chrome.tabs.sendMessage(tab.id, { type: 'export' }, { frameId: lf.frameId }).catch(() => null);
    if (file) await download(file, 'srt').catch((e) => translateMsg(e.message));
  });

  // ---------- rating card ----------

  // Under the translation from the 10th translated video on (background.js counts
  // them, each page once). Not now asks again 25 videos later and a second Not now
  // ends it; rating or sharing ends it too.
  const STORE_URL = 'https://chromewebstore.google.com/detail/subtitle-overlay/kfiihdconjdcclppmdhopeejkbmkkalo';
  const RATE_FIRST = 10, RATE_AGAIN = 25;
  let { stats, rateAsk = {} } = await chrome.storage.local.get(['stats', 'rateAsk']);
  let rateState = ''; // '' until it shows in this popup, then 'ask', 'thanks' or 'gone'

  function renderRate(l) {
    if (rateState === 'thanks' || rateState === 'gone') return;
    const show = !!(l && l.translatedTo) && !rateAsk.done && !!stats && stats.videos >= (rateAsk.next || RATE_FIRST);
    $('rateCard').hidden = !show;
    if (!show || rateState) return;
    rateState = 'ask';
    $('rateCount').textContent = stats.videos;
    $('rateVideos').textContent = t('{n} videos translated', { n: stats.videos });
    $('rateLines').textContent = t('That’s {count} translated lines. Nice!', { n: stats.lines, count: stats.lines.toLocaleString(SubI18n.lang) });
    $('rateCard').classList.add('enter');
  }
  // The 10th video translated while the popup is open.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.stats) return;
    stats = changes.stats.newValue;
    const lf = loadedFrame();
    renderRate(lf && lf.report.loaded);
  });

  const endRate = () => chrome.storage.local.set({ rateAsk: Object.assign(rateAsk, { done: true }) });

  // The thank-you takes the question's place; the card's height glides to the new one.
  function showRateThanks() {
    const card = $('rateCard');
    const from = card.offsetHeight;
    $('rateQuestion').hidden = true;
    $('rateThanks').hidden = false;
    $('rateThanks').classList.add('enter');
    const to = card.offsetHeight;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      card.animate([{ height: from + 'px' }, { height: to + 'px' }], { duration: 240, easing: 'cubic-bezier(.25, 1, .5, 1)' });
    }
  }

  function closeRate() {
    if (rateState === 'ask') {
      const closed = (rateAsk.closed || 0) + 1;
      Object.assign(rateAsk, closed > 1 ? { closed, done: true } : { closed, next: stats.videos + RATE_AGAIN });
      chrome.storage.local.set({ rateAsk });
    }
    rateState = 'gone';
    $('rateCard').hidden = true;
    $('pick').focus();
  }
  $('rateClose').addEventListener('click', closeRate);
  $('rateLater').addEventListener('click', closeRate);

  // The Web Store opens in a new tab, which closes the popup: saved first.
  $('rateStore').addEventListener('click', async (e) => {
    e.preventDefault();
    await endRate();
    chrome.tabs.create({ url: $('rateStore').href });
    window.close();
  });

  $('rateShare').addEventListener('click', async () => {
    const label = $('rateShare').lastChild;
    try { await navigator.clipboard.writeText(STORE_URL); }
    catch (e) {
      const text = label.textContent;
      label.textContent = t('Copy failed');
      setTimeout(() => { label.textContent = text; }, 1500);
      return;
    }
    await endRate();
    rateState = 'thanks';
    showRateThanks();
  });

  // ---------- found subtitles ----------

  let capturedItems = [];
  const details = new Map(); // id -> details or { error }

  async function refreshCaptured() {
    capturedItems = await chrome.runtime.sendMessage({ type: 'get-captured', tabId: tab.id }).catch(() => []) || [];
    renderCaptured();
    for (const item of capturedItems) {
      if (details.has(item.id)) continue;
      details.set(item.id, item.details || null);
      if (item.details) continue;
      chrome.runtime.sendMessage({ type: 'item-details', tabId: tab.id, id: item.id }).then((res) => {
        details.set(item.id, res && res.ok ? res.details : { error: res ? res.error : t('Failed.') });
        if (res && res.lang) item.lang = res.lang;
        renderCaptured();
      });
    }
  }

  // Episode name from the page (top frame first), shown as the card title;
  // the file name moves into the line under it.
  function episodeTitle() {
    const top = (frames || []).find((f) => f.frameId === 0);
    return (top && top.report.title) || ((frames || []).find((f) => f.report.title) || { report: {} }).report.title || '';
  }

  function renderCaptured() {
    const box = $('captured');
    const cards = [];
    const episode = episodeTitle();
    for (const item of capturedItems) {
      const d = details.get(item.id);
      const file = item.name || decodeURIComponent(item.url.split(/[?#]/)[0].split('/').pop() || item.url);
      let meta;
      if (!d) meta = t('Checking…');
      else if (d.error) meta = d.error;
      else if (item.kind === 'hls') meta = t('Streaming subtitles') + (d.count ? ' · ' + t('{n} lines', { n: d.count }) : d.pieces ? ' · ' + t('{n} pieces', { n: d.pieces }) : '') + (d.preview ? ' · "' + d.preview + '"' : '');
      else meta = t('{n} lines', { n: d.count }) + (d.preview ? ' · "' + d.preview + '"' : '');
      if (episode) meta = file + ' · ' + meta;
      cards.push(card(item.lang, episode || file, meta, item.url, () => fetchNetworkItem(item)));
    }
    for (const v of allVideos()) {
      for (const tr of v.tracks) {
        const meta = t('{n} lines', { n: tr.count }) + (tr.preview ? ' · "' + tr.preview + '"' : '') + ' · ' + t('from the player');
        cards.push(card(tr.language, tr.label || t('Player track {n}', { n: tr.index + 1 }), meta, '', async () => {
          const res = await chrome.tabs.sendMessage(tab.id, { type: 'track-vtt', videoIndex: v.index, trackIndex: tr.index }, { frameId: v.frameId }).catch(() => null);
          if (!res || !res.text) return { ok: false, error: t('The track has no lines yet.') };
          return { ok: true, name: (tr.label || tr.language || 'track') + '.vtt', b64: SubLib.bytesToBase64(new TextEncoder().encode(res.text)) };
        }));
      }
    }
    if (!cards.length) {
      const p = document.createElement('div');
      p.className = 'empty';
      p.textContent = t('No subtitle files seen yet. Turn on subtitles in the site’s own player (for example the CC button on Prima+), let it play a moment, then open this again.');
      cards.push(p);
    }
    box.replaceChildren(...cards);
  }

  function fetchNetworkItem(item) {
    return chrome.runtime.sendMessage({ type: 'fetch-item', tabId: tab.id, id: item.id })
      .catch((e) => ({ ok: false, error: e.message }));
  }

  // One found file: language, title, line count + preview, and three actions.
  function card(badgeText, title, meta, url, getFile) {
    const c = document.createElement('div');
    c.className = 'item';
    const head = document.createElement('div');
    head.className = 'item-head';
    if (badgeText) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = (SubSettings.flag(badgeText) + ' ' + badgeText).trim();
      head.append(b);
    }
    const name = document.createElement('span');
    name.className = 'item-title';
    name.textContent = title;
    if (url) name.title = url;
    head.append(name);
    const m = document.createElement('div');
    m.className = 'item-meta';
    m.textContent = meta;
    m.title = meta;
    const row = document.createElement('div');
    row.className = 'row';
    const err = document.createElement('div');
    err.className = 'error';

    const run = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', async () => {
        err.textContent = '';
        b.disabled = true;
        const old = b.textContent;
        b.textContent = '…';
        try {
          const file = await getFile();
          if (!file || !file.ok) throw new Error(file ? file.error : t('Failed.'));
          await fn(file);
        } catch (e) {
          err.textContent = e.message;
        }
        b.disabled = false;
        b.textContent = old;
      });
      return b;
    };

    row.append(
      run(t('Use as overlay'), async (file) => {
        const res = await loadIntoPage(file.name, file.b64);
        if (!res.ok) throw new Error(res.error);
      }),
      run(t('Download .vtt'), async (file) => { await download(file, 'vtt'); c.append(translateNote()); }),
      run(t('Download .srt'), async (file) => { await download(file, 'srt'); c.append(translateNote()); }),
      run(t('Translate to {lang}', { lang: SubSettings.languageName(lang) }), async (file) => {
        const res = await loadIntoPage(file.name, file.b64);
        if (!res.ok) throw new Error(res.error);
        const lf = loadedFrame();
        const tr = lf ? await translateLoaded(lf.frameId) : { ok: false, error: t('The subtitles didn’t reach the video.') };
        if (!tr || !tr.ok) throw new Error(tr ? tr.error : t('Translation failed.'));
      }),
      run(t('Add to queue'), async (file) => { await addToQueue(file); c.append(queueNote()); }),
    );
    c.append(head, m, row, err);
    return c;
  }

  // The translation queue translates the file in its own tab while you watch
  // something else, and remembers this page: its Play button brings you back
  // here with the translation on the video. The queue tab opens behind this
  // one if it isn't open yet (it only runs while open).
  async function addToQueue(file) {
    const lines = SubLib.parse(SubLib.decode(SubLib.base64ToBytes(file.b64), 'auto').text)
      .map((c) => ({ start: c.start, end: c.end, text: c.text }));
    if (!lines.length) throw new Error(t('No subtitle lines found.'));
    // The background names the file and opens the queue (as for the card over the video).
    const res = await chrome.runtime.sendMessage({ type: 'add-to-queue', tabId: tab.id, lines, lang, title: episodeTitle(), fileName: file.name });
    if (!res || !res.ok) throw new Error(res ? res.error : t('Failed.'));
  }
  const queueView = () => chrome.extension.getViews({ type: 'tab' }).find((v) => v.location.pathname === '/batch.html');

  // After "Add to queue": "Added to the translation queue. Open the queue ↗"
  function queueNote() {
    document.querySelectorAll('.translate').forEach((n) => n.remove());
    const p = document.createElement('div');
    p.className = 'translate';
    const done = document.createElement('div');
    done.className = 'saved';
    done.textContent = t('Added to the translation queue');
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = t('Open the queue') + ' ↗';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const view = queueView();
      if (!view) return chrome.tabs.create({ url: chrome.runtime.getURL('batch.html') });
      view.chrome.tabs.getCurrent((there) => {
        if (!there) return;
        chrome.tabs.update(there.id, { active: true });
        chrome.windows.update(there.windowId, { focused: true });
      });
    });
    p.append(done, a);
    return p;
  }

  // After a download: "Saved to Downloads. Translate it ↗"
  function translateNote() {
    document.querySelectorAll('.translate').forEach((n) => n.remove());
    const p = document.createElement('div');
    p.className = 'translate';
    const done = document.createElement('div');
    done.className = 'saved';
    done.textContent = t('Saved to Downloads');
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = t('Translate it on translate-subtitles.com') + '\u00a0↗';
    a.addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.sendMessage({ type: 'open-translator' }); });
    p.append(done, a);
    return p;
  }

  async function download(file, format) {
    const { text } = SubLib.decode(SubLib.base64ToBytes(file.b64), 'auto');
    const cues = SubLib.parse(text);
    if (!cues.length) throw new Error(t('No subtitle lines found.'));
    const out = format === 'srt' ? SubLib.toSRT(cues) : SubLib.toVTT(cues);
    const base = file.name.replace(SubLib.SUB_FILE, '');
    SubLib.saveText(out, base + '.' + format);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'captured-changed' && msg.tabId === tab.id) refreshCaptured();
  });

  // ---------- settings ----------

  const controls = [...document.querySelectorAll('[data-key]')];

  function showSettings() {
    for (const c of controls) {
      const v = settings[c.dataset.key];
      if (c.type === 'checkbox') c.checked = !!v;
      else c.value = v;
    }
    for (const r of document.querySelectorAll('input[type=range]')) paintRange(r);
    for (const o of document.querySelectorAll('output[data-for]')) {
      o.textContent = settings[o.dataset.for] + (o.dataset.unit || ' px');
    }
    $('offset').value = settings.offset;
    $('offsetReset').disabled = !settings.offset;
    $('distanceSetting').hidden = settings.place === 'middle';
    $('distanceLabel').textContent = t(settings.place === 'top' ? 'Distance from top' : 'Distance from bottom');
    $('dualSetting').hidden = $('secondLangSetting').hidden = !settings.dual;
    $('dualLabel').textContent = t(settings.place === 'top' ? 'Second subtitles: distance from bottom' : 'Second subtitles: distance from top');
    renderPreview();
    renderPresets();
    showColors();
    if (googleFonts.length) renderFonts();
    SubRender.ensureFont(document, settings.font).then(renderPreview, () => {});
  }

  // The filled part of a slider's track: up to the thumb, or between 0 and
  // the thumb on a slider that goes below 0 (the shadow's X and Y).
  function paintRange(r) {
    const min = Number(r.min) || 0, max = Number(r.max) || 100;
    const at = (v) => ((v - min) / (max - min)) * 100 + '%';
    const zero = Math.max(min, 0), v = Number(r.value);
    r.style.setProperty('--from', at(Math.min(zero, v)));
    r.style.setProperty('--fill', at(Math.max(zero, v)));
  }

  // Save at most once per frame while a slider is being dragged.
  let pending = {}, queued = false;
  function queueSave(patch) {
    Object.assign(pending, patch);
    Object.assign(settings, patch);
    showSettings();
    if (queued) return;
    queued = true;
    requestAnimationFrame(async () => {
      queued = false;
      const p = pending;
      pending = {};
      settings = await SubSettings.save(p);
      showSettings();
    });
  }

  for (const c of controls) {
    c.addEventListener('input', () => {
      const key = c.dataset.key;
      let value = c.type === 'checkbox' ? c.checked : c.value;
      if (c.type === 'range' || c.type === 'number' || key === 'weight') value = Number(value);
      if (c.type === 'number' && c.value === '') return;
      queueSave({ [key]: c.type === 'number' || c.type === 'range' ? SubSettings.clamp(key, value) : value });
    });
  }

  for (const b of document.querySelectorAll('[data-offset]')) {
    b.addEventListener('click', () => queueSave({ offset: SubSettings.clamp('offset', settings.offset + Number(b.dataset.offset)) }));
  }
  $('offset').addEventListener('change', () => queueSave({ offset: SubSettings.clamp('offset', $('offset').value) }));
  $('offsetReset').addEventListener('click', () => queueSave({ offset: 0 }));

  $('resetAll').addEventListener('click', async () => {
    settings = await SubSettings.reset();
    showSettings();
  });

  // ---------- colours ----------

  // The four colour buttons share one popover: fixed swatches, the colours
  // picked last, and the system picker or a typed code for anything else.
  const colorButtons = [...document.querySelectorAll('[data-color]')];
  const colorPop = $('colorPop');
  let colorKey = null; // the setting the open popover changes
  let recentColors = await SubSettings.loadRecentColors();

  // "#ffe600", "FFE600" or "#fe0" -> "#ffe600"; anything else -> ''.
  function hexColor(text) {
    let h = String(text).trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(h)) h = h.replace(/./g, '$&$&');
    return /^[0-9a-f]{6}$/.test(h) ? '#' + h : '';
  }

  function swatch(hex, name) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.value = hex;
    b.style.setProperty('--c', hex);
    b.title = name;
    b.setAttribute('aria-label', name);
    b.addEventListener('click', () => setColor(hex));
    return b;
  }
  $('colorPresets').append(...SubSettings.COLORS.map(([hex, name]) => swatch(hex, t(name))));

  function renderRecent() {
    $('colorRecent').replaceChildren(...recentColors.map((hex) => swatch(hex, hex.toUpperCase())));
    $('colorRecent').hidden = $('colorRecentLabel').hidden = !recentColors.length;
  }

  // The buttons show their colour; the open popover marks the current one.
  function showColors() {
    for (const b of colorButtons) b.style.setProperty('--c', settings[b.dataset.color]);
    if (!colorKey) return;
    const now = String(settings[colorKey]).toLowerCase();
    for (const s of colorPop.querySelectorAll('.swatch')) s.setAttribute('aria-pressed', String(s.dataset.value === now));
    $('colorAny').value = now;
    if (document.activeElement !== $('colorHex')) $('colorHex').value = now.toUpperCase();
  }

  function aimColors(button) {
    colorKey = button.dataset.color;
    for (const b of colorButtons) b.classList.toggle('anchor', b === button);
    colorPop.setAttribute('aria-label', button.getAttribute('aria-label'));
    renderRecent();
    showColors();
  }

  for (const b of colorButtons) {
    // The button opens and closes the popover itself (popovertarget). Another
    // colour's button while it is open switches to that colour instead.
    b.addEventListener('click', (e) => {
      if (!colorPop.matches(':popover-open')) aimColors(b);
      else if (colorKey !== b.dataset.color) { e.preventDefault(); aimColors(b); }
    });
  }
  function setColor(hex) {
    if (colorKey) queueSave({ [colorKey]: hex });
  }

  async function rememberColor(hex) {
    recentColors = await SubSettings.addRecentColor(hex);
    renderRecent();
    showColors();
  }

  // The system picker changes the colour live. Its colour is remembered when
  // it closes, or when the popover does (the picker may still be open then).
  let picked = '';
  $('colorAny').addEventListener('input', () => { picked = $('colorAny').value; setColor(picked); });
  $('colorAny').addEventListener('change', () => { if (picked) rememberColor(picked); picked = ''; });
  colorPop.addEventListener('toggle', (e) => {
    if (e.newState !== 'closed') return;
    if (picked) rememberColor(picked);
    picked = '';
    colorKey = null;
  });

  // A typed code applies once it has all six digits; a short one like #FE0 on Enter.
  $('colorHex').addEventListener('input', () => {
    if (/^#?[0-9a-f]{6}$/i.test($('colorHex').value.trim())) setColor(hexColor($('colorHex').value));
  });
  $('colorHex').addEventListener('change', () => {
    const hex = hexColor($('colorHex').value);
    if (hex) { setColor(hex); rememberColor(hex); }
    if (colorKey) $('colorHex').value = String(settings[colorKey]).toUpperCase();
  });

  // ---------- presets ----------

  let userPresets = await SubSettings.loadPresets();
  // The preset picked last ("b:clean" built in, "u:<name>" your own). Several
  // presets can have the same values; only this one is marked, while it still matches.
  let { activePreset } = await chrome.storage.local.get('activePreset');
  function pickPreset(id) {
    activePreset = id;
    chrome.storage.local.set({ activePreset: id });
  }
  const builtIn = [...document.querySelectorAll('[data-preset]')];
  for (const b of builtIn) {
    b.addEventListener('click', () => { pickPreset('b:' + b.dataset.preset); queueSave(SubSettings.PRESETS[b.dataset.preset]); });
  }

  const matches = (values) => Object.keys(values).every((k) => settings[k] === values[k]);

  // One preset at most: the one picked last if it still matches, else the
  // newest of your own that matches (it covers more than a built-in), else a built-in.
  function markedPreset() {
    const all = [...builtIn.map((b) => ['b:' + b.dataset.preset, SubSettings.PRESETS[b.dataset.preset]]),
      ...userPresets.map((p) => ['u:' + p.name, p.values])];
    const hits = all.filter(([, values]) => matches(values)).map(([id]) => id);
    if (hits.includes(activePreset)) return activePreset;
    return hits.filter((id) => id.startsWith('u:')).pop() || hits[0] || '';
  }

  function renderPresets() {
    const box = $('presets');
    box.querySelectorAll('.user').forEach((n) => n.remove());
    const marked = markedPreset();
    for (const b of builtIn) b.classList.toggle('on', marked === 'b:' + b.dataset.preset);
    for (const p of userPresets) {
      const b = document.createElement('button');
      b.className = 'user' + (marked === 'u:' + p.name ? ' on' : '');
      const name = document.createElement('span');
      name.textContent = p.name;
      const del = document.createElement('i');
      del.textContent = '×';
      del.title = t('Delete preset "{name}"', { name: p.name });
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        userPresets = await SubSettings.deletePreset(p.name);
        renderPresets();
      });
      b.append(name, del);
      b.addEventListener('click', () => { pickPreset('u:' + p.name); queueSave(Object.assign({}, p.values)); });
      box.append(b);
    }
    showUpdate(marked);
  }

  // Picked one of your own presets and then changed something: offer to
  // write the change back into it, so you don't need a new preset.
  function editedPreset(marked) {
    if (!activePreset || !activePreset.startsWith('u:') || marked === activePreset) return null;
    return userPresets.find((p) => 'u:' + p.name === activePreset) || null;
  }
  function showUpdate(marked) {
    const p = editedPreset(marked);
    const btn = $('presetUpdate');
    btn.hidden = !p || !$('saveForm').hidden;
    if (p) btn.textContent = t('Update "{name}"', { name: p.name });
    // With Update on offer, a new preset is the second choice.
    $('presetNew').classList.toggle('primary', btn.hidden);
    $('presetNew').classList.toggle('ghost', !btn.hidden);
  }
  $('presetUpdate').addEventListener('click', async () => {
    const p = editedPreset(markedPreset());
    if (!p) return;
    userPresets = await SubSettings.savePreset(p.name, settings);
    renderPresets();
  });

  function toggleSaveForm(open) {
    $('saveForm').hidden = !open;
    $('presetNew').hidden = open;
    showUpdate(markedPreset());
    if (open) {
      $('presetName').value = t('My preset {n}', { n: userPresets.length + 1 });
      $('presetName').select();
    }
  }
  async function savePreset() {
    const name = $('presetName').value.trim();
    if (!name) return $('presetName').focus();
    userPresets = await SubSettings.savePreset(name, settings);
    pickPreset('u:' + name);
    toggleSaveForm(false);
    renderPresets();
    $('presets').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  $('presetNew').addEventListener('click', () => toggleSaveForm(true));
  $('presetCancel').addEventListener('click', () => toggleSaveForm(false));
  $('presetSave').addEventListener('click', savePreset);
  $('presetName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') savePreset();
    if (e.key === 'Escape') { e.preventDefault(); toggleSaveForm(false); }
  });

  // ---------- font picker ----------

  const SYSTEM_FONTS = [['sans', t('System sans')], ['serif', t('Serif')], ['mono', t('Monospace')]];
  const CATEGORY = { s: t('Sans'), r: t('Serif'), d: t('Display'), h: t('Handwriting'), m: t('Mono') };
  let googleFonts = [];
  fetch('lib/google-fonts.json').then((r) => r.json()).then((list) => { googleFonts = list; renderFonts(); });
  const fontFilter = { cat: '', cs: true, lang: true };
  // The second letter chip follows the language you translate into.
  const langNeed = () => SubSettings.language(lang)[2];
  const hasAlphabet = (f, need) => !need || (f[5] || '').includes(need);
  function renderLangChip() {
    const [, , need, sample] = SubSettings.language(lang);
    const name = SubSettings.languageName(lang);
    // Plain latin (Italian, German...) fits every font; Czech has its own chip already.
    $('needLang').hidden = !need || lang === 'cs';
    $('needLang').textContent = sample;
    $('needLang').title = t('Only fonts that have {lang} letters (your translation language)', { lang: name });
    $('needLang').classList.toggle('on', fontFilter.lang);
  }

  function renderFonts() {
    const q = $('fontSearch').value.trim().toLowerCase();
    const rows = [];
    const row = (value, label, tags) => {
      const b = document.createElement('button');
      b.className = 'font-row' + (settings.font === value ? ' on' : '');
      b.setAttribute('role', 'option');
      const n = document.createElement('span');
      n.className = 'name';
      n.textContent = label;
      b.append(n);
      for (const t of tags) {
        const s = document.createElement('span');
        s.className = 'tag';
        s.textContent = t;
        b.append(s);
      }
      b.addEventListener('click', () => pickFont(value));
      rows.push(b);
    };
    if (!q && !fontFilter.cat) for (const [v, l] of SYSTEM_FONTS) row(v, l, [t('built in')]);
    const hits = googleFonts.filter((f) => (!q || f[0].toLowerCase().includes(q))
      && (!fontFilter.cat || f[1] === fontFilter.cat) && (!fontFilter.cs || f[3])
      && ($('needLang').hidden || !fontFilter.lang || hasAlphabet(f, langNeed())));
    // The current font stays visible at the top even when the filters hide it.
    const current = SubRender.isGoogle(settings.font) && googleFonts.find((f) => f[0] === SubRender.googleName(settings.font));
    const shown = hits.slice(0, 60);
    if (current && !shown.includes(current) && !q) shown.unshift(current);
    const code = lang.split('-')[0].toUpperCase();
    for (const f of shown) {
      row('g:' + f[0], f[0], [CATEGORY[f[1]]].concat(f[3] ? ['CZ'] : [], langNeed() && lang !== 'cs' && hasAlphabet(f, langNeed()) ? [code] : []));
    }
    if (hits.length > shown.length) {
      const more = document.createElement('div');
      more.className = 'more';
      more.textContent = t('{n} more, type to search', { n: hits.length - 60 });
      rows.push(more);
    }
    if (!rows.length) {
      const none = document.createElement('div');
      none.className = 'more';
      none.textContent = t('No font matches.');
      rows.push(none);
    }
    $('fontList').replaceChildren(...rows);
  }

  // Downloads the font right away and asks the page to switch to it, so you see
  // whether it really reached the video (an old copy of the page script, left
  // over after the extension was updated, never answers).
  async function pickFont(value) {
    queueSave({ font: value });
    const status = $('fontStatus');
    const say = (text, kind) => {
      if (settings.font !== value) return; // another font was picked meanwhile
      status.hidden = false;
      status.className = 'font-status' + (kind ? ' ' + kind : '');
      status.textContent = text;
    };
    if (!SubRender.isGoogle(value)) { status.hidden = true; return; }
    const name = SubRender.googleName(value);
    say(t('Downloading {name}…', { name }));
    try {
      await SubRender.ensureFont(document, value);
      renderPreview();
      const lf = loadedFrame();
      if (!lf) return say(t('{name} is ready. It is used as soon as subtitles are on.', { name }), 'ok');
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'use-font', font: value }, { frameId: lf.frameId }).catch(() => null);
      if (res && res.ok) say(t('{name} is on the video.', { name }), 'ok');
      else if (res) throw new Error(res.error);
      else say(t('The page didn’t answer. Reload the page (needed after the extension is updated), your subtitles come back on their own.'), 'error');
    } catch (e) {
      say(t('Couldn’t load {name}: {error}', { name, error: e.message }), 'error');
    }
  }

  $('fontSearch').addEventListener('input', renderFonts);
  for (const b of document.querySelectorAll('[data-cat]')) {
    b.addEventListener('click', () => {
      fontFilter.cat = b.dataset.cat;
      document.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x === b));
      renderFonts();
    });
  }
  for (const [id, key] of [['needCs', 'cs'], ['needLang', 'lang']]) {
    $(id).addEventListener('click', () => {
      fontFilter[key] = !fontFilter[key];
      $(id).classList.toggle('on', fontFilter[key]);
      renderFonts();
    });
  }
  renderLangChip();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings || queued) return;
    settings = SubSettings.withDefaults(changes.settings.newValue);
    showSettings();
  });

  // Slider rows: the label column fits the longest label in this language
  // ("Innenabstand" in German), measured while the Style tab shows.
  function fitLabels() {
    const w = Math.max(54, ...[...document.querySelectorAll('.sub > span')].map((e) => e.scrollWidth));
    $('panelStyle').style.setProperty('--label-w', w + 'px');
  }
  onStyleShown = () => { fitLabels(); renderPreview(); };
  if ($('panelStyle').classList.contains('active')) fitLabels();

  function renderPreview(fresh) {
    if ($('preview').hidden) return;
    const el = $('previewSubs');
    if (fresh) el.replaceChildren();
    // The preview pretends to be a 540 px tall player, so scaled text is readable.
    SubRender.applyStyle(el, settings, 540, $('preview').clientWidth || 352);
    if (!el.childNodes.length) SubRender.renderCues(el, [{ text: SubSettings.previewText(lang) }]);
  }

  // Mac keyboards say Option and Shift with symbols; draw the keys the same way.
  if (/Mac/i.test(navigator.platform)) {
    document.querySelectorAll('kbd[data-mod=alt]').forEach((k) => { k.textContent = '\u2325'; k.title = 'Option'; });
    document.querySelectorAll('kbd[data-mod=shift]').forEach((k) => { k.textContent = '\u21e7'; k.title = 'Shift'; });
    $('keysNote').textContent = t('⌥ is Option, ⇧ is Shift. Shortcuts work on the page, not inside this popup.');
  }

  // ---------- keyboard shortcuts ----------

  // Each row's keys are a button: click it, press the new combo. Esc cancels,
  // Backspace switches the shortcut off, a combo another row uses is refused.
  const isMac = /Mac/i.test(navigator.platform);
  let shortcuts = await SubSettings.loadShortcuts();
  const defaults = SubSettings.defaultShortcuts();
  let recording = ''; // id of the row waiting for keys
  const keyRows = {};

  for (const { id, name } of SubSettings.SHORTCUTS) {
    const row = document.createElement('tr');
    const label = document.createElement('td');
    label.textContent = t(name);
    const cell = document.createElement('td');
    const combo = document.createElement('button');
    combo.className = 'combo combo-btn';
    combo.addEventListener('click', () => (recording === id ? stopRecording() : startRecording(id)));
    const reset = document.createElement('button');
    reset.className = 'ghost key-btn';
    reset.textContent = '\u21ba';
    reset.title = reset.ariaLabel = t('Reset');
    reset.addEventListener('click', () => saveShortcut(id, Object.assign({}, defaults[id])));
    cell.append(reset, combo);
    row.append(label, cell);
    $('keysTable').append(row);
    keyRows[id] = { combo, reset };
  }

  function drawShortcuts() {
    for (const { id, name } of SubSettings.SHORTCUTS) {
      const { combo, reset } = keyRows[id];
      const k = shortcuts[id];
      combo.classList.toggle('recording', recording === id);
      combo.classList.toggle('unset', !k && recording !== id);
      combo.replaceChildren();
      if (recording === id) combo.textContent = t('Press the keys…');
      else if (!k) combo.textContent = t('Off');
      else SubSettings.keyParts(k, isMac).forEach(([label, title], i) => {
        if (i) { const plus = document.createElement('i'); plus.textContent = '+'; combo.append(plus); }
        const kb = document.createElement('kbd');
        kb.textContent = label;
        if (title) kb.title = title;
        combo.append(kb);
      });
      combo.title = recording === id ? t('Cancel') : t('Change');
      combo.ariaLabel = t(name) + ': ' + (k ? SubSettings.keyText(k, isMac) : t('Off'));
      reset.hidden = SubSettings.sameKey(k, defaults[id]);
    }
    $('keysResetAll').hidden = SubSettings.SHORTCUTS.every(({ id }) => SubSettings.sameKey(shortcuts[id], defaults[id]));
  }

  function startRecording(id) {
    recording = id;
    $('keyError').hidden = true;
    drawShortcuts();
  }
  function stopRecording() {
    recording = '';
    $('keyError').hidden = true;
    drawShortcuts();
  }

  // Only what differs from the defaults is stored; 1.0.13's "toggleKey" is folded in.
  async function saveShortcut(id, k) {
    shortcuts[id] = k;
    const changed = {};
    for (const { id: i } of SubSettings.SHORTCUTS) {
      if (!SubSettings.sameKey(shortcuts[i], defaults[i])) changed[i] = shortcuts[i];
    }
    await chrome.storage.local.set({ shortcuts: changed });
    await chrome.storage.local.remove('toggleKey');
    stopRecording();
  }

  document.addEventListener('keydown', (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') return stopRecording();
    if ((e.code === 'Backspace' || e.code === 'Delete') && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      return saveShortcut(recording, null);
    }
    if (/^(Shift|Alt|Control|Meta|OS|CapsLock|Fn)/.test(e.code) || !e.code || e.code === 'Tab') return; // wait for the actual key
    const k = SubSettings.keyOf(e);
    const taken = SubSettings.shortcutFor(shortcuts, k);
    if (taken && taken !== recording) {
      $('keyError').textContent = t('Already used: {name}. Try another key.', { name: t(SubSettings.shortcutName(taken)) });
      $('keyError').hidden = false;
      return;
    }
    saveShortcut(recording, k);
  }, true);

  $('keysResetAll').addEventListener('click', async () => {
    shortcuts = SubSettings.defaultShortcuts();
    await chrome.storage.local.remove(['shortcuts', 'toggleKey']);
    stopRecording();
  });

  drawShortcuts();

  // ---------- on / off per site ----------

  const site = SubSettings.siteOf(tab.url || '');
  let offSites = await SubSettings.loadOffSites();

  function renderSite() {
    const off = SubSettings.isOff(offSites, site);
    $('siteRow').hidden = !site;
    $('siteName').textContent = site;
    $('siteOn').checked = !off;
    $('siteOn').setAttribute('aria-label', t('Subtitle Overlay on {site}', { site }));
    document.body.classList.toggle('site-off', off);
    if (off) $('status').textContent = t('Turned off on this site.');
    $('offSection').hidden = !offSites.length;
    $('offList').replaceChildren(...offSites.map((s) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = s;
      const on = document.createElement('button');
      on.textContent = t('Turn on');
      on.addEventListener('click', () => setSite(s, false));
      li.append(name, on);
      return li;
    }));
  }

  async function setSite(s, off) {
    offSites = await SubSettings.setSiteOff(s, off);
    if (off) chrome.runtime.sendMessage({ type: 'site-off', tabId: tab.id }).catch(() => {});
    renderSite();
    if (!SubSettings.isOff(offSites, site)) { await scan(); refreshCaptured(); }
  }

  // Turning off a subdomain's parent (example.com) also covers player.example.com,
  // so "on" removes whichever listed site covers this one.
  $('siteOn').addEventListener('change', () => {
    if ($('siteOn').checked) {
      const covering = offSites.filter((x) => SubSettings.isOff([x], site));
      covering.reduce((p, s) => p.then(() => setSite(s, false)), Promise.resolve());
    } else {
      setSite(site, true);
    }
  });

  // ---------- extension look (lib/theme.js applies and keeps it) ----------

  $('uiTheme').value = SubTheme.get();
  $('uiTheme').addEventListener('change', () => SubTheme.set($('uiTheme').value));

  // ---------- interface language ----------

  const { uiLang } = await chrome.storage.local.get('uiLang');
  $('uiLang').replaceChildren(...SubI18n.LOCALES.map(([code, name]) => {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = code === 'auto' ? t('Same as browser') : name;
    return o;
  }));
  $('uiLang').value = uiLang || 'auto';
  $('uiLang').addEventListener('change', async () => {
    await chrome.storage.local.set({ uiLang: $('uiLang').value });
    location.reload();
  });

  showSettings();
  renderSite();
  if (!SubSettings.isOff(offSites, site)) {
    await scan();
    refreshCaptured();
  }
})();
