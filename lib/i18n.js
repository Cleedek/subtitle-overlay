// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Cleedek

// Interface language. The English text is the key: each file in lib/locales
// maps it to a translation, and anything without one stays in English.
// Only the language in use is loaded, because this runs in every page and frame.
// Shared by the popup, the content script and the background worker.
(function (root) {
  'use strict';

  // [code, name in its own language]; "auto" follows the browser.
  const LOCALES = [
    ['auto', ''], ['en', 'English'], ['id', 'Bahasa Indonesia'], ['ms', 'Bahasa Melayu'], ['cs', 'Čeština'],
    ['da', 'Dansk'], ['de', 'Deutsch'], ['es', 'Español'], ['tl', 'Filipino'], ['fr', 'Français'],
    ['hr', 'Hrvatski'], ['it', 'Italiano'], ['hu', 'Magyar'], ['nl', 'Nederlands'], ['no', 'Norsk'],
    ['pl', 'Polski'], ['pt', 'Português'], ['ro', 'Română'], ['sk', 'Slovenčina'], ['fi', 'Suomi'],
    ['sv', 'Svenska'], ['vi', 'Tiếng Việt'], ['tr', 'Türkçe'], ['el', 'Ελληνικά'], ['uk', 'Українська'],
    ['hi', 'हिन्दी'], ['th', 'ไทย'], ['ja', '日本語'], ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['ko', '한국어'],
  ];
  // English needs only its singular and plural forms; everything else is its own key.
  const dicts = {
    en: {
      '{n} videos on this page': { one: '{n} video on this page', other: '{n} videos on this page' },
      '{n} videos on this page, playing': { one: '{n} video on this page, playing', other: '{n} videos on this page, playing' },
      '{n} lines': { one: '{n} line', other: '{n} lines' },
      '{n} pieces': { one: '{n} piece', other: '{n} pieces' },
      'Loaded {n} lines': { one: 'Loaded {n} line', other: 'Loaded {n} lines' },
      'Translating {n} lines to {lang}…': { one: 'Translating {n} line to {lang}…', other: 'Translating {n} lines to {lang}…' },
      'Saved to Downloads ({n} lines)': { one: 'Saved to Downloads ({n} line)', other: 'Saved to Downloads ({n} lines)' },
      'Showing {n} lines.': { one: 'Showing {n} line.', other: 'Showing {n} lines.' },
      'Showing {n} lines in {lang}.': { one: 'Showing {n} line in {lang}.', other: 'Showing {n} lines in {lang}.' },
      '{n} videos translated': { one: '{n} video translated', other: '{n} videos translated' },
      'That’s {count} translated lines. Nice!': { one: 'That’s {count} translated line. Nice!', other: 'That’s {count} translated lines. Nice!' },
    },
  };
  let lang = 'en';
  let wanted = 0; // the newest language request wins if two overlap

  // A browser language like "de-AT" or "zh-TW" -> one we have.
  function match(code) {
    const c = String(code || '').toLowerCase();
    if (c.startsWith('zh')) return /tw|hk|mo|hant/.test(c) ? 'zh-TW' : 'zh-CN';
    const base = c.split('-')[0];
    const alias = { nb: 'no', nn: 'no', fil: 'tl' }[base] || base;
    return LOCALES.some((l) => l[0] === alias && alias !== 'auto') ? alias : 'en';
  }

  function resolve(choice) {
    return choice && choice !== 'auto' && LOCALES.some((l) => l[0] === choice)
      ? choice
      : match(root.chrome && chrome.i18n ? chrome.i18n.getUILanguage() : root.navigator && navigator.language);
  }

  // Reads one language's file. Extension pages and the worker can do it directly.
  async function read(code) {
    if (code === 'en' || !LOCALES.some((l) => l[0] === code)) return null;
    const res = await fetch(chrome.runtime.getURL('lib/locales/' + code + '.json'));
    return res.json();
  }

  // Web pages can't read extension files, so the content script asks the worker.
  const inPage = () => !root.location || root.location.protocol !== 'chrome-extension:';

  // Switches language once its text is here. If it can't be loaded, English shows.
  async function setLang(choice) {
    const code = resolve(choice);
    const mine = ++wanted;
    if (code !== 'en' && !dicts[code]) {
      try {
        const dict = inPage() ? await chrome.runtime.sendMessage({ type: 'ui-strings', lang: code }) : await read(code);
        if (dict) dicts[code] = dict;
      } catch (e) { /* stays in English */ }
    }
    if (mine === wanted) lang = code;
    return lang;
  }

  async function load() {
    let uiLang;
    try { ({ uiLang } = await chrome.storage.local.get('uiLang')); } catch (e) { /* no storage here */ }
    return setLang(uiLang);
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

  root.SubI18n = { LOCALES, read, load, setLang, t, translatePage, get lang() { return lang; } };
})(globalThis);
