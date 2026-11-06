// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Cleedek

// Subtitle parsing, decoding and export. Shared by the content script,
// the popup and the background worker (no DOM needed here).
(function (root) {
  'use strict';

  // ---------- text encoding ----------

  const CZECH = /[ěščřžýůťďňĚŠČŘŽÝŮŤĎŇ]/g;
  // Vietnamese-only letters plus the combining tone marks Windows-1258 produces.
  const VIETNAMESE = /[ơưđƠƯĐăâêôĂÂÊỘ̀́̃̉]/g;
  const ARABIC = /[\u0621-\u064A]/g;
  const LATIN = /[A-Za-z]/g;

  function count(text, re) {
    const m = text.match(re);
    return m ? m.length : 0;
  }

  // bytes: Uint8Array. encoding: 'auto' or a TextDecoder label.
  // Returns { text, encoding } where encoding is the one actually used.
  function decode(bytes, encoding) {
    let enc = encoding || 'auto';
    if (enc === 'auto') {
      // A UTF-16 byte order mark wins outright.
      if (bytes[0] === 0xff && bytes[1] === 0xfe) enc = 'utf-16le';
      else if (bytes[0] === 0xfe && bytes[1] === 0xff) enc = 'utf-16be';
    }
    if (enc === 'auto') {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return { text: stripBom(text), encoding: 'utf-8' };
      } catch (e) {
        // Not valid UTF-8: an East Asian code page if one reads as real text,
        // else the single-byte code page whose letters fit best.
        const cjk = guessCjk(bytes);
        if (cjk) return cjk;
        // Arabic is almost all high bytes; Czech and Vietnamese are mostly plain Latin letters.
        const ar = new TextDecoder('windows-1256').decode(bytes);
        const letters = count(ar, ARABIC);
        if (letters >= 20 && letters > count(ar, LATIN) * 2) return { text: stripBom(ar), encoding: 'windows-1256' };
        const cz = new TextDecoder('windows-1250').decode(bytes);
        const vi = new TextDecoder('windows-1258').decode(bytes);
        const viWins = count(vi, VIETNAMESE) > count(cz, CZECH) * 1.5;
        return viWins
          ? { text: stripBom(vi.normalize('NFC')), encoding: 'windows-1258' }
          : { text: stripBom(cz), encoding: 'windows-1250' };
      }
    }
    let text = new TextDecoder(enc).decode(bytes);
    if (enc === 'windows-1258') text = text.normalize('NFC');
    return { text: stripBom(text), encoding: enc };
  }

  // Old Japanese, Chinese and Korean subtitles use two-byte code pages. Any of
  // them can decode the others' bytes into nonsense characters, so each
  // candidate is scored by how often the most common words of the language
  // show up (Japanese particles, Korean endings, Chinese 的/是/了). Nonsense
  // almost never hits them. Earlier entries win a tie: EUC-JP before GBK,
  // since GBK keeps EUC-JP's kana but garbles its kanji.
  const CJK_CODEPAGES = ['shift_jis', 'euc-jp', 'euc-kr', 'big5', 'gbk'];
  const CJK_COMMON = /[のはにをたがてでとしいなよねっ이는다에가을를고의지요니해서的是了我你不在他这這们們么麼有个個说說]/g;
  const NON_ASCII = /[^\x00-\x7f]/g;

  function guessCjk(bytes) {
    let best = null;
    for (const enc of CJK_CODEPAGES) {
      let text;
      try { text = new TextDecoder(enc, { fatal: true }).decode(bytes); } catch (e) { continue; }
      const hits = count(text, CJK_COMMON);
      const wide = count(text, NON_ASCII);
      // Real text: common words make up a good share of the non-Latin letters.
      if (hits < 5 || hits < wide * 0.04) continue;
      const score = hits / wide;
      if (!best || score > best.score * 1.1) best = { score, text, enc };
    }
    return best ? { text: stripBom(best.text), encoding: best.enc } : null;
  }

  function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  // ---------- base64 (messages between extension parts carry bytes as text) ----------

  function bytesToBase64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ---------- parsing ----------

  // "01:02:03,456", "02:03.456", "1:02:03.4" -> milliseconds
  const TIME = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;

  function parseTime(str) {
    const m = TIME.exec(str);
    if (!m) return null;
    const ms = m[4].padEnd(3, '0');
    return ((+(m[1] || 0) * 60 + +m[2]) * 60 + +m[3]) * 1000 + +ms;
  }

  // X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000 -> offset in ms (or null)
  function parseTimestampMap(text) {
    const m = /X-TIMESTAMP-MAP=([^\r\n]+)/.exec(text);
    if (!m) return null;
    const ts = /MPEGTS:(\d+)/.exec(m[1]);
    const local = /LOCAL:([\d:.,]+)/.exec(m[1]);
    if (!ts) return null;
    return Math.round((+ts[1] / 90000) * 1000) - (local ? parseTime(local[1]) || 0 : 0);
  }

  // Parses SRT, WebVTT, TTML (DFXP, IMSC) or YouTube's own caption formats. Returns cues sorted by start: [{ start, end, text }] (ms).
  function parse(text) {
    const ttml = parseTTML(text);
    if (ttml) return ttml;
    const yt = parseYouTube(text);
    if (yt) return yt;
    const lines = stripBom(String(text)).replace(/\r\n?/g, '\n').split('\n');
    const cues = [];
    let i = 0;
    while (i < lines.length) {
      // Skip blank lines between blocks.
      if (!lines[i].trim()) { i++; continue; }
      // Collect one block.
      const block = [];
      while (i < lines.length && lines[i].trim()) block.push(lines[i++]);
      const first = block[0].trim();
      if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(first)) continue;
      const timingIndex = block.findIndex((l) => l.includes('-->'));
      if (timingIndex < 0 || timingIndex > 1) continue;
      const [left, right] = block[timingIndex].split('-->');
      const start = parseTime(left);
      const end = parseTime(right);
      if (start == null || end == null || end <= start) continue;
      const body = block.slice(timingIndex + 1).join('\n');
      if (!body.trim()) continue;
      cues.push({ start, end, text: body });
    }
    cues.sort((a, b) => a.start - b.start || a.end - b.end);
    return cues;
  }

  // Some uploaders' captions carry formatting tags as plain text, and YouTube
  // hands them over that way ("<b>Hello</b>", also escaped once more). Those
  // become real formatting or go. Anything else in angle brackets, like "<3" or
  // "<i think>", is what someone wrote and stays. Takes escaped text.
  function youTubeTags(body) {
    return body.replace(/&(?:amp;)?lt;(\/?)([a-z]+)([ .][^\n]*?)?&(?:amp;)?gt;/gi, (all, slash, name, rest) => {
      const tag = name.toLowerCase();
      if (/^[biu]$/.test(tag)) return rest ? all : '<' + slash + tag + '>';
      if (tag === 'br') return '\n';
      return /^(font|span|c|v|lang|ruby|rt)$/.test(tag) ? '' : all;
    });
  }

  // YouTube captions (/api/timedtext) come as JSON ("json3") or XML ("srv3",
  // older "transcript"), not as WebVTT. Returns null for anything else.
  // YouTube's captions roll: a line stays up while the next one arrives (in
  // auto-generated, auto-translated and many hand-made files alike), which
  // stacked old and new lines on the video. So a line ends where the next starts.
  function parseYouTube(text) {
    const t = stripBom(String(text)).trimStart();
    const cues = [];
    const escape = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (t[0] === '{') {
      let data;
      try { data = JSON.parse(t); } catch (e) { return null; }
      if (!data || !Array.isArray(data.events)) return null;
      for (const ev of data.events) {
        if (!ev.segs || ev.aAppend) continue;
        const body = ev.segs.map((sg) => sg.utf8 || '').join('').trim();
        const start = +ev.tStartMs || 0;
        if (body) cues.push({ start, end: start + (+ev.dDurationMs || 0), text: youTubeTags(escape(body)) });
      }
    } else if (/^<\?xml|^<(timedtext|transcript)\b/.test(t)) {
      // srv3: <p t="ms" d="ms">, transcript: <text start="s" dur="s">
      const re = /<(p|text)\b([^>]*)>([\s\S]*?)<\/\1>/g;
      let m;
      while ((m = re.exec(t))) {
        const attr = (name) => { const a = new RegExp('\\b' + name + '="([\\d.]+)"').exec(m[2]); return a ? +a[1] : null; };
        const ms = m[1] === 'p';
        const start = ms ? attr('t') : Math.round((attr('start') || 0) * 1000);
        const dur = ms ? attr('d') : Math.round((attr('dur') || 0) * 1000);
        if (start == null) continue;
        // transcript text is escaped twice (&amp;#39;); srv3 once.
        let body = m[3].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
        if (!ms) body = decodeEntities(body);
        body = youTubeTags(body).trim();
        if (body) cues.push({ start, end: start + (dur || 0), text: body });
      }
      if (!cues.length && !/<(p|text)\b/.test(t)) return null;
    } else {
      return null;
    }
    cues.sort((a, b) => a.start - b.start);
    for (let i = 0; i < cues.length; i++) {
      const next = cues[i + 1];
      if (next && next.start > cues[i].start && next.start < cues[i].end) cues[i].end = next.start;
      if (cues[i].end <= cues[i].start) cues[i].end = cues[i].start + 2000;
    }
    return cues;
  }

  // TTML is the XML subtitle format of big streaming services, also known by the
  // names DFXP, IMSC and EBU-TT-D. No DOM here (the background worker has none),
  // so the tags are read one by one. Times can be written many ways: see ttmlTime.
  const TTML_START = /^\s*(?:<\?xml[^>]*\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<(?:[\w.-]+:)?tt[\s>]/;
  const isTTML = (text) => TTML_START.test(stripBom(String(text)).slice(0, 8192));

  // Attributes by their name without prefix (tts:fontStyle -> fontStyle). Values stay escaped.
  function xmlAttrs(str) {
    const out = {};
    const re = /(?:[\w.-]+:)?([\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(str))) out[m[1]] = m[2] != null ? m[2] : m[3];
    return out;
  }

  // "00:01:02.5", "00:01:02:12" (frames), "62.5s", "500ms", "1.5m", "1h", "30f",
  // "620000000t" (ticks, Netflix) -> milliseconds, or null.
  function ttmlTime(value, rate) {
    const s = String(value || '').trim();
    let m = /^(\d+):(\d{2}):(\d{2})(?:[.,](\d+)|:(\d+)(?:\.(\d+))?)?$/.exec(s);
    if (m) {
      const frames = (+(m[5] || 0) + +(m[6] || 0) / rate.sub) / rate.frame;
      return Math.round((+m[1] * 3600 + +m[2] * 60 + +m[3] + +('0.' + (m[4] || 0)) + frames) * 1000);
    }
    m = /^(\d+(?:\.\d+)?)(h|ms|m|s|f|t)$/.exec(s);
    if (!m) return null;
    const unit = { h: 3600000, m: 60000, s: 1000, ms: 1, f: 1000 / rate.frame, t: 1000 / rate.tick }[m[2]];
    return Math.round(+m[1] * unit);
  }

  // Timing can sit on the line, on its words, or on the blocks around it. Italics,
  // bold and underline become <i>, <b>, <u>; position and colour are left out, as
  // in the other formats (the overlay has its own style). Text stays escaped, as
  // cue text does everywhere. Returns null for anything that isn't TTML, and an
  // empty list for TTML holding pictures instead of text.
  function parseTTML(text) {
    if (!isTTML(text)) return null;
    const src = stripBom(String(text));
    const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)(?:[\w.-]+:)?([\w.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
    const styles = {};
    let rate = null;
    const cues = [];
    const stack = []; // open elements: { name, begin, end, timed, fmt, closes, owner }
    let cur = null;   // the cue being collected
    let skip = 0;     // depth inside something that isn't text (metadata, ...)
    let inBody = false;

    const fmtOf = (a, depth = 0) => {
      const out = {};
      if (depth < 8) for (const id of (a.style || '').split(/\s+/)) if (styles[id]) Object.assign(out, fmtOf(styles[id], depth + 1));
      if (a.fontStyle) out.i = /italic|oblique/.test(a.fontStyle);
      if (a.fontWeight) out.b = a.fontWeight === 'bold';
      if (a.textDecoration) out.u = /(^|\s)underline/.test(a.textDecoration);
      return out;
    };
    const finish = () => {
      // Spaces at the ends of a line go, also those just inside <i>…</i>.
      const body = cur.parts.join('').replace(/[ \t]*\n[ \t]*/g, '\n').trim()
        .replace(/(^|\n)((?:<[ibu]>)+)[ \t]+/g, '$1$2').replace(/[ \t]+((?:<\/[ibu]>)+)(?=\n|$)/g, '$1');
      if (body.replace(/<[^>]*>/g, '').trim() && cur.end > cur.begin) cues.push({ start: cur.begin, end: cur.end, text: body });
      cur = null;
    };

    let m;
    while ((m = tokens.exec(src))) {
      const [, cdata, slash, name, rawAttrs, selfClose, chars] = m;
      if (chars != null || cdata != null) {
        if (!cur || skip) continue;
        cur.parts.push(chars != null ? chars.replace(/\s+/g, ' ')
          : cdata.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
        continue;
      }
      if (!name) continue; // comment, <?xml ?>

      if (slash) {
        if (skip) { skip--; continue; }
        if (!inBody) continue;
        const open = stack.pop();
        if (!open) continue;
        if (cur) cur.parts.push(...open.closes);
        if (cur && cur.owner === open) finish();
        if (name === 'body') inBody = false;
        continue;
      }

      const a = xmlAttrs(rawAttrs);
      if (!rate && name === 'tt') {
        const [num, den] = (a.frameRateMultiplier || '1 1').split(/[\s:]+/).map(Number);
        const frame = (+a.frameRate > 0 ? +a.frameRate : 30) * (num > 0 && den > 0 ? num / den : 1);
        const sub = +a.subFrameRate > 0 ? +a.subFrameRate : 1;
        rate = { frame, sub, tick: +a.tickRate > 0 ? +a.tickRate : +a.frameRate > 0 ? +a.frameRate * sub : 1 };
      }
      if (!inBody) {
        if (name === 'style' && a.id) styles[a.id] = a;
        if (name === 'body' && !selfClose) inBody = true;
        else continue;
      }
      if (skip || !['body', 'div', 'p', 'span', 'br'].includes(name)) { if (!selfClose) skip++; continue; }
      if (name === 'br') { if (cur) cur.parts.push('\n'); if (!selfClose) stack.push({ name, closes: [] }); continue; }

      const parent = stack[stack.length - 1] || { begin: 0, end: Infinity, timed: false, fmt: {} };
      const begin = ttmlTime(a.begin, rate);
      const end = ttmlTime(a.end, rate);
      const dur = ttmlTime(a.dur, rate);
      const start = parent.begin + (begin || 0);
      const stop = Math.min(parent.end, end != null ? parent.begin + end : Infinity, dur != null ? start + dur : Infinity);
      const open = { name, begin: start, end: stop, timed: parent.timed || begin != null || end != null || dur != null,
        fmt: Object.assign({}, parent.fmt, fmtOf(a)), closes: [] };
      // A cue is one timed line, or one timed word group in a line without a time of its own.
      if (!cur && open.timed && (name === 'p' || name === 'span')) {
        cur = { begin: start, end: stop, parts: [], owner: open };
        for (const k of ['i', 'b', 'u']) if (open.fmt[k]) { cur.parts.push('<' + k + '>'); open.closes.unshift('</' + k + '>'); }
      } else if (cur) {
        for (const k of ['i', 'b', 'u']) if (open.fmt[k] && !parent.fmt[k]) { cur.parts.push('<' + k + '>'); open.closes.unshift('</' + k + '>'); }
      }
      if (selfClose) {
        if (cur) cur.parts.push(...open.closes);
        if (cur && cur.owner === open) finish();
      } else stack.push(open);
    }

    cues.sort((x, y) => x.start - y.start || x.end - y.end);
    // Two lines of one subtitle are sometimes separate elements in separate places on screen.
    const out = [];
    for (const c of cues) {
      const last = out[out.length - 1];
      if (last && last.start === c.start && last.end === c.end) last.text += '\n' + c.text;
      else out.push(c);
    }
    // A line with no end stays until the next one.
    out.forEach((c, i) => {
      if (c.end === Infinity) c.end = out[i + 1] ? out[i + 1].start : c.start + 5000;
    });
    return out;
  }

  // Joins HLS subtitle segments (each a small WebVTT file) into one cue list.
  // Each segment's X-TIMESTAMP-MAP is applied relative to the first segment,
  // and cues repeated across segment boundaries are kept once.
  function stitchSegments(segmentTexts) {
    const offsets = segmentTexts.map(parseTimestampMap);
    const known = offsets.filter((o) => o != null);
    const base = known.length ? Math.min(...known) : 0;
    const seen = new Set();
    const out = [];
    segmentTexts.forEach((text, idx) => {
      const shift = offsets[idx] == null ? 0 : offsets[idx] - base;
      for (const cue of parse(text)) {
        const c = { start: cue.start + shift, end: cue.end + shift, text: cue.text };
        const key = c.start + '|' + c.end + '|' + c.text;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(c);
      }
    });
    out.sort((a, b) => a.start - b.start || a.end - b.end);
    return out;
  }

  // ---------- cue text ----------

  const ENTITIES = { amp: '&', lt: '<', gt: '>', nbsp: ' ', lrm: '‎', rlm: '‏', quot: '"', apos: "'" };

  function decodeEntities(s) {
    return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (all, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : all;
      }
      return ENTITIES[e.toLowerCase()] ?? all;
    });
  }

  // Splits cue text into styled runs: [{ text, i, b, u }]. Only <i>, <b>, <u>
  // are kept; every other tag (<font>, <c.x>, <v Name>, {\an8}, timestamps) is dropped.
  function toRuns(raw) {
    const text = raw.replace(/\{\\[^}]*\}/g, '');
    const runs = [];
    const state = { i: 0, b: 0, u: 0 };
    const re = /<(\/?)([a-zA-Z]+|\d[\d:.]*)[^>]*>/g;
    let last = 0;
    let m;
    const push = (s) => {
      if (!s) return;
      runs.push({ text: decodeEntities(s), i: state.i > 0, b: state.b > 0, u: state.u > 0 });
    };
    while ((m = re.exec(text))) {
      push(text.slice(last, m.index));
      last = re.lastIndex;
      const tag = m[2].toLowerCase();
      if (tag in state) state[tag] = Math.max(0, state[tag] + (m[1] ? -1 : 1));
    }
    push(text.slice(last));
    return runs;
  }

  // Drops what only helps without sound: [Music] / [hudba], all-caps (LAUGHS),
  // lines of only music notes, and the ">>" YouTube puts where the speaker
  // changes. Works on raw cue text (tags and entities still in). An empty
  // result means nothing is left to show.
  function cleanCaption(raw) {
    const bare = (l) => l.replace(/<[^>]*>/g, '').trim();
    return String(raw)
      .replace(/(?:>>|&gt;&gt;)\s*/g, '')
      .replace(/\[[^\]\n]*\]/g, '')
      .replace(/\(\s*[A-Z\u00c0-\u017d][A-Z\u00c0-\u017d\s'.,-]{3,}\)/g, '')
      .split('\n')
      .map((l) => l.replace(/\s{2,}/g, ' ').trim())
      .filter((l) => bare(l) && !/^\(.*\)$/.test(bare(l)) && !/^[\u266a\u266b\u266c#\s]+$/.test(bare(l)))
      .join('\n');
  }

  // Plain text with only i/b/u tags left, for exporting.
  function cleanText(raw) {
    return toRuns(raw).map((r) => {
      let s = r.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (r.u) s = '<u>' + s + '</u>';
      if (r.b) s = '<b>' + s + '</b>';
      if (r.i) s = '<i>' + s + '</i>';
      return s;
    }).join('').replace(/<\/(i|b|u)><\1>/g, '');
  }

  // ---------- export ----------

  function formatTime(ms, sep) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const f = Math.floor(ms % 1000);
    const p = (n, w) => String(n).padStart(w, '0');
    return p(h, 2) + ':' + p(m, 2) + ':' + p(s, 2) + sep + p(f, 3);
  }

  function toSRT(cues) {
    return cues.map((c, i) =>
      (i + 1) + '\n' + formatTime(c.start, ',') + ' --> ' + formatTime(c.end, ',') + '\n' + cleanText(c.text)
    ).join('\n\n') + '\n';
  }

  function toVTT(cues) {
    return 'WEBVTT\n\n' + cues.map((c) =>
      formatTime(c.start, '.') + ' --> ' + formatTime(c.end, '.') + '\n' + cleanText(c.text)
    ).join('\n\n') + '\n';
  }

  // First visible line of the first cue, for previews in the popup.
  function preview(cues) {
    if (!cues.length) return '';
    return toRuns(cues[0].text).map((r) => r.text).join('').split('\n')[0].trim();
  }

  // ---------- HLS playlists ----------

  // #EXT-X-MEDIA:TYPE=SUBTITLES,NAME="Čeština",URI="x.m3u8" -> { TYPE, NAME, URI }
  function parseAttrs(line) {
    const out = {};
    const re = /([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g;
    let m;
    while ((m = re.exec(line))) out[m[1]] = m[3] != null ? m[3] : m[2];
    return out;
  }

  function segmentUrls(text, base) {
    return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => new URL(l, base).href);
  }

  // Subtitle tracks listed in a master playlist: [{ url, lang, name }]
  function subtitleTracks(text, base) {
    return text.split(/\r?\n/).filter((l) => l.startsWith('#EXT-X-MEDIA:')).map((l) => parseAttrs(l.slice(13)))
      .filter((a) => a.TYPE === 'SUBTITLES' && a.URI)
      .map((a) => ({ url: new URL(a.URI, base).href, lang: (a.LANGUAGE || '').toLowerCase(), name: a.NAME || '' }));
  }

  // Language code hidden in a URL like ".../ep12_cze.vtt" or "?lang=cs".
  function guessLanguage(text) {
    const m = /(?:^|[._/\-=])(cs|cz|cze|ces|sk|slk|slo|en|eng|vi|vie|de|deu|ger|fr|fra|fre|es|spa|pl|pol|hu|hun|it|ita|ru|rus|uk|ukr)(?=$|[._/\-&?])/i.exec(text || '');
    return m ? m[1].toLowerCase() : '';
  }

  // "Language: cs" in a WebVTT header, or xml:lang="cs" at the top of a TTML file.
  function headerLanguage(text) {
    const m = /^WEBVTT[^\n]*\n(?:[^\n]+\n)*?Language:\s*([\w-]+)/i.exec(text || '');
    if (m) return m[1].toLowerCase();
    if (!isTTML(text)) return '';
    const tt = /<(?:[\w.-]+:)?tt\b[^>]*?\bxml:lang\s*=\s*["']([\w-]+)/.exec(text);
    return tt ? tt[1].toLowerCase() : '';
  }

  // Whether a response looks like TTML from its address and type. 'sure': it says
  // so. 'check': plain XML with a subtitle word in the address, so its content
  // has to be looked at first. Other XML on the web is left alone.
  function ttmlHint(url, ctype) {
    const path = url.split(/[?#]/)[0];
    if (/\.(ttml2?|dfxp)$/i.test(path) || /ttml|dfxp/i.test(ctype || '')) return 'sure';
    if ((/\.xml$/i.test(path) || /\/xml\b/i.test(ctype || '')) && /subtitle|caption|ttml|dfxp|imsc|timedtext|\/subs?\b/i.test(url)) return 'check';
    return '';
  }

  // Subtitle file names: for checking a dropped file and for taking the extension off.
  const SUB_FILE = /\.(srt|(web)?vtt|ttml2?|dfxp|xml)$/i;

  // Saves text as a file the way web converters do: a Blob plus a link with a
  // download name. chrome.downloads ignored the file name in Arc ("download", no
  // extension), a download link keeps it. Needs a document (popup, panel, page).
  function saveText(text, filename) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    (document.body || document.documentElement).append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  root.SubLib = {
    decode, parse, parseYouTube, parseTTML, isTTML, ttmlHint, SUB_FILE, parseTime, parseTimestampMap, stitchSegments,
    toRuns, cleanText, cleanCaption, toSRT, toVTT, preview, formatTime,
    bytesToBase64, base64ToBytes, saveText,
    parseAttrs, segmentUrls, subtitleTracks, guessLanguage, headerLanguage,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
