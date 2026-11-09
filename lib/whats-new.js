// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Cleedek

// "What's new": a card shown once in the popup after an update has really been installed.
//
// When releasing a version with news: raise "version" in manifest.json and add an entry at the top
// of the list, with 3 to 4 short highlights in English (only what a user notices and can try), plus
// their translations in lib/locales. **Two stars** around a word make it bold: the label as the
// interface names it, so people find it. "heading" is optional; without it the card says "in version
// 1.0.20". A version without an entry shows nothing, and new installs never see the card.
const WHATS_NEW = [
  {
    version: '1.0.19',
    heading: 'in recent versions', // sums up 1.0.17 to 1.0.19
    items: [
      'Added support for **Netflix** and **.ttml** subtitles',
      'Before **Improve** starts, the AI notes who is who, so names and forms of address stay consistent',
      'The interface now comes in **23 more languages**',
      'Plus lots of smaller improvements',
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

// Popup: the card while it's unread, then a quiet link in the footer. Returns whether the card shows.
async function setupWhatsNew({ slug, i18n }) {
  const $ = (id) => document.getElementById(id);
  const t = i18n.t;
  const current = chrome.runtime.getManifest().version;
  const url = `https://cleedek.com/${i18n.lang === 'cs' ? 'cs/' : ''}work/${slug}#changelog`;
  $('newsMore').href = url;
  $('newsLink').href = url;

  const showLink = () => {
    const entry = WHATS_NEW.find((n) => !versionIsNewer(n.version, current) && !versionIsNewer(current, n.version));
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
  $('newsList').replaceChildren(...unread.flatMap((n) => n.items).slice(0, 4).map((text) => {
    const li = document.createElement('li');
    li.append(...richText(t(text)));
    return li;
  }));
  $('whatsNew').hidden = false;
  document.body.classList.add('has-news');
  $('newsClose').addEventListener('click', () => {
    $('whatsNew').hidden = true;
    document.body.classList.remove('has-news');
    chrome.storage.local.remove('whatsNewFrom').catch(() => {});
    showLink();
  });
  return true;
}
