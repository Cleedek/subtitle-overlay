#!/usr/bin/env python3
# first.py <folder-code> [...]: replace only screenshot 1 in each language and keep 2-5 as they are.
#   en = the global (default) screenshots, from store/images/screenshot-1.png; others from store/images/<code>/.
#   If a language has no own screenshots yet (0), uploads all five. Ends with Save draft per language.
# Run with ARC_TAB=kfiihdcon so it works whichever Arc tab is active. Submit for review stays a human click.
import base64, os, subprocess, sys, time
D = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(D, '..', 'images')
LOCAL = '[data-image-upload-type="4"]:not([data-is-global])'
GLOBAL = '[data-image-upload-type="4"][data-is-global="true"]'

def js(code):
    p = os.path.join(D, '_step.js'); open(p, 'w', encoding='utf-8').write(code)
    r = subprocess.run([os.path.join(D, 'arc.sh'), p], capture_output=True, text=True)
    return r.stdout.strip().strip('"')

def keys(sel):
    r = js(f"[...document.querySelector('{sel}').querySelectorAll('[data-image-key]')].map(e => e.dataset.imageKey).join(',')")
    return [k for k in r.split(',') if k]

def press(sel, idx, label):
    return js(f"""(() => {{ const it = document.querySelector('{sel}').querySelectorAll('[data-image-key]')[{idx}];
      const b = [...it.querySelectorAll('[role=button]')].find(x => new RegExp('{label}', 'i').test(x.getAttribute('aria-label') || ''));
      if (!b) return 'no button';
      for (const t of ['mousedown','mouseup','click']) b.dispatchEvent(new MouseEvent(t, {{bubbles: true, cancelable: true, view: window}})); return 'ok'; }})()""")

def confirm_remove():
    return js("""(() => { const d = [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].find(x => x.innerText.includes('remove this image'));
      const b = d && [...d.querySelectorAll('button,[role=button]')].find(x => x.innerText.trim() === 'Remove');
      if (b) for (const t of ['mousedown','mouseup','click']) b.dispatchEvent(new MouseEvent(t, {bubbles: true, cancelable: true, view: window})); return b ? 'ok' : 'none'; })()""")

def upload(sel, path):
    b64 = base64.b64encode(open(path, 'rb').read()).decode()
    return js(f"""(() => {{ const c = document.querySelector('{sel}');
      const inp = c.querySelector('input[type=file]') || c.parentElement.querySelector('input[type=file]');
      const bin = atob('{b64}'); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([u], '{os.path.basename(path)}', {{type: 'image/png'}}));
      inp.files = dt.files; inp.dispatchEvent(new Event('change', {{bubbles: true}})); return 'up ' + u.length; }})()""")

def wait(fn, secs=40):
    for _ in range(secs):
        if fn(): return True
        time.sleep(1)
    return False

def save():
    js("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save draft').click(); 'ok'")
    for _ in range(30):
        time.sleep(1)
        t = js("[...document.querySelectorAll('[aria-live],[role=status],[role=alert]')].map(e => e.textContent).join('|')")
        if 'Item saved' in t: return True
    return False

def replace_first(sel, path):
    before = keys(sel)
    if len(before) != 5: return f'expected 5, found {len(before)}'
    press(sel, 0, 'Remove image'); time.sleep(1.2); confirm_remove()
    if not wait(lambda: len(keys(sel)) == 4, 20): return 'remove not seen'
    upload(sel, path)
    if not wait(lambda: len(keys(sel)) == 5): return 'upload not seen'
    new = [k for k in keys(sel) if k not in before]
    if len(new) != 1: return 'new image not found'
    for i in (4, 3, 2, 1):
        press(sel, i, 'move left'); time.sleep(1.2)
    k = keys(sel)
    if k[0] != new[0] or k[1:] != before[1:]: return 'order wrong: ' + ','.join(k)
    return 'ok'

def upload_all(sel, folder):
    for i in range(1, 6):
        upload(sel, os.path.join(IMG, folder, f'screenshot-{i}.png'))
        if not wait(lambda: len(keys(sel)) == i): return f'upload {i} not seen'
    return 'ok (all 5 uploaded)'

for folder in sys.argv[1:]:
    code = 'en' if folder == 'en' else folder.replace('_', '-')
    r = subprocess.run([sys.executable, os.path.join(D, 'fill.py'), code], capture_output=True, text=True)
    if r.returncode: print(folder, 'SWITCH FAILED', r.stdout.strip(), flush=True); sys.exit(1)
    if folder == 'en':
        res = replace_first(GLOBAL, os.path.join(IMG, 'screenshot-1.png'))
    else:
        n = len(keys(LOCAL))
        res = upload_all(LOCAL, folder) if n == 0 else replace_first(LOCAL, os.path.join(IMG, folder, 'screenshot-1.png'))
    if not res.startswith('ok'): print(folder, 'STOPPED:', res, flush=True); sys.exit(1)
    print(folder, res, '| saved' if save() else '| SAVE NOT CONFIRMED', flush=True)
