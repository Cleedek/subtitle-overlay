// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Cleedek

// Windows has no flag emoji: "🇨🇿 Čeština" shows as "CZ Čeština". There the flags
// come from a small font that holds nothing but flags (lib/vendor/flags, 78 kB).
// Every font list that can show a flag starts with "SO Flags"; elsewhere that name
// matches no font and is skipped, so Macs keep their own flags.
// The file comes with the extension (nothing is downloaded) and is read as soon as
// a page or the card over a video starts, on Windows only.
(function (root) {
  'use strict';

  const FAMILY = 'SO Flags';
  const FILE = 'lib/vendor/flags/TwemojiCountryFlags.woff2';
  // The flag letters plus the pieces of the England, Scotland and Wales flags.
  const RANGE = 'U+1F1E6-1F1FF, U+1F3F4, U+E0062-E0063, U+E0065, U+E0067, U+E006C, U+E006E, U+E0073-E0074, U+E0077, U+E007F';
  const done = new WeakSet(); // documents that have it

  const onWindows = () => /^win/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');

  // Extension pages read the file straight away. On websites the page's own
  // security rules could block that, so the background part sends the bytes.
  function source() {
    if (location.protocol === 'chrome-extension:') return Promise.resolve(`url("${chrome.runtime.getURL(FILE)}") format("woff2")`);
    return chrome.runtime.sendMessage({ type: 'flag-font' }).then((res) => {
      if (!res || !res.ok) throw new Error('no flag font');
      return root.SubLib.base64ToBytes(res.b64).buffer;
    });
  }

  function addFlagFont(doc = document) {
    if (done.has(doc) || !onWindows()) return;
    done.add(doc);
    source().then((src) => {
      const face = new FontFace(FAMILY, src, { unicodeRange: RANGE, display: 'swap' });
      doc.fonts.add(face);
      face.load(); // straight away, so the first flag never shows as letters for a moment
    }).catch(() => { done.delete(doc); /* letters then, as before */ });
  }

  root.SubFlags = { addFlagFont, FILE };
  // The popup, the queue and the welcome page: right away. On websites content.js
  // calls it once it draws something.
  if (root.document && location.protocol === 'chrome-extension:') addFlagFont();
})(typeof self !== 'undefined' ? self : this);
