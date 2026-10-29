# python3 desktop_table.py <base.json> <new.json>: before/after tables from desktop.cjs runs
import json, sys

B = json.load(open(sys.argv[1]))
N = json.load(open(sys.argv[2]))
bs, ns = B['scenarios'], N['scenarios']

print('### Boot\n')
print('| | before | after |\n|---|---|---|')
for k in ['quality', 'pixelRatio', 'buffer', 'shadowMap', 'frameCap']:
    print(f"| {k} | {B['boot'].get(k)} | {N['boot'].get(k)} |")

if 'passes' in bs and 'passes' in ns:
    b, n = bs['passes'], ns['passes']
    print('\n### One frame at the plaza (SwiftShader raster ms, readPixels-synced)\n')
    print('| | before | after |\n|---|---|---|')
    print(f"| megapixels drawn / frame | {b['mpx']:.1f} | {n['mpx']:.1f} |")
    print(f"| draw calls | {b['draws']} | {n['draws']} |")
    print(f"| frame raster ms | {min(b['base'], b['baseAgain'])} | {min(n['base'], n['baseAgain'])} |")

pk = [k for k in bs if k.startswith('pacing-')]
if pk:
    print('\n### Frames rendered per second (Game.frame on a virtual display, render stubbed)\n')
    print('| display | before renders/s | after renders/s | after sim s / s | after CPU ms / step |')
    print('|---|---|---|---|---|')
    for k in pk:
        if k not in ns:
            continue
        b, n = bs[k], ns[k]
        print(f"| {k[7:]} | {b['rendersPerSec']:.0f} | {n['rendersPerSec']:.0f} | {n['simSecondsPerSecond']:.3f} | {n['cpuMsPerStep']:.2f} |")

tk = [k for k in bs if k.startswith('threads-')]
if tk:
    print('\n### Browser CPU by state (% of one core, 12 s; SwiftShader raster is in gpu-process)\n')
    print('| state | before total | after total | before video decode | after video decode | before main-thread ms/s | after main-thread ms/s |')
    print('|---|---|---|---|---|---|---|')
    med = lambda v: sum(r[1] for r in v['rows'] if r[0].endswith('/Media'))
    for k in tk:
        if k not in ns:
            continue
        b, n = bs[k], ns[k]
        print(f"| {k[8:]} | {b['totalPct']:.0f} | {n['totalPct']:.0f} | {med(b):.1f} | {med(n):.1f} | {b['main']['TaskMsPerSec']:.0f} | {n['main']['TaskMsPerSec']:.0f} |")

if 'rooms' in bs and 'rooms' in ns:
    print('\n### Enter + leave a room x10\n')
    print('| | before | after |\n|---|---|---|')
    for f, lab in [('heapMB', 'heap MB (start → after 10)'), ('geometries', 'geometries'), ('textures', 'textures'), ('programs', 'programs'), ('sceneObjects', 'scene objects')]:
        print(f"| {lab} | {bs['rooms'][0][f]:.0f} → {bs['rooms'][-1][f]:.0f} | {ns['rooms'][0][f]:.0f} → {ns['rooms'][-1][f]:.0f} |")
    e = lambda r: max(x.get('enterLongMs', 0) for x in r[1:])
    print(f"| longest task entering (max of 10) | {e(bs['rooms']):.0f} | {e(ns['rooms']):.0f} |")

if 'soak' in bs and 'soak' in ns:
    print('\n### Soak (skating, every 30 s)\n')
    print('| | before | after |\n|---|---|---|')
    for f in ['heapMB', 'geometries', 'textures', 'programs', 'dom']:
        b, n = bs['soak'], ns['soak']
        print(f"| {f} first → last | {b[0][f]:.0f} → {b[-1][f]:.0f} | {n[0][f]:.0f} → {n[-1][f]:.0f} |")
    print(f"| longest task | {max(x['longMax'] for x in bs['soak']):.0f} | {max(x['longMax'] for x in ns['soak']):.0f} |")
    print(f"| minutes | {bs['soak'][-1]['min']} | {ns['soak'][-1]['min']} |")
