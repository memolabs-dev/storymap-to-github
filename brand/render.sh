#!/bin/bash
# Renders the brand's PNG files from icon.svg and cover.html with headless Chrome.
# Usage: bash brand/render.sh
set -euo pipefail
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
shot() { # file, width, height, output
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --virtual-time-budget=6000 --window-size="$2,$3" --screenshot="$4" "file://$PWD/$1" >/dev/null 2>&1
}
# Headless Chrome has a minimum window width, so the icon is drawn at 1024
# and scaled down.
shot icon.html 1024 1024 icon-1024.png
for size in 512 256 128; do /usr/bin/sips -Z "$size" icon-1024.png --out "icon-$size.png" >/dev/null; done
rm icon-1024.png
shot cover.html 1920 1080 cover.png
ls -la icon-*.png cover.png
