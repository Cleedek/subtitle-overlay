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

  // The player's manifest lists every subtitle language of the title with its
  // file addresses. It arrives encrypted and is read with JSON.parse, so that is
  // where it is seen. Only the list goes to content.js: with it, subtitles in
  // your language can be used as they are instead of being translated.
  const FORMATS = ['imsc1.1', 'dfxp-ls-sdh', 'simplesdh', 'webvtt-lssdh-ios8']; // text formats (others are pictures)
  const tracksRecent = [];
  const fireTracks = (detail) => document.dispatchEvent(new CustomEvent('subtitle-overlay-nf-tracks', { detail }));
  function readManifest(result) {
    const list = result.timedtexttracks || result.textTracks;
    if (!Array.isArray(list)) return;
    const tracks = [];
    for (const tr of list) {
      if (!tr || tr.isNoneTrack || !tr.language) continue;
      const all = tr.ttDownloadables || tr.downloadables || {};
      let urls = [];
      for (const f of FORMATS) {
        const d = all[f];
        if (!d) continue;
        urls = d.downloadUrls ? Object.values(d.downloadUrls) : Array.isArray(d.urls) ? d.urls.map((u) => u && u.url) : [];
        urls = urls.filter((u) => typeof u === 'string' && /^https:/.test(u));
        if (urls.length) break;
      }
      if (!urls.length) continue;
      tracks.push({ lang: String(tr.language), cc: tr.rawTrackType === 'closedcaptions', forced: !!tr.isForcedNarrative, urls: urls.slice(0, 3) });
    }
    if (!tracks.length) return;
    const detail = JSON.stringify({ movieId: String(result.movieId), tracks });
    tracksRecent.push(detail);
    if (tracksRecent.length > 3) tracksRecent.shift();
    fireTracks(detail);
  }
  const parse = JSON.parse;
  JSON.parse = function () {
    const data = parse.apply(this, arguments);
    try {
      const r = data && typeof data === 'object' && data.result;
      if (r && r.movieId && (r.timedtexttracks || r.textTracks)) readManifest(r);
    } catch (e) { /* never break the player */ }
    return data;
  };
  document.addEventListener('subtitle-overlay-nf-tracks-ask', () => tracksRecent.forEach(fireTracks));

  // Netflix lists only the subtitle languages common where you live. Asking
  // for one more in the manifest request (preferredTextLocale) adds it, one
  // language at a time. content.js keeps the language you translate into in
  // this site's localStorage, which both sides can read; this script runs
  // before content.js, so the very first title after installing goes without.
  const stringify = JSON.stringify;
  JSON.stringify = function (data) {
    try {
      if (data && typeof data === 'object' && typeof data.url === 'string' && /manifest/i.test(data.url)) {
        const lang = localStorage.getItem('subtitleOverlayLang');
        if (lang && /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(lang)) {
          for (const v of Object.values(data)) {
            if (v && typeof v === 'object' && ('showAllSubDubTracks' in v || Array.isArray(v.profiles))) v.preferredTextLocale = lang;
          }
        }
      }
    } catch (e) { /* never break the player */ }
    return stringify.apply(this, arguments);
  };

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
