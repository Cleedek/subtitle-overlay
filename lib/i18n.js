// Interface language. The English text is the key: each file in lib/locales
// maps it to a translation, and anything without one stays in English.
// Shared by the popup, the content script and the background worker.
(function (root) {
  'use strict';

  // [code, name in its own language]; "auto" follows the browser.
  const LOCALES = [
    ['auto', ''], ['en', 'English'], ['cs', 'Čeština'], ['sk', 'Slovenčina'], ['de', 'Deutsch'],
    ['fr', 'Français'], ['es', 'Español'], ['vi', 'Tiếng Việt'], ['zh-CN', '简体中文'],
  ];
  const dicts = {};
  let lang = 'en';

  // A browser language like "de-AT" or "zh-TW" -> one we have (all Chinese gets simplified).
  function match(code) {
    const c = String(code || '').toLowerCase();
    if (c.startsWith('zh')) return 'zh-CN';
    const base = c.split('-')[0];
    return LOCALES.some((l) => l[0] === base && base !== 'auto') ? base : 'en';
  }

  function setLang(choice) {
    lang = choice && choice !== 'auto' && LOCALES.some((l) => l[0] === choice)
      ? choice
      : match(root.chrome && chrome.i18n ? chrome.i18n.getUILanguage() : root.navigator && navigator.language);
    return lang;
  }
  setLang('auto');

  async function load() {
    try {
      const { uiLang } = await chrome.storage.local.get('uiLang');
      return setLang(uiLang);
    } catch (e) { return lang; }
  }
  // Other parts of the extension follow a change made in the popup.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.uiLang) setLang(changes.uiLang.newValue);
    });
  } catch (e) { /* no storage here */ }

  // vars fill {name} placeholders. A translation can be an object of plural
  // forms ({ one, few, many, other }), picked by vars.n.
  function t(en, vars) {
    let s = (dicts[lang] && dicts[lang][en]) || (dicts.en && dicts.en[en]) || en;
    if (typeof s === 'object') {
      const n = vars ? Number(vars.n) : 0;
      let form = 'other';
      try { form = new Intl.PluralRules(lang).select(n); } catch (e) { /* keep "other" */ }
      s = s[form] || s.other;
    }
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
  }

  function add(code, dict) {
    dicts[code] = Object.assign(dicts[code] || {}, dict);
  }

  // Translates a static page in place: every text node, plus the title,
  // placeholder and aria-label attributes.
  function translatePage(rootEl) {
    if (lang === 'en') return;
    const walker = rootEl.ownerDocument.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const key = n.nodeValue.trim().replace(/\s+/g, ' ');
      if (!key) continue;
      const tr = t(key);
      if (tr !== key) n.nodeValue = n.nodeValue.match(/^\s*/)[0] + tr + n.nodeValue.match(/\s*$/)[0];
    }
    for (const el of rootEl.querySelectorAll('[title], [placeholder], [aria-label]')) {
      for (const a of ['title', 'placeholder', 'aria-label']) {
        const v = el.getAttribute(a);
        if (v) el.setAttribute(a, t(v));
      }
    }
    rootEl.ownerDocument.documentElement.lang = lang;
  }

  root.SubI18n = { LOCALES, add, load, setLang, t, translatePage, get lang() { return lang; } };
})(globalThis);
