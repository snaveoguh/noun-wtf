# Noun World v2 — Blender character pipeline

Procedural, deterministic Blender scripts (run with Blender as a Python module) that build the
rigged Noun body, its animation set, the head base and the skateboard for the browser game
(three.js r183). The level has its own pipeline: see `LEVEL_README.md` / `build_level.py`.

Outputs (all in `packages/nouns-webapp/public/world2/`):

| file | what |
| --- | --- |
| `noun_character.glb` | skinned body `NounBody` + armature `NounRig` (23 bones), 29 clips, 2 morph targets, ~1.8k tris, ~0.9 MB |
| `noun_head_base.glb` | big chamfered box head `NounHead` (1.10 × 1.00 × 0.85 m, 128 tris); the runtime paints the Noun onto it |
| `skateboard.glb` | `Skateboard` / `Deck` / `TruckFront` / `TruckBack` / `Wheel{FL,FR,BL,BR}` |
| `character_manifest.json` | the runtime contract (bones, clips, head attach, UV rects, morphs, skate stance, board) |

## Running

```bash
python3 -m venv /tmp/claude-0/bvenv && /tmp/claude-0/bvenv/bin/pip install bpy==5.2.2   # once
packages/nouns-world-engine/blender/build_character_assets.sh     # everything + validation
```

or step by step (`PY=/tmp/claude-0/bvenv/bin/python`):

```bash
$PY build_skateboard.py
$PY build_head.py                      # [--texture some.png] to embed another head map
$PY build_character.py                 # [--only idle,walk] [--no-export] [--save-blend]
$PY check_clearance.py [--heavy]       # arm-vs-head interpenetration per clip
node validate_three.mjs                # from the repo root: parses the GLBs with the webapp's three.js
```

Previews (Cycles CPU, headless; `--toon` = Toon BSDF 2-tone ramp + flat ambient + inverted-hull
black outlines, Standard view transform):

```bash
$PY render_previews.py --toon --frames 6 --size 240 --out /tmp/claude-0/previews/jsr      # every clip
python3 contact_sheet.py /tmp/claude-0/previews/jsr/frames sheet.png idle,walk,run 6
$PY render_previews.py --turnaround --toon --views 0,45,90,180 --dist 5 --target 1.1 --tag hero
$PY render_previews.py --turnaround --toon --morph weight_heavy=1 --no-head --tag heavy
python3 head_debug_grid.py /tmp/claude-0/scratch/head_debug.png                           # labelled UV grid
$PY render_previews.py --turnaround --head-texture /tmp/claude-0/scratch/head_debug.png --tag debug
```

`render_previews.py` re-imports the exported GLBs (round trip), parents `noun_head_base.glb` to the
`head` bone at the manifest `head.offset`, and the board to the `board` bone.

## Art direction: Jet Set Radio street style, cel-shaded

Designed for a 2-3 tone toon ramp with bold black outlines: strong silhouettes, crisp planes,
flat colour regions. `lib/sculpt.py` lofts every part from stacked 6-10 sided **chamfered**
cross-sections (superellipse exponent < 2) and flat-shades them (crease angle 28°):

* cropped boxy jacket: rib hem band, wide shoulder pads, flat front/back panels and a **funnel
  collar** that hides the neck (no skin neck stub; the head sits on the collar);
* lanky arms in puffy sleeves tapering to thin forearms, rib cuffs, **mitten hands with a big thumb**;
* **baggy cargo pants** with hard diagonal folds (rings rotated half a facet at the knee and hem),
  cargo pockets on the thighs, a yellow outer-seam racing stripe, stacking over
* **chunky sneakers**: thick flat soles, toe spring, big toe box, white side panels.

Flat albedo only (`lib/paint.py`): one colour per material plus a couple of hard-edged panels — no
gradients, no noise, no vertex colours.

| material | look | runtime |
| --- | --- | --- |
| `NounBody` | flat jacket colour, accessory art in `uvRegions.front` | replaced by the Noun canvas |
| `NounSkin` | flat #e3b48f, no map | set `color` to the head's skin tone |
| `NounPants` | olive #5d6b3c, yellow side stripe, darker pocket panels | — |
| `NounShoe` / `NounSole` | red upper, white side panels + lace block; off-white sole with black band, dark tread | — |

### Weight morph targets

Shape keys `weight_thin` and `weight_heavy` (exported as glTF morph targets with normals, on all 5
body primitives). Every builder reads a weight value (-1 thin, 0 base, +1 heavy) through
`sculpt.M(base, thin, heavy)`, and the mesh is built three times with identical topology:
heavy = round belly pushing the jacket out (+0.27 m), double-wide waist and seat, thick thighs and
arms; sleeves/hands/thighs are also pushed outward so the hanging arms clear the belly. Drive
`morphTargetInfluences` 0..1 at runtime (slider s ∈ [-1, 1]: thin = max(0, -s), heavy = max(0, s)).

