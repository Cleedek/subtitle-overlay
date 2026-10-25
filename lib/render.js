// Turns settings into CSS and cue text into DOM. Shared by the content
// script (real overlay) and the popup (live preview).
(function (root) {
  'use strict';

  const FONTS = {
    sans: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", Times, serif',
    mono: 'ui-monospace, Menlo, Consolas, "Courier New", monospace',
  };

  // Settings store a Google font as "g:Family Name". It is installed under a
  // prefixed name so it never clashes with a font the website itself uses.
  const isGoogle = (font) => typeof font === 'string' && font.startsWith('g:');
  const googleName = (font) => font.slice(2);

  function fontStack(font) {
    if (isGoogle(font)) return '"SO ' + googleName(font).replace(/"/g, '') + '", ' + FONTS.sans;
    return FONTS[font] || FONTS.sans;
  }

  // Asks the background worker for the font files and adds them to this
  // document. Resolves true once the font is usable.
  const installed = new WeakMap(); // document -> Map(family -> Promise)
  function ensureFont(doc, font) {
    if (!isGoogle(font)) return Promise.resolve(true);
    const family = googleName(font);
    if (!installed.has(doc)) installed.set(doc, new Map());
    const map = installed.get(doc);
    if (!map.has(family)) {
      map.set(family, chrome.runtime.sendMessage({ type: 'load-font', family }).then((res) => {
        if (!res || !res.ok) throw new Error(res ? res.error : 'Font failed to load.');
        return Promise.all(res.faces.map((f) => {
          const face = new FontFace('SO ' + family, root.SubLib.base64ToBytes(f.b64).buffer, {
            weight: f.weight, style: f.style, unicodeRange: f.unicodeRange || 'U+0-10FFFF',
          });
          return face.load().then(() => doc.fonts.add(face));
        })).then(() => true);
      }).catch((e) => { map.delete(family); throw e; }));
    }
    return map.get(family);
  }

  // Styles for the subtitle block. Everything visual is driven by CSS variables
  // set in applyStyle, so a settings change never rebuilds the DOM.
  const CSS = `
    .subs {
      position: absolute; left: 50%; bottom: var(--bottom);
      /* --lift: extra room while a player's own controls are showing (YouTube) */
      transform: translate(-50%, calc(-1 * var(--lift, 0px))); width: var(--maxw);
      transition: transform .25s cubic-bezier(.25, 1, .5, 1);
      display: flex; flex-direction: column; align-items: center; gap: 0.15em;
      text-align: center; pointer-events: none;
      font-family: var(--font); font-size: var(--size); font-weight: var(--weight);
      line-height: 1.3; color: var(--color); text-shadow: var(--shadow);
      white-space: pre-line; overflow-wrap: break-word;
      -webkit-font-smoothing: antialiased; font-style: normal; letter-spacing: normal;
    }
    .subs[data-place=top] { bottom: auto; top: var(--bottom); transform: translateX(-50%); }
    .subs[data-place=middle] { bottom: auto; top: 50%; transform: translate(-50%, -50%); }
    .subs.hidden { display: none; }
    .line {
      padding: var(--pad-y) var(--pad-x); border-radius: 0.12em;
      -webkit-box-decoration-break: clone; box-decoration-break: clone;
    }
    /* The background box is a copy of the text underneath, painted solid, and
       the whole copy is made see-through at once. Where the boxes of two
       wrapped lines overlap they merge instead of doubling the darkness. */
    .block { display: grid; }
    .block > div { grid-area: 1 / 1; }
    .back { opacity: var(--box-alpha); }
    .front { position: relative; } /* a see-through layer paints above plain text, so lift the text */
    /* Blur needs its own layer: under .back's opacity it would only see .back itself. */
    .blur { display: none; }
    .subs[data-blur=on] .blur { display: block; }
    .blur .line { color: transparent; text-shadow: none; -webkit-backdrop-filter: blur(var(--blur)); backdrop-filter: blur(var(--blur)); }
    .blur .line * { text-decoration-color: transparent; }
    .back .line { background: var(--box-solid); color: transparent; text-shadow: none; }
    .back .line * { text-decoration-color: transparent; }
    .line i { font-style: italic; }
    .line b { font-weight: 800; }
    .line u { text-decoration: underline; }
  `;

  function hexToRgba(hex, opacityPercent) {
    const h = String(hex || '#000000').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16) || 0;
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + (opacityPercent / 100) + ')';
  }

  // Outline = a ring of hard text shadows (works for any font, unlike text-stroke),
  // followed by the soft drop shadow.
  function textShadow(s, k) {
    const parts = [];
    if (s.outline && s.outlineWidth > 0) {
      const w = Math.max(0.5, s.outlineWidth * k);
      const steps = 16;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        parts.push((Math.cos(a) * w).toFixed(2) + 'px ' + (Math.sin(a) * w).toFixed(2) + 'px 0 ' + s.outlineColor);
      }
    }
    if (s.shadow) {
      const o = (s.shadowOffset * k).toFixed(2) + 'px';
      parts.push(o + ' ' + o + ' ' + (s.shadowBlur * k).toFixed(2) + 'px ' + hexToRgba(s.shadowColor, s.shadowOpacity));
    }
    return parts.length ? parts.join(', ') : 'none';
  }

  // el: the .subs element. playerHeight/playerWidth: size of the picture in px.
  function applyStyle(el, s, playerHeight, playerWidth) {
    const k = s.scale && playerHeight > 0 ? playerHeight / 1080 : 1;
    const st = el.style;
    st.setProperty('--bottom', (s.bottom * k).toFixed(1) + 'px');
    st.setProperty('--size', Math.max(10, s.size * k).toFixed(1) + 'px');
    st.setProperty('--font', fontStack(s.font));
    st.setProperty('--weight', String(s.weight));
    st.setProperty('--color', s.color);
    st.setProperty('--shadow', textShadow(s, k));
    st.setProperty('--box-solid', s.box ? hexToRgba(s.boxColor, 100) : 'transparent');
    st.setProperty('--box-alpha', s.box ? String(s.boxOpacity / 100) : '0');
    st.setProperty('--pad-y', s.box ? (s.boxPadding * k * 0.5).toFixed(1) + 'px' : '0px');
    st.setProperty('--pad-x', s.box ? (s.boxPadding * k).toFixed(1) + 'px' : '0px');
    st.setProperty('--blur', s.box && s.boxBlur > 0 ? (s.boxBlur * k).toFixed(1) + 'px' : '0px');
    el.dataset.place = s.place;
    el.dataset.blur = s.box && s.boxBlur > 0 ? 'on' : '';
    st.setProperty('--maxw', playerWidth > 0 ? (playerWidth * s.maxWidth / 100).toFixed(0) + 'px' : s.maxWidth + '%');
  }

  // Builds one block per active cue. Built with DOM nodes, never innerHTML,
  // so nothing inside a subtitle file can run as code.
  function renderCues(el, cues) {
    const doc = el.ownerDocument;
    el.replaceChildren();
    for (const cue of cues) {
      const line = doc.createElement('span');
      line.className = 'line';
      for (const run of root.SubLib.toRuns(cue.text)) {
        let node = doc.createTextNode(run.text);
        for (const tag of ['u', 'b', 'i']) {
          if (!run[tag]) continue;
          const wrap = doc.createElement(tag);
          wrap.appendChild(node);
          node = wrap;
        }
        line.appendChild(node);
      }
      // Same text twice in one grid cell, so both wrap identically: box behind, text in front.
      const back = doc.createElement('div');
      back.className = 'back';
      back.setAttribute('aria-hidden', 'true');
      back.appendChild(line.cloneNode(true));
      const blur = doc.createElement('div');
      blur.className = 'blur';
      blur.setAttribute('aria-hidden', 'true');
      blur.appendChild(line.cloneNode(true));
      const front = doc.createElement('div');
      front.className = 'front';
      front.appendChild(line);
      const block = doc.createElement('div');
      block.className = 'block';
      block.append(blur, back, front);
      el.appendChild(block);
    }
  }

  root.SubRender = { CSS, applyStyle, renderCues, hexToRgba, fontStack, ensureFont, isGoogle, googleName };
})(globalThis);
