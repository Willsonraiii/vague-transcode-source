#!/usr/bin/env bash
# Deploy the website: sync site/ → the GitHub Pages repo, then push.
#
# The live tool at https://willsonraiii.github.io/vague-transcode/ is served
# from the SEPARATE repo  Willsonraiii/vague-transcode .  Changing site/ in
# this source repo does nothing for users until this script runs.
#
# Usage:
#   ./deploy-site.sh                  # push with whatever git credentials
#                                     # the current machine already has
#   ./deploy-site.sh --token <pat>    # push with a fine-grained PAT that has
#                                     # Contents: Read & write on
#                                     # Willsonraiii/vague-transcode
#
# Notes:
#   - Never deletes files that exist only in the Pages repo (the TikTok
#     domain-verification .txt must survive every deploy).
#   - Run from any checkout of vague-transcode-source; nothing else needed.
set -e
cd "$(dirname "$0")"

TOKEN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

SRC=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "• cloning Pages repo (Willsonraiii/vague-transcode)"
git clone -q https://github.com/Willsonraiii/vague-transcode.git "$TMP/pages"

echo "• copying site/ over it (no --delete: keeps Pages-only files)"
cp -r site/. "$TMP/pages/"
cd "$TMP/pages"

git add -A
if git diff --cached --quiet; then
  echo "• Pages repo already matches site/ — nothing to deploy."
  exit 0
fi

git -c user.name="vague-deploy" \
    -c user.email="deploy@users.noreply.github.com" \
    commit -q -m "Sync site from source repo @ $SRC"

if [ -n "$TOKEN" ]; then
  git push -q "https://x-access-token:$TOKEN@github.com/Willsonraiii/vague-transcode.git" main
else
  git push origin main
fi
echo "✓ deployed from source @ $SRC — live in ~1 min at"
echo "  https://willsonraiii.github.io/vague-transcode/"
