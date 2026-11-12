// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Cleedek

// The welcome page, opened once by a new install (background.js). It shows the
// result before any how-to: a short muted clip with four lines of our own,
// translated for real into the language automatic mode will use, and drawn
// with the same code that draws subtitles over a video. Step 1 is the popup's
// "Translate to", with an optional second language (the popup's "Second
// subtitles") that the sample shows at once. "Pin the icon" ticks itself.
(async function () {
  'use strict';
  const { SubSettings, SubRender, SubI18n } = globalThis;
  const $ = (id) => document.getElementById(id);
  const t = SubI18n.t;
  await SubI18n.load();
  SubI18n.translatePage(document.body);
  document.title = t(document.title);

  // ---------- the sample ----------

  // English lines of our own (the clip has no sound), in ms like the overlay's cues.
  const CUES = [
    { start: 400, end: 2900, text: 'Subtitles show up right here.' },
    { start: 3200, end: 5900, text: 'Translated into your language.' },
    { start: 6200, end: 8700, text: 'On any video, on any website.' },
    { start: 9000, end: 11200, text: 'Don’t wait. Try it now.' },
  ];
  const video = $('video'), player = $('player'), subs = $('subs'), subs2 = $('subs2');
  const translated = new Map(); // language -> the four lines
  let prefs = await SubSettings.loadTranslation();
  let settings = await SubSettings.load();
  let shown = null; // the cue on screen and its language, so a frame with nothing new draws nothing

  const style = document.createElement('style');
  style.textContent = SubRender.CSS;
  document.head.append(style);

  // The person's own look, sized as if the player were twice as tall: at its
  // real height the text would be too small to read on a page.
  function restyle() {
    const s = Object.assign({}, settings, { scale: true });
    const h = player.clientHeight * 2.2, w = player.clientWidth;
    SubRender.applyStyle(subs, s, h, w);
    // The second set sits at the other edge, as over a video (content.js dualSettings).
    SubRender.applyStyle(subs2, Object.assign({}, s, { place: s.place === 'top' ? 'bottom' : 'top', bottom: s.dualDistance }), h, w);
  }
  restyle();
  new ResizeObserver(restyle).observe(player);
  SubRender.ensureFont(document, settings.font).catch(() => {});

  // The lines in a language once they arrived; 'orig' is the English we wrote.
  const linesIn = (code) => (code === 'orig' ? CUES.map((c) => c.text) : translated.get(code));
  const secondOn = () => !!settings.dual;

  function draw() {
    const now = video.currentTime * 1000;
    const i = CUES.findIndex((c) => now >= c.start && now < c.end);
    const lines = linesIn(prefs.translateTo), lines2 = secondOn() ? linesIn(prefs.secondLang) : null;
    const key = [i, lines ? prefs.translateTo : '', lines2 ? prefs.secondLang : '', secondOn()].join('|');
    if (key === shown) return;
    shown = key;
    const text = i < 0 ? '' : lines ? lines[i] : CUES[i].text;
    SubRender.renderCues(subs, text ? [{ text }] : []);
    SubRender.renderCues(subs2, i >= 0 && lines2 ? [{ text: lines2[i] }] : []);
    // The original in the corner only when the line below it differs from it,
    // and not with a second set: that one has the top of the picture.
    const differs = !!text && text !== CUES[i].text && !secondOn();
    $('orig').hidden = !differs;
    if (differs) $('origText').textContent = CUES[i].text;
  }
  function loop() {
    draw();
    if (!video.paused) requestAnimationFrame(loop);
  }
  video.addEventListener('play', () => { player.classList.remove('paused'); $('playPause').setAttribute('aria-label', t('Pause')); loop(); });
  video.addEventListener('pause', () => { player.classList.add('paused'); $('playPause').setAttribute('aria-label', t('Play')); });
  video.addEventListener('seeked', draw);
  $('playPause').addEventListener('click', () => (video.paused ? video.play().catch(() => {}) : video.pause()));

  // Moving pictures only for people who haven't asked for less motion: they
  // get a still with its first line, and the button to start it.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    player.classList.add('paused');
    $('playPause').setAttribute('aria-label', t('Play'));
    video.currentTime = 1;
  } else {
    video.play().catch(() => { player.classList.add('paused'); });
  }

  // Asks for the main language and, when it is on, the second one.
  async function translate() {
    const wanted = () => [prefs.translateTo].concat(secondOn() && prefs.secondLang !== 'orig' ? [prefs.secondLang] : []);
    const asked = wanted();
    $('demoError').hidden = true;
    let failed = false;
    await Promise.all(asked.filter((to) => !translated.has(to)).map(async (to) => {
      let res = null;
      try { res = await chrome.runtime.sendMessage({ type: 'translate', to, texts: CUES.map((c) => c.text) }); } catch (e) { /* the worker is asleep or gone */ }
      if (res && res.ok && Array.isArray(res.texts) && res.texts.length === CUES.length) translated.set(to, res.texts.map((s) => String(s).trim()));
      else failed = true;
    }));
    if (asked.join() !== wanted().join()) return; // another choice was made meanwhile: its own call answers
    $('demoError').hidden = !failed;
    shown = null;
    draw();
  }

  // ---------- the language ----------

  const cap = (s) => s.charAt(0).toLocaleUpperCase(SubI18n.lang) + s.slice(1);
  const option = (value, text) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    return o;
  };
  const langOptions = () => SubSettings.LANGUAGES.map(([code]) => option(code, (SubSettings.flag(code) + ' ' + cap(SubSettings.languageName(code))).trim()));
  $('lang').replaceChildren(...langOptions());
  $('lang').value = prefs.translateTo;
  $('lang').addEventListener('change', () => {
    prefs.translateTo = $('lang').value;
    SubSettings.saveTranslation({ translateTo: prefs.translateTo });
    translate();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.translateTo && changes.translateTo.newValue !== prefs.translateTo) {
      prefs.translateTo = changes.translateTo.newValue;
      $('lang').value = prefs.translateTo;
      translate();
    }
    if (changes.secondLang && changes.secondLang.newValue !== prefs.secondLang) {
      prefs.secondLang = changes.secondLang.newValue || 'orig';
      showSecond();
      translate();
    }
    // A look changed in the popup shows here too, and so does its "Second subtitles" switch.
    if (changes.settings) SubSettings.load().then((s) => { settings = s; restyle(); showSecond(); translate(); SubRender.ensureFont(document, s.font).catch(() => {}); });
  });

  // ---------- the optional second language ----------

  // The popup's "Second subtitles" switch and its language: the original, or
  // any language. Off until asked for; the sample shows it the moment it is on.
  $('second').replaceChildren(option('orig', t('Original')), ...langOptions());
  function showSecond() {
    const on = secondOn();
    $('secondAdd').hidden = on;
    $('secondRow').hidden = $('secondNote').hidden = !on;
    $('second').value = prefs.secondLang || 'orig';
  }
  async function setSecond(on) {
    settings = await SubSettings.save({ dual: on });
    showSecond();
    translate();
  }
  $('secondAdd').addEventListener('click', () => setSecond(true).then(() => $('second').focus()));
  $('secondRemove').addEventListener('click', () => setSecond(false).then(() => $('secondAdd').focus()));
  $('second').addEventListener('change', () => {
    prefs.secondLang = $('second').value;
    SubSettings.saveTranslation({ secondLang: prefs.secondLang });
    translate();
  });
  showSecond();
  translate();

  // ---------- "Pin the icon" ----------

  // Chrome says whether the icon sits in the toolbar. Asked again while the
  // page is in front, until it does. A browser without the call keeps the step
  // as it is.
  const canAsk = !!(chrome.action && chrome.action.getUserSettings);
  let pinTimer = 0;
  async function checkPin() {
    const s = await chrome.action.getUserSettings().catch(() => null);
    if (!s || !s.isOnToolbar) return;
    clearInterval(pinTimer);
    document.removeEventListener('visibilitychange', watchPin);
    $('pinStep').className = 'ok';
    $('pinStep').querySelector('.n').textContent = '✓';
    $('pinTitle').textContent = t($('pinTitle').dataset.done);
    $('playStep').className = 'now';
  }
  function watchPin() {
    clearInterval(pinTimer);
    if (document.hidden) return;
    checkPin();
    pinTimer = setInterval(checkPin, 1500);
  }
  if (canAsk) {
    document.addEventListener('visibilitychange', watchPin);
    watchPin();
  }

  // ---------- leaving ----------

  $('privacyLink').href = SubSettings.PRIVACY_URL;
  $('done').addEventListener('click', async () => {
    const tab = await chrome.tabs.getCurrent().catch(() => null);
    if (tab) chrome.tabs.remove(tab.id).catch(() => window.close());
    else window.close();
  });
})();
