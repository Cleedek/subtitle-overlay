(() => {
  const c = document.querySelector('__SEL__');
  const items = [...c.querySelectorAll('[data-image-key]')];
  const it = items[__IDX__];
  const b = [...it.querySelectorAll('[role=button]')].find(x => /move left/.test(x.getAttribute('aria-label')));
  for (const t of ['mousedown', 'mouseup', 'click']) b.dispatchEvent(new MouseEvent(t, {bubbles: true, cancelable: true, view: window}));
  return items.length + ' moved ' + __IDX__;
})()