## Head base, its size and its UV contract

`build_head.py` builds a big box with one 0.07 m chamfer (flat planes), origin at the bottom
centre, facing +Z (three.js), material `NounHead`: **1.10 m wide, 1.00 m tall, 0.85 m deep** —
Nouns proportions, about as tall as everything below it. Manifest `head` = `{bone: "head",
offset: [0, -0.02, 0], width: 1.1}`: the bottom sits at y ≈ 1.13, on the funnel collar.

UV rects (glTF convention, v = 0 at the top of the image) — also in the manifest as `headUv`:

| face | rect [u0, v0, u1, v1] | orientation |
| --- | --- | --- |
| front (+Z) | 0, 0, 0.5, 0.5 | not mirrored: image left = character's right |
| left (+X) | 0.5, 0, 0.75, 0.5 | image left = front |
| right (−X) | 0.75, 0, 1, 0.5 | image left = back |
| top | 0, 0.5, 0.5, 1 | image top = back, image left = character's right |
| back | 0.5, 0.5, 1, 1 | image left = character's left |
| bottom | 0.24, 0.49, 0.26, 0.5 | samples a strip of the front rect |

Each face is an orthographic projection of the whole box face including its chamfers, so paint per
rect and it wraps continuously. `build_head.default_texture()` is the reference painter (head
sprite bbox → front, glasses on top, edge columns/rows extruded onto the sides/top, dominant colour
on the back). Verified with the labelled debug grid (`head_debug_grid.py`) and `validate_three.mjs`.

## Rig + animation

Unchanged contract: 23 bones (`root`, `board`, `hips`, `spine`, `chest`, `neck`, `head`, and per side
`shoulder` `upperarm` `forearm` `hand` `thigh` `shin` `foot` `toe`); three.js names are the Blender
names with the `.` stripped (`hand.R` → `handR`). Clips are key poses / procedural cycles on
Hermite splines (`lib/posekit.py`: hold keys for anticipation/settles, per-channel lag for overlap
and follow-through), solved with a custom FK/IK solver (feet planted by IK on the ground or the
deck), baked at 30 fps, one glTF animation per clip, in place.

Clips (29): idle, idle_look, walk, run, sprint, jump_start, jump_air, fall, land, wave, dance,
celebrate, punch, kick, skate_idle, skate_push, skate_crouch, skate_ollie, skate_air, skate_flip,
skate_land, skate_grind, skate_manual, skate_grab, skate_turn_left, skate_turn_right, skate_bail,
skate_getup, skate_powerslide. Skate stance: regular, left foot toward the nose (+Z), feet planted
on the deck top in `board`-bone space; parent `skateboard.glb` to the `board` bone.

**Big-head rules** (the 1.1 m head pivots 5 cm above its bottom, so any tilt sinks an edge):

* the solver clamps the head's pitch/roll relative to the chest to 6° (yaw is free) and caps
  clavicle shrugs at 3° (`posekit.HEAD_SWING_MAX`, `CLAV_UP_MAX`);
* no arm goes above shoulder height within the head's footprint: wave is a big side wave at
  shoulder height, celebrate throws the arm wide, dance pumps at chest height, fall windmills at the
  sides, the guard (punch/kick) holds fists at chest height, skate arms stay at or below horizontal;
* the skaters' forward lean is halved (`posekit.TORSO_PITCH_SCALE`: positive hips/spine/chest
  pitch × 0.5; IK keeps the feet planted) so the head stays stacked over the board;
* lying down (bail/getup) the body reclines ~45° against the head, which rests flat on the ground
  (a pose can raise the clamp through the `head.swing_max` control);
* `check_clearance.py` (capsules along upperarm/forearm/hand vs the head box, plus head-below-floor)
  reports ≤ 1.2 cm arm contact for every clip, ≤ 3.2 cm with `--heavy` (sleeves +3.5 cm), and the
  head never more than 1.4 cm into the floor.

Joint positions and the ankle height were kept, so the foot-contact maths still holds (validated:
soles on the ground in every on-foot clip, on the deck in every skate clip).

## Files

* `build_character.py` — body + clips + manifest; `build_head.py` — head base; `build_skateboard.py`
* `lib/rig.py` — skeleton, torso UV contract (`UV_REGIONS`), materials, morph set-up
* `lib/sculpt.py` — lofted body + weight morphs + skin weights; `lib/paint.py` — flat textures
* `lib/posekit.py` — splines, pose sequencing, solver (+ big-head clamps), baker; `lib/clips_foot.py`, `lib/clips_skate.py`
* `lib/common.py` — scene/material/image helpers, Nouns RLE decoder, deck dimensions
* `render_previews.py` (`--toon`, `--turnaround`, `--morph`), `contact_sheet.py`, `head_debug_grid.py`,
  `check_clearance.py`, `validate_three.mjs`, `build_character_assets.sh`
