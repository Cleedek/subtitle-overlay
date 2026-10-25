// Runs inside YouTube's own page (not the extension's sandbox). YouTube's
// caption files can only be downloaded once, by its player, so this copies
// each one as the player receives it and hands the text to content.js.
(function () {
  'use strict';
  if (window.__subOverlayYT) return;
  window.__subOverlayYT = true;
  const isCaptions = (url) => /\/api\/timedtext\b/.test(String(url || ''));
  // The last few files are kept for content.js, which may start after the
  // player already loaded captions (it asks with 'subtitle-overlay-yt-ask').
  const recent = [];
  const fire = (detail) => document.dispatchEvent(new CustomEvent('subtitle-overlay-yt', { detail }));
  const emit = (url, text) => {
    if (!text) return;
    const detail = JSON.stringify({ url: String(new URL(url, location.href)), text });
    recent.push(detail);
    if (recent.length > 3) recent.shift();
    fire(detail);
  };
  document.addEventListener('subtitle-overlay-yt-ask', () => recent.forEach(fire));

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const promise = origFetch.apply(this, arguments);
    const url = typeof input === 'string' ? input : input && input.url;
    if (isCaptions(url)) promise.then((r) => r.clone().text()).then((t) => emit(url, t), () => {});
    return promise;
  };

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (isCaptions(url)) {
      this.addEventListener('load', () => {
        try {
          let t = this.response;
          if (this.responseType === '' || this.responseType === 'text') t = this.responseText;
          else if (this.responseType === 'json') t = JSON.stringify(t);
          else if (t instanceof ArrayBuffer) t = new TextDecoder().decode(t);
          if (typeof t === 'string') emit(url, t);
        } catch (e) { /* not readable */ }
      });
    }
    return open.apply(this, arguments);
  };
})();
