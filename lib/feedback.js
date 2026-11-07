// "Write to me": a form on a second level of the popup, built like "Support the creator".
// The message goes to a small service of ours, which emails it. If that fails, the text stays saved
// and the person can send it from their own email instead. Same file in all the extensions.
const FEEDBACK_URL = 'https://feedback.cleedek.com/';
const FEEDBACK_EMAIL = 'feedback@cleedek.com';

function setupFeedback({ ext, name, i18n }) {
  const $ = (id) => document.getElementById(id);
  const t = i18n.t;
  const LABELS = { problem: 'What happened?', idea: 'What would help you?', other: "What's on your mind?" };
  let type = 'problem';

  function techInfo() {
    const ua = navigator.userAgentData;
    const brands = ua?.brands || [];
    const brand = brands.find((b) => !/not.?a.?brand|chromium/i.test(b.brand)) || brands.find((b) => /chromium/i.test(b.brand));
    return {
      version: chrome.runtime.getManifest().version,
      browser: brand ? `${brand.brand} ${brand.version}` : '',
      os: ua?.platform || '',
      lang: i18n.lang,
    };
  }

  function showState(state) {
    for (const [id, key] of [['fbForm', 'form'], ['fbSent', 'sent'], ['fbFailed', 'failed']]) $(id).hidden = state !== key;
    window.scrollTo(0, 0);
  }

  function setType(next) {
    type = next;
    document.querySelectorAll('#fbTypes [role=radio]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.type === type)));
    $('fbLabel').textContent = t(LABELS[type]);
  }

  // A popup closes as soon as you click anywhere else, so the text is kept while typing.
  const saveDraft = () => chrome.storage.local.set({ feedbackDraft: { type, message: $('fbMessage').value, email: $('fbEmail').value } }).catch(() => {});
  const updateSend = () => { $('fbSend').disabled = !$('fbMessage').value.trim(); };

  async function loadDraft() {
    const { feedbackDraft: draft } = await chrome.storage.local.get('feedbackDraft').catch(() => ({}));
    setType(LABELS[draft?.type] ? draft.type : 'problem');
    $('fbMessage').value = draft?.message || '';
    $('fbEmail').value = draft?.email || '';
    updateSend();
  }

  function open(on) {
    document.body.classList.toggle('feedback', on);
    window.scrollTo(0, 0);
    if (!on) return $('feedbackOpen').focus();
    showState('form');
    $('fbMessage').focus();
  }

  function mailLink(message, tech) {
    const lines = [message.slice(0, 1500), '', '---', ...Object.values(tech).filter(Boolean)];
    return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(`${name}: ${type}`)}&body=${encodeURIComponent(lines.join('\n'))}`;
  }

  async function send() {
    const message = $('fbMessage').value.trim();
    if (!message) return;
    const tech = $('fbTech').checked ? techInfo() : {};
    const button = $('fbSend');
    button.disabled = true;
    button.textContent = t('Sending…');
    try {
      const res = await fetch(FEEDBACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ext, type, message, email: $('fbEmail').value.trim(), tech }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(String(res.status));
      await chrome.storage.local.remove('feedbackDraft').catch(() => {});
      $('fbMessage').value = '';
      $('fbEmail').value = '';
      setType('problem');
      showState('sent');
      $('fbDone').focus();
    } catch (e) {
      $('fbMail').href = mailLink(message, tech);
      showState('failed');
      $('fbRetry').focus();
    } finally {
      button.textContent = t('Send');
      updateSend();
    }
  }

  document.querySelectorAll('#fbTypes [role=radio]').forEach((b) => b.addEventListener('click', () => { setType(b.dataset.type); saveDraft(); }));
  $('fbMessage').addEventListener('input', () => { updateSend(); saveDraft(); });
  $('fbEmail').addEventListener('input', saveDraft);
  $('fbForm').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  $('feedbackOpen').addEventListener('click', async () => { await loadDraft(); open(true); });
  $('feedbackBack').addEventListener('click', () => open(false));
  $('fbDone').addEventListener('click', () => open(false));
  $('fbRetry').addEventListener('click', send);
  $('fbCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(FEEDBACK_EMAIL); $('fbCopy').textContent = t('Copied'); }
    catch (e) { getSelection().selectAllChildren($('fbAddress')); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('feedback')) { e.preventDefault(); open(false); }
  });

  $('fbAddress').textContent = FEEDBACK_EMAIL;
  const info = techInfo();
  $('fbTechInfo').textContent = [`${name} ${info.version}`, info.browser, info.os, info.lang].filter(Boolean).join(', ') + '. ' + t('Nothing else is sent.');
}
