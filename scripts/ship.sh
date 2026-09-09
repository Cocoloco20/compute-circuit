#!/bin/bash
# ship "commit message"  — typecheck, push, and wait for the exact commit to go live.
#
# The old loop ran a full `next build` locally (17s) that Vercel then repeated
# (40s), and confirmed the deploy by sleeping. Total ~2 minutes, most of it
# waiting on nothing. tsc catches the error class that matters in ~1s; Vercel is
# the build of record; /api/version reports the commit actually serving, so this
# polls for that SHA instead of guessing.
set -e
cd "$(dirname "$0")/.."
MSG="${1:?usage: ship.sh \"commit message\"}"
ALIAS="${ALIAS:-https://compute-circuit.vercel.app}"

echo "→ typecheck"
npx tsc --noEmit

if [ -z "$(git status --porcelain)" ]; then
  echo "→ nothing to commit"; exit 0
fi

git add -A
git commit -q -m "$MSG"
SHA=$(git rev-parse HEAD)
echo "→ pushing ${SHA:0:7}"
git push -q origin HEAD

echo -n "→ waiting for ${SHA:0:7} to serve "
START=$(date +%s)
while true; do
  LIVE=$(curl -s --max-time 10 "$ALIAS/api/version" 2>/dev/null \
         | python3 -c "import sys,json;print(json.load(sys.stdin).get('sha',''))" 2>/dev/null || echo "")
  if [ "$LIVE" = "$SHA" ]; then
    echo " live in $(( $(date +%s) - START ))s"; exit 0
  fi
  ELAPSED=$(( $(date +%s) - START ))
  if [ $ELAPSED -gt 300 ]; then
    echo " TIMED OUT after ${ELAPSED}s (live sha: ${LIVE:0:7})"; exit 1
  fi
  echo -n "."
  sleep 4
done
