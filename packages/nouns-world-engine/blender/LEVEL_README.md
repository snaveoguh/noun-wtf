# Noggle Plaza: level pipeline

This is the level for Noun World v2. Headless Blender (`bpy` 5.2 as a Python module) builds
it and writes the files to `packages/nouns-webapp/public/world2/level/`. The runtime loads
that folder in `src/miniapps/world2/world/Level.ts`.

```bash
# one-time: Blender as a Python module
python3 -m venv /tmp/claude-0/bvenv && /tmp/claude-0/bvenv/bin/pip install bpy==5.2.2

# full build from the repo root (~20-35 min on 4 CPUs, depending on load)
/tmp/claude-0/bvenv/bin/python packages/nouns-world-engine/blender/build_level.py \
    --previews /tmp/claude-0/previews/final

# quick look at layout/materials without the lightmap bake
/tmp/claude-0/bvenv/bin/python packages/nouns-world-engine/blender/build_level.py \
    --preview-only --previews /tmp/claude-0/previews --views overview,fountain

# fast smoke build into a scratch dir (about 3 min)
/tmp/claude-0/bvenv/bin/python packages/nouns-world-engine/blender/build_level.py \
    --out /tmp/claude-0/lvl_test --lm-samples 8 --lm-scale 0.25

# validate with the webapp's three.js
node packages/nouns-world-engine/blender/validate_level.mjs [levelDir]
```

Options: `--lm-samples` (default 40, OIDN-denoised), `--lm-scale` (scales the atlas
resolutions), `--style jsr|photo`, `--cache DIR` (texture cache, default
`/tmp/claude-0/level_cache`), `--save-blend PATH`.

## Modules

| file | role |
| --- | --- |
| `build_level.py` | Entry point. Runs textures, layout, objects, lightmaps, export and previews. |
| `level_common.py` | Numpy geometry builder (`Level`, `Part`, primitives) and the Blender to three.js coordinate conversion. Also handles rails, spawns and landmarks. |
| `level_layout.py` | The plaza: ground, fountain, terrace with the Big Six, platform with the 3-stair and kink, QP bay, mini ramp, funbox, ledge garden, south bank, furniture, streets, buildings, backdrop, boundary walls and decals. |
| `level_nodes.py`, `level_materials.py` | Procedural material recipes. Cycles bakes them into tiling JPG albedo, ORM and normal maps (cached by recipe hash). Also builds the glTF-exportable materials. |
| `level_style.py` | **Jet Set Radio art pass** (default). Turns the baked albedo into flat, saturated colour fields: k-means palette, ink seam lines and a colourise grade. Curbs get hazard stripes. Normal maps are dropped and constant colours are made punchier. |
| `level_textures.py` | Numpy decals: posters, 8 graffiti pieces and the noun mural. |
| `level_scene.py` | Builds Blender objects from the parts. Also the sky gradient, sun constants and preview cameras. |
| `level_lightmap.py` | Lightmap UVs (UV map `lightmap`, i.e. TEXCOORD_1), the Cycles bake, OIDN denoise and the encoding. |
| `level_export.py` | Writes `plaza.glb`, `collision.glb` and `level.json`. |
| `validate_level.mjs` | Node and three.js checks: parse, uv1, rails on geometry, spawns on ground, size. |

## Outputs

- `plaza.glb`: render geometry with no Draco. Each top-level node has a stable name:
  `Ground`, `Obstacles`, `Buildings`, `Props`, `Foliage`, `Decals`, `Water`, `Backdrop`.
  - A node holds one primitive per material, and GLTFLoader turns the node into a Group of meshes.
  - Materials are unique per node (suffix `__<Node>`), so a lightmap never has to be shared across nodes.
  - UV0 is world-scale tiling. Every primitive also has `uv1` for the lightmap.
  - Textures are embedded JPGs. Decals are PNGs with alpha.
- `lightmap_<atlas>.webp`: the baked lightmaps. The atlases are `ground` 2k, `obstacles` 2k,
  `props` 2k, `buildings` 1k, `detail` 1k (foliage, decals, water) and `backdrop` 512.
- `collision.glb`: merged, positions-only physics meshes. These are `COL_Ground`,
  `COL_Obstacles`, `COL_Buildings`, `COL_Props`, `COL_Rails` (handrail, coping and flat-bar
  tubes) and `COL_Boundary` (invisible walls at x/z = ±76). It has no foliage, decals,
  awnings or lamp heads.
- `level.json`: has the keys the runtime reads: `glb`, `collisionGlb`, `rails`, `spawns`,
  `sun`, `sky`, `fog`, `lightmaps` (node name to file), `lightMapIntensity`, `bounds` and
  `landmarks`. The `meta` key is informational only.

### Coordinates

The files use three.js Y-up metres. Blender `(x, y, z)` becomes three `(x, z, -y)`. The
origin is the fountain centre, and the plaza floor is at `y = 0`. A spawn `yaw` of 0 faces
+Z, and the forward vector is `(sin yaw, 0, cos yaw)`. `sun.direction` points from the sun
toward the scene.

### Rails

The rail points lie on the edge at the top-surface height. `validate_level.mjs` raycasts
down to check that every sample is within 5 cm of the collision mesh. The rail types are:

- `ledge`: both top edges of every ledge, plus manual pads, planters, benches and the fountain rims.
- `curb`: the inner and outer street curbs, as closed loops.
- `rail`: the Big Six handrail, the 3-stair handrail, the kinked rail and the flat bar.
- `coping`: the QPs, the mini ramp and the south bank lip.

### Lightmap encoding

The lightmap is baked with Cycles at the default 40 samples, then OIDN-denoised with a
normal guide. Each texel holds irradiance in three.js light units, the same scale as
`sun.intensity`:

- sky light, occluded
- bounce light from both sun and sky
- multiplied by a short-range AO term (0.6 m, mixed at 45%)

The sun only enters after at least one diffuse bounce (a light-path trick), so **no direct
sun is baked in**. The runtime's live sun and shadows supply the direct light.

During the bake every material is temporarily swapped to a plain Diffuse BSDF with the same
albedo and normal, so metallic surfaces still get irradiance. Decals are hidden from rays so
they don't shadow the walls behind them.

Encoding is **linear** 8-bit with a ±1 LSB triangular dither:
`value = irradiance / lightMapIntensity`. This matches `Level.ts`, which loads lightmaps with
`colorSpace = LinearSRGBColorSpace`, `channel = 1` and `flipY = false`, and sets
`material.lightMapIntensity` to the value from the JSON.

### Art direction (JSR)

The runtime does the toon ramp and the outline pass. The level supplies flat, saturated
albedo:

- pale warm plaza slabs with ink seams
- orange and teal paver bands
- pink sidewalks
- indigo asphalt
- yellow and black hazard curbs
- coral ledges with blush tops
- violet planters
- yellow rails
- pastel or saturated facades
- graffiti pieces above the shopfronts and in the alleys

The look is tuned per material in `STYLE` and `CONST` in `level_style.py`. Stylised
textures are cached in `<cache>/jsr/`. To go back to the photoreal textures, pass
`--style photo`.

## Notes and known issues

- Hidden faces get lightmap texels and come out black, which is harmless. Examples: ledge
  bottoms sitting on the ground, and lamp bases.
- `Graphics.applyLevel` still adds a PMREM environment at 0.6 and a hemisphere light at 0.12
  on baked levels. That ambient light is counted twice, because the lightmap already has the
  sky. Lower it if the level looks washed out.
- The lightmap UV unwrap of `Ground` takes about 35 s (smart project). Bake time is
  dominated by the 2k atlases.
