import json,os,sys
S=sys.argv[1] if len(sys.argv)>1 else 'data'
def load(n,p):
    f=f'{S}/final-{n}-{p}.json'
    return json.load(open(f)) if os.path.exists(f) else None
rows=[]
for prof in ['weak','mid','desktop']:
    B=load('base',prof); N=load('new',prof)
    if not B or not N: continue
    print(f"\n### {prof}  (boot base {B['boot']['quality']} @{B['boot']['pr']}, new {N['boot']['quality']} @{N['boot']['pr']})\n")
    print("| scenario | build | frame p50 / p95 / p99 ms | hitches >50ms | CPU p50 / p95 ms | render ms | draws | tris | programs | heap MB | long tasks (max ms) |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for sc in ['plaza-idle','skate-loop','remotes-16','interior','big-drop']:
        for n,R in [('before',B),('after',N)]:
            s=R['scenarios'].get(sc)
            if not s: continue
            f=s['frame']; c=s['cpu']; r=s['render'] or {}
            rend=next((x['mean'] for x in s['systems'] if x['name']=='render'),0)
            print(f"| {sc} | {n} | {f['p50']:.0f} / {f['p95']:.0f} / {f['p99']:.0f} | {f['hitches']}/{f['frames']} | {c['p50']:.0f} / {c['p95']:.0f} | {rend:.0f} | {r.get('calls','')} | {round(r.get('triangles',0)/1000)}k | {r.get('programs','')} | {s['heapMB']:.0f} | {s['longTasks']['count']} ({s['longTasks']['maxMs']:.0f}) |")
    for k in ['enterInterior','leaveInterior','enterDrop']:
        b=B.get(k); a=N.get(k)
        if b and a: print(f"\n{k}: before {json.dumps(b)} → after {json.dumps(a)}")
