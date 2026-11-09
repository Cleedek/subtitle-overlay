(() => {
  const d = [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].find(x => x.innerText.includes('__TEXT__'));
  if (!d) return 'no dialog';
  const b = [...d.querySelectorAll('button,[role=button]')].find(x => x.innerText.trim() === '__BTN__');
  if (!b) return 'no btn';
  for (const t of ['mousedown', 'mouseup', 'click']) b.dispatchEvent(new MouseEvent(t, {bubbles: true, cancelable: true, view: window}));
  return 'pressed';
})()
