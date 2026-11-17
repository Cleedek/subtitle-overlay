#!/bin/zsh
# thumbs.sh <outdir> [global]: download the current language's (or global) Dashboard screenshot thumbnails as PNG
O=$1; SEL='[data-image-upload-type="4"]:not([data-is-global])'; [ "$2" = global ] && SEL='[data-image-upload-type="4"][data-is-global="true"]'
rm -rf $O; mkdir -p $O; D=${0:A:h}
echo "[...document.querySelector('$SEL').querySelectorAll('[data-image-key] img')].map(i=>i.src).join(' ')" > $D/_t.js
i=0; for u in ${=$($D/arc.sh $D/_t.js 2>/dev/null | tr -d '"')}; do i=$((i+1)); curl -s "$u" -o $O/d$i.img && sips -s format png $O/d$i.img --out $O/d$i.png >/dev/null; rm $O/d$i.img; done
ls $O
