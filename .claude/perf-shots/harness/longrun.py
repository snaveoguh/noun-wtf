import json,sys,collections
p=json.load(open(sys.argv[1])); K=int(sys.argv[2]) if len(sys.argv)>2 else 2
n={x['id']:x for x in p['nodes']}
parent={}
for x in p['nodes']:
    for c in x.get('children',[]): parent[c]=x['id']
def name(i):
    cf=n[i]['callFrame']; return f"{cf['functionName'] or '(anon)'} {cf['url'].split('/')[-1].split('?')[0]}:{cf['lineNumber']}"
t=p['startTime']; runs=[]; cur=None
for sid,d in zip(p['samples'],p['timeDeltas']):
    t+=d
    if name(sid).startswith('(idle)') or name(sid).startswith('(program)') and False:
        if cur: runs.append(cur); cur=None
    else:
        if cur is None: cur=[t,t,[]]
        cur[1]=t; cur[2].append(sid)
if cur: runs.append(cur)
runs.sort(key=lambda r:r[1]-r[0], reverse=True)
for r in runs[:K]:
    print('RUN ms', round((r[1]-r[0])/1000))
    inc=collections.Counter()
    for sid in r[2]:
        seen=set(); c=sid
        while c is not None:
            k=name(c)
            if k not in seen: inc[k]+=1; seen.add(k)
            c=parent.get(c)
    tot=len(r[2])
    for k,v in inc.most_common(40): print(f"  {v/tot*100:5.1f}% {k}")
