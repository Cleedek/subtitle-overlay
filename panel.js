// DevTools "Subtitles" panel: lists every subtitle response the page loads
// and reads its content straight from DevTools, so it works even when the
// file can't be downloaded again.
(function () {
  'use strict';
  const { SubLib } = globalThis;
  const tabId = chrome.devtools.inspectedWindow.tabId;
  const $ = (id) => document.getElementById(id);

  const items = new Map();    // url without query -> item
  const contents = new Map(); // url without query -> response text (also HLS pieces)

  const stripQuery = (url) => url.split(/[?#]/)[0];
  const VTT_URL = /\.(web)?vtt$/i;
  const SUB_URL = /\.((web)?vtt|srt)$/i;
  const M3U8_URL = /\.m3u8$/i;

  function bg(msg) {
    return chrome.runtime.sendMessage(Object.assign({ tabId }, msg)).catch((e) => ({ ok: false, error: e.message }));
  }

  // DevTools hands back text, or base64 for responses it thinks are binary.
  function contentOf(entry) {
    return new Promise((resolve) => entry.getContent((body, encoding) => {
      if (body == null) return resolve(null);
      resolve(encoding === 'base64' ? SubLib.decode(SubLib.base64ToBytes(body), 'auto').text : body);
    }));
  }

  // ---------- collecting ----------

  async function onEntry(entry) {
    const url = entry.request.url;
    if (!/^https?:/.test(url) || entry.response.status >= 400) return;
    const key = stripQuery(url);
    const mime = String(entry.response.content.mimeType || '').toLowerCase();

    if (SUB_URL.test(key) || mime.includes('text/vtt') || mime.includes('x-subrip')) {
      const text = await contentOf(entry);
      if (text == null) return;
      contents.set(key, text);
      addItem({ kind: 'file', url, text, lang: SubLib.guessLanguage(url) || SubLib.headerLanguage(text) });
    } else if (M3U8_URL.test(key) || mime.includes('mpegurl')) {
      const text = await contentOf(entry);
      if (!text || !text.startsWith('#EXTM3U')) return;
      for (const track of SubLib.subtitleTracks(text, url)) addItem(Object.assign({ kind: 'hls' }, track));
      if (text.includes('#EXTINF')) {
        const segs = SubLib.segmentUrls(text, url);
        if (segs.length && segs.every((s) => VTT_URL.test(stripQuery(s)))) {
          const first = stripQuery(segs[0]);
          addItem({ kind: 'hls', url, playlist: text, lang: SubLib.guessLanguage(url), segmentPrefix: first.slice(0, first.lastIndexOf('/') + 1) });
        }
      }
    }
    render();
  }

  function addItem(item) {
    const key = stripQuery(item.url);
    const existing = items.get(key);
    if (!existing) return items.set(key, item);
    for (const k of Object.keys(item)) if (item[k] && !existing[k]) existing[k] = item[k];
    existing.url = item.url;
  }

  // ---------- turning an item into one subtitle file ----------

  async function fetchText(url) {
    const known = contents.get(stripQuery(url));
    if (known != null) return known;
    const res = await bg({ type: 'fetch-bytes', url });
    if (!res || !res.ok) throw new Error(res ? res.error : 'Download failed.');
    return SubLib.decode(SubLib.base64ToBytes(res.b64), 'auto').text;
  }

  // HLS: use the pieces DevTools already saw, download only the missing ones.
  async function cuesOf(item) {
    if (item.kind === 'file') return SubLib.parse(item.text);
    let url = item.url;
    let playlist = item.playlist || await fetchText(url);
    if (!playlist.includes('#EXTINF')) {
      const track = SubLib.subtitleTracks(playlist, url)[0];
      if (!track) throw new Error('No subtitle track in this playlist.');
      url = track.url;
      playlist = await fetchText(url);
    }
    const segs = SubLib.segmentUrls(playlist, url);
    const texts = [];
    for (let i = 0; i < segs.length; i += 6) {
      texts.push(...await Promise.all(segs.slice(i, i + 6).map(fetchText)));
    }
    const cues = SubLib.stitchSegments(texts);
    if (!cues.length) throw new Error('The pieces are not plain WebVTT text.');
    item.cues = cues;
    return cues;
  }

  function baseName(item) {
    const base = stripQuery(item.url).split('/').pop().replace(/\.(web)?vtt$|\.srt$|\.m3u8$/i, '') || 'subtitles';
    return (base + (item.lang && !base.includes(item.lang) ? '.' + item.lang : '')).replace(/[^\w.\-]+/g, '_');
  }

  const utf8Base64 = (text) => SubLib.bytesToBase64(new TextEncoder().encode(text));

  // ---------- list ----------

  function visibleItems() {
    const prefixes = [...items.values()].filter((i) => i.segmentPrefix).map((i) => i.segmentPrefix);
    return [...items.values()].filter((i) => i.kind === 'hls' || !prefixes.some((p) => i.url.startsWith(p))).reverse();
  }

  function meta(item) {
    if (item.kind === 'hls') {
      if (item.cues) return 'Streaming subtitles · ' + item.cues.length + ' lines · "' + SubLib.preview(item.cues) + '"';
      if (!item.playlist) return 'Streaming subtitles · listed by the player, not loaded yet';
      const segs = SubLib.segmentUrls(item.playlist, item.url);
      const seen = segs.filter((s) => contents.has(stripQuery(s))).length;
      return 'Streaming subtitles · ' + segs.length + ' pieces (' + seen + ' seen so far)';
    }
    if (!item.cues) item.cues = SubLib.parse(item.text);
    return item.cues.length + ' lines' + (item.cues.length ? ' · "' + SubLib.preview(item.cues) + '"' : '');
  }

  function render() {
    const list = visibleItems();
    if (!list.length) {
      const p = document.createElement('div');
      p.className = 'empty';
      p.textContent = 'Nothing yet. Keep DevTools open, then reload the page or switch subtitles on in the player.';
      $('list').replaceChildren(p);
      return;
    }
    $('list').replaceChildren(...list.map(card));
  }

  function card(item) {
    const c = document.createElement('div');
    c.className = 'item';
    const head = document.createElement('div');
    head.className = 'item-head';
    if (item.lang) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = item.lang;
      head.append(b);
    }
    const t = document.createElement('span');
    t.className = 'item-title';
    t.textContent = item.name || decodeURIComponent(stripQuery(item.url).split('/').pop());
    t.title = item.url;
    head.append(t);
    const m = document.createElement('div');
    m.className = 'item-meta';
    m.textContent = meta(item);
    m.title = item.url;
    const row = document.createElement('div');
    row.className = 'row';
    const err = document.createElement('div');
    err.className = 'error';

    const action = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', async () => {
        err.textContent = '';
        b.disabled = true;
        b.textContent = '…';
        try {
          const cues = await cuesOf(item);
          if (!cues.length) throw new Error('No subtitle lines found.');
          const res = await fn(cues);
          if (res && !res.ok) throw new Error(res.error);
          m.textContent = meta(item);
        } catch (e) {
          err.textContent = e.message;
        }
        b.disabled = false;
        b.textContent = label;
      });
      return b;
    };

    row.append(
      action('Use as overlay', (cues) => bg({ type: 'load-into-tab', name: baseName(item) + '.vtt', b64: utf8Base64(SubLib.toVTT(cues)) })),
      action('Download .vtt', (cues) => SubLib.saveText(SubLib.toVTT(cues), baseName(item) + '.vtt')),
      action('Download .srt', (cues) => SubLib.saveText(SubLib.toSRT(cues), baseName(item) + '.srt')),
    );
    c.append(head, m, row, err);
    return c;
  }

  function clear() {
    items.clear();
    contents.clear();
    render();
  }

  $('clear').addEventListener('click', clear);
  chrome.devtools.network.onNavigated.addListener(clear);
  chrome.devtools.network.onRequestFinished.addListener(onEntry);
  // Requests from before the panel was opened (only those since DevTools opened).
  chrome.devtools.network.getHAR((har) => {
    for (const entry of (har && har.entries) || []) if (entry.getContent) onEntry(entry);
  });
  render();
})();
