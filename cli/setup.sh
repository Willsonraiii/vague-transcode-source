#!/usr/bin/env bash
# =============================================================================
#  Vague — Linux setup
#
#  Installs ffmpeg + dovi_tool, then verifies Dolby Vision support.
#  Safe to run more than once. Asks before anything that needs sudo.
#
#    chmod +x setup.sh
#    ./setup.sh
# =============================================================================
set -u

G='\033[32m'; R='\033[31m'; Y='\033[33m'; D='\033[2m'; B='\033[1m'; X='\033[0m'
ok(){   printf "  ${G}✓${X} %b\n" "$1"; }
bad(){  printf "  ${R}✗${X} %b\n" "$1"; }
warn(){ printf "  ${Y}!${X} %b\n" "$1"; }
step(){ printf "\n${B}%s${X}\n%s\n" "$1" "────────────────────────────────────────────────"; }
ask(){  printf "\n${Y}? %s${X} [y/N] " "$1"; read -r a; [ "$a" = "y" ] || [ "$a" = "Y" ]; }

cd "$(dirname "$(readlink -f "$0")")" || exit 1

printf "\n${B}Vague — Linux setup${X}\n"
printf "${D}Installs ffmpeg and dovi_tool, then checks Dolby Vision support.${X}\n"

# ---------------------------------------------------------------- 1. distro
step "1. Detecting your system"

DISTRO="unknown"; INSTALL=""
if   command -v apt-get >/dev/null 2>&1; then DISTRO="debian"; INSTALL="sudo apt-get install -y"
elif command -v dnf     >/dev/null 2>&1; then DISTRO="fedora"; INSTALL="sudo dnf install -y"
elif command -v pacman  >/dev/null 2>&1; then DISTRO="arch";   INSTALL="sudo pacman -S --noconfirm"
elif command -v zypper  >/dev/null 2>&1; then DISTRO="suse";   INSTALL="sudo zypper install -y"
elif command -v apk     >/dev/null 2>&1; then DISTRO="alpine"; INSTALL="sudo apk add"
fi

NAME=$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")
ok "${NAME:-Linux}  ${D}(package manager: ${DISTRO})${X}"
[ "$DISTRO" = "unknown" ] && warn "Unknown package manager — I'll use static downloads instead."

ARCH=$(uname -m)
ok "architecture: $ARCH"
if [ "$ARCH" != "x86_64" ]; then
  warn "Static dovi_tool builds are x86_64 only. You may need to build from source."
fi

# ------------------------------------------------------------------ 2. node
step "2. Node.js"
if command -v node >/dev/null 2>&1; then
  NV=$(node --version)
  MAJ=$(echo "$NV" | sed 's/v\([0-9]*\).*/\1/')
  if [ "$MAJ" -ge 16 ] 2>/dev/null; then ok "node $NV"
  else bad "node $NV is too old (need 16+)"; fi
else
  bad "node not installed"
  if [ -n "$INSTALL" ] && ask "Install Node.js now?"; then
    case $DISTRO in
      debian) $INSTALL nodejs npm ;;
      fedora) $INSTALL nodejs ;;
      arch)   $INSTALL nodejs npm ;;
      suse)   $INSTALL nodejs ;;
      alpine) $INSTALL nodejs npm ;;
    esac
    command -v node >/dev/null 2>&1 && ok "node $(node --version) installed"
  else
    printf "     ${D}Install manually: https://nodejs.org${X}\n"
  fi
fi

# ---------------------------------------------------------------- 3. ffmpeg
step "3. ffmpeg"
if command -v ffmpeg >/dev/null 2>&1; then
  ok "ffmpeg found  ${D}$(ffmpeg -version 2>/dev/null | head -1 | cut -c1-48)${X}"
else
  bad "ffmpeg not installed"
  if [ -n "$INSTALL" ] && ask "Install ffmpeg from your package manager?"; then
    if [ "$DISTRO" = "fedora" ]; then
      printf "     ${D}Fedora needs RPM Fusion for ffmpeg…${X}\n"
      sudo dnf install -y \
        "https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm" \
        2>/dev/null
    fi
    $INSTALL ffmpeg
  fi
  command -v ffmpeg >/dev/null 2>&1 && ok "ffmpeg installed" || bad "still missing"
