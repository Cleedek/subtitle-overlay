// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Cleedek

// "What's new": a card shown once in the popup after an update has really been installed.
//
// When releasing a version with news: raise "version" in manifest.json and add an entry at the top
// of the list, with short highlights in English (only what a user notices and can try; the card shows
// 3 per page, up to 3 pages), plus their translations in lib/locales. **Two stars** around a word make it bold: the label as the
// interface names it, so people find it. "heading" is optional; without it the card says "in version
// 1.0.20". A version without an entry shows nothing, and new installs never see the card.
// An item can also be limited to the people it's for: { text, os: 'not-mac' } (Windows, Linux,
// ChromeOS), or { text, langs: ['fa', 'bn'] } (the interface language or any of the browser's).
const WIN_KEYS = { os: 'not-mac', text: 'On Windows and Linux, the shortcuts are now **Alt\u00a0+\u00a0Enter** for fullscreen and **Alt\u00a0+\u00a0,** / **Alt\u00a0+\u00a0.** for timing' };
const OLD_ENCODINGS = { langs: ['uk', 'ru', 'bg', 'sr', 'mk', 'be', 'kk', 'el', 'tr', 'he', 'iw', 'th'], text: 'Old subtitle files in Cyrillic, Greek, Turkish, Hebrew or Thai now load with the right letters' };
const PERSIAN_BENGALI = { langs: ['fa', 'bn'], text: 'The interface and translation now come in **Persian** and **Bengali**' };
const SHARED = '**Shared** subtitles: if someone improved the same ones with AI, you get theirs right away';
const SMALLER = 'Plus lots of smaller improvements and bug fixes';

const WHATS_NEW = [
  {
    version: '1.2.0',
    heading: 'in recent versions', // new in 1.2.0, then a recap of 1.1.0 to 1.1.2
    items: [
      '**Make subtitles from the audio** (beta): for videos with no subtitles at all, made on your computer',
      'The **Translation queue** puts episodes in order: you get episode 1 first, then 2, 3 and so on',
      SHARED,
      'If the AI removes lines from subtitles made from the audio, **Put back** brings any of them back',
      WIN_KEYS,
      OLD_ENCODINGS,
      PERSIAN_BENGALI,
      SMALLER,
    ],
  },
  {
    version: '1.1.2',
    items: [WIN_KEYS, OLD_ENCODINGS, SMALLER],
  },
  {
    version: '1.1.1',
    items: [
      PERSIAN_BENGALI,
      'You can now also load **.ass** and **.ssa** subtitle files',
    ],
  },
  {
    version: '1.1.0',
    heading: 'in recent versions', // new in 1.1.0, then a recap of 1.0.17 to 1.0.19
    items: [
      SHARED,
      'Improved subtitles come back anywhere: the same subtitles on another page get your copy from **Saved subtitles** at once, without asking the AI again',
      '**Improve** now also works on YouTube’s automatic captions in your own language: it adds punctuation and fixes misheard words',
      'Subtitles straight from the site: if it has them in your language (YouTube, **Netflix**, **Prime Video**, HBO Max and more), you get those instead of a translation',
      'Free AI translation on your own computer: **Local AI** now sets itself up in two steps',
      'Before **Improve** starts, the AI notes who is who, so names and forms of address stay consistent',
      'No subtitles? The **Help** label on the video walks you through it, and **Report a problem** sends me the site’s name',
      '**Translation queue** progress now shows in the card over the video, and the finished file replaces Google’s lines on its own',
      SMALLER,
    ],
  },
];

