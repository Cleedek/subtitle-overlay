import base64, sys
img, sel, out = sys.argv[1], sys.argv[2], sys.argv[3]
b64 = base64.b64encode(open(img, 'rb').read()).decode()
open(out, 'w').write(f"""(() => {{
  const c = document.querySelector('{sel}');
  const inp = c.querySelector('input[type=file]') || c.parentElement.querySelector('input[type=file]');
  if (!inp) return 'no input';
  const bin = atob('{b64}');
  const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const dt = new DataTransfer(); dt.items.add(new File([u], 'screenshot-2.png', {{type: 'image/png'}}));
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', {{bubbles: true}}));
  return 'uploaded ' + u.length;
}})()""")
