// After someone removes the extension, Chrome opens a short "why did you leave?" page
// (feedback.cleedek.com/bye, code in the extension-feedback Worker, src/bye.js).
// The address carries only the extension, its version and the interface language, so the page
// opens in the language the person last used. It's set again whenever that language changes.
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
    try { await chrome.runtime.setUninstallURL(url.href); } catch (e) { /* not fatal: no page after removal */ }
  }

  update();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.uiLang) update();
  });
}
