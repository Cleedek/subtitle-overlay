// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Cleedek

// Style and sync settings: defaults, presets and storage helpers.
// Shared by the popup and the content script.
(function (root) {
  'use strict';

  const DEFAULTS = {
    place: 'bottom',         // bottom | middle | top of the video
    bottom: 56,              // px from that edge (bottom or top; unused in the middle)
    size: 48,                // px, for a 1080 px tall player when scaling is on
    scale: true,             // scale size/spacing with the player height
    font: 'g:Vend Sans',     // sans | serif | mono | g:<Google font name>
    weight: 600,             // 400 | 600 | 700
    color: '#ffffff',
    outline: true,
    outlineWidth: 1.5,
    outlineColor: '#000000',
    outlineOpacity: 50,      // %
    shadow: false,
    shadowBlur: 1,
    shadowSpread: 1,         // px the letters grow before the blur, like Figma's spread
    shadowX: 1,              // px, negative = left
    shadowY: 2,              // px, negative = up
    shadowColor: '#000000',
    shadowOpacity: 50,       // %
    box: false,
    boxColor: '#000000',
    boxOpacity: 50,          // %
    boxPaddingX: 2,          // px left and right of the text
    boxPaddingY: 1,          // px above and below
    boxBlur: 0,              // px, blurs the video behind the box
    maxWidth: 80,            // % of the video width
    offset: 0,               // ms; positive = subtitles appear later
    onPause: 'keep',         // keep | hide
    hideSounds: true,        // drop [Music], (LAUGHS), ♪ and ">>" from the lines
    clickCopy: true,         // click a line on the video to copy its text
    statusNotices: true,     // the short messages while subtitles load and translate ("Translating…", "Translated to…")
    dual: false,             // with a translation on, also show the original at the other edge
    dualDistance: 40,        // px from that edge, for the original
  };

  // Presets only touch the look, never position, size or sync.
  const PRESETS = {
    clean: { color: '#ffffff', weight: 600, outline: true, outlineWidth: 2, outlineColor: '#000000', outlineOpacity: 100, shadow: true, shadowBlur: 4, shadowSpread: 0, shadowX: 2, shadowY: 2, shadowColor: '#000000', shadowOpacity: 80, box: false },
    boxed: { color: '#ffffff', weight: 600, outline: false, shadow: false, box: true, boxColor: '#000000', boxOpacity: 60, boxPaddingX: 8, boxPaddingY: 4 },
    contrast: { color: '#ffe600', weight: 700, outline: true, outlineWidth: 4, outlineColor: '#000000', outlineOpacity: 100, shadow: true, shadowBlur: 2, shadowSpread: 0, shadowX: 2, shadowY: 2, shadowColor: '#000000', shadowOpacity: 100, box: false },
  };

  const LIMITS = {
    bottom: [0, 300], size: [14, 96], outlineWidth: [0, 6], outlineOpacity: [0, 100], shadowBlur: [0, 40],
    shadowSpread: [0, 10], shadowX: [-10, 10], shadowY: [-10, 10], shadowOpacity: [0, 100], boxOpacity: [0, 100],
    boxPaddingX: [0, 24], boxPaddingY: [0, 24], boxBlur: [0, 20], dualDistance: [0, 300], maxWidth: [40, 100], offset: [-60000, 60000],
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

  // One box padding, as saved before sides and top/bottom were apart: the
  // sides got it whole, top and bottom half of it.
  function splitPadding(p) {
    return { boxPaddingX: p, boxPaddingY: Math.round(p / 2) };
  }

  // Saved settings over the defaults. Shadows saved before spread and X/Y
  // existed had one offset for both directions.
  function withDefaults(saved) {
    const s = Object.assign({}, DEFAULTS, saved || {});
    if (saved && saved.shadowOffset != null && saved.shadowX == null) s.shadowX = s.shadowY = saved.shadowOffset;
    if (saved && saved.boxPadding != null && saved.boxPaddingX == null) Object.assign(s, splitPadding(saved.boxPadding));
    delete s.shadowOffset;
    delete s.boxPadding;
    return s;
  }

  async function load() {
    const { settings } = await chrome.storage.local.get('settings');
    return withDefaults(settings);
  }

  // Merges a partial change into the saved settings and returns the result.
  // One save at a time: two at once would both read the old settings, and the
  // second would write the first one's change back out.
  let saving = Promise.resolve();
  function save(patch) {
    const run = saving.then(async () => {
      const current = await load();
      const next = Object.assign(current, patch);
      for (const k of Object.keys(LIMITS)) next[k] = clamp(k, next[k]);
      await chrome.storage.local.set({ settings: next });
      return next;
    });
    saving = run.catch(() => {});
    return run;
  }

  // Your own presets keep the whole look (font, size, position too), never the sync
  // offset, whether second subtitles are on, or the Behaviour tab.
  const NOT_LOOK = ['offset', 'dual', 'onPause', 'hideSounds', 'clickCopy', 'statusNotices'];
  const PRESET_KEYS = Object.keys(DEFAULTS).filter((k) => !NOT_LOOK.includes(k));

  // Back to the default look (the Style tab's reset); everything else stays.
  async function reset() {
    const settings = await load();
    for (const k of PRESET_KEYS) settings[k] = DEFAULTS[k];
    await chrome.storage.local.set({ settings });
    return settings;
  }

  async function loadPresets() {
    const { presets } = await chrome.storage.local.get('presets');
    if (!Array.isArray(presets)) return [];
    // Presets saved before also carried the Behaviour settings; only the look applies.
    return presets.map((p) => {
      const values = {};
      for (const k of PRESET_KEYS) if (p.values && k in p.values) values[k] = p.values[k];
      // Saved before spread and X/Y: the same shadow, now spelled out.
      if (p.values && p.values.shadowOffset != null && !('shadowX' in p.values)) {
        Object.assign(values, { shadowX: p.values.shadowOffset, shadowY: p.values.shadowOffset, shadowSpread: 0 });
      }
      if (p.values && p.values.boxPadding != null && !('boxPaddingX' in p.values)) Object.assign(values, splitPadding(p.values.boxPadding));
      return { name: p.name, values };
    });
  }

  // Same name = replace that preset where it stands (so Update keeps its place).
  async function savePreset(name, settings) {
    const values = {};
    for (const k of PRESET_KEYS) values[k] = settings[k];
    const list = await loadPresets();
    const i = list.findIndex((p) => p.name === name);
    if (i >= 0) list[i] = { name, values };
    else list.push({ name, values });
    await chrome.storage.local.set({ presets: list });
    return list;
  }

  async function deletePreset(name) {
    const list = (await loadPresets()).filter((p) => p.name !== name);
    await chrome.storage.local.set({ presets: list });
    return list;
  }

  // ---------- colours ----------

  // The colour popover's fixed swatches, light to dark: each reads well on
  // video as text, and the dark ones as an outline, shadow or box.
  const COLORS = [
    ['#ffffff', 'White'], ['#fff3d6', 'Cream'], ['#ffe600', 'Yellow'], ['#8ff0ff', 'Light cyan'],
    ['#a6f28c', 'Light green'], ['#9a9a9a', 'Gray'], ['#3a3a3a', 'Dark gray'], ['#000000', 'Black'],
  ];
  const RECENT_COLORS = 8;

  // Colours picked with the custom picker or typed as a code, newest first.
  // One list for every colour setting.
  async function loadRecentColors() {
    const { recentColors } = await chrome.storage.local.get('recentColors');
    return Array.isArray(recentColors) ? recentColors : [];
  }

  async function addRecentColor(hex) {
    const c = String(hex).toLowerCase();
    if (COLORS.some(([v]) => v === c)) return loadRecentColors();
    const list = [c, ...(await loadRecentColors()).filter((x) => x !== c)].slice(0, RECENT_COLORS);
    await chrome.storage.local.set({ recentColors: list });
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
  // The Style tab's preview line in each language: a short pangram or phrase with that
  // language's own letters, so a font that lacks them shows at once.
  const PREVIEW = {
    vi: 'Tiếng Việt rất <i>đẹp</i>', cs: 'Příliš žluťoučký kůň <i>úpěl</i>', en: 'The quick brown fox <i>jumps</i>',
    sk: 'Kŕdeľ šťastných ďatľov <i>učí</i>', de: 'Zwölf Boxkämpfer jagen <i>Viktor</i>', fr: 'Voix ambiguë d’un cœur qui <i>préfère</i>',
    es: 'La cigüeña tocaba el <i>saxofón</i>', it: 'È già l’ora del <i>caffè</i>', pt: 'À noite, vovô Kowalsky <i>vê</i>',
    pl: 'Zażółć gęślą <i>jaźń</i>', hu: 'Árvíztűrő <i>tükörfúrógép</i>', uk: 'Щастям б’єш жук їх <i>глицю</i>',
    nl: 'Een café vol <i>ideeën</i>', sv: 'Älgen går över <i>ån</i>', da: 'Blåbærgrød med <i>fløde</i>',
    no: 'Blåbærsyltetøy på <i>brødskiva</i>', fi: 'Hyvää yötä ja <i>kauniita unia</i>', el: 'Ξεσκεπάζω την <i>ψυχοφθόρα</i>',
    tr: 'Pijamalı hasta yağız <i>şoföre</i>', ro: 'Șapte țânțari în <i>grădină</i>', hr: 'Đače, uštedu plaćaj <i>žaljenjem</i>',
    'zh-CN': '简体中文<i>字幕</i>', 'zh-TW': '繁體中文<i>字幕</i>', ja: '日本語の<i>字幕</i>',
    ko: '한국어 <i>자막</i>', th: 'เป็นมนุษย์สุดประเสริฐ<i>เลิศคุณค่า</i>', id: 'Selamat <i>menonton</i>',
    ms: 'Selamat <i>menonton</i>', tl: 'Maligayang <i>panonood</i>', hi: 'हिंदी में <i>उपशीर्षक</i>', ar: 'شاهد الفيلم <i>بلغتك</i>',
  };
  const previewText = (code) => PREVIEW[code] || PREVIEW.en;
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
  // translator: 'google' only, or Google first and then a better AI pass:
  // 'gemini' (your own Google AI Studio key), 'claude' (your own Anthropic key),
  // 'openai' (your own OpenAI key) or 'local' (Ollama / LM Studio on this computer).
  // In the popup 'google' is the "Improve with AI" switch turned off; aiPick remembers
  // the AI that comes back when it is turned on again.
  // aiNotices: the short messages over the video when the AI pass starts and finishes.
  // aiSaveFile: a finished AI pass (and every file in the background queue) saves its .srt to Downloads.
  // keepFor: how long it stays in the extension's "Saved subtitles" (batch.html):
  // 'off', days ('1', '7', '30', '90') or 'forever'.
  // shareFind: look for improved subtitles other people shared (on by default:
  // a lookup sends only the start of the subtitles' fingerprint). shareAuto: use
  // a shared copy at once instead of offering it. shareMine: send your own
  // finished improvements (off until you say yes in the card over the video).
  const TRANSLATION = { translateTo: 'vi', autoTranslate: false, secondLang: 'orig',
    translator: 'google', aiPick: 'local', geminiKey: '', geminiModel: '', claudeKey: '', claudeModel: '', openaiKey: '', openaiModel: '', localUrl: 'http://localhost:11434', localModel: '', aiNotices: true, aiSaveFile: false, keepFor: 'forever',
    shareFind: true, shareAuto: false, shareMine: false };
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

  // The AI translators: where each keeps its key and its model.
  const AI = {
    gemini: { name: 'Gemini', key: 'geminiKey', model: 'geminiModel' },
    claude: { name: 'Claude', key: 'claudeKey', model: 'claudeModel' },
    openai: { name: 'OpenAI', key: 'openaiKey', model: 'openaiModel' },
    local: { name: 'Local model', key: '', model: 'localModel' },
  };
  // The saved model if it's still offered; otherwise Gemini's newest plain Flash,
  // Claude's newest Sonnet, OpenAI's newest Terra (its mid model, "natural
  // writing"; Luna if there's none), or the first local model.
  function pickModel(translator, models, saved) {
    if (models.includes(saved)) return saved;
    const newest = (re, not) => models.filter((m) => re.test(m) && !(not && not.test(m))).sort().pop();
    // By version number, not by name: letters sort after numbers, and a name
    // without a version ("gemini-flash-latest") only wins when it's alone.
    const version = (m) => (/-(\d+(?:\.\d+)?)-/.exec(m) || [0, '0'])[1].split('.').map(Number);
    const newestFlash = () => models.filter((m) => /flash/.test(m) && !/lite|preview|exp|thinking/.test(m))
      .sort((a, b) => version(a)[0] - version(b)[0] || (version(a)[1] || 0) - (version(b)[1] || 0)).pop();
    return (translator === 'gemini' && newestFlash())
      || (translator === 'claude' && newest(/sonnet/))
      || (translator === 'openai' && (newest(/terra/) || newest(/luna/))) || models[0];
  }

  // ---------- saved subtitles ----------

  // Improved subtitles kept in the extension, one storage key each ("lib:" +
  // file + language), so the same file improved again replaces its copy.
  // { name, lang, model, t, until, page, title, srt }; until 0 = kept forever.
  // Each copy keeps the time it was saved with: a shorter choice later doesn't delete older ones.
  const KEEP_FOR = ['off', '1', '7', '30', '90', 'forever'];
  // item.src (optional): sourceKey() of the original lines. A second key
  // "src:" + src + "|" + language then points at the copy, so the same
  // subtitles get it back at once (findKept), whatever page or file name they come with.
  async function keepSubtitles(item, keepFor) {
    if (!keepFor || keepFor === 'off') return;
    const t = Date.now();
    const until = keepFor === 'forever' ? 0 : t + Number(keepFor) * 24 * 3600 * 1000;
    const key = 'lib:' + item.name + '|' + item.lang;
    const set = { [key]: Object.assign({ t, until }, item) };
    if (item.src) set['src:' + item.src + '|' + item.lang] = key;
    await chrome.storage.local.set(set);
    await pruneSaved();
  }
  // The saved copy of these original lines in a language, or null. The copy
  // must still be there and in time (a deleted one leaves its pointer behind,
  // which goes on the way) and come from the same lines.
  async function findKept(src, lang) {
    if (!src) return null;
    const ptr = 'src:' + src + '|' + lang;
    const key = (await chrome.storage.local.get(ptr))[ptr];
    if (!key) return null;
    const item = (await chrome.storage.local.get(key))[key];
    if (!item || item.src !== src || (item.until && item.until <= Date.now())) {
      await chrome.storage.local.remove(ptr);
      return null;
    }
    return Object.assign({ key }, item);
  }
  // A fingerprint of original subtitles: every line's timing and text
  // (SHA-256, hex). The same file gives the same key on any site or page;
  // another version of it (other timing, other lines) gives another one.
  async function sourceKey(cues) {
    if (!cues || !cues.length || !crypto.subtle) return '';
    const text = cues.map((c) => Math.round(c.start / 100) + '|' + Math.round(c.end / 100) + '|' + String(c.text).replace(/\s+/g, ' ').trim()).join('\n');
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Every saved copy, newest first; ones past their time are deleted on the way.
  async function loadSaved() {
    const all = await chrome.storage.local.get(null);
    const now = Date.now();
    const keys = Object.keys(all).filter((k) => k.startsWith('lib:'));
    const old = keys.filter((k) => all[k].until && all[k].until <= now);
    if (old.length) await chrome.storage.local.remove(old);
    return keys.filter((k) => !old.includes(k)).map((k) => Object.assign({ key: k }, all[k])).sort((a, b) => b.t - a.t);
  }
  const pruneSaved = () => loadSaved().then(() => {});
  const forgetSaved = (key) => chrome.storage.local.remove(key);

  // ---------- shared subtitles ----------

  // Where shared improved subtitles live (~/subtitle-share). shareUrl in storage
  // points elsewhere, for testing with a local copy of the server.
  const SHARE_URL = 'https://subs.cleedek.com';
  // Sharing with others (since 1.1.0). Off = no lookups, no uploads, no
  // settings, no card.
  const SHARING = true;
  // Reusing improved subtitles from Saved subtitles on this computer (the same
  // original lines get the saved copy instead of a new translation), since
  // 1.1.0. Off: nothing is looked up; copies are still saved with their
  // fingerprint, so they're found once it's on.
  const REUSE_SAVED = true;
  const PRIVACY_URL = 'https://cleedek.com/subtitle-overlay/privacy';
  // Only good models' work is shared: any paid one, or a local one with at
  // least 12 billion parameters by its name ("gemma3:12b", "qwen3-14b").
  function shareable(translator, model) {
    if (!AI[translator] || !model) return false;
    if (translator !== 'local') return true;
    const size = /(?:^|[^\d.])(\d+(?:\.\d+)?)b\b/i.exec(model);
    return !!size && Number(size[1]) >= 12;
  }
  // This install's random id for sharing (never shown, it's what deletes your
  // copies), made the first time it's needed.
  async function shareOwner() {
    const got = (await chrome.storage.local.get('shareOwner')).shareOwner;
    if (/^[0-9a-f]{32}$/.test(got || '')) return got;
    const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    await chrome.storage.local.set({ shareOwner: id });
    return id;
  }
  // "4F2A": what others see as "user #4F2A" (the server works it out the same way).
  async function shareTag(owner) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('tag:' + owner));
    return [...new Uint8Array(hash)].slice(0, 2).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  // ---------- pages ----------

  // The YouTube video an address shows (a watch page, Shorts, an embed), or ''.
  function youTubeId(url) {
    try {
      const u = new URL(url);
      if (!/(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname)) return '';
      const id = u.pathname === '/watch' ? u.searchParams.get('v') : (/^\/(?:shorts|embed|live)\/([\w-]+)/.exec(u.pathname) || [])[1];
      return /^[\w-]{11}$/.test(id || '') ? id : '';
    } catch (e) { return ''; }
  }
  // The address a page's last subtitles are remembered under (content.js, and
  // Play in the queue). A YouTube video is one page whatever else its address
  // holds: a start time, a playlist, a search it came from, the mobile site.
  const pageOf = (url) => { const id = youTubeId(url); return id ? 'https://www.youtube.com/watch?v=' + id : url; };

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

  // ---------- keyboard shortcuts ----------

  // Every shortcut can be changed in the popup: a physical key (event.code) plus modifiers.
  // Only the changed ones are stored, under "shortcuts" ({ id: key or null }); null means
  // switched off. The order here is the order in the popup.
  const alt = (code, shift = false) => ({ code, alt: true, shift, ctrl: false, meta: false });
  // Symbol keys sit in different places on different keyboards (on a Czech one "=" is
  // where a US keyboard has "-"). These defaults follow the printed symbol: the key that
  // types it on this keyboard, else the US place. Letters, digits and arrows don't move.
  const SYMBOL_OF = { BracketLeft: '[', BracketRight: ']', Equal: '=', Minus: '-' };
  const SHORTCUTS = [
    { id: 'toggle', name: 'Show / hide subtitles', key: alt('KeyS') },
    { id: 'main', name: 'Show / hide the main subtitles', key: alt('Digit1') },
    { id: 'second', name: 'Show / hide the second subtitles', key: alt('Digit2') },
    { id: 'earlier', name: 'Earlier by 0.1 s', key: alt('BracketLeft') },
    { id: 'later', name: 'Later by 0.1 s', key: alt('BracketRight') },
    { id: 'earlierMore', name: 'Earlier by 1 s', key: alt('BracketLeft', true) },
    { id: 'laterMore', name: 'Later by 1 s', key: alt('BracketRight', true) },
    { id: 'syncReset', name: 'Reset sync to 0', key: alt('Digit0') },
    { id: 'up', name: 'Move subtitles up', key: alt('ArrowUp') },
    { id: 'down', name: 'Move subtitles down', key: alt('ArrowDown') },
    { id: 'bigger', name: 'Bigger subtitles', key: alt('Equal') },
    { id: 'smaller', name: 'Smaller subtitles', key: alt('Minus') },
    { id: 'fullscreen', name: 'Fullscreen with subtitles', key: alt('KeyF') },
    { id: 'repeat', name: 'Repeat the current line', key: alt('KeyR') },
  ];
  // This keyboard's layout (physical code -> what the key types), once read.
  let layout = null;
  async function readLayout(fresh) {
    if (layout && !fresh) return layout;
    // Frames inside a page often can't read it, so the last layout read anywhere is
    // kept in storage and used there; with none at all it's US places and labels.
    const { keyLayout } = await chrome.storage.local.get('keyLayout');
    try {
      const map = await navigator.keyboard.getLayoutMap();
      layout = new Map(map);
      const plain = Object.fromEntries(layout);
      if (JSON.stringify(plain) !== JSON.stringify(keyLayout)) chrome.storage.local.set({ keyLayout: plain });
    } catch (e) {
      layout = new Map(Object.entries(keyLayout || {}));
    }
    return layout;
  }
  // The physical key that types this symbol, or '' if none does without Shift.
  function codeFor(symbol) {
    if (!layout) return '';
    for (const [code, ch] of layout) if (ch === symbol) return code;
    return '';
  }
  function defaultShortcuts() {
    const out = Object.fromEntries(SHORTCUTS.map((s) => [s.id, Object.assign({}, s.key)]));
    const taken = new Set(Object.values(out).filter((k) => !SYMBOL_OF[k.code]).map((k) => k.code));
    for (const k of Object.values(out)) {
      const code = SYMBOL_OF[k.code] && codeFor(SYMBOL_OF[k.code]);
      if (code && !taken.has(code)) k.code = code;
    }
    return out;
  }
  async function loadShortcuts(freshLayout) {
    await readLayout(freshLayout);
    const { shortcuts, toggleKey } = await chrome.storage.local.get(['shortcuts', 'toggleKey']);
    return withShortcuts(shortcuts, toggleKey);
  }
  // Defaults plus the stored changes. "toggleKey" is where 1.0.13 kept the one changeable shortcut.
  function withShortcuts(stored, toggleKey) {
    const out = defaultShortcuts();
    if (toggleKey && toggleKey.code && !(stored && 'toggle' in stored)) out.toggle = toggleKey;
    for (const [id, k] of Object.entries(stored || {})) if (id in out && (k === null || (k && k.code))) out[id] = k;
    return out;
  }
  const keyOf = (e) => ({ code: e.code, alt: e.altKey, shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey });
  const sameKey = (a, b) => !!a && !!b && a.code === b.code && !!a.alt === !!b.alt && !!a.shift === !!b.shift && !!a.ctrl === !!b.ctrl && !!a.meta === !!b.meta;
  // Which action a key press belongs to, or ''.
  function shortcutFor(map, k) {
    for (const s of SHORTCUTS) if (sameKey(map[s.id], k)) return s.id;
    return '';
  }
  const shortcutName = (id) => (SHORTCUTS.find((s) => s.id === id) || {}).name || '';
  // The keys of a shortcut as labels, the Mac way (symbols) or the Windows way.
  function keyParts(k, mac) {
    const parts = [];
    if (k.ctrl) parts.push(mac ? ['\u2303', 'Control'] : ['Ctrl']);
    if (k.alt) parts.push(mac ? ['\u2325', 'Option'] : ['Alt']);
    if (k.shift) parts.push(mac ? ['\u21e7', 'Shift'] : ['Shift']);
    if (k.meta) parts.push(mac ? ['\u2318', 'Command'] : ['Win']);
    parts.push([keyLabel(k.code)]);
    return parts;
  }
  // "⌥F" on a Mac, "Alt+F" elsewhere.
  const keyText = (k, mac) => keyParts(k, mac).map(([l]) => l).join(mac ? '' : '+');
  // The key's own label from its physical code ("KeyS" -> "S", "Digit4" -> "4").
  const KEY_LABELS = {
    Space: 'Space', Enter: 'Enter', Backspace: '⌫', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/', Backquote: '`', IntlBackslash: '§',
  };
  function keyLabel(code) {
    // The symbol this keyboard really prints on that key, when we know it. Digits keep
    // their digit: every keyboard prints it on the key (Czech ones type "+" there).
    const typed = layout && !/^(?:Digit|Numpad|Arrow)/.test(code) && layout.get(code);
    if (typed && typed.trim()) return typed.toUpperCase();
    const m = /^(?:Key|Digit|Numpad)(.+)$/.exec(code);
    return m ? m[1] : KEY_LABELS[code] || code;
  }

  // A short fingerprint of a page address, so counters keep no addresses (FNV-1a).
  function fingerprint(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(36);
  }

  // The one-time "support the creator" card over the video (content.js) is due
  // after 100 translated videos and 3 weeks of use, or 30 videos improved by an AI
  // (someone who set up a model is a fan sooner). It shows on 3 videos at most.
  const SUPPORT_ASK = { videos: 100, days: 21, aiVideos: 30, pages: 3 };
  function supportAskDue(stats, installedAt, now) {
    const s = stats || {};
    const days = installedAt ? ((now || Date.now()) - installedAt) / 864e5 : 0;
    return ((s.videos || 0) >= SUPPORT_ASK.videos && days >= SUPPORT_ASK.days) || (s.aiVideos || 0) >= SUPPORT_ASK.aiVideos;
  }

  root.SubSettings = {
    DEFAULTS, PRESETS, LIMITS, PRESET_KEYS, clamp, withDefaults, load, save, reset, loadPresets, savePreset, deletePreset,
    COLORS, loadRecentColors, addRecentColor,
    LANGUAGES, language, previewText, SUBSETS, languageName, flag, TRANSLATION, loadTranslation, saveTranslation, AI, pickModel,
    KEEP_FOR, keepSubtitles, findKept, sourceKey, SHARE_URL, SHARING, REUSE_SAVED, PRIVACY_URL, shareable, shareOwner, shareTag, loadSaved, pruneSaved, forgetSaved,
    youTubeId, pageOf, siteOf, isOff, loadOffSites, setSiteOff,
    fingerprint, SUPPORT_ASK, supportAskDue,
    SHORTCUTS, readLayout, defaultShortcuts, loadShortcuts, withShortcuts, keyOf, sameKey, shortcutFor, shortcutName, keyParts, keyText, keyLabel,
  };
})(globalThis);
