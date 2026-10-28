import json,sys,collections
p=json.load(open(sys.argv[1])); target=sys.argv[2]; depth=int(sys.argv[3]) if len(sys.argv)>3 else 1
n={x['id']:x for x in p['nodes']}
parent={}
for x in p['nodes']:
    for c in x.get('children',[]): parent[c]=x['id']
def name(i):
    cf=n[i]['callFrame']; return f"{cf['functionName'] or '(anon)'} {cf['url'].split('/')[-1].split('?')[0]}:{cf['lineNumber']}"
tot=0; child=collections.Counter(); allt=0; selfc=collections.Counter()
for sid,d in zip(p['samples'],p['timeDeltas']):
    allt+=d
    chain=[];c=sid
    while c is not None: chain.append(name(c)); c=parent.get(c)
    idx=[i for i,k in enumerate(chain) if target in k]
    if not idx: continue
    i=max(idx); tot+=d
    below=chain[:i]
    key=' < '.join(reversed(below[-depth:])) if below else '(self)'
    child[key]+=d; selfc[chain[0]]+=d
print(f'{target}: {tot/1000:.0f} ms of {allt/1000:.0f} ms ({tot/allt*100:.1f}%)')
for k,v in child.most_common(25): print(f'  {v/1000:7.1f}ms {k}')
print(' -- self')
for k,v in selfc.most_common(15): print(f'  {v/1000:7.1f}ms {k}')
