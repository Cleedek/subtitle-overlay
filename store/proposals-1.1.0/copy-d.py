# Writes copy/<store code>.json (shared + d blocks) for variant D. s2 comes from the l10n kit for these codes.
import json, sys, os
D = json.load(open('copy-d.json'))
for code, v in D.items():
    p = f'copy/{code}.json'
    j = json.load(open(p)) if os.path.exists(p) else {}
    j['shared'] = dict(j.get('shared', {}), co=v['co'], sharedAi=v['sharedAi'])
    j['d'] = {k: v[k] for k in ('target', 'line', 'googleNote', 'aiNote', 'unedited', 'file') if k in v}
    open(p, 'w').write(json.dumps(j, ensure_ascii=False, indent=2) + '\n')
    print(code)
