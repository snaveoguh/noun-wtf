# python3 table.py <dir> : before/after tables from {base,new}-<profile>.json
import json, os, sys
d = sys.argv[1]
def load(n):
    p = os.path.join(d, n)
    return json.load(open(p)) if os.path.exists(p) else None
for prof in ['ipad-land', 'ipad-port', 'droid-tab']:
    b, a = load(f'base-{prof}.json'), load(f'new-{prof}.json')
    if not b or not a: continue
    print(f"\n### {prof} ({a['engine']})\n")
    for k, r in (('before', b), ('after', a)):
        bt = r['boot']
        print(f"- {k}: boots `{bt['quality']}` at render scale {bt['lite']['scale']}, buffer {bt['buffer'][0]}×{bt['buffer'][1]}, shadow map {bt['shadowMap']}, weak {bt['weak']}")
    print("\n| scenario | build | frame p50 / p95 / max ms | CPU p95 / max ms | worst frame: what ran | draws | programs | heap MB |")
    print("|---|---|---|---|---|---|---|---|")
    for s in b['scenarios']:
        if s == 'soak' or s not in a['scenarios']: continue
        for k, r in (('before', b), ('after', a)):
            x = r['scenarios'][s]
            hl = sorted(x['hitchLog'], key=lambda h: -h['cpuMs'])
            top = ', '.join(f"{n} {v:.0f}" for n, v in hl[0]['top'][:2]) if hl else ''
            heap = f"{x['heapMB']:.0f}" if x.get('heapMB') else '–'
            print(f"| {s} | {k} | {x['frame']['p50']:.0f} / {x['frame']['p95']:.0f} / {x['frame']['max']:.0f} | {x['cpu']['p95']:.0f} / **{x['cpu']['max']:.0f}** | {top} | {x['render']['calls']} | {x['render']['programs']} | {heap} |")
