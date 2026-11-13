#!/usr/bin/env bash
# make-source.sh: builds the public-safe SOURCE in ~/SOURCE from the four public repositories.
# Copies only. Needs no key. Never touches 80_ or 90_ (those are private and do not exist here).
set -euo pipefail
D="${1:-$HOME/SOURCE}"; mkdir -p "$D"
get() { [ -d "$D/$2" ] && { echo "$2 already here, left as it is"; return; }
  git clone -q --depth 1 "https://github.com/aiontekmirion/$1.git" "$D/$2" && rm -rf "$D/$2/.git" "$D/$2/.github" && echo "$2 ok: $(find "$D/$2" -type f | wc -l) files"; }
get TheSpine 10_SPINE; get aiontekmirion.github.io 20_SITE; get TheLark 30_LARK; get theinfinitecorridor 40_ENGINE
mkdir -p "$D/00_START"; [ -f "$D/00_START/README.md" ] || cp "$D/10_SPINE/START.md" "$D/00_START/README.md"
echo "done: $D"
