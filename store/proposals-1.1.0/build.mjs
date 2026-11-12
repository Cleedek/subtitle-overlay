// Store screenshot 2 for 1.1.0: three proposals that show the new shared subtitles card.
//   node store/proposals-1.1.0/build.mjs [en cs ...] [--only=a,b,c]      (from the repo root)
// Writes variant-<x>.html (en) / variant-<x>.<code>.html next to this file and renders each to
// out/variant-<x>.png / out/variant-<x>.<code>.png at the store's 1280x800, then compare.png (en, A B C).
// Copy: copy/<code>.json ({ s2, shared, example? }). The card over the video is a capture of the real
// extension (capture-shared.mjs): img/<code>/card-shared-offer.png, card-shared-used.png, card-shared-rects.json.
// The "Use" chip in variant C is the extension's own string from lib/locales.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const puppeteer = createRequire(path.join(repo, 'promo-video/package.json'))('puppeteer-core');
const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice(7).split(',') : ['a', 'b', 'c'];
const codes = args.filter((a) => !a.startsWith('--'));
if (!codes.length) codes.push('en');
const UI = { pt_BR: 'pt', pt_PT: 'pt', fil: 'tl', zh_CN: 'zh-CN', zh_TW: 'zh-TW' }; // store code -> lib/locales file

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Copy may carry <br>, <span>…</span> and <b>…</b>; nothing else.
const rich = (s) => esc(s).replace(/&lt;(\/?)(br|span|b)&gt;/g, '<$1$2>');

// The real Vietnamese example (every language but Czech), unedited gemma3:12b output.
const VI = { lang: 'vi', google: 'Sao cũng được, Thơm. Chúng ta đã xong.', gemma: 'Thôi đi, Thom. Kết thúc rồi.' };
const CREDIT = '<div class="credit">Film: Tears of Steel © Blender Foundation · mango.blender.org · CC BY 3.0</div>';
const BAR = '<div class="bar"><i></i><i></i><i></i><div class="url">video-site.example/watch/tears-of-steel</div><img class="ext" src="../../icons/icon128.png" alt=""></div>';

// Scripts Inter lacks, as in promo-video/screens/l10n/build.mjs.
const LANGS = JSON.parse(readFileSync(path.join(repo, 'promo-video/screens/l10n/langs.json'), 'utf8'));
const lang = (code) => LANGS[code] || { ui: code, target: code, html: code, rtl: false };
const FONTS = {
  th: 'Noto+Sans+Thai:wght@400;500;600;700', hi: 'Noto+Sans+Devanagari:wght@400;500;600;700', ar: 'Noto+Sans+Arabic:wght@400;500;600;700',
  ja: 'Noto+Sans+JP:wght@400;500;600;700', ko: 'Noto+Sans+KR:wght@400;500;600;700', zh_CN: 'Noto+Sans+SC:wght@400;500;600;700',
  zh_TW: 'Noto+Sans+TC:wght@400;500;600;700', el: 'Noto+Sans:wght@400;500;600;700', uk: 'Noto+Sans:wght@400;500;600;700',
};
const FAMILY = { th: 'Noto Sans Thai', hi: 'Noto Sans Devanagari', ar: 'Noto Sans Arabic', ja: 'Noto Sans JP', ko: 'Noto Sans KR', zh_CN: 'Noto Sans SC', zh_TW: 'Noto Sans TC' };

