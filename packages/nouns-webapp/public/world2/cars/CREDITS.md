# Noun World cars: sources and licences

Every car on Noun World's roads, where its shape came from, and under what terms.
Names are the house's own. No car carries a real maker's badge, logo or trademarked name.

| Car | Inspired by | Source | Licence | Tris (body + 4 wheels) |
| --- | --- | --- | --- | --- |
| ROADSTAR | the next-gen electric roadster with cold-gas thrusters | Procedural (`src/miniapps/world2/cars/models.ts`) | Original work for noun.wtf | ~1.1k |
| CAVALLINO '47 | the first post-war Italian V12 sports racer (1947) | Procedural | Original work | ~1.2k |
| TORO | the Italian wedge supercar with scissor doors | Procedural | Original work | ~0.8k |
| DIP '64 | the 1964 lowrider convertible | Procedural | Original work | ~1.0k |
| STOMPA | 1980s arena monster trucks | Procedural | Original work | ~1.6k |
| BUBBLE | 1950s bubble cars with a front-opening door | Procedural | Original work | ~0.6k |
| KAIDO | 1980s Japanese mountain-pass hatchbacks | `kaido.glb`: body of **"hatchback-sports"** from Kenney's **Car Kit** (v3.1) | **CC0 1.0** (public domain) | 760 body + house wheels |
| BRUISER '70 | 1970 American muscle cars | `bruiser.glb`: body of **"sedan-sports"** from Kenney's **Car Kit** (v3.1) | **CC0 1.0** (public domain) | 760 body + house wheels |

## Kenney Car Kit

- Source: https://kenney.nl/assets/car-kit (Car Kit 3.1, created and distributed by Kenney, www.kenney.nl)
- Licence: Creative Commons Zero (CC0 1.0), http://creativecommons.org/publicdomain/zero/1.0/. Personal, educational and commercial use. Credit is not required; we credit Kenney anyway, here and in-game (the car's prompt and speedo say "body: Kenney Car Kit (CC0)").
- Changes: converted with `scripts/cars/kenney-to-toon.mjs`. The colormap texture is baked to one flat colour per face and posterised. UVs, tangents and textures are dropped. The kit's wheels are replaced by the game's own chunky wheels. The body is scaled ×1.45 (KAIDO) or ×1.7 (BRUISER) and recoloured per paint job at runtime.

## Looked for, not used

- Open-licensed models of the specific cars that inspired the heroes (flying roadster, 1947 racer, scissor-door supercar) are either branded replicas or CC-BY scans of trademarked designs. We couldn't confirm clean licences without trademark issues, so those three are original procedural builds in the house box-and-wedge style.
