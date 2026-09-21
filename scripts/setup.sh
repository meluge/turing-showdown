#!/usr/bin/env bash
# Fetch Pokémon Showdown at the pinned commit, apply the generalized-rules patch, and build it.
set -euo pipefail

SHOWDOWN_REPO=https://github.com/smogon/pokemon-showdown.git
SHOWDOWN_COMMIT=f10d6798f2ba5af92e55892c8c7063ca7b53c18a

cd "$(dirname "$0")/.."

if [ ! -d pokemon-showdown/.git ]; then
	git init -q pokemon-showdown
	git -C pokemon-showdown remote add origin "$SHOWDOWN_REPO"
fi
cd pokemon-showdown

if [ "$(git rev-parse -q --verify HEAD || true)" != "$SHOWDOWN_COMMIT" ]; then
	git fetch -q --depth 1 origin "$SHOWDOWN_COMMIT"
	git checkout -q FETCH_HEAD
fi

patch=../patches/generalized-rules.patch
if git apply --reverse --check "$patch" 2>/dev/null; then
	echo "patch already applied"
else
	git apply "$patch"
	echo "applied $patch"
fi

[ -d node_modules ] || npm install --no-audit --no-fund
git checkout -q package-lock.json
node build
echo "ok: pokemon-showdown is built with the generalized rules"
