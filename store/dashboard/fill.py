#!/usr/bin/env python3
# fill.py <dashboard-code> <file|-> : switch the Store listing language, then (if a file is given) put its text in Description.
import json, subprocess, sys, time, os, re
S = os.path.dirname(os.path.abspath(__file__))
def js(code):
    p = os.path.join(S, '_step.js'); open(p, 'w', encoding='utf-8').write(code)
    r = subprocess.run([os.path.join(S, 'arc.sh'), p], capture_output=True, text=True)
    return (r.stdout + r.stderr).strip()
COMBO = "[...document.querySelectorAll('[role=combobox]')].find(e => e.textContent.includes('Language'))"
def is_on(label, code):
    return re.search('– ' + re.escape(code) + r'( \(default\))?"?$', label) is not None
def switch(code):
    for attempt in range(4):
        cur = js(f"{COMBO}.textContent")
        if is_on(cur, code): return True
        js(f"{COMBO}.click(); 'ok'")
        time.sleep(0.8)
        js(f"""(() => {{ const l = [...document.querySelectorAll('li[data-value="{code}"]')]; const li = l.find(x => x.offsetParent) || l[0]; li.click(); return 'ok'; }})()""")
        time.sleep(1.5)
    return is_on(js(f"{COMBO}.textContent"), code)
def setdesc(text):
    t = json.dumps(text)
    return js(f"""(() => {{
      const ta = document.querySelector('textarea');
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      ta.focus(); set.call(ta, {t});
      ta.dispatchEvent(new Event('input', {{bubbles: true}}));
      ta.dispatchEvent(new Event('change', {{bubbles: true}}));
      ta.blur();
      return ta.value.length;
    }})()""")
def read():
    return js("(() => { const ta = document.querySelector('textarea'); return ta.value.length + ' | ' + ta.value.slice(0, 60).replace(/\\n/g, ' '); })()")
code = sys.argv[1]
ok = switch(code)
if not ok: print(code, 'SWITCH FAILED', js(f"{COMBO}.textContent")); sys.exit(1)
if len(sys.argv) > 2:
    text = open(sys.argv[2], encoding='utf-8').read().rstrip('\n')
    n = setdesc(text); time.sleep(0.5)
    r = read()
    print(code, 'set', n, 'expected', len(text), '| now', r)
else:
    print(code, read())
