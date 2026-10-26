#!/bin/bash
# Installs THIS fork (git clone) into Dota 2 on macOS / Linux.
#
# The quick-install-oha scripts install the Steam Workshop copy: they link
# only bots/ from the workshop item. This fork also ships game/ (addon scripts
# and the FretBots auto-start loader) and needs both folders linked from the
# clone. Existing folders are renamed with a timestamp, never deleted.
#
# Usage:
#   ./quick-install-fork.sh
#   VSCRIPTS="/path/to/vscripts" ./quick-install-fork.sh
set -u

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=${REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}

case "$(uname -s)" in
    Darwin) DEFAULT_STEAM="$HOME/Library/Application Support/Steam" ;;
    Linux)  DEFAULT_STEAM="${STEAM_DIR:-$HOME/.steam/steam}" ;;
    *) echo "Unsupported OS"; exit 1 ;;
esac

VSCRIPTS=${VSCRIPTS:-"$DEFAULT_STEAM/steamapps/common/dota 2 beta/game/dota/scripts/vscripts"}

fail() { echo "FAILED: $*"; exit 1; }

[ -f "$REPO_ROOT/bots/hero_selection.lua" ] || fail "repo root not found: $REPO_ROOT"
[ -f "$REPO_ROOT/game/gameinit.lua" ] || fail "game/ not found in $REPO_ROOT"
[ -d "$DEFAULT_STEAM" ] || fail "Steam not found: $DEFAULT_STEAM"
[ -d "$DEFAULT_STEAM/steamapps/common/dota 2 beta" ] || fail "Dota 2 not installed under $DEFAULT_STEAM"
[ -d "$VSCRIPTS" ] || fail "vscripts not found: $VSCRIPTS"

stamp=$(date +%Y%m%d_%H%M%S)
for name in bots game; do
    target="$REPO_ROOT/$name"
    link="$VSCRIPTS/$name"
    if [ -e "$link" ] || [ -L "$link" ]; then
        echo "Renaming existing $name -> ${name}.old_$stamp"
        mv "$link" "$link.old_$stamp" || fail "could not back up $link"
    fi
    ln -s "$target" "$link" || fail "could not link $link"
done

CUST="$REPO_ROOT/game/Customize"
if [ ! -d "$CUST" ]; then
    mkdir -p "$CUST" && cp "$REPO_ROOT/bots/Customize/general.lua" "$CUST/" \
        || fail "could not create $CUST"
    echo "Created $CUST with a copy of general.lua"
fi

for f in bots/hero_selection.lua game/gameinit.lua game/fretbots_autostart.lua; do
    [ -e "$VSCRIPTS/$f" ] || fail "verification failed for $f"
done

LLM_LUA="$CUST/llm.lua"
if [ ! -f "$LLM_LUA" ]; then
    cp "$REPO_ROOT/bots/Customize/llm.example.lua" "$LLM_LUA" \
        && echo "Created $LLM_LUA from llm.example.lua"
fi
if [ -t 0 ]; then
    printf 'Paste Groq API key for the LLM advisor (Enter to skip): '
    read -r KEY
else
    KEY=""
fi
if [ -n "${KEY:-}" ]; then
    sed -i.bak "s|APIKey = \"\"|APIKey = \"$KEY\"|" "$LLM_LUA" && rm -f "$LLM_LUA.bak"
    echo "Groq key written to $LLM_LUA"
else
    echo "No key set. Edit $LLM_LUA and fill in APIKey later."
fi

echo ""
echo "Install complete."
echo "Lobby: Custom Lobby, Local Host, Local Dev Script, Enable Cheats."
echo "FretBots needs once per game: sv_cheats 1; script_reload_code bots/fretbots"
