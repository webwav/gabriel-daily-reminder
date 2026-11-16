#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# 1. Refresh public/initial-state.json from data/alarm_state.json
node --input-type=module -e '
import fs from "fs";
import { createInitialState, AGAMA_OPTIONS, ZOOM_DIRECTORY } from "./data/defaultState.js";
let state = createInitialState();
if (fs.existsSync("./data/alarm_state.json")) {
  state = JSON.parse(fs.readFileSync("./data/alarm_state.json", "utf8"));
  state.zoomDirectory = ZOOM_DIRECTORY;
  state.agamaOptions = AGAMA_OPTIONS;
}
fs.writeFileSync("./public/initial-state.json", JSON.stringify(state, null, 2));
'

# 2. Pre-warm any missing neural kid voice MP3 clips and sync into public/tts_cache/
if [ -x "./.venv/bin/python3" ]; then
  ./.venv/bin/python3 ./scripts/prewarm_kid_tts.py
fi
mkdir -p ./public/tts_cache
if [ -d "./data/tts_cache" ]; then
  rsync -a ./data/tts_cache/ ./public/tts_cache/
fi
touch ./public/.nojekyll

# 3. Push static build from public/ to gh-pages branch incrementally
TMP_DEPLOY="$(mktemp -d)"
trap 'rm -rf "$TMP_DEPLOY"' EXIT

REMOTE_URL="$(git remote get-url origin)"
if git ls-remote --exit-code --heads "$REMOTE_URL" gh-pages >/dev/null 2>&1; then
  git clone --depth 1 --branch gh-pages "$REMOTE_URL" "$TMP_DEPLOY" >/dev/null 2>&1
  rsync -a --delete --exclude='.git' --exclude='.DS_Store' ./public/ "$TMP_DEPLOY/"
else
  rsync -a --exclude='.DS_Store' ./public/ "$TMP_DEPLOY/"
  git -C "$TMP_DEPLOY" init -b gh-pages
  git -C "$TMP_DEPLOY" remote add origin "$REMOTE_URL"
fi

git -C "$TMP_DEPLOY" config user.name "webwav"
git -C "$TMP_DEPLOY" config user.email "webwav@users.noreply.github.com"
git -C "$TMP_DEPLOY" add -A
if git -C "$TMP_DEPLOY" diff --cached --quiet; then
  echo "gh-pages already up to date."
else
  git -C "$TMP_DEPLOY" commit -m "Deploy Gabriel Daily Reminder PWA ($(date -u '+%Y-%m-%d %H:%M UTC'))"
  git -C "$TMP_DEPLOY" push origin gh-pages:gh-pages
  echo "Deployed static PWA to gh-pages on $REMOTE_URL"
fi