function page(code, title, css, body) {
  const L = lang(code);
  const extra = FONTS[code] ? `&family=${FONTS[code]}` : '';
  const fam = FAMILY[code] ? `"Inter", "${FAMILY[code]}", sans-serif` : '"Inter", sans-serif';
  return `<!doctype html>
<html lang="${L.html}" dir="${L.rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800${extra}&display=block">
<link rel="stylesheet" href="../../promo-video/screens/screens.css">
<style>
  body { font-family: ${fam}; }
  ${FAMILY[code] ? 'h1 { letter-spacing: 0; line-height: 1.15; } .eyebrow { letter-spacing: .04em; }' : ''}
  ${code === 'ko' ? 'body { word-break: keep-all; }' : ''}
  ${code === 'ja' || code.startsWith('zh') ? 'body { line-break: strict; }' : ''}
  h1, .body { text-wrap: balance; }
  /* Shared by all three: the comparison card and the window, as in promo-video/screens/screenshot-2.html. */
  .cmp { background: rgba(33, 28, 46, .85); border: 1px solid rgba(255, 255, 255, .08); border-radius: 14px; padding: 18px 20px 16px; margin-bottom: 22px; }
  .cmp .who { font-size: 13px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: #a59fb5; margin-bottom: 14px; }
  .row { display: grid; gap: 5px; padding: 0 0 0 14px; border-left: 3px solid #5d5869; margin: 0 0 14px; }
  .row.ai { border-left-color: #8b6bff; margin-bottom: 0; }
  .row .lbl { font-size: 13px; color: #9d96ad; font-weight: 600; }
  .row.ai .lbl { color: #b9a6ff; }
  .row .line { font-family: "Inter", sans-serif; font-size: 19px; line-height: 1.3; color: #e7e3f0; font-weight: 550; letter-spacing: -.005em; }
  .row.ai .line { color: #fff; }
  .row .why { font-size: 13px; color: #9d96ad; }
  .cmp .foot { font-size: 12.5px; color: #8a8496; margin-top: 14px; }
  .film { position: relative; overflow: hidden; }
  .film > img { display: block; width: 100%; height: 100%; }
  ${css}
</style>
</head>
<body>
${body}
<script>
  // Shrink a text block until it fits: data-lines = how many lines it may take (as in l10n/build.mjs).
  window.fit = () => {
    for (const el of document.querySelectorAll('[data-lines]')) {
      const lines = +el.dataset.lines;
      let size = parseFloat(getComputedStyle(el).fontSize);
      const min = +(el.dataset.min || size * 0.7);
      const tooBig = () => { const lh = parseFloat(getComputedStyle(el).lineHeight) || size * 1.1; return el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().height > lines * lh + 2; };
      while (tooBig() && size > min) { size -= 1; el.style.fontSize = size + 'px'; }
      el.dataset.fitted = size;
    }
    // data-same="group": every block in the group takes the smallest fitted size (both caption lines alike).
    const groups = {};
    for (const el of document.querySelectorAll('[data-same]')) (groups[el.dataset.same] = groups[el.dataset.same] || []).push(el);
    for (const els of Object.values(groups)) {
      const min = Math.min(...els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
      els.forEach((e) => { e.style.fontSize = min + 'px'; e.dataset.fitted = min; });
    }
  };
</script>
</body>
</html>`;
}

const top = (c, extra = '') => `
  <div class="top">
    <div class="eyebrow">${esc(c.s2.eyebrow)}</div>
    <h1 data-lines="1" data-min="30">${rich(c.s2.h1)}</h1>
    ${extra}
  </div>`;
const cmp = (c, ex) => `
    <div class="cmp">
      <div class="who">${esc(c.s2.who)}</div>
      <div class="row"><span class="lbl">${esc(c.s2.google)}</span><span class="line" lang="${ex.lang}" dir="ltr">${esc(ex.google)}</span>${c.s2.why && ex.lang === 'vi' ? `<span class="why">${esc(c.s2.why)}</span>` : ''}</div>
      <div class="row ai"><span class="lbl">${esc(c.s2.ai)}</span><span class="line" lang="${ex.lang}" dir="ltr">${esc(ex.gemma)}</span></div>
      <div class="foot">${esc(c.s2.foot)}</div>
    </div>`;
const prov = (c) => `
    <div class="prov">
      <div><b>${esc(c.s2.local)}</b><span class="b-gemma">Gemma</span><span class="b-ollama">Ollama</span><span class="b-lms">LM Studio</span></div>
      <div><b>${esc(c.s2.key)}</b><span class="b-gemini">Gemini</span><span class="b-claude">Claude</span><span class="b-openai">OpenAI</span></div>
    </div>`;
