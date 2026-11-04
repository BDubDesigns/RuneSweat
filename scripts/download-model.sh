#!/usr/bin/env bash
# Download the MediaPipe PoseLandmarker model bundles + copy the WASM runtime
# from the installed @mediapipe/tasks-vision package into public/.
#
# Usage: npm run download-model
#   - downloads pose_landmarker_lite.task (default, ~5.8 MB) and
#     pose_landmarker_full.task (~13 MB) into public/models/
#   - copies node_modules/@mediapipe/tasks-vision/wasm/* into public/wasm/
#
# The .task files and the WASM runtime are git-ignored on purpose (see
# .gitignore): a fresh clone runs this script once. Nothing is fetched
# from a CDN at runtime.
set -euo pipefail
cd "$(dirname "$0")/.."

LITE_URL="https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
FULL_URL="https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task"

mkdir -p public/models public/wasm

download() {
  local url="$1" dest="$2"
  if [ -s "$dest" ]; then
    echo "exists, skipping: $dest"
    return
  fi
  echo "downloading $url"
  curl -fL --progress-bar -o "$dest" "$url"
  echo "saved: $dest ($(du -h "$dest" | cut -f1))"
}

download "$LITE_URL" public/models/pose_landmarker_lite.task
download "$FULL_URL" public/models/pose_landmarker_full.task

WASM_SRC="node_modules/@mediapipe/tasks-vision/wasm"
if [ -d "$WASM_SRC" ]; then
  # Copy the whole WASM dir: the loader + both wasm binaries.
  # (1.2.2 ships vision_wasm_internal.* and vision_wasm_module_internal.*.)
  cp "$WASM_SRC"/* public/wasm/
  echo "wasm copied:"
  ls -la public/wasm/
else
  echo "WARNING: $WASM_SRC not found — run 'npm install' first." >&2
  exit 1
fi

echo "done."
