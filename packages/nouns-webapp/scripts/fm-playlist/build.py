"""Build public/fm/playlist.json for the site-wide NOUN FM player.

1. resolve each candidate list (YouTube search + oEmbed embeddable check):
     FM_WORK=fm-work; mkdir -p $FM_WORK
     for g in dub footwork downtempo psych soul hiphop videos; do
       python3 -I resolve.py $FM_WORK/resolved-$g.jsonl candidates/cands-$g.jsonl
     done
2. merge (the owner's own library sets first, dedupe by video, cap each
   artist at CAP songs):  FM_WORK=fm-work python3 -I build.py
"""
import collections
import concurrent.futures as cf
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from resolve import embeddable, norm  # noqa: E402

S = os.environ.get('FM_WORK', 'fm-work') + '/'
CAP = 12
rows = []
# owner's own sets first (they win dedupe + count toward caps)
lib = json.load(open(os.path.join(HERE, 'owner-sets.json')))
GENRE = {'vibe ratings': 'aotearoa dub', 'FOOTWORK': 'footwork', 'pipedream vibes': 'psych rock', 'electric av': 'chicano rock'}
own = []
for s in lib['sets']:
    for t in s['tracks']:
        if t['src'].get('kind') != 'youtube':
            continue
        title = t['title']
        artist = ''
        if ' - ' in title and t['artist'] == 'YouTube':
            artist, title = title.split(' - ', 1)
        own.append({'id': t['src']['id'], 'title': title, 'artist': artist or 'PIP3 pick', 'genre': GENRE.get(s['name'], 'pip3'), 'kind': 'music', 'dur': t.get('dur', 0), 'own': True})
with cf.ThreadPoolExecutor(6) as ex:
    ok = list(ex.map(lambda r: embeddable(r['id']), own))
own = [r for r, k in zip(own, ok) if k]
print('own tracks embeddable:', len(own), 'of', len(ok))
rows += own
for f in ['dub', 'footwork', 'downtempo', 'psych', 'soul', 'hiphop', 'videos']:
    for line in open(f'{S}resolved-{f}.jsonl'):
        r = json.loads(line)
        rows.append({'id': r['id'], 'title': r['title'], 'artist': r['artist'], 'genre': r['genre'], 'kind': r.get('kind', 'music'), 'dur': r['dur']})
seen, per_artist, out = set(), collections.Counter(), []
dropped = collections.Counter()
for r in rows:
    if r['id'] in seen:
        dropped['dup-video'] += 1; continue
    a = norm(r['artist'])
    if r['kind'] == 'music' and not r.get('own') and per_artist[a] >= CAP:
        dropped['artist-cap'] += 1; continue
    seen.add(r['id']); per_artist[a] += 1
    r.pop('own', None)
    out.append(r)
kinds = collections.Counter(r['kind'] for r in out)
print('final', len(out), dict(kinds), 'dropped', dict(dropped))
print('top artists', per_artist.most_common(8))
genres = collections.Counter(r['genre'] for r in out)
print('genres', len(genres), genres.most_common(12))
json.dump({'version': 1, 'generated': '2026-10-23', 'items': out}, open(os.path.join(HERE, '..', '..', 'public', 'fm', 'playlist.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
