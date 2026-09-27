#!/usr/bin/env bash
# Launches the Vague desktop app and opens it in your browser.
cd "$(dirname "$(readlink -f "$0")")" || exit 1
echo
echo "  Starting Vague…  (Ctrl+C to quit)"
echo
exec node app.js