// The current screenshot 2's layout (top text, comparison column, 720x405 window).
const BASE_CSS = `
  .top { position: absolute; left: 30px; right: 30px; top: 50px; text-align: center; }
  .top h1 { white-space: nowrap; }
  .top .body { margin: 14px auto 0; max-width: 860px; }
  .col { position: absolute; left: 64px; width: 408px; top: 318px; }
  .win { left: 512px; top: 262px; width: 720px; }
  .film { width: 720px; height: 405px; }`;

const variants = {
  // A: the minimal swap. Same picture as today; the card is the real shared row after Use
  // (gemma3:12b's line on screen, as the comparison says), instead of "Improving 46 %".
  a: (code, c, ex, R) => page(code, 'Store screenshot 2, proposal A', BASE_CSS, `
  ${top(c, `<p class="body" data-lines="2" data-min="14">${rich(c.s2.body)}</p>`)}
  <div class="col">${cmp(c, ex)}${prov(c)}
  </div>
  <div class="win">${BAR}
    <div class="film"><img src="img/${code}/card-shared-used.png" alt=""></div>
  </div>
  ${CREDIT}`),

  // B: the same layout with the card offering the shared copy (Use), and a note tied to it.
  b: (code, c, ex, R) => {
    const r = R.offer; // the card in 720x405 film px, the same as page px here
    const right = 720 - (r.x + r.w); // card's distance from the film's right edge
    return page(code, 'Store screenshot 2, proposal B', BASE_CSS + `
  .ring { position: absolute; left: ${r.x - 3}px; top: ${r.y - 3}px; width: ${r.w + 6}px; height: ${r.h + 6}px; border-radius: 15px;
    box-shadow: 0 0 0 2px #86efac, 0 0 26px rgba(134, 239, 172, .35); pointer-events: none; }
  .note { position: absolute; right: ${right}px; top: ${r.y + r.h + 18}px; width: ${Math.max(r.w, 244)}px; padding: 12px 15px 13px;
    border-radius: 12px; background: #f3f1f8; color: #3b3548; font-size: 15px; line-height: 1.38; font-weight: 500;
    box-shadow: 0 14px 34px rgba(0, 0, 0, .45); }
  .note b { color: #15121c; font-weight: 700; }
  .note span { display: block; }
  /* The tip points up at Use (the card's first button, about 30 px in from its left edge). */
  .note::before { content: ""; position: absolute; top: -7px; left: ${Math.round(r.x + 30 - (720 - right - Math.max(r.w, 244)) - 7)}px; width: 14px; height: 14px; background: #f3f1f8; transform: rotate(45deg); border-radius: 2px; }`, `
  ${top(c, `<p class="body" data-lines="2" data-min="14">${rich(c.s2.body)}</p>`)}
  <div class="col">${cmp(c, ex)}${prov(c)}
  </div>
  <div class="win">${BAR}
    <div class="film"><img src="img/${code}/card-shared-offer.png" alt="">
      <div class="ring"></div>
      <div class="note"><span data-lines="3" data-min="12">${rich(c.shared.callout)}</span></div>
    </div>
  </div>
  ${CREDIT}`);
  },

  // C: shared subtitles as a co-headline. The comparison is now the two real states of the card over the
  // video: Google's line with the shared copy offered, then one click on Use, then gemma3:12b's line.
  c: (code, c, ex, R, ui) => {
    const W = 560, k = W / 720, H = Math.round(405 * k);
    const ring = (r) => `left:${Math.round(r.x * k) - 3}px;top:${Math.round(r.y * k) - 3}px;width:${Math.round(r.w * k) + 6}px;height:${Math.round(r.h * k) + 6}px`;
    return page(code, 'Store screenshot 2, proposal C', `
  .top { position: absolute; left: 30px; right: 30px; top: 46px; text-align: center; }
  .top h1 { white-space: nowrap; font-size: 46px; line-height: 1.12; }
  .top h1.co { margin-top: 4px; color: #fff; }
  .top h1.co span { color: #86efac; }
  .win { top: 238px; width: ${W}px; }
  .w1 { left: 64px; } .w2 { left: 656px; }
  .film { width: ${W}px; height: ${H}px; }
  .ring { position: absolute; border-radius: 12px; box-shadow: 0 0 0 2px #86efac, 0 0 22px rgba(134, 239, 172, .3); }
  .use { position: absolute; left: 640px; top: ${238 + 40 + Math.round(H * 0.62)}px; transform: translate(-50%, -50%); z-index: 2;
    display: flex; align-items: center; gap: 8px; padding: 9px 18px 9px 16px; border-radius: 999px; background: #7a41e4; color: #fff;
    font: 650 16px/1 system-ui, -apple-system, "Segoe UI", sans-serif; white-space: nowrap;
    box-shadow: 0 0 0 6px #0e0d12, 0 10px 30px rgba(0, 0, 0, .5); }
  .use svg { width: 16px; height: 16px; }
  .cap { position: absolute; top: ${238 + 40 + H + 26}px; width: ${W}px; }
  .c1 { left: 64px; } .c2 { left: 656px; }
  .cap .line { font-size: 21px; }
  .row.shared { border-left-color: #86efac; }
  .row.shared .lbl { color: #86efac; }
  .row.shared .line { color: #fff; }
  .cap .foot { font-size: 12.5px; color: #8a8496; margin-top: 12px; padding-left: 17px; }`, `
  <div class="top">
    <div class="eyebrow">${esc(c.s2.eyebrow)}</div>
    <h1 data-lines="1" data-min="30">${rich(c.s2.h1)}</h1>
    <h1 class="co" data-lines="1" data-min="30">${rich(c.shared.co)}</h1>
  </div>
  <div class="win w1">${BAR}
    <div class="film"><img src="img/${code}/card-shared-offer.png" alt=""><div class="ring" style="${ring(R.offer)}"></div></div>
  </div>
  <div class="win w2">${BAR}
    <div class="film"><img src="img/${code}/card-shared-used.png" alt=""><div class="ring" style="${ring(R.used)}"></div></div>
  </div>
  <div class="use">${esc(ui.Use || 'Use')}<svg viewBox="0 0 16 16"><path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
  <div class="cap c1"><div class="row"><span class="lbl">${esc(c.s2.google)}</span><span class="line" lang="${ex.lang}" dir="ltr">${esc(ex.google)}</span>${c.s2.why && ex.lang === 'vi' ? `<span class="why">${esc(c.s2.why)}</span>` : ''}</div></div>
  <div class="cap c2"><div class="row shared"><span class="lbl">${esc(c.shared.sharedAi)}</span><span class="line" lang="${ex.lang}" dir="ltr">${esc(ex.gemma)}</span></div><div class="foot">${esc(c.s2.foot)}</div></div>
  ${CREDIT}`);
  },

  // D: C revised (Filip, 12 Nov): the example in the listing's own language (EN: English UI, Spanish subtitles),
  // lines read from examples/bridge-<target>.json (gen-example.mjs), a note under each frame on the same
  // baselines, the provider chips back at the bottom left, frames 24 px under the headline.
  d: (code, c, ex, R, ui) => {
    const D = c.d;
    const row = JSON.parse(readFileSync(path.join(here, 'examples', D.file || `bridge-${D.target}.json`), 'utf8')).rows[D.line - 1];
    const RD = JSON.parse(readFileSync(path.join(here, 'img', code, 'd', 'card-shared-rects.json'), 'utf8'));
    const W = 560, k = W / 720, H = Math.round(405 * k), TOP = 210;
    const ring = (r) => `left:${Math.round(r.x * k) - 3}px;top:${Math.round(r.y * k) - 3}px;width:${Math.round(r.w * k) + 6}px;height:${Math.round(r.h * k) + 6}px`;
    return page(code, 'Store screenshot 2, proposal D', `
  .top { position: absolute; left: 30px; right: 30px; top: 44px; text-align: center; }
  .top h1 { white-space: nowrap; font-size: 46px; line-height: 1.12; }
  .top h1.co { margin-top: 4px; color: #fff; }
  .top h1.co span { color: #86efac; }
  .win { top: ${TOP}px; width: ${W}px; }
  .w1 { left: 64px; } .w2 { left: 656px; }
  .film { width: ${W}px; height: ${H}px; }
  .ring { position: absolute; border-radius: 12px; box-shadow: 0 0 0 2px #86efac, 0 0 22px rgba(134, 239, 172, .3); }
  .use { position: absolute; left: 640px; top: ${TOP + 40 + Math.round(H * 0.62)}px; transform: translate(-50%, -50%); z-index: 2;
    display: flex; align-items: center; gap: 8px; padding: 9px 18px 9px 16px; border-radius: 999px; background: #7a41e4; color: #fff;
    font: 650 16px/1 system-ui, -apple-system, "Segoe UI", sans-serif; white-space: nowrap;
    box-shadow: 0 0 0 6px #0e0d12, 0 10px 30px rgba(0, 0, 0, .5); }
  .use svg { width: 16px; height: 16px; }
  /* One grid for both captions: label, line and note share their rows, so they sit on the same baselines. */
  .caps { position: absolute; left: 64px; top: ${TOP + 40 + H + 22}px; width: 1152px; display: grid; grid-template-columns: ${W}px ${W}px;
    column-gap: 32px; grid-template-rows: auto auto auto; grid-auto-flow: column; }
  .caps > * { padding-inline-start: 17px; border-inline-start: 3px solid #5d5869; }
  .caps .lbl { font-size: 13px; color: #9d96ad; font-weight: 600; padding-bottom: 5px; }
  .caps .line { font-size: 21px; line-height: 1.3; color: #e7e3f0; font-weight: 550; letter-spacing: -.005em; }
  .caps .note { font-size: 13px; color: #9d96ad; padding-top: 5px; }
  .caps .s { border-inline-start-color: #86efac; }
  .caps .lbl.s { color: #86efac; }
  .caps .line.s { color: #fff; }
  .prov { position: absolute; left: 64px; bottom: 30px; display: flex; gap: 36px; }
  .prov > div { display: block; }
  .prov b { display: block; margin-bottom: 9px; }
  .prov span { display: inline-block; margin-right: 7px; white-space: nowrap; }
  .credit { bottom: 14px; }
  /* Right to left: the story reads from the right (Google first), the arrow points left, chips and credit swap sides. */
  [dir=rtl] .w1 { left: 656px; } [dir=rtl] .w2 { left: 64px; }
  [dir=rtl] .use svg { transform: scaleX(-1); }
  [dir=rtl] .prov { left: auto; right: 64px; }
  [dir=rtl] .prov span { margin-right: 0; margin-left: 7px; }
  [dir=rtl] .credit { right: auto; left: 22px; }`, `
  <div class="top">
    <div class="eyebrow">${esc(c.s2.eyebrow)}</div>
    <h1 data-lines="1" data-min="30">${rich(c.s2.h1)}</h1>
    <h1 class="co" data-lines="1" data-min="30">${rich(c.shared.co)}</h1>
  </div>
  <div class="win w1">${BAR}
    <div class="film"><img src="img/${code}/d/card-shared-offer.png" alt=""><div class="ring" style="${ring(RD.offer)}"></div></div>
  </div>
  <div class="win w2">${BAR}
    <div class="film"><img src="img/${code}/d/card-shared-used.png" alt=""><div class="ring" style="${ring(RD.used)}"></div></div>
  </div>
  <div class="use">${esc(ui.Use || 'Use')}<svg viewBox="0 0 16 16"><path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
  <div class="caps">
    <div class="lbl">${esc(c.s2.google)}</div>
    <div class="line" lang="${D.target}" dir="${lang(code).rtl ? 'rtl' : 'ltr'}"><span data-lines="1" data-min="17" data-same="cap" style="display:block">${esc(row.google)}</span></div>
    <div class="note">${esc(D.googleNote)}</div>
    <div class="lbl s">${esc(c.shared.sharedAi)}</div>
    <div class="line s" lang="${D.target}" dir="${lang(code).rtl ? 'rtl' : 'ltr'}"><span data-lines="1" data-min="17" data-same="cap" style="display:block">${esc(row.gemma)}</span></div>
    <div class="note s">${esc(D.aiNote)}</div>
  </div>
  ${prov(c)}
  <div class="credit"><span dir="auto">${esc(D.unedited)}</span> · <span dir="ltr">Film: Tears of Steel © Blender Foundation · mango.blender.org · CC BY 3.0</span></div>`);
  },
};

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--hide-scrollbars', '--force-color-profile=srgb', '--allow-file-access-from-files', '--mute-audio'],
});
const tab = await browser.newPage();
await tab.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
mkdirSync(path.join(here, 'out'), { recursive: true });
const rendered = {};
for (const code of codes) {
  const c = JSON.parse(readFileSync(path.join(here, 'copy', code + '.json'), 'utf8'));
  // The other languages keep their screenshot 2 strings in the l10n kit; copy/<code>.json adds only the new ones.
  if (!c.s2) c.s2 = JSON.parse(readFileSync(path.join(repo, 'promo-video/screens/l10n/copy', code + '.json'), 'utf8')).s2;
  const rFile = path.join(here, 'img', code, 'card-shared-rects.json');
  const R = existsSync(rFile) ? JSON.parse(readFileSync(rFile, 'utf8')) : null;
  const uiFile = path.join(repo, 'lib/locales', lang(code).ui + '.json');
  const ui = existsSync(uiFile) ? JSON.parse(readFileSync(uiFile, 'utf8')) : {};
  const ex = c.example || VI;
  for (const v of ONLY) {
    const name = `variant-${v}${code === 'en' ? '' : '.' + code}`;
    const file = path.join(here, name + '.html');
    writeFileSync(file, variants[v](code, c, ex, R, ui));
    await tab.goto('file://' + file, { waitUntil: 'networkidle0' });
    await tab.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode().catch(() => {}))); window.fit(); });
    const fitted = await tab.evaluate(() => [...document.querySelectorAll('[data-lines]')].map((e) => e.className + e.tagName + ':' + e.dataset.fitted).join(' '));
    const png = path.join(here, 'out', name + '.png');
    await tab.screenshot({ path: png });
    rendered[code + v] = png;
    console.log(name, fitted);
  }
}
// compare.png (A, B, C) or compare-<x>-<y>.png: the en variants side by side at 50 %, labelled.
if (codes.includes('en') && ONLY.length > 1) {
  const cname = ONLY.join() === 'a,b,c' ? 'compare' : 'compare-' + ONLY.join('-');
  const tile = (v) => `<figure><div class="lab">${v.toUpperCase()}</div><img src="out/variant-${v}.png"></figure>`;
  writeFileSync(path.join(here, cname + '.html'), `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@600;700&display=block">
<style>html,body{margin:0;background:#1d1b22;font-family:Inter,sans-serif}body{display:flex;gap:24px;padding:24px;width:max-content}
figure{margin:0}img{display:block;width:640px;height:400px;border-radius:8px;box-shadow:0 0 0 1px rgba(255,255,255,.12)}
.lab{color:#fff;font-size:26px;font-weight:700;margin:0 0 10px 2px}</style>
${ONLY.map(tile).join('')}`);
  await tab.setViewport({ width: 24 * (ONLY.length + 1) + 640 * ONLY.length, height: 24 * 2 + 400 + 46, deviceScaleFactor: 1 });
  await tab.goto('file://' + path.join(here, cname + '.html'), { waitUntil: 'networkidle0' });
  await tab.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode().catch(() => {}))); });
  await tab.screenshot({ path: path.join(here, cname + '.png') });
  console.log(cname + '.png');
}
await browser.close();
