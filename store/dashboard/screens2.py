#!/usr/bin/env python3
# screens2.py <folder-code> [...]: like screens.py, but checks the saved state after a page reload.
# Per language: remove all localized screenshots, Save draft, reload, confirm 0; upload 1..5, Save draft,
# reload, confirm 5. Use "GLOBAL" as a code for the global slot (store/images/screenshot-1..5.png).
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_argv, sys.argv = sys.argv, sys.argv[:1]
import screens as S  # reuses js(), D and IMG; its own loop runs over an empty list here
sys.argv = _argv

LOCAL = '[data-image-upload-type="4"]:not([data-is-global])'
GLOBAL = '[data-image-upload-type="4"][data-is-global="true"]'

def count(sel):
    try: return int(S.js(f"document.querySelector('{sel}').querySelectorAll('[data-image-key]').length"))
    except ValueError: return -1

def remove_first(sel):
    S.js(f"""(() => {{ const it = document.querySelector('{sel}').querySelector('[data-image-key]');
      const b = [...it.querySelectorAll('[role=button]')].find(x => /Remove image/.test(x.getAttribute('aria-label')));
      for (const t of ['mousedown','mouseup','click']) b.dispatchEvent(new MouseEvent(t, {{bubbles: true, cancelable: true, view: window}})); return 'ok'; }})()""")
    time.sleep(1.5)
    S.js("""(() => { const d = [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].find(x => x.innerText.includes('remove this image'));
      const b = d && [...d.querySelectorAll('button,[role=button]')].find(x => x.innerText.trim() === 'Remove');
      if (b) for (const t of ['mousedown','mouseup','click']) b.dispatchEvent(new MouseEvent(t, {bubbles: true, cancelable: true, view: window})); return b ? 'ok' : 'none'; })()""")
    time.sleep(2.5)

def upload(sel, path):
    import base64
    b64 = base64.b64encode(open(path, 'rb').read()).decode()
    S.js(f"""(() => {{ const c = document.querySelector('{sel}');
      const inp = c.querySelector('input[type=file]') || c.parentElement.querySelector('input[type=file]');
      const bin = atob('{b64}'); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([u], '{os.path.basename(path)}', {{type: 'image/png'}}));
      inp.files = dt.files; inp.dispatchEvent(new Event('change', {{bubbles: true}})); return 'up'; }})()""")

def wait(sel, n, secs=40):
    for _ in range(secs):
        if count(sel) == n: return True
        time.sleep(1)
    return False

def save_reload(code):
    S.js("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save draft').click(); 'ok'")
    for _ in range(30):
        time.sleep(1)
        if S.js("String([...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save draft').disabled)") == 'true': break
    time.sleep(2)
    S.js("location.reload(); 'ok'"); time.sleep(10)
    for _ in range(20):
        if S.js("String(!!document.querySelector('[data-image-upload-type=\"4\"]'))") == 'true': break
        time.sleep(1)
    switch(code)

def switch(code):
    import subprocess
    r = subprocess.run([sys.executable, os.path.join(S.D, 'fill.py'), code], capture_output=True, text=True)
    if r.returncode: print(code, 'SWITCH FAILED', r.stdout.strip(), flush=True); sys.exit(1)

def do(folder):
    is_global = folder == 'GLOBAL'
    sel = GLOBAL if is_global else LOCAL
    code = 'en' if is_global else {'he': 'iw'}.get(folder, folder.replace('_', '-'))
    files = [os.path.join(S.IMG, *([] if is_global else [folder]), f'screenshot-{i}.png') for i in range(1, 6)]
    switch(code)
    for attempt in range(3):
        while count(sel) > 0:
            n = count(sel); remove_first(sel); wait(sel, n - 1, 15)
        save_reload(code)
        if count(sel) == 0: break
    else:
        print(folder, 'could not clear, has', count(sel), flush=True); sys.exit(1)
    for i, f in enumerate(files, 1):
        upload(sel, f)
        if not wait(sel, i): print(folder, f'upload {i} not seen, count', count(sel), flush=True); sys.exit(1)
        time.sleep(1.5)
    save_reload(code)
    n = count(sel)
    print(folder, 'OK 5 after reload' if n == 5 else f'COUNT {n} AFTER RELOAD', flush=True)
    if n != 5: sys.exit(1)

if __name__ == '__main__':
    for f in sys.argv[1:]: do(f)
