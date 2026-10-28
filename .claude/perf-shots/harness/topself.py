import json,sys,collections
p=json.load(open(sys.argv[1])); n={x['id']:x for x in p['nodes']}
dt=collections.Counter(); 
ts=p['timeDeltas']; samples=p['samples']
tot=collections.Counter()
for sid,d in zip(samples,ts): tot[sid]+=d
self_=collections.Counter()
for sid,t in tot.items():
    cf=n[sid]['callFrame']; key=f"{cf['functionName'] or '(anon)'} {cf['url'].split('/')[-1]}:{cf['lineNumber']}"
    self_[key]+=t
# inclusive
parent={}
for x in p['nodes']:
    for c in x.get('children',[]): parent[c]=x['id']
inc=collections.Counter()
for sid,t in tot.items():
    seen=set(); cur=sid
    while cur is not None:
        cf=n[cur]['callFrame']; key=f"{cf['functionName'] or '(anon)'} {cf['url'].split('/')[-1]}:{cf['lineNumber']}"
        if key not in seen: inc[key]+=t; seen.add(key)
        cur=parent.get(cur)
T=sum(tot.values())
print("total ms",T/1000)
print("--- self")
for k,v in self_.most_common(int(sys.argv[2]) if len(sys.argv)>2 else 40): print(f"{v/T*100:5.1f}% {v/1000:8.1f}ms {k}")
print("--- inclusive")
for k,v in inc.most_common(50): print(f"{v/T*100:5.1f}% {k}")
