# `/public/assets` — Third-party GLB models for the World game

This folder holds `.glb` models used by the "world" mini-app
(`src/miniapps/world/engine/CityBlock.tsx`). Models are served from `/assets/...`
at runtime and are loaded lazily via `useGLTF` — see
`src/miniapps/world/engine/glbProps.tsx` and `propCatalog.ts` for the manifest.

**All props have a procedural fallback.** If a `.glb` isn't on disk, the scene
still renders — it just uses the old box-stack geometry for that prop. So it's
safe to unzip packs piecemeal and see the world fill in as you drop files in.

---

## Asset packs

We use three CC0-licensed Kenney packs. Download each, unzip, and copy the
`.glb` files into the indicated folder.

### 1. City Kit (Suburban) → `kenney/city-kit/`
**Download:** https://kenney.nl/assets/city-kit-suburban (CC0)

Expected files (catalog references):
```
kenney/city-kit/lamp-post.glb
kenney/city-kit/fire-hydrant.glb
kenney/city-kit/mailbox.glb
kenney/city-kit/trash-bin.glb
kenney/city-kit/dumpster.glb
kenney/city-kit/bench.glb
kenney/city-kit/traffic-cone.glb
kenney/city-kit/newspaper-stand.glb
kenney/city-kit/shop-small.glb
```

The Kenney zip ships with named `.glb` files per object — rename them to match
the paths above if they differ. Any file not present just uses the proc
fallback (the bodega in particular has a full proc backup).

### 2. Car Kit → `kenney/car-kit/`
**Download:** https://kenney.nl/assets/car-kit (CC0)

Expected files:
```
kenney/car-kit/sedan.glb
kenney/car-kit/taxi.glb
kenney/car-kit/police.glb
kenney/car-kit/delivery.glb
kenney/car-kit/sport.glb
```

Each parked-car slot in the scene deterministically picks one of these
variants based on the car's instance id, so the curb has mixed vehicles
instead of five identical boxes.

### 3. Weapon Pack → `kenney/weapon-pack/`
**Download:** https://kenney.nl/assets/weapon-pack (CC0)

Expected files:
```
kenney/weapon-pack/pistol.glb
kenney/weapon-pack/smg.glb
kenney/weapon-pack/shotgun.glb
```

These are referenced by the catalog for build-mode / pickup drops. Not
currently rendered by `CityBlock.tsx`.

---

## Expected directory layout

```
public/assets/
├── README.md              (this file)
└── kenney/
    ├── city-kit/
    │   ├── lamp-post.glb
    │   ├── fire-hydrant.glb
    │   ├── mailbox.glb
    │   ├── trash-bin.glb
    │   ├── dumpster.glb
    │   ├── bench.glb
    │   ├── traffic-cone.glb
    │   ├── newspaper-stand.glb
    │   └── shop-small.glb
    ├── car-kit/
    │   ├── sedan.glb
    │   ├── taxi.glb
    │   ├── police.glb
    │   ├── delivery.glb
    │   └── sport.glb
    └── weapon-pack/
        ├── pistol.glb
        ├── smg.glb
        └── shotgun.glb
```

---

## Testing

1. Unzip a pack (start with `city-kit`) into the path above.
2. Restart the webapp dev server (`pnpm dev` from `packages/nouns-webapp/`).
3. Visit the world game. Props with a matching GLB should render as proper
   models; the rest will still render as box-stack proc geometry.
4. The first load does a HEAD probe per URL and caches the result — if you
   add/remove files, you may need a hard refresh (Cmd+Shift+R) to bust.

## Licensing

All packs above are released under **CC0 1.0** by Kenney (kenney.nl). You can
use them in commercial projects with no attribution required — crediting
Kenney is nice but not mandatory.

---

## Adding new prop types

1. Add a `PropEntry` to `src/miniapps/world/engine/propCatalog.ts`.
2. Add a component (or modify an existing one in `CityBlock.tsx`) that pulls
   the entry via `getProp(id)`, calls `useGlbProbe(entry.glbUrl)`, and renders
   `<GlbModel />` when `hasModel` is true, proc geometry otherwise.
3. Drop the `.glb` into the corresponding folder here.

The catalog is authoritative — `build mode` (future) will pick from it
directly.
