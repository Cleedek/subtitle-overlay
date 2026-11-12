// all-languages.png: every store language's variant D screenshot 2 at 50 %, labelled with its store code.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
const here = path.dirname(fileURLToPath(import.meta.url));
const puppeteer = createRequire(path.join(here, '../../promo-video/package.json'))('puppeteer-core');
const codes = process.argv.slice(2);
const tile = (c) => `<figure><div class="lab">${c === 'en' ? 'en (global)' : c}</div><img src="out/variant-d${c === 'en' ? '' : '.' + c}.png"></figure>`;
writeFileSync(path.join(here, 'all-languages.html'), `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#1d1b22;font-family:system-ui,sans-serif}body{display:grid;grid-template-columns:repeat(4,640px);gap:20px;padding:20px;width:max-content}
figure{margin:0}img{display:block;width:640px;height:400px;border-radius:6px;box-shadow:0 0 0 1px rgba(255,255,255,.12)}
.lab{color:#fff;font-size:20px;font-weight:700;margin:0 0 6px 2px}</style>${codes.map(tile).join('')}`);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--allow-file-access-from-files', '--mute-audio'] });
const tab = await browser.newPage();
const rows = Math.ceil(codes.length / 4);
await tab.setViewport({ width: 20 * 5 + 640 * 4, height: 20 + rows * (400 + 20 + 30), deviceScaleFactor: 1 });
await tab.goto('file://' + path.join(here, 'all-languages.html'), { waitUntil: 'networkidle0' });
await tab.evaluate(async () => { await Promise.all([...document.images].map((i) => i.decode().catch(() => {}))); });
await tab.screenshot({ path: path.join(here, 'all-languages.png'), fullPage: true });
await browser.close();
