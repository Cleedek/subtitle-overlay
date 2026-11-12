// rows[i].google from the raw Google answers kept in examples/bridge-<target>.json, as the extension shows them:
// the answer to the request that carried the 8 film lines (the page may translate other text too, such as the
// welcome sample), HTML entities decoded (the overlay renders the lines as HTML, so &#39; shows as ').
//   node google-rows.mjs examples/bridge-*.json      (rewrites rows[].google in place, raw stays untouched)
import { readFileSync, writeFileSync } from 'node:fs';
export const decode = (s) => String(s).replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
export function googleRows(glog, en) {
  const hit = glog.find((g) => new URLSearchParams(g.request).getAll('q')[0] === en[0]);
  if (!hit) throw new Error('no Google answer for the film lines');
  return JSON.parse(hit.response).map((d) => decode(Array.isArray(d) ? d[0] : d));
}
if (process.argv[1] && process.argv[1].endsWith('google-rows.mjs')) {
  for (const f of process.argv.slice(2)) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    const g = googleRows(j.raw.google, j.rows.map((r) => r.en));
    j.rows.forEach((r, i) => { if (r.google !== g[i]) console.log(f, i + 1, JSON.stringify(r.google), '->', JSON.stringify(g[i])); r.google = g[i]; });
    writeFileSync(f, JSON.stringify(j, null, 1));
  }
}
