// The look of the extension's own pages (popup, translation queue, DevTools
// panel): dark, light, or the system's. Loaded in <head>, before the page
// shows. Kept in localStorage, not chrome.storage: it answers at once, so a
// light popup never opens dark for a moment first.
(function () {
  'use strict';
  const KEY = 'theme';
  const THEMES = ['light', 'dark', 'auto'];
  const systemLight = matchMedia('(prefers-color-scheme: light)');
  const read = () => {
    try { const v = localStorage.getItem(KEY); return THEMES.includes(v) ? v : 'dark'; } catch (e) { return 'dark'; }
  };
  let choice = read();

  function apply() {
    const light = choice === 'light' || (choice === 'auto' && systemLight.matches);
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
  }
  apply();
  systemLight.addEventListener('change', apply);
  // Changed in the popup: an open queue or DevTools panel follows.
  addEventListener('storage', (e) => { if (e.key === KEY) { choice = read(); apply(); } });

  globalThis.SubTheme = {
    get: () => choice,
    set(value) {
      choice = THEMES.includes(value) ? value : 'dark';
      try { localStorage.setItem(KEY, choice); } catch (e) { /* this page only */ }
      // All at once: without this, fields and buttons fade to the new colors after the rest.
      const root = document.documentElement;
      root.classList.add('theme-switching');
      apply();
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
    },
  };
})();
