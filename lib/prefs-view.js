// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Cleedek

// "Language & appearance": a row in the footer list that opens its own screen, like
// "Support the creator". Same file in Subtitle Overlay, Edge Trim and Snap Translate.
// The row shows what is chosen ("Čeština · Dark"), leaving out "Same as browser".
//
// On that screen the look is a segmented control and the languages are one list to
// scroll, iOS style: own name on top, the name in the current language under it, a
// check on the chosen one. The two hidden <select>s stay the source of truth: the
// popup fills them and listens to their "change", this file only draws them.
function setupPrefsView([langId, themeId]) {
  const $ = (id) => document.getElementById(id);
  const lang = $(langId);
  const theme = $(themeId);
  const selects = [lang, theme].filter(Boolean);
  const CHECK = '<svg class="lang-check" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const summary = () => {
    $('prefsNow').textContent = selects
      .filter((s) => s.selectedIndex > 0 && !/^(auto|light dark)$/.test(s.value))
      .map((s) => s.selectedOptions[0].text)
      .join(' · ');
  };

  // Picking an option = setting the select and telling the popup, as a dropdown would.
  const pick = (select, value) => {
    if (select.value === value) return;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    render();
  };

  // "Polski" -> "Polish" when the popup is in English. Nothing when both are the same.
  const nameIn = (code) => {
    try {
      const ui = document.documentElement.lang || 'en';
      return new Intl.DisplayNames([ui], { type: 'language' }).of(code);
    } catch (e) { return ''; }
  };
  const browserLang = () => {
    try { return (chrome.i18n.getUILanguage() || '').split('-')[0]; } catch (e) { return ''; }
  };

  function renderTheme() {
    const seg = $('themeSeg');
    if (!seg || !theme) return;
    seg.replaceChildren(...[...theme.options].map((o) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(o.value === theme.value));
      b.textContent = o.text;
      b.addEventListener('click', () => pick(theme, o.value));
      return b;
    }));
    fitTheme();
  }

  // A long "Same as browser" (Greek) does not fit on one line: let all three wrap.
  // Measured again when the screen opens, since a hidden screen has no width.
  function fitTheme() {
    const seg = $('themeSeg');
    if (!seg) return;
    seg.classList.remove('wrap');
    if (seg.scrollWidth > seg.clientWidth + 1) seg.classList.add('wrap');
  }

  function renderLang() {
    const list = $('langList');
    if (!list || !lang) return;
    // "Same as browser" on top, then A to Z by each language's own name (Latin first,
    // then other scripts), the same in all three extensions whatever order the popup used.
    const abc = new Intl.Collator('en', { sensitivity: 'base' });
    const opts = [...lang.options].sort((a, b) => (b.value === 'auto') - (a.value === 'auto') || abc.compare(a.text, b.text));
    list.replaceChildren(...opts.map((o) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lang-row';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(o.value === lang.value));
      const own = o.text;
      let sub = nameIn(o.value === 'auto' ? browserLang() : o.value);
      if (sub && sub.toLocaleLowerCase() === own.toLocaleLowerCase()) sub = '';
      const text = document.createElement('span');
      text.className = 'lang-text';
      const top = document.createElement('span');
      top.className = 'lang-own';
      top.textContent = own;
      if (o.value !== 'auto') top.lang = o.value;
      text.append(top);
      if (sub) {
        const under = document.createElement('span');
        under.className = 'lang-sub';
        under.textContent = sub;
        text.append(under);
      }
      b.append(text);
      b.insertAdjacentHTML('beforeend', CHECK);
      b.addEventListener('click', () => {
        // The popup reloads in the new language; come back to this screen, not the main one.
        try { sessionStorage.setItem('prefsOpen', '1'); } catch (e) { /* only a convenience */ }
        pick(lang, o.value);
      });
      return b;
    }));
  }

  function render() {
    summary();
    renderTheme();
    renderLang();
  }

  // The options are added (and translated) by the popup after it loads.
  for (const s of selects) {
    s.addEventListener('change', render);
    new MutationObserver(render).observe(s, { childList: true, subtree: true, characterData: true });
  }
  render();

  const show = (on, focus = true) => {
    document.body.classList.toggle('prefs', on);
    if (on) fitTheme();
    window.scrollTo(0, 0);
    if (focus) (on ? $('prefsBack') : $('prefsOpen')).focus();
  };
  $('prefsOpen').addEventListener('click', () => show(true));
  $('prefsBack').addEventListener('click', () => show(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('prefs')) { e.preventDefault(); show(false); }
  });

  try {
    if (sessionStorage.getItem('prefsOpen')) {
      sessionStorage.removeItem('prefsOpen');
      show(true, false);
    }
  } catch (e) { /* only a convenience */ }
}
