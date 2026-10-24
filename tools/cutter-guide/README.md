# Sticker cutter guide

Generates a kiss-cut sticker sheet with smooth, low-node cut lines from
transparent PNG artwork or from Noun seeds rendered out of `nouns-assets`.

```bash
pip install shapely scikit-image opencv-python-headless reportlab pillow numpy

# from artwork PNGs (transparent background), 50mm wide each, A4 sheets
python3 tools/cutter-guide/cutter_guide.py --pngs art/*.png --width 50 --out out/meme-value

# from Noun seeds  bg:body:accessory:head:glasses
python3 tools/cutter-guide/cutter_guide.py --seeds 0:3:104:248:14 1:8:109:124:19 --width 45 --out out/sheet

# quick demo, 12 random nouns
python3 tools/cutter-guide/cutter_guide.py --random 12 --width 45 --out out/demo
```

## Outputs

| file | what |
|---|---|
| `<out>.pdf` | print file. Artwork + cut line as spot colour **CutContour** (0/100/0/0), 0.1 mm hairline, no fill. One page per sheet. |
| `<out>.svg` (or `-pN.svg`) | same thing as SVG, mm units, layers `Artwork` and `CutContour` (magenta stroke). Opens in Illustrator / Inkscape. |
| `<out>-preview.png` | proof: artwork, cut line in magenta, Bézier anchor nodes in blue. |

The terminal prints a table per sticker: node count, cut size, and the measured
minimum gap between artwork and cut line. Anything under `--clearance` is
flagged `TOO TIGHT` and the script already bumped the offset to fix it.

## How the cut line is built

1. Silhouette = union of opaque pixels.
2. Offset outward by `--offset` (3.5 mm) with round joins.
3. Close concavities narrower than `--round` (12 mm) so the line never dives
   into gaps between glasses / head / body.
4. Round convex corners to `--convex` (5 mm).
5. Fit the ring with cubic Béziers to `--tolerance` (0.35 mm). This is what
   absorbs the pixel-step ripple and keeps node counts in the teens.
6. Guard: the final curve must stay at least `--clearance` (2 mm) from the art.

Knobs worth touching:

- `--offset` white border width. 3 to 4 mm is normal for die-cut stickers.
- `--round` bigger = blobbier, fewer inside notches. 12 mm is already soft.
- `--tolerance` bigger = fewer nodes, 0.5 mm is still invisible on a cutter.
- `--sheet A4|A3|SRA3|WxH` and `--margin`, `--gap` for the printer's imposition.

## Printer notes

- Send the PDF. The cut line is a named spot colour `CutContour`, which is
  what most kiss-cut RIPs (Roland, Mimaki, Summa) look for by default. If the
  printer asks for a different name (e.g. `CutContour` vs `Thru-cut`), change
  the `spotName` in `write_pdf`.
- Cut line is a single closed path per sticker, no holes, clockwise.
- Artwork is nearest-neighbour upscaled pixel art, so edges print crisp.
