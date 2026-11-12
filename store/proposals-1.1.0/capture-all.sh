#!/bin/zsh
# Captures the real shared card (offered + used) for every store language in copy/<code>.json "d", one Chrome at a time.
#   ./capture-all.sh <work dir W> [codes...]
W=$1; shift
here=${0:a:h}
codes=(${@:-$(cd $here/copy && ls *.json | sed 's/\.json$//')})
for code in $codes; do
  read ui target line file <<< $(node -e '
    const L = require("'$here'/../../promo-video/screens/l10n/langs.json")["'$code'"] || { ui: "'$code'" };
    const d = require("'$here'/copy/'$code'.json").d;
    console.log(L.ui, d.target, d.line, d.file || "");')
  echo "=== $code ui=$ui target=$target line=$line $file"
  node $here/capture-shared.mjs /Users/filip/subtitle-overlay $W $ui $target $line $file 2>&1 | grep -E "offer|used|ERR|timeout|TIMEOUT" | cut -c1-260
  mkdir -p $here/img/$code/d && cp $W/caps/$ui/card-shared-* $here/img/$code/d/
done