fi

# check libx265 + its version
HAS265=0
if command -v ffmpeg >/dev/null 2>&1; then
  if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q '\blibx265\b'; then
    HAS265=1
    XV=$(ffmpeg -hide_banner -h encoder=libx265 2>/dev/null | grep -o 'x265 [0-9.]*' | head -1)
    ok "libx265 present  ${D}${XV}${X}"
  else
    bad "libx265 MISSING — cannot encode HDR"
  fi
fi

# ------------------------------------------------------- 4. static fallback
if [ "$HAS265" -eq 0 ] && [ "$ARCH" = "x86_64" ]; then
  step "4. Static ffmpeg fallback"
  warn "Your ffmpeg has no libx265. A static build fixes this."
  if ask "Download a static ffmpeg to /usr/local/bin?"; then
    TMP=$(mktemp -d)
    echo "  downloading…"
    if curl -fL# -o "$TMP/ff.tar.xz" \
        https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz; then
      tar xf "$TMP/ff.tar.xz" -C "$TMP"
      D2=$(find "$TMP" -maxdepth 1 -type d -name 'ffmpeg-*-static' | head -1)
      sudo install "$D2/ffmpeg" "$D2/ffprobe" /usr/local/bin/ && ok "installed to /usr/local/bin"
      hash -r
    else
      bad "download failed — get it manually from https://johnvansickle.com/ffmpeg/"
    fi
    rm -rf "$TMP"
  fi
else
  step "4. Static ffmpeg fallback"
  ok "not needed"
fi

# ------------------------------------------------------------- 5. dovi_tool
step "5. dovi_tool  (needed for Dolby Vision)"
if command -v dovi_tool >/dev/null 2>&1; then
  ok "dovi_tool found  ${D}$(dovi_tool --version 2>/dev/null | head -1)${X}"
elif [ "$ARCH" = "x86_64" ]; then
  bad "dovi_tool not installed"
  if ask "Download the latest dovi_tool to /usr/local/bin?"; then
    TMP=$(mktemp -d)
    URL=$(curl -fsSL https://api.github.com/repos/quietvoid/dovi_tool/releases/latest \
          | grep -o 'https://[^"]*x86_64-unknown-linux-musl\.tar\.gz' | head -1)
    if [ -n "$URL" ]; then
      echo "  $URL"
      curl -fL# -o "$TMP/dv.tar.gz" "$URL" && tar xf "$TMP/dv.tar.gz" -C "$TMP"
      BIN=$(find "$TMP" -name dovi_tool -type f | head -1)
      [ -n "$BIN" ] && sudo install "$BIN" /usr/local/bin/ && ok "installed" || bad "extract failed"
      hash -r
    else
      bad "could not find a release URL"
      printf "     ${D}Get it manually: https://github.com/quietvoid/dovi_tool/releases${X}\n"
    fi
    rm -rf "$TMP"
  fi
else
  warn "no prebuilt binary for $ARCH — build from source or skip (HLG still works)"
fi

# ---------------------------------------------------------------- 6. verify
step "6. Verifying"
chmod +x ./*.sh 2>/dev/null
if command -v node >/dev/null 2>&1; then
  node doctor.js
  RC=$?
else
  bad "node missing — cannot run Doctor"; RC=1
fi

printf "\n${B}%s${X}\n" "════════════════════════════════════════════════"
if [ "$RC" -eq 0 ]; then
  printf "${G}${B}  Ready.${X}\n\n"
  printf "  Start the app:   ${B}./vague-app.sh${X}\n"
  printf "  Or the CLI:      ${B}./vague.sh /path/to/video.mov${X}\n\n"
else
  printf "${Y}${B}  Not ready yet — see the ✗ items above.${X}\n"
  printf "${D}  Fix those, then run ./setup.sh again.${X}\n\n"
fi
