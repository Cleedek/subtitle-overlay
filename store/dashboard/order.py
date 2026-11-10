#!/usr/bin/env python3
# order.py <folder> [...]: per language, put the Store listing description from store/descriptions/<folder>.txt,
# then put the 5 screenshots in the order of store/images/<folder>/screenshot-1..5.png (en = global ones),
# matching each dashboard image to a local file by a tiny 64x40 picture. Ends with Save draft.
import os, re, struct, subprocess, sys, tempfile, time, urllib.request
D = os.path.dirname(os.path.abspath(__file__)); IMG = os.path.join(D, '..', 'images'); DESC = os.path.join(D, '..', 'descriptions')
LOCAL = '[data-image-upload-type="4"]:not([data-is-global])'; GLOBAL = '[data-image-upload-type="4"][data-is-global="true"]'
TMP = tempfile.mkdtemp()
sys.path.insert(0, D)
_argv = sys.argv; sys.argv = sys.argv[:1]  # first.py's loop runs over sys.argv, so hide our arguments while importing
from first import js, keys, press, save  # noqa
sys.argv = _argv

def bmp_pixels(path):
    out = os.path.join(TMP, 'x.bmp')
    subprocess.run(['sips', '-s', 'format', 'bmp', '-z', '40', '64', path, '--out', out], capture_output=True)
    b = open(out, 'rb').read()
    off = struct.unpack_from('<I', b, 10)[0]; w, h = struct.unpack_from('<ii', b, 18); bpp = struct.unpack_from('<H', b, 28)[0] // 8
    row = (w * bpp + 3) & ~3
    return [b[off + y * row + x * bpp + c] for y in range(abs(h)) for x in range(w) for c in range(3)]

REF = {}
def ref(folder, i):
    if (folder, i) not in REF:
        p = os.path.join(IMG, f'screenshot-{i}.png') if folder == 'en' else os.path.join(IMG, folder, f'screenshot-{i}.png')
        REF[(folder, i)] = bmp_pixels(p)
    return REF[(folder, i)]

def dash_pixels(sel):
    srcs = js(f"[...document.querySelector('{sel}').querySelectorAll('[data-image-key] img')].map(i => i.src).join(' ')").split()
    out = []
    for s in srcs:
        p = os.path.join(TMP, f'd{len(out)}.png')
        urllib.request.urlretrieve(re.sub(r'=[^=/]*$', '', s) + '=w320-h200', p)
        out.append(bmp_pixels(p))
    return out

def diff(a, b): return sum(abs(x - y) for x, y in zip(a, b)) / len(a)

def current_order(folder, sel):
    dp = dash_pixels(sel)
    order = []
    for px in dp:
        scores = sorted((diff(px, ref(folder, i)), i) for i in range(1, 6))
        order.append((scores[0][1], round(scores[0][0], 1), round(scores[1][0], 1)))
    return order

def fix(folder, sel):
    for _ in range(12):
        o = current_order(folder, sel)
        nums = [n for n, _, _ in o]
        if nums == [1, 2, 3, 4, 5]: return 'ok ' + str(o)
        if sorted(nums) != [1, 2, 3, 4, 5]: return 'UNSURE ' + str(o)
        # move the first out-of-place wanted image one step left
        want = next(i for i in range(1, 6) if nums[i - 1] != i)
        idx = nums.index(want)
        press(sel, idx, 'move left'); time.sleep(1.5)
    return 'GAVE UP ' + str(current_order(folder, sel))

for folder in sys.argv[1:]:
    code = 'en' if folder == 'en' else folder.replace('_', '-')
    r = subprocess.run([sys.executable, os.path.join(D, 'fill.py'), code, os.path.join(DESC, folder + '.txt')], capture_output=True, text=True)
    print(folder, 'desc:', r.stdout.strip()[:90], flush=True)
    if r.returncode: print(folder, 'SWITCH FAILED'); sys.exit(1)
    time.sleep(1)
    res = fix(folder, GLOBAL if folder == 'en' else LOCAL)
    print(folder, 'shots:', res, flush=True)
    print(folder, 'saved' if save() else 'SAVE NOT CONFIRMED', flush=True)
