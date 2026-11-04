// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Cleedek

// Runs inside Netflix's own page (not the extension's sandbox). Netflix's
// subtitle addresses have nothing to recognise them by, so this looks at the
// start of what the player receives: only TTML is copied and handed to
// content.js. Video pieces pass through after a look at their first bytes.
(function () {
  'use strict';
  if (window.__subOverlayNetflix) return;
  window.__subOverlayNetflix = true;
  const MAX_BYTES = 5 * 1024 * 1024; // the largest subtitle files are far smaller
  const TTML = /^\s*(?:<\?xml[^>]*\?>\s*|<!--[\s\S]*?-->\s*)*<(?:[\w.-]+:)?tt[\s>]/;
  const decoder = new TextDecoder();
  const looksLike = (bytes) => TTML.test(decoder.decode(bytes.subarray(0, 1024)));

  // The last few files are kept for content.js, which may start after the
  // player already loaded subtitles (it asks with 'subtitle-overlay-page-ask').
  const recent = [];
  const fire = (detail) => document.dispatchEvent(new CustomEvent('subtitle-overlay-page', { detail }));
  const emit = (text) => {
    // Trailers on the home page carry subtitles too: only what you opened counts.
    if (!text || !/\/watch\//.test(location.pathname)) return;
    recent.push(text);
    if (recent.length > 3) recent.shift();
    fire(text);
  };
  document.addEventListener('subtitle-overlay-page-ask', () => recent.forEach(fire));

  async function copy(response) {
    if (+response.headers.get('content-length') > MAX_BYTES) return;
    const reader = response.clone().body.getReader();
    const first = await reader.read();
    if (first.done) return;
    if (!looksLike(first.value)) return reader.cancel();
    const parts = [first.value];
    let size = first.value.length;
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      parts.push(next.value);
      if ((size += next.value.length) > MAX_BYTES) return reader.cancel();
    }
    emit(await new Blob(parts).text());
  }

  const origFetch = window.fetch;
  window.fetch = function () {
    const promise = origFetch.apply(this, arguments);
    promise.then((r) => { if (r.body) return copy(r); }).catch(() => {});
    return promise;
  };

  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', () => {
      try {
        if (this.responseType === '' || this.responseType === 'text') {
          if (TTML.test(this.responseText.slice(0, 1024))) emit(this.responseText);
        } else if (this.responseType === 'arraybuffer' && this.response && this.response.byteLength <= MAX_BYTES) {
          const bytes = new Uint8Array(this.response);
          if (looksLike(bytes)) emit(decoder.decode(bytes));
        }
      } catch (e) { /* not readable */ }
    });
    return send.apply(this, arguments);
  };
})();
