"""Phone ("lite") copies of Noun World's plaza assets, for the 'low' tier.

plaza.glb is ~10 MB, two thirds of it JPEG textures up to 1638 px wide, and
the lightmaps go up to 2048². Phones render at 1x and can't use that detail:
this writes half-size copies next to the originals, which the level loader
picks on 'low' (falling back to the full files if a lite one is missing).

  public/world2/level/plaza.glb              → plaza.lite.glb
  public/world2/level/lightmap_*.webp        → lightmap_*.lite.webp

Textures and lightmaps over MAX_KEEP px on their long side are halved and the
textures re-encoded as WebP (EXT_texture_webp); normals become 8-bit and the
lightmap UVs (TEXCOORD_1, all inside 0..1) 16-bit (KHR_mesh_quantization).
three's GLTFLoader reads all of it natively. Positions and the tiling UVs stay
float. Re-run after re-exporting the plaza.

usage (from packages/nouns-webapp): python3 -I scripts/lite-assets.py
"""
import glob
import io
import json
import os
import struct

import numpy as np
from PIL import Image

LEVEL = os.path.join(os.path.dirname(__file__), '..', 'public', 'world2', 'level')
# Images at or under this (long side) keep their size
MAX_KEEP = 512
TEX_WEBP_Q = 80
WEBP_Q = 82


def halve(im: Image.Image) -> Image.Image:
    w, h = im.size
    return im.resize((max(1, w // 2), max(1, h // 2)), Image.LANCZOS)


def lite_image(data: bytes) -> bytes:
    """Halve (when big) and re-encode as WebP (alpha kept)."""
    im = Image.open(io.BytesIO(data))
    if max(im.size) > MAX_KEEP:
        im = halve(im)
    out = io.BytesIO()
    alpha = im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info)
    im.convert('RGBA' if alpha else 'RGB').save(out, 'WEBP', quality=TEX_WEBP_Q, method=6)
    return out.getvalue()


def read_floats(bin_: bytes, view: dict, acc: dict, comps: int) -> np.ndarray:
    off = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    n = acc['count'] * comps
    return np.frombuffer(bin_, dtype='<f4', count=n, offset=off).reshape(acc['count'], comps)


def quantize_normals(v: np.ndarray) -> bytes:
    """Unit normals → normalized int8, padded to 4 bytes per vertex (glTF alignment)."""
    q = np.clip(np.round(v * 127.0), -127, 127).astype('<i1')
    out = np.zeros((len(v), 4), dtype='<i1')
    out[:, :3] = q
    return out.tobytes()


def quantize_unit_uvs(v: np.ndarray) -> bytes:
    """UVs inside 0..1 → normalized uint16."""
    return np.clip(np.round(v * 65535.0), 0, 65535).astype('<u2').tobytes()


def lite_glb(src: str, dst: str) -> None:
    f = open(src, 'rb').read()
    magic, version, _ = struct.unpack('<4sII', f[:12])
    assert magic == b'glTF' and version == 2, 'not a glTF 2 binary'
    jlen, jtype = struct.unpack('<II', f[12:20])
    assert jtype == 0x4E4F534A
    j = json.loads(f[20:20 + jlen])
    blen, btype = struct.unpack('<II', f[20 + jlen:28 + jlen])
    assert btype == 0x004E4942
    bin_ = f[28 + jlen:28 + jlen + blen]

    views = j['bufferViews']
    acc_views = [a.get('bufferView') for a in j['accessors']]
    assert len(set(v for v in acc_views if v is not None)) == len(
        [v for v in acc_views if v is not None]
    ), 'shared bufferViews: not supported'
    assert not any('byteStride' in v for v in views), 'interleaved views: not supported'
    datas = [bin_[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in views]

    # Textures → half-size WebP
    for im in j.get('images', []):
        if 'bufferView' not in im:
            continue
        i = im['bufferView']
        datas[i] = lite_image(datas[i])
        im['mimeType'] = 'image/webp'
    for t in j.get('textures', []):
        if 'source' in t:
            t.setdefault('extensions', {})['EXT_texture_webp'] = {'source': t.pop('source')}

    # Geometry: 8-bit normals, 16-bit lightmap UVs
    quantized = False
    for m in j['meshes']:
        for p in m['primitives']:
            at = p['attributes']
            for key in ('NORMAL', 'TEXCOORD_1'):
                ai = at.get(key)
                if ai is None:
                    continue
                a = j['accessors'][ai]
                if a.get('componentType') != 5126 or a.get('sparse') is not None:
                    continue
                vi = a['bufferView']
                comps = 3 if key == 'NORMAL' else 2
                v = read_floats(bin_, views[vi], a, comps)
                if key == 'NORMAL':
                    datas[vi] = quantize_normals(v)
                    a['componentType'] = 5120  # BYTE
                    views[vi]['byteStride'] = 4
                else:
                    if v.size and (v.min() < 0 or v.max() > 1):
                        continue
                    datas[vi] = quantize_unit_uvs(v)
                    a['componentType'] = 5123  # UNSIGNED_SHORT
                a['normalized'] = True
                a['byteOffset'] = 0
                a.pop('min', None)
                a.pop('max', None)
                quantized = True

    used = set(j.get('extensionsUsed', []))
    req = set(j.get('extensionsRequired', []))
    used.add('EXT_texture_webp')
    req.add('EXT_texture_webp')
    if quantized:
        used.add('KHR_mesh_quantization')
        req.add('KHR_mesh_quantization')
    j['extensionsUsed'] = sorted(used)
    j['extensionsRequired'] = sorted(req)

    # Re-pack the binary chunk (4-byte aligned views)
    out = bytearray()
    for v, d in zip(views, datas):
        out += b'\0' * ((4 - len(out) % 4) % 4)
        v['byteOffset'] = len(out)
        v['byteLength'] = len(d)
        out += d
    out += b'\0' * ((4 - len(out) % 4) % 4)
    j['buffers'][0]['byteLength'] = len(out)

    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(dst, 'wb') as o:
        o.write(struct.pack('<4sII', b'glTF', 2, total))
        o.write(struct.pack('<II', len(js), 0x4E4F534A))
        o.write(js)
        o.write(struct.pack('<II', len(out), 0x004E4942))
        o.write(out)


def lite_webp(src: str, dst: str) -> None:
    im = Image.open(src)
    if max(im.size) > MAX_KEEP:
        im = halve(im)
    im.save(dst, 'WEBP', quality=WEBP_Q, method=6)


def kb(p: str) -> int:
    return os.path.getsize(p) // 1024


if __name__ == '__main__':
    src = os.path.join(LEVEL, 'plaza.glb')
    dst = os.path.join(LEVEL, 'plaza.lite.glb')
    lite_glb(src, dst)
    print(f'plaza.glb {kb(src)} KB -> plaza.lite.glb {kb(dst)} KB')
    for p in sorted(glob.glob(os.path.join(LEVEL, 'lightmap_*.webp'))):
        if p.endswith('.lite.webp'):
            continue
        q = p[: -len('.webp')] + '.lite.webp'
        lite_webp(p, q)
        print(f'{os.path.basename(p)} {kb(p)} KB -> {os.path.basename(q)} {kb(q)} KB')
