// Style and sync settings: defaults, presets and storage helpers.
// Shared by the popup and the content script.
(function (root) {
  'use strict';

  const DEFAULTS = {
    place: 'bottom',         // bottom | middle | top of the video
    bottom: 40,              // px from that edge (bottom or top; unused in the middle)
    size: 36,                // px, for a 1080 px tall player when scaling is on
    scale: true,             // scale size/spacing with the player height
    font: 'sans',            // sans | serif | mono
    weight: 600,             // 400 | 600 | 700
    color: '#ffffff',
    outline: true,
    outlineWidth: 2,
    outlineColor: '#000000',
    shadow: true,
    shadowBlur: 4,
    shadowOffset: 2,
    shadowColor: '#000000',
    shadowOpacity: 80,       // %
    box: false,
    boxColor: '#000000',
    boxOpacity: 60,          // %
    boxPadding: 8,
    boxBlur: 0,              // px, blurs the video behind the box
    maxWidth: 80,            // % of the video width
    offset: 0,               // ms; positive = subtitles appear later
    onPause: 'keep',         // keep | hide
    hideSounds: true,        // drop [Music], (LAUGHS), ♪ and ">>" from the lines
    clickCopy: true,         // click a line on the video to copy its text
    dual: false,             // with a translation on, also show the original at the other edge
    dualDistance: 40,        // px from that edge, for the original
  };

  // Presets only touch the look, never position, size or sync.
  const PRESETS = {
    clean: { color: '#ffffff', weight: 600, outline: true, outlineWidth: 2, outlineColor: '#000000', shadow: true, shadowBlur: 4, shadowOffset: 2, shadowColor: '#000000', shadowOpacity: 80, box: false },
    boxed: { color: '#ffffff', weight: 600, outline: false, shadow: false, box: true, boxColor: '#000000', boxOpacity: 60, boxPadding: 8 },
    contrast: { color: '#ffe600', weight: 700, outline: true, outlineWidth: 4, outlineColor: '#000000', shadow: true, shadowBlur: 2, shadowOffset: 2, shadowColor: '#000000', shadowOpacity: 100, box: false },
  };

  const LIMITS = {
    bottom: [0, 300], size: [14, 96], outlineWidth: [0, 6], shadowBlur: [0, 12],
    shadowOffset: [0, 6], shadowOpacity: [0, 100], boxOpacity: [0, 100],
    boxPadding: [0, 24], boxBlur: [0, 20], dualDistance: [0, 300], maxWidth: [40, 100], offset: [-60000, 60000],
  };

  function clamp(key, value) {
    const l = LIMITS[key];
    if (!l) return value;
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULTS[key];
    const v = Math.min(l[1], Math.max(l[0], n));
    // Thin outlines get half steps (0.5, 1, 1.5); from 2 px on, whole pixels.
    if (key === 'outlineWidth' && v < 2) return Math.round(v * 2) / 2;
    return Math.round(v);
  }

  async function load() {
    const { settings } = await chrome.storage.local.get('settings');
    return Object.assign({}, DEFAULTS, settings || {});
  }

  // Merges a partial change into the saved settings and returns the result.
  async function save(patch) {
    const current = await load();
    const next = Object.assign(current, patch);
    for (const k of Object.keys(LIMITS)) next[k] = clamp(k, next[k]);
    await chrome.storage.local.set({ settings: next });
    return next;
  }

  async function reset() {
    await chrome.storage.local.set({ settings: Object.assign({}, DEFAULTS) });
    return Object.assign({}, DEFAULTS);
  }

  // Your own presets keep the whole look (font, size, position too), never the sync offset.
  const PRESET_KEYS = Object.keys(DEFAULTS).filter((k) => k !== 'offset' && k !== 'dual');

  async function loadPresets() {
    const { presets } = await chrome.storage.local.get('presets');
    return Array.isArray(presets) ? presets : [];
  }

  // Same name = replace that preset.
  async function savePreset(name, settings) {
    const values = {};
    for (const k of PRESET_KEYS) values[k] = settings[k];
    const list = (await loadPresets()).filter((p) => p.name !== name);
    list.push({ name, values });
    await chrome.storage.local.set({ presets: list });
    return list;
  }

  async function deletePreset(name) {
    const list = (await loadPresets()).filter((p) => p.name !== name);
    await chrome.storage.local.set({ presets: list });
    return list;
  }

  // ---------- translation ----------

  // Google Translate codes, in the order the language picker shows them.
  // need = the alphabet a font must have for the language (a letter code in
  // lib/google-fonts.json: e latin-ext, v vietnamese, c cyrillic, g greek,
  // h hebrew, a arabic, t thai, d devanagari, j japanese, k korean,
  // S/T chinese simplified/traditional; '' = plain latin, every font has it).
  // sample = letters that show whether a font really has them.
  const LANGUAGES = [
    ['vi', 'Vietnamese', 'v', 'ư ế ộ'], ['cs', 'Czech', 'e', 'č ř ž'], ['en', 'English', '', 'Aa'],
    ['sk', 'Slovak', 'e', 'ľ ť ô'], ['de', 'German', '', 'ä ö ß'], ['fr', 'French', '', 'é ç œ'],
    ['es', 'Spanish', '', 'ñ á ¿'], ['it', 'Italian', '', 'à è ò'], ['pt', 'Portuguese', '', 'ã ç õ'],
    ['pl', 'Polish', 'e', 'ą ł ż'], ['hu', 'Hungarian', 'e', 'ő ű á'], ['uk', 'Ukrainian', 'c', 'ї є ґ'],
    ['nl', 'Dutch', '', 'é ë ü'], ['sv', 'Swedish', '', 'å ä ö'],
    ['da', 'Danish', '', 'æ ø å'], ['no', 'Norwegian', '', 'æ ø å'], ['fi', 'Finnish', '', 'ä ö å'],
    ['el', 'Greek', 'g', 'α β γ'], ['tr', 'Turkish', 'e', 'ğ ş ı'], ['ro', 'Romanian', 'e', 'ș ț ă'],
    ['hr', 'Croatian', 'e', 'č ć đ'], ['zh-CN', 'Chinese (Simplified)', 'S', '中文'], ['zh-TW', 'Chinese (Traditional)', 'T', '中文'],
    ['ja', 'Japanese', 'j', 'あ ア 字'], ['ko', 'Korean', 'k', '한 국'], ['th', 'Thai', 't', 'ภ า ษ'],
    ['id', 'Indonesian', '', 'Aa'], ['ms', 'Malay', '', 'Aa'], ['tl', 'Filipino', '', 'Ñ ñ'],
    ['hi', 'Hindi', 'd', 'हि दी'], ['ar', 'Arabic', 'a', 'ع ر ب'],
  ];
  const language = (code) => LANGUAGES.find((l) => l[0] === code) || [code, code, '', ''];
  // Google Fonts alphabet ("subset") names for the letter codes above.
  const SUBSETS = { e: 'latin-ext', v: 'vietnamese', c: 'cyrillic', g: 'greek', h: 'hebrew', a: 'arabic', t: 'thai',
    d: 'devanagari', j: 'japanese', k: 'korean', S: 'chinese-simplified', T: 'chinese-traditional' };
  // In the interface language when the browser knows it ("vietnamština" in Czech), else English.
  const languageName = (code) => {
    const ui = root.SubI18n ? root.SubI18n.lang : 'en';
    try {
      // Chinese by script (simplified/traditional), not by country.
      // Google's "tl" is named Filipino, the national language, not Tagalog.
      const name = new Intl.DisplayNames([ui], { type: 'language' }).of({ 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant', tl: 'fil' }[code] || code);
      if (name && name !== code) return name;
    } catch (e) { /* older browser */ }
    return (LANGUAGES.find((l) => l[0] === code) || [code, code])[1];
  };

  // A flag for a language code, to tell languages apart at a glance. A flag is a
  // country, not a language, so this picks the country most people link with it
  // (English = UK, Portuguese = Portugal). A region in the code wins: pt-BR = Brazil.
  // Also takes the 3-letter and odd codes subtitle file names use (cze, eng, ger).
  const FLAG_COUNTRY = {
    vi: 'VN', cs: 'CZ', en: 'GB', sk: 'SK', de: 'DE', fr: 'FR', es: 'ES', it: 'IT', pt: 'PT', pl: 'PL',
    hu: 'HU', uk: 'UA', ru: 'RU', nl: 'NL', sv: 'SE', da: 'DK', no: 'NO', nb: 'NO', fi: 'FI', el: 'GR',
    tr: 'TR', ro: 'RO', hr: 'HR', zh: 'CN', 'zh-tw': 'TW', 'zh-hant': 'TW', ja: 'JP', ko: 'KR', th: 'TH',
    id: 'ID', ms: 'MY', tl: 'PH', fil: 'PH', hi: 'IN', ar: 'SA', he: 'IL', iw: 'IL',
    cz: 'CZ', cze: 'CZ', ces: 'CZ', slk: 'SK', slo: 'SK', eng: 'GB', vie: 'VN', deu: 'DE', ger: 'DE',
    fra: 'FR', fre: 'FR', spa: 'ES', pol: 'PL', hun: 'HU', ita: 'IT', rus: 'RU', ukr: 'UA',
  };
  function flag(code) {
    const c = String(code || '').toLowerCase();
    const region = /^[a-z]{2,3}[-_]([a-z]{2})$/.exec(c);
    const cc = FLAG_COUNTRY[c] || (region && region[1] !== 'cn' ? region[1].toUpperCase() : FLAG_COUNTRY[c.split(/[-_]/)[0]]);
    return cc ? String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : '';
  }

  // Translation choices live outside the style settings, so presets and
  // "Reset to defaults" never change them. Each is its own storage key.
  // secondLang: language of the second subtitles ('orig' = the untranslated file).
  const TRANSLATION = { translateTo: 'vi', autoTranslate: false, secondLang: 'orig' };
  async function loadTranslation() {
    const got = await chrome.storage.local.get(Object.keys(TRANSLATION));
    const out = Object.assign({}, TRANSLATION);
    for (const k of Object.keys(TRANSLATION)) if (got[k] != null) out[k] = got[k];
    // A language dropped from the list (Russian, Hebrew) falls back to the default.
    const known = (code) => LANGUAGES.some((l) => l[0] === code);
    if (!known(out.translateTo)) out.translateTo = TRANSLATION.translateTo;
    if (out.secondLang !== 'orig' && !known(out.secondLang)) out.secondLang = TRANSLATION.secondLang;
    return out;
  }
  async function saveTranslation(patch) {
    await chrome.storage.local.set(patch);
  }

  // ---------- sites where the extension is turned off ----------

  // A site is its host name without "www."; turning off example.com also covers
  // its subdomains (player.example.com). Stored as a list under "offSites".
  function siteOf(url) {
    try {
      const u = new URL(url);
      return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '') : '';
    } catch (e) { return ''; }
  }
  const isOff = (list, site) => !!site && (list || []).some((s) => site === s || site.endsWith('.' + s));
  async function loadOffSites() {
    const { offSites } = await chrome.storage.local.get('offSites');
    return Array.isArray(offSites) ? offSites : [];
  }
  async function setSiteOff(site, off) {
    const list = (await loadOffSites()).filter((s) => s !== site);
    if (off) list.push(site);
    list.sort();
    await chrome.storage.local.set({ offSites: list });
    return list;
  }

  // ---------- show / hide shortcut ----------

  // The one shortcut you can change: a physical key (event.code) plus modifiers.
  // Stored as "toggleKey", outside the style settings, like the translation choices.
  const TOGGLE_KEY = { code: 'KeyS', alt: true, shift: false, ctrl: false, meta: false };
  async function loadToggleKey() {
    const { toggleKey } = await chrome.storage.local.get('toggleKey');
    return toggleKey && toggleKey.code ? toggleKey : Object.assign({}, TOGGLE_KEY);
  }
  const keyOf = (e) => ({ code: e.code, alt: e.altKey, shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey });
  const sameKey = (a, b) => !!a && !!b && a.code === b.code && !!a.alt === !!b.alt && !!a.shift === !!b.shift && !!a.ctrl === !!b.ctrl && !!a.meta === !!b.meta;
  // The fixed shortcuts (Alt + key, Shift allowed only on [ and ]), so a new one can't take their place.
  const FIXED_KEYS = {
    BracketLeft: 'Earlier / later by 0.1 s', BracketRight: 'Earlier / later by 0.1 s', Digit0: 'Reset sync to 0',
    ArrowUp: 'Move subtitles up / down', ArrowDown: 'Move subtitles up / down', KeyF: 'Fullscreen with subtitles', KeyR: 'Repeat the current line',
  };
  function fixedKeyName(k) {
    if (!k.alt || k.ctrl || k.meta) return '';
    if (k.shift) return /^Bracket/.test(k.code) ? 'Earlier / later by 1 s' : '';
    return FIXED_KEYS[k.code] || '';
  }
  // The key's own label from its physical code ("KeyS" -> "S", "Digit4" -> "4").
  const KEY_LABELS = {
    Space: 'Space', Enter: 'Enter', Backspace: '⌫', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/', Backquote: '`', IntlBackslash: '§',
  };
  function keyLabel(code) {
    const m = /^(?:Key|Digit|Numpad)(.+)$/.exec(code);
    return m ? m[1] : KEY_LABELS[code] || code;
  }

  root.SubSettings = {
    DEFAULTS, PRESETS, LIMITS, PRESET_KEYS, clamp, load, save, reset, loadPresets, savePreset, deletePreset,
    LANGUAGES, language, SUBSETS, languageName, flag, TRANSLATION, loadTranslation, saveTranslation,
    siteOf, isOff, loadOffSites, setSiteOff,
    TOGGLE_KEY, loadToggleKey, keyOf, sameKey, fixedKeyName, keyLabel,
  };
})(globalThis);
