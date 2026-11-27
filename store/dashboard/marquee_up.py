#!/usr/bin/env python3
# marquee_up.py: replace the global marquee (upload type 3) with store/images/marquee-promo-1400x560.png, save, reload, check.
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_a, sys.argv = sys.argv, sys.argv[:1]
import screens2 as T
sys.argv = _a
SEL = '[data-image-upload-type="3"]'
T.switch('en')
print('before', T.count(SEL))
while T.count(SEL) > 0:
    n = T.count(SEL); T.remove_first(SEL); T.wait(SEL, n - 1, 15)
T.upload(SEL, os.path.join(T.S.IMG, 'marquee-promo-1400x560.png'))
print('uploaded seen', T.wait(SEL, 1))
time.sleep(1.5)
T.save_reload('en')
print('after reload', T.count(SEL))
