#!/bin/bash
# Download all spritesheet PNGs from spritesheetcenter.vercel.app
# CC0 assets by Kerimbonia (Nouns DAO Proposal #201)
# Each PNG is 768x384 (16x8 grid of 48x48 frames)

BASE_URL="https://spritesheetcenter.vercel.app/assetz"
OUT_DIR="$(dirname "$0")/../public/sprites"

mkdir -p "$OUT_DIR"/{body,head,accessory,glasses,background,belowthebelt,shoes}

echo "Downloading sprite assets..."

# Download assets.json manifest
curl -sS "$BASE_URL/assets.json" -o "$OUT_DIR/assets.json"

# Parse and download each category
for TYPE in body head accessory glasses background belowthebelt shoes; do
  echo "=== $TYPE ==="
  FILENAMES=$(jq -r ".[] | select(.type==\"$TYPE\") | .src[]" "$OUT_DIR/assets.json")
  COUNT=$(echo "$FILENAMES" | wc -l | tr -d ' ')
  I=0
  echo "$FILENAMES" | while read -r FILE; do
    I=$((I + 1))
    if [ -f "$OUT_DIR/$TYPE/$FILE" ]; then
      echo "  [$I/$COUNT] skip $FILE (exists)"
      continue
    fi
    echo "  [$I/$COUNT] $FILE"
    curl -sS "$BASE_URL/$TYPE/$FILE" -o "$OUT_DIR/$TYPE/$FILE" || echo "  FAILED: $FILE"
  done
done

echo ""
echo "Done! Assets saved to $OUT_DIR"
echo "Total size: $(du -sh "$OUT_DIR" | cut -f1)"