const versionParts = (v) => String(v).split('.').map(Number);
function versionIsNewer(a, b) {
  const [x, y] = [versionParts(a), versionParts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

// Background worker: note which version the person came from. If they skip the card and another
// update arrives, the first version is kept, so they see everything they missed.
function rememberUpdate({ reason, previousVersion }) {
  if (reason !== 'update' || !previousVersion) return;
  if (!versionIsNewer(chrome.runtime.getManifest().version, previousVersion)) return;
  chrome.storage.local.get('whatsNewFrom').then(({ whatsNewFrom }) => {
    if (!whatsNewFrom) chrome.storage.local.set({ whatsNewFrom: previousVersion });
  }).catch(() => {});
}

// "Text with **bold** words" -> text and <b> nodes, never HTML.
function richText(text) {
  return String(text).split('**').map((part, i) => {
    if (!(i % 2)) return document.createTextNode(part);
    const b = document.createElement('b');
    b.dir = 'auto'; // ".ttml" keeps its dot in front inside right-to-left text
    b.textContent = part;
    return b;
  });
}

const PER_PAGE = 3;
const MAX_PAGES = 3;
const AUTO_MS = 5000;

// Several pages: dots underneath, arrows that show under the mouse, a swipe on the trackpad, and a
// page change every 5 s while nobody is pointing at, touching or tabbing through the card. With
// "reduce motion" switched on in the system, pages only change when the person asks.
function setupPages(pages, t) {
  const $ = (id) => document.getElementById(id);
  const row = $('newsList');
  const card = $('whatsNew');
  const dots = pages.map((page, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', t('Page {n} of {total}', { n: i + 1, total: pages.length }));
    b.addEventListener('click', () => { go(i); restart(); });
    return b;
  });
  $('newsDots').replaceChildren(...dots);
  $('newsNav').hidden = false;

  let index = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const go = (i) => {
    index = (i + pages.length) % pages.length;
    // Slide the row sideways only: scrollIntoView would also scroll the whole popup up to the card.
    // Offsets from the first page come out negative in right-to-left, as Chrome's scrollLeft does there.
    row.scrollTo({ left: pages[index].offsetLeft - pages[0].offsetLeft, behavior: reduce.matches ? 'instant' : 'smooth' });
    mark();
  };
  const mark = () => {
    dots.forEach((d, i) => d.setAttribute('aria-current', String(i === index)));
    pages.forEach((p, i) => p.toggleAttribute('inert', i !== index)); // screen readers and Tab stay on the visible page
  };
  // A swipe or a scroll by hand: the page that ends up in view is the current one.
  row.addEventListener('scrollend', () => {
    const w = row.clientWidth || 1;
    const i = Math.round(Math.abs(row.scrollLeft) / w);
    if (i !== index) { index = i; mark(); restart(); }
  });
  $('newsPrev').addEventListener('click', () => { go(index - 1); restart(); });
  $('newsNext').addEventListener('click', () => { go(index + 1); restart(); });

  let timer = 0;
  let held = false;
  let onScreen = true; // pages change by themselves only while the whole card is in view
  const stop = () => { clearInterval(timer); timer = 0; };
  const restart = () => {
    stop();
    if (held || !onScreen || reduce.matches || document.hidden || card.hidden) return;
    timer = setInterval(() => go(index + 1), AUTO_MS);
  };
  const hold = (on) => { held = on; restart(); };
  card.addEventListener('pointerenter', () => hold(true));
  card.addEventListener('pointerleave', () => hold(false));
  card.addEventListener('focusin', () => hold(true));
  card.addEventListener('focusout', (e) => { if (!card.contains(e.relatedTarget)) hold(false); });
  document.addEventListener('visibilitychange', restart);
  reduce.addEventListener('change', restart);
  $('newsClose').addEventListener('click', stop);
  new IntersectionObserver(([e]) => { onScreen = e.intersectionRatio > 0.99; restart(); }, { threshold: [0, 1] }).observe(card);
  mark();
  restart();
}

// Popup: the card while it's unread, then a quiet link in the footer. Returns whether the card shows.
async function setupWhatsNew({ slug, i18n }) {
  const $ = (id) => document.getElementById(id);
  const t = i18n.t;
  const current = chrome.runtime.getManifest().version;
  const url = `https://cleedek.com/${i18n.lang === 'cs' ? 'cs/' : ''}work/${slug}#changelog`;
  $('newsMore').href = url;
  $('newsLink').href = url;

  const showLink = () => {
    // The newest entry up to this version (the list is newest first): a bug-fix
    // release without its own entry keeps the link to the last one.
    const entry = WHATS_NEW.find((n) => !versionIsNewer(n.version, current));
    if (!entry) return;
    $('newsLinkText').textContent = t("What's new in version {version}", { version: entry.version });
    $('newsLink').hidden = false;
  };

  const { whatsNewFrom: from } = await chrome.storage.local.get('whatsNewFrom').catch(() => ({}));
  const unread = from ? WHATS_NEW.filter((n) => versionIsNewer(n.version, from) && !versionIsNewer(n.version, current)) : [];
  if (!unread.length) {
    if (from) chrome.storage.local.remove('whatsNewFrom').catch(() => {});
    showLink();
    return false;
  }

  const top = unread[0];
  $('newsVersion').textContent = top.heading ? t(top.heading) : t('in version {version}', { version: top.version });
  // Up to 3 highlights per page, at most 3 pages; a line two versions share shows once, and a line
  // meant for other people (another system, another language) not at all.
  const mac = /Mac/i.test(navigator.platform);
  const langs = new Set([i18n.lang, ...(navigator.languages || [])].map((l) => String(l).toLowerCase().split('-')[0]));
  const forMe = (item) => {
    if (typeof item === 'string') return item;
    if (item.os === 'not-mac' && mac) return null;
    if (item.langs && !item.langs.some((l) => langs.has(l))) return null;
    return item.text;
  };
  const all = [...new Set(unread.flatMap((n) => n.items.map(forMe)).filter(Boolean))];
  const rest = all.filter((text) => text !== SMALLER); // "Plus lots of smaller improvements": once, and last
  const items = rest.length < all.length ? [...rest.slice(0, PER_PAGE * MAX_PAGES - 1), SMALLER] : rest.slice(0, PER_PAGE * MAX_PAGES);
  const pages = [];
  for (let i = 0; i < items.length; i += PER_PAGE) {
    const ul = document.createElement('ul');
    ul.className = 'news-list';
    ul.append(...items.slice(i, i + PER_PAGE).map((text) => {
      const li = document.createElement('li');
      li.append(...richText(t(text)));
      return li;
    }));
    pages.push(ul);
  }
  $('newsList').replaceChildren(...pages);
  $('whatsNew').hidden = false;
  document.body.classList.add('has-news');
  if (pages.length > 1) setupPages(pages, t);
  $('newsClose').addEventListener('click', () => {
    $('whatsNew').hidden = true;
    document.body.classList.remove('has-news');
    chrome.storage.local.remove('whatsNewFrom').catch(() => {});
    showLink();
  });
  return true;
}
