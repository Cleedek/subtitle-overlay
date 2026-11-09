#!/usr/bin/env python3
# screens.py <folder-code> [...]: for each language, switch the Store listing to it, remove its own (localized)
# screenshots, upload store/images/<code>/screenshot-1..5.png in order, check there are 5, and Save draft.
# Folder codes as in store/images (zh_CN, pt_BR); the Dashboard uses zh-CN, pt-BR.
import base64, json, os, subprocess, sys, time
D = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(D, '..', 'images')
SEL = '[data-image-upload-type="4"]:not([data-is-global])'

def js(code):
    p = os.path.join(D, '_step.js'); open(p, 'w', encoding='utf-8').write(code)
    r = subprocess.run([os.path.join(D, 'arc.sh'), p], capture_output=True, text=True)
    return (r.stdout + r.stderr).strip().strip('"')

def count():
    return int(js(f"document.querySelector('{SEL}').querySelectorAll('[data-image-key]').length") or -1)

def press_remove_first():
    js(f"""(() => {{ const it = document.querySelector('{SEL}').querySelector('[data-image-key]');
      const b = [...it.querySelectorAll('[role=button]')].find(x => /Remove image/.test(x.getAttribute('aria-label')));
      for (const t of ['mousedown','mouseup','click']) b.dispatchEvent(new MouseEvent(t, {{bubbles: true, cancelable: true, view: window}})); return 'ok'; }})()""")
    time.sleep(1.2)
    js("""(() => { const d = [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].find(x => x.innerText.includes('remove this image'));
      const b = d && [...d.querySelectorAll('button,[role=button]')].find(x => x.innerText.trim() === 'Remove');
      if (b) for (const t of ['mousedown','mouseup','click']) b.dispatchEvent(new MouseEvent(t, {bubbles: true, cancelable: true, view: window})); return b ? 'ok' : 'none'; })()""")

def upload(path):
    b64 = base64.b64encode(open(path, 'rb').read()).decode()
    name = os.path.basename(path)
    return js(f"""(() => {{ const c = document.querySelector('{SEL}');
      const inp = c.querySelector('input[type=file]') || c.parentElement.querySelector('input[type=file]');
      const bin = atob('{b64}'); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([u], '{name}', {{type: 'image/png'}}));
      inp.files = dt.files; inp.dispatchEvent(new Event('change', {{bubbles: true}})); return 'up ' + u.length; }})()""")

def wait_count(n, secs=40):
    for _ in range(secs):
        if count() == n: return True
        time.sleep(1)
    return False

def save():
    js("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save draft').click(); 'ok'")
    for _ in range(30):
        time.sleep(1)
        t = js("[...document.querySelectorAll('[aria-live],[role=status],[role=alert]')].map(e => e.textContent).join('|')")
        if 'Item saved' in t: return True
    return False

for folder in sys.argv[1:]:
    code = folder.replace('_', '-')
    r = subprocess.run([sys.executable, os.path.join(D, 'fill.py'), code], capture_output=True, text=True)
    if r.returncode: print(folder, 'SWITCH FAILED', r.stdout.strip()); sys.exit(1)
    for _ in range(8):
        n = count()
        if n <= 0: break
        press_remove_first(); wait_count(n - 1, 15)
    if count() != 0: print(folder, 'could not clear, has', count()); sys.exit(1)
    for i in range(1, 6):
        upload(os.path.join(IMG, folder, f'screenshot-{i}.png'))
        if not wait_count(i): print(folder, f'upload {i} not seen, count', count()); sys.exit(1)
    print(folder, 'uploaded 5, saved' if save() else 'uploaded 5, SAVE NOT CONFIRMED', flush=True)
