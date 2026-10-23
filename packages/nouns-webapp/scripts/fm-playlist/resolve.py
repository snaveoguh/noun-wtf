"""Resolve NOUN FM candidates ({artist,title,genre,kind}) to embeddable YouTube videos.

usage: python3 -I resolve.py OUT.jsonl CANDS.jsonl [CANDS.jsonl ...]
Resumable: candidates already present in OUT (by artist+title) are skipped.
"""
import concurrent.futures as cf
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
MAX_S = {'music': 15 * 60, 'video': 2 * 3600, 'podcast': 3 * 3600}
MIN_S = {'music': 60, 'video': 6 * 60, 'podcast': 10 * 60}


def get(url, timeout=20):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read().decode('utf-8', 'replace')


def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def secs(text):
    if not text:
        return None
    n = 0
    for p in text.split(':'):
        if not p.isdigit():
            return None
        n = n * 60 + int(p)
    return n


def walk(o, out):
    if isinstance(o, dict):
        vr = o.get('videoRenderer')
        if isinstance(vr, dict) and 'videoId' in vr:
            out.append(vr)
        for v in o.values():
            walk(v, out)
    elif isinstance(o, list):
        for v in o:
            walk(v, out)


def search(q):
    url = 'https://www.youtube.com/results?' + urllib.parse.urlencode({'search_query': q})
    for attempt in range(3):
        try:
            _, html = get(url)
            m = re.search(r'var ytInitialData = (\{.*?\});</script>', html, re.S)
            if not m:
                time.sleep(2 + attempt * 3)
                continue
            vids = []
            walk(json.loads(m.group(1)), vids)
            res = []
            for vr in vids[:8]:
                title = ''.join(r.get('text', '') for r in vr.get('title', {}).get('runs', []))
                chan = ''.join(r.get('text', '') for r in vr.get('ownerText', {}).get('runs', []))
                length = secs(vr.get('lengthText', {}).get('simpleText'))
                res.append({'id': vr['videoId'], 'title': title, 'channel': chan, 'dur': length})
            return res
        except Exception:
            time.sleep(2 + attempt * 3)
    return None


def embeddable(vid):
    try:
        st, body = get('https://www.youtube.com/oembed?' + urllib.parse.urlencode(
            {'url': f'https://www.youtube.com/watch?v={vid}', 'format': 'json'}), timeout=15)
        return st == 200 and '"html"' in body
    except Exception:
        return False


BAD = re.compile(r'\b(reaction|reacts|cover by|karaoke|lyrics? video|tutorial|lesson|how to play|8d audio|slowed|sped up|nightcore|1 hour|10 hours|loop|trailer|teaser|clip|shorts)\b')


def pick(c, results):
    kind = c.get('kind', 'music')
    want_t = norm(c['title'])
    want_a = norm(c['artist'])
    t_words = [w for w in want_t.split() if len(w) > 2] or want_t.split()
    best = None
    for r in results:
        if r['dur'] is None or r['dur'] < MIN_S.get(kind, 60) or r['dur'] > MAX_S.get(kind, MAX_S['music']):
            continue
        hay = norm(r['title'] + ' ' + r['channel'])
        if BAD.search(hay) and not BAD.search(want_t):
            continue
        t_hit = sum(w in hay for w in t_words) / max(1, len(t_words))
        a_words = [w for w in want_a.split() if len(w) > 1]
        a_hit = sum(w in hay for w in a_words) / max(1, len(a_words))
        if kind == 'music':
            if t_hit < 0.75 or a_hit < 0.5:
                continue
        elif t_hit < 0.8:
            continue
        score = t_hit * 2 + a_hit + (0.3 if 'topic' in norm(r['channel']) or 'official' in hay else 0)
        if best is None or score > best[0]:
            best = (score, r)
    return best[1] if best else None


def resolve(c):
    q = f"{c['artist']} {c['title']}" if c.get('kind', 'music') == 'music' else f"{c['title']} {c['artist']}"
    results = search(q)
    if results is None:
        return c, None, 'search-failed'
    r = pick(c, results)
    if r is None:
        return c, None, 'no-match'
    if not embeddable(r['id']):
        # try the next acceptable match once
        rest = [x for x in results if x['id'] != r['id']]
        r = pick(c, rest)
        if r is None or not embeddable(r['id']):
            return c, None, 'not-embeddable'
    return c, r, 'ok'


def main():
    out_path, cand_paths = sys.argv[1], sys.argv[2:]
    done = set()
    try:
        for line in open(out_path):
            o = json.loads(line)
            done.add((norm(o['artist']), norm(o['title'])))
    except FileNotFoundError:
        pass
    cands, seen = [], set(done)
    for p in cand_paths:
        for line in open(p):
            line = line.strip()
            if not line:
                continue
            c = json.loads(line)
            k = (norm(c['artist']), norm(c['title']))
            if k in seen:
                continue
            seen.add(k)
            cands.append(c)
    print(f'{len(cands)} to resolve ({len(done)} already done)', flush=True)
    stats = {}
    with open(out_path, 'a') as out, open(out_path + '.misses', 'a') as miss, cf.ThreadPoolExecutor(4) as ex:
        for i, (c, r, why) in enumerate(ex.map(resolve, cands), 1):
            stats[why] = stats.get(why, 0) + 1
            rec = dict(c)
            if r:
                rec.update({'id': r['id'], 'ytTitle': r['title'], 'channel': r['channel'], 'dur': r['dur']})
                out.write(json.dumps(rec, ensure_ascii=False) + '\n')
                out.flush()
            else:
                rec['why'] = why
                miss.write(json.dumps(rec, ensure_ascii=False) + '\n')
                miss.flush()
            if i % 50 == 0:
                print(i, stats, flush=True)
    print('done', stats, flush=True)


if __name__ == '__main__':
    main()
