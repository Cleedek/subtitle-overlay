// After someone removes the extension, Chrome opens a short "why did you leave?" page
// (feedback.cleedek.com/bye, code in the extension-feedback Worker, src/bye.js).
// The address carries the extension, its version and the interface language, so the page
// opens in the language the person last used. It's set again whenever that language changes.
// Subtitle Overlay also adds the last websites where a video played (see rememberGoodbyeSite below).
// Same file in all the extensions; call it once from background.js, after lib/i18n.js.
const GOODBYE_URL = 'https://feedback.cleedek.com/bye';

function setupGoodbye({ ext, i18n }) {
  // The language "Same as browser" turned into, worked out by i18n.js before anything was loaded.
  const browserLang = i18n.lang;

  async function update() {
    let uiLang;
    try { ({ uiLang } = await chrome.storage.local.get('uiLang')); } catch (e) { /* browser language then */ }
    const url = new URL(GOODBYE_URL);
    url.searchParams.set('ext', ext);
    url.searchParams.set('v', chrome.runtime.getManifest().version);
    url.searchParams.set('lang', uiLang && uiLang !== 'auto' ? uiLang : browserLang);
    const sites = await recentGoodbyeSites();
    if (sites.length) url.hash = 'sites=' + sites.map((s) => `${s.h}~${Math.floor(s.t / 1000)}`).join(',');
    try { await chrome.runtime.setUninstallURL(url.href); } catch (e) { /* not fatal: no page after removal */ }
  }

  update();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.uiLang || changes.goodbyeSites)) update();
  });
}

// Websites where a video played lately (only Subtitle Overlay calls this): the newest three, at most a week old.
// They go after "#" in the address above. The browser never sends that part to the server: the page reads it
// itself and offers the sites as one-click answers, and nothing leaves the computer until the person presses Send.
// Only the site's name is kept (netflix.com), never the page, and never from a private window (the caller checks).
const GOODBYE_SITES = 3;
const GOODBYE_DAYS = 7;
let goodbyeWrite = Promise.resolve();

async function recentGoodbyeSites() {
  try {
    const { goodbyeSites = [] } = await chrome.storage.local.get('goodbyeSites');
    return goodbyeSites.filter((s) => Date.now() - s.t < GOODBYE_DAYS * 864e5);
  } catch (e) { return []; }
}

function rememberGoodbyeSite(pageUrl) {
  let host;
  try {
    const url = new URL(pageUrl);
    if (!/^https?:$/.test(url.protocol)) return;
    host = url.hostname.replace(/^www\./, '');
  } catch (e) { return; }
  if (!/^[a-z0-9.-]{1,100}$/.test(host)) return;
  goodbyeWrite = goodbyeWrite.then(async () => {
    const sites = await recentGoodbyeSites();
    // Already the newest one, a moment ago: the address would hardly change, so no new write.
    if (sites[0] && sites[0].h === host && Date.now() - sites[0].t < 10 * 60000) return;
    const next = [{ h: host, t: Date.now() }, ...sites.filter((s) => s.h !== host)].slice(0, GOODBYE_SITES);
    await chrome.storage.local.set({ goodbyeSites: next });
  }).catch(() => {});
}
