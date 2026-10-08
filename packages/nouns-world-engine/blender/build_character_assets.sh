#!/usr/bin/env bash
# Rebuild every character-side asset of Noun World v2 and validate it with three.js.
#   skateboard.glb -> noun_head_base.glb -> noun_character.glb + character_manifest.json
# Usage: packages/nouns-world-engine/blender/build_character_assets.sh [blender-python]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
PY="${1:-${BLENDER_PY:-/tmp/claude-0/bvenv/bin/python}}"

"$PY" "$HERE/build_skateboard.py"
"$PY" "$HERE/build_head.py"          # before the character: the manifest reads the head GLB
"$PY" "$HERE/build_character.py"
"$PY" "$HERE/check_clearance.py" | grep -E "intersects" || echo "clearance: no arm/head intersections > 2 cm"
cd "$REPO" && node packages/nouns-world-engine/blender/validate_three.mjs
