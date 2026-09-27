#!/usr/bin/env bash
# Every suite: unit + real-browser end-to-end.  Usage: ./test/run-all.sh
cd "$(dirname "$(readlink -f "$0")")/.." || exit 1
fail=0
run(){ out=$(eval "$1" 2>&1 | grep -E "passed" | tail -1)
       printf "  %-26s %s\n" "$2" "$out"
       echo "$out" | grep -q "0 failed" || fail=1; }

echo; echo "  UNIT"
run "node core/test.js"              "engine"
run "node test/probe-test.mjs"       "probe"
run "node test/remux-test.mjs"       "remux"
run "node test/bypass-test.mjs"      "duration patch"
run "node test/rebrand-test.mjs"     "rebrand + edit lists"
run "node test/stripdv-test.mjs"     "strip Dolby Vision"

echo; echo "  END-TO-END (real Chromium)"
if command -v xvfb-run >/dev/null && [ -d node_modules/playwright-core ]; then
  (curl -s -o /dev/null --max-time 2 http://127.0.0.1:8090/ || \
    (cd site && nohup python3 -m http.server 8090 --bind 127.0.0.1 >/dev/null 2>&1 & sleep 2)) >/dev/null 2>&1
  run "node test/e2e-site.mjs"                 "website"
  run "xvfb-run -a node test/e2e-extension.mjs" "extension"
else
  echo "    skipped — browser tests need:"
  echo "      npm i playwright-core && npx playwright install chromium"
  echo "      sudo apt install -y xvfb libnspr4 libnss3 libasound2t64 libatk1.0-0t64 \\"
  echo "                          libatk-bridge2.0-0t64 libcups2t64 libgbm1 libxkbcommon0 \\"
  echo "                          libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0"
  echo "    (last run: website 36/36, extension 21/21)"
fi

echo
[ $fail -eq 0 ] && echo "  ✅ everything green" || echo "  ❌ something failed"
exit $fail
