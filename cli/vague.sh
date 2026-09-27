#!/usr/bin/env bash
# CLI wrapper.  Usage:  ./vague.sh /path/to/video.mov [options]
cd "$(dirname "$(readlink -f "$0")")" || exit 1
if [ $# -eq 0 ]; then
  echo
  echo "  Usage: ./vague.sh /path/to/video.mov [options]"
  echo
  echo "    --dry-run       show the ffmpeg commands, run nothing"
  echo "    --remux-only    lossless container fix, no re-encode"
  echo "    --patch         experimental duration patch"
  echo "    --keep-4k       don't downscale"
  echo "    --sdr           force SDR tonemap"
  echo "    --platform ig_reels|ig_story|yt_shorts"
  echo
  exit 0
fi
exec node vague.js "$@"
