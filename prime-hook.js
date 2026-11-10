// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Cleedek

// Runs inside Prime Video's own page (primevideo.com, amazon.*/gp/video), not
// the extension's sandbox. When a title starts, the player asks Amazon for its
// "playback resources", which list every subtitle language with a file address.
// Only that list goes to content.js: with it, subtitles in your language can be
// used as they are instead of being translated. Nothing is changed or asked for.
(function () {
  'use strict';
  if (window.__subOverlayPrime) return;
  window.__subOverlayPrime = true;
  const RESOURCES = /PlaybackResources/i; // GetPlaybackResources, GetVodPlaybackResources
  const recent = [];
  const fire = (detail) => document.dispatchEvent(new CustomEvent('subtitle-overlay-site-tracks', { detail }));

  // The lists sit under keys like subtitleUrls and forcedNarratives, at
  // different depths in old and new answers: looked for anywhere.
  function collect(node, key, out, depth) {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (Array.isArray(node)) {
      if (/subtitle|forced|timedtext/i.test(key)) {
        for (const s of node) {
          if (!s || typeof s.url !== 'string' || !/^https:/.test(s.url)) continue;
          const lang = s.languageCode || s.language || '';
          if (!lang) continue;
          const kind = [s.type, s.subtype, s.trackType].join(' ');
          out.push({
            lang: String(lang),
            name: String(s.displayName || ''),
            cc: /sdh|caption|\bcc\b/i.test(kind),
            forced: /forced/i.test(key + ' ' + kind),
            urls: [s.url],
          });
        }
      }
      return;
    }
    for (const k of Object.keys(node)) collect(node[k], k, out, depth + 1);
  }

  function read(data, url, body) {
    // Trailers ask too: only the title you started counts.
    if (/Trailer/.test(String(url)) || (typeof body === 'string' && /"Trailer"/.test(body))) return;
    const tracks = [];
    collect(data, '', tracks, 0);
    if (!tracks.length) return;
    let id = '';
    try { id = new URL(url, location.href).searchParams.get('asin') || ''; } catch (e) { /* no id */ }
    if (!id && typeof body === 'string') id = (/"titleId"\s*:\s*"([^"]+)"/.exec(body) || [])[1] || '';
    const detail = JSON.stringify({ site: 'Prime Video', id, tracks: tracks.slice(0, 150) });
    recent.push(detail);
    if (recent.length > 3) recent.shift();
    fire(detail);
  }
  document.addEventListener('subtitle-overlay-site-tracks-ask', () => recent.forEach(fire));

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const promise = origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      if (RESOURCES.test(String(url))) {
        const body = init && init.body;
        promise.then((r) => r.clone().json()).then((data) => read(data, url, body)).catch(() => {});
      }
    } catch (e) { /* never break the player */ }
    return promise;
  };

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__subOverlayUrl = String(url);
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (RESOURCES.test(this.__subOverlayUrl || '')) {
      this.addEventListener('load', () => {
        try {
          const data = this.responseType === 'json' ? this.response
            : this.responseType === '' || this.responseType === 'text' ? JSON.parse(this.responseText) : null;
          if (data) read(data, this.__subOverlayUrl, body);
        } catch (e) { /* not readable */ }
      });
    }
    return send.apply(this, arguments);
  };
})();
