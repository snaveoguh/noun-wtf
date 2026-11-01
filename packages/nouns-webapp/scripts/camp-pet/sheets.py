"""Lay the CAMP pet concept frames out as contact sheets.

python3 scripts/camp-pet/sheets.py <framesDir> <outDir> [fridgeDir]
(run from packages/nouns-webapp; frames come from render.cjs, the fridge
shots from fridge.cjs)
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

FR, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
LON = 'src/fonts/Londrina_Solid/LondrinaSolid-Black.ttf'
SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
BG = (225, 215, 213)
INK = (34, 26, 38)
MUTED = (110, 100, 104)
ROSE = (255, 99, 141)

VARIANTS = [
    dict(id='mochi', name='MOCHI', tag='the classic',
         look='dusty-pink skin, giant round ears, buck teeth, folding bat wings, curly tail',
         who='Shy snack goblin. Hides behind its ears, then steals your fries.',
         names='Mochi, Dumpling, Pip'),
    dict(id='nub', name='NUB', tag='the cube',
         look='the most Noun: square head and square ears, 8-bit stepped wings, little smile',
         who='Unbothered. Sits on your head like it pays rent.',
         names='Nub, Cubey, Blok'),
    dict(id='zip', name='ZIP', tag='the flyer',
         look='Nouns peachy skin, slimmer and leggier, biggest wings and longest tail, cat mouth',
         who='Hyper show-off. Loops round you every time you land a trick.',
         names='Zip, Zoomer, Turbo'),
    dict(id='bean', name='BEAN', tag='the baby',
         look='tiny, biggest head, cream-pink, two acid-green wings that buzz like a bee',
         who='Sleepy and clingy. Always ends up napping on your head.',
         names='Bean, Peanut, Mote'),
]


def font(path, size):
    return ImageFont.truetype(path, size)


def tile(name, w, h):
    im = Image.open(os.path.join(FR, name)).convert('RGB')
    # frames are square: crop to the tile's aspect, centred
    s = im.width
    if w / h != 1:
        ch = int(s * h / w)
        top = (s - ch) // 2
        im = im.crop((0, top, s, top + ch))
    return im.resize((w, h), Image.LANCZOS)


def label(d, x, y, text, f, fill=INK):
    d.text((x, y), text, font=f, fill=fill)


sizes = json.load(open(os.path.join(FR, 'sizes.json')))
W = 1800
GAP = 18
M = 40


def variant_sheet(v):
    head_h = 190
    t4 = (W - 2 * M - 3 * GAP) // 4
    t3 = (W - 2 * M - 2 * GAP) // 3
    sec = 54
    H = head_h + sec + t4 + 40 + sec + t3 + 40 + sec + t3 + 40 + 60
    S = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(S)
    label(d, M, 26, v['name'], font(LON, 92))
    nw = d.textlength(v['name'], font=font(LON, 92))
    label(d, M + nw + 24, 70, v['tag'], font(LON, 44), ROSE)
    label(d, M, 128, v['who'], font(BOLD, 24))
    label(d, M, 160, f"{v['look']}.  ~{int(sizes[v['id']] * 100)} cm tall (rider 182 cm).  Name ideas: {v['names']}",
          font(SANS, 19), MUTED)
    y = head_h

    def section(title, y):
        label(d, M, y + 8, title, font(LON, 34))
        return y + sec

    y = section('TURNAROUND', y)
    for i, (k, cap) in enumerate([('turn-front', 'front'), ('turn-34', '3/4'), ('turn-side', 'side'), ('turn-back', 'back')]):
        x = M + i * (t4 + GAP)
        S.paste(tile(f"{v['id']}-{k}.png", t4, t4), (x, y))
        label(d, x + 6, y + t4 + 6, cap, font(SANS, 20), MUTED)
    y += t4 + 40
    y = section('FOLLOWING YOU', y)
    for i, (k, cap) in enumerate([('mode-head', 'on your head'), ('mode-beside', 'running beside you'), ('mode-fly', 'flying alongside (you on a board)')]):
        x = M + i * (t3 + GAP)
        S.paste(tile(f"{v['id']}-{k}.png", t3, t3), (x, y))
        label(d, x + 6, y + t3 + 6, cap, font(SANS, 20), MUTED)
    y += t3 + 40
    y = section('MOODS', y)
    for i, (k, cap) in enumerate([('pose-idle', 'idle'), ('pose-happy', 'happy (you came back: hop + spin)'), ('pose-sleep', 'asleep (noggles pushed up)')]):
        x = M + i * (t3 + GAP)
        S.paste(tile(f"{v['id']}-{k}.png", t3, t3), (x, y))
        label(d, x + 6, y + t3 + 6, cap, font(SANS, 20), MUTED)
    label(d, M, H - 44, 'noun.wtf CAMP pet concept. Voxels + the real hip-rose noggles (pixel for pixel from the Nouns art), '
          "rendered with Noun World's toon materials and ink outline.", font(SANS, 17), MUTED)
    S.save(os.path.join(OUT, f"{v['id']}.png"), optimize=True)


def overview():
    head_h = 170
    col = (W - 2 * M - 3 * GAP) // 4
    lh = 760
    H = head_h + lh + 30 + col + 20 + col + 300
    S = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(S)
    label(d, M, 24, 'CAMP PET', font(LON, 92))
    label(d, M + d.textlength('CAMP PET', font=font(LON, 92)) + 24, 68, 'four takes on one hairless flying mouse', font(LON, 40), ROSE)
    label(d, M, 128, 'Pick one (or mix: e.g. NUB ears on MOCHI). Each has its own sheet next to this one.', font(SANS, 22), MUTED)
    y = head_h
    lu = Image.open(os.path.join(FR, 'lineup.png')).convert('RGB')
    # crop to what's drawn (anything off the backdrop colour), then fit
    from PIL import ImageChops
    diff = ImageChops.difference(lu, Image.new('RGB', lu.size, lu.getpixel((2, 2)))).convert('L')
    bb = diff.point(lambda q: 255 if q > 12 else 0).getbbox()
    pad = 30
    lu = lu.crop((max(0, bb[0] - pad), max(0, bb[1] - pad), min(lu.width, bb[2] + pad), min(lu.height, bb[3] + pad)))
    k = min((W - 2 * M) / lu.width, (lh - 40) / lu.height)
    lu = lu.resize((int(lu.width * k), int(lu.height * k)), Image.LANCZOS)
    S.paste(lu, (M + (W - 2 * M - lu.width) // 2, y + 40))
    label(d, M + 8, y + 8, 'to scale, next to a Noun rider (182 cm): MOCHI, NUB, ZIP, BEAN', font(SANS, 20), MUTED)
    y += lh + 30
    for i, v in enumerate(VARIANTS):
        x = M + i * (col + GAP)
        S.paste(tile(f"{v['id']}-turn-34.png", col, col), (x, y))
        S.paste(tile(f"{v['id']}-pose-happy.png", col, col), (x, y + col + 20))
        ty = y + 2 * col + 40
        label(d, x, ty, v['name'], font(LON, 52))
        label(d, x + d.textlength(v['name'], font=font(LON, 52)) + 12, ty + 18, v['tag'], font(LON, 30), ROSE)
        words, line, lines = v['who'].split(), '', []
        f = font(SANS, 19)
        for w_ in words:
            if d.textlength(line + ' ' + w_, font=f) > col:
                lines.append(line)
                line = w_
            else:
                line = (line + ' ' + w_).strip()
        lines.append(line)
        for j, ln in enumerate(lines):
            label(d, x, ty + 66 + j * 25, ln, f)
    S.save(os.path.join(OUT, 'overview.png'), optimize=True)


def fridge_sheet(fd):
    """Before you adopt it: up on CAMP's fridge, shot in the live game."""
    head_h = 190
    tw = (W - 2 * M - GAP) // 2
    th = tw * 800 // 1280
    rows = [('mochi', 'perched, keeping an eye on the room'), ('nub', 'napping (noggles pushed up)'),
            ('zip', 'watching you'), ('bean', 'napping')]
    H = head_h + len(rows) * (th + 44) + 50
    S = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(S)
    label(d, M, 26, 'ON THE FRIDGE', font(LON, 92))
    label(d, M + d.textlength('ON THE FRIDGE', font=font(LON, 92)) + 24, 70, 'before you adopt it', font(LON, 44), ROSE)
    label(d, M, 128, "Until it's adopted it lives up on CAMP's fridge, out of reach. Talk to it there to adopt it.", font(BOLD, 24))
    label(d, M, 160, "Shot in the live game (offline) on the fridge already in world/camp/layout.ts (0.75 x 0.7 x 1.8 m, back corner by the kitchen), "
          'in the room\'s own sunset light.', font(SANS, 19), MUTED)
    y = head_h
    for vid, cap in rows:
        name = next(v['name'] for v in VARIANTS if v['id'] == vid)
        for i, view in enumerate(['wide', 'close']):
            im = Image.open(os.path.join(fd, f'fridge-{vid}-{view}.png')).convert('RGB').resize((tw, th), Image.LANCZOS)
            S.paste(im, (M + i * (tw + GAP), y))
        label(d, M, y + th + 6, name, font(LON, 30))
        label(d, M + d.textlength(name, font=font(LON, 30)) + 12, y + th + 12, cap, font(SANS, 20), MUTED)
        y += th + 44
    S.save(os.path.join(OUT, 'fridge.png'), optimize=True)


for v in VARIANTS:
    variant_sheet(v)
overview()
if len(sys.argv) > 3:
    fridge_sheet(sys.argv[3])
print('ok')
