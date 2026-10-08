"""Noggle Plaza level pipeline -- shared geometry builder.

All geometry is accumulated in plain Python/numpy "Parts" (one per output mesh)
and only turned into Blender meshes at the end (``Level.to_blender``). This keeps
the build deterministic, fast, and gives us exact, stable mesh names.

Coordinates: Blender Z-up, meters. Origin = plaza center, plaza floor at z=0.
Conversion to three.js (Y-up, glTF):  (x, y, z)_blender -> (x, z, -y)_three.
"""
import math
import numpy as np

# --------------------------------------------------------------------------------------
# Output mesh groups.  Render groups end up in plaza.glb, collision groups in collision.glb
# --------------------------------------------------------------------------------------
RENDER_GROUPS = ["Ground", "Obstacles", "Buildings", "Props", "Foliage", "Decals", "Water", "Backdrop"]
# default render-group -> collision-group mapping (None = render only)
DEFAULT_COL = {
    "Ground": "COL_Ground",
    "Obstacles": "COL_Obstacles",
    "Buildings": "COL_Buildings",
    "Props": "COL_Props",
    "Foliage": None,
    "Decals": None,
    "Water": None,
    "Backdrop": None,
}
COLLISION_GROUPS = ["COL_Ground", "COL_Obstacles", "COL_Buildings", "COL_Props", "COL_Boundary"]


def to_three(p):
    """Blender (x,y,z) Z-up -> three.js (x,y,z) Y-up (what the glTF exporter does)."""
    return [round(float(p[0]), 4), round(float(p[2]), 4), round(float(-p[1]), 4)]


def rot_z(pts, ang):
    c, s = math.cos(ang), math.sin(ang)
    out = []
    for p in pts:
        x, y = p[0], p[1]
        out.append((c * x - s * y, s * x + c * y, p[2]))
    return out


def xform(pts, origin=(0, 0, 0), ang=0.0):
    if ang:
        pts = rot_z(pts, ang)
    ox, oy, oz = origin
    return [(p[0] + ox, p[1] + oy, p[2] + oz) for p in pts]


class Part:
    """Accumulates polygons for one output mesh."""

    def __init__(self, name):
        self.name = name
        self.verts = []
        self.faces = []
        self.mats = []
        self.smooth = []
        self.uvs = []  # per face: None (box projection) or list of (u,v) per corner

    def add(self, verts, faces, mat, smooth=False, uvs=None):
        base = len(self.verts)
        self.verts.extend([tuple(map(float, v)) for v in verts])
        for i, f in enumerate(faces):
            self.faces.append([base + j for j in f])
            self.mats.append(mat[i] if isinstance(mat, (list, tuple)) else mat)
            self.smooth.append(smooth[i] if isinstance(smooth, (list, tuple)) else smooth)
            self.uvs.append(None if uvs is None else uvs[i])


class Level:
    def __init__(self):
        self.parts = {}
        self.rails = []
        self.spawns = []
        self.landmarks = []
        self._rail_ids = {}

    # ---------------------------------------------------------------- parts
    def part(self, name):
        if name not in self.parts:
            self.parts[name] = Part(name)
        return self.parts[name]

    def emit(self, group, verts, faces, mat, smooth=False, uvs=None, col=True):
        """Add geometry to a render group and (optionally) its collision group.

        col: True -> default collision group, False/None -> render only,
             str  -> explicit collision group name, "only" -> collision only (default group)
        """
        if col != "only":
            self.part(group).add(verts, faces, mat, smooth, uvs)
        if col:
            cg = DEFAULT_COL.get(group) if col in (True, "only") else col
            if cg:
                self.part(cg).add(verts, faces, "collision", False, None)

    def col_only(self, cgroup, verts, faces):
        self.part(cgroup).add(verts, faces, "collision", False, None)

    # ---------------------------------------------------------------- metadata
    def rail(self, rtype, pts, name=None):
        """Register a grindable polyline (Blender coords)."""
        base = name or rtype
        n = self._rail_ids.get(base, 0) + 1
        self._rail_ids[base] = n
        rid = f"{base}_{n:02d}"
        self.rails.append({"id": rid, "type": rtype, "points": [to_three(p) for p in pts]})
        return rid

    def spawn(self, name, pos, facing_xy):
        """facing_xy = Blender-space horizontal direction the skater faces."""
        # three: forward = (sin yaw, 0, cos yaw); blender dir (dx,dy) -> three (dx, -dy)
        tx, tz = facing_xy[0], -facing_xy[1]
        yaw = math.atan2(tx, tz)
        self.spawns.append({"name": name, "position": to_three(pos), "yaw": round(yaw, 4)})

    def landmark(self, name, pos, kind="spot"):
        self.landmarks.append({"name": name, "kind": kind, "position": to_three(pos)})

    # ================================================================ primitives
    def polys(self, group, polys, mat, col=True, smooth=False, uvs=None):
        """List of polygons (each a list of 3D points), each with its own verts (flat)."""
        verts, faces = [], []
        for poly in polys:
            b = len(verts)
            verts.extend(poly)
            faces.append(list(range(b, b + len(poly))))
        self.emit(group, verts, faces, mat, smooth=smooth, uvs=uvs, col=col)

    def box(self, group, mat, center, size, ang=0.0, col=True, bottom=False, top=True,
            mat_top=None, mat_side=None, sides="nsew", uv_top=None):
        """Axis box (rotated about Z by ang around its center). center=(cx,cy,z0) where z0 = bottom."""
        cx, cy, z0 = center
        sx, sy, sz = size
        hx, hy = sx / 2, sy / 2
        z1 = z0 + sz
        c = [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)]
        lo = [(x, y, z0) for x, y in c]
        hi = [(x, y, z1) for x, y in c]
        polys, mats, uvl = [], [], []
        if top:
            polys.append(hi)
            mats.append(mat_top or mat)
            uvl.append(uv_top)
        if bottom:
            polys.append(lo[::-1])
            mats.append(mat)
            uvl.append(None)
        side_names = ["s", "e", "n", "w"]  # -y, +x, +y, -x faces
        for i in range(4):
            if side_names[i] not in sides:
                continue
            j = (i + 1) % 4
            polys.append([lo[i], lo[j], hi[j], hi[i]])
            mats.append(mat_side or mat)
            uvl.append(None)
        polys = [xform(p, (cx, cy, 0), ang) for p in polys]
        verts, faces = [], []
        for p in polys:
            b = len(verts)
            verts.extend(p)
            faces.append(list(range(b, b + len(p))))
        self.emit(group, verts, faces, mats, uvs=uvl if any(u is not None for u in uvl) else None, col=col)

    def boxmm(self, group, mat, mn, mx, **kw):
        """Box from min/max corners (unrotated)."""
        cx, cy = (mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2
        self.box(group, mat, (cx, cy, mn[2]), (mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]), **kw)

    def prism(self, group, poly2d, z0, z1, mat, mat_top=None, col=True, bottom=False, origin=(0, 0, 0), ang=0.0):
        """Extrude a CCW 2D polygon from z0 to z1."""
        n = len(poly2d)
        lo = [(x, y, z0) for x, y in poly2d]
        hi = [(x, y, z1) for x, y in poly2d]
        polys = [hi]
        mats = [mat_top or mat]
        if bottom:
            polys.append(lo[::-1])
            mats.append(mat)
        for i in range(n):
            j = (i + 1) % n
            polys.append([lo[i], lo[j], hi[j], hi[i]])
            mats.append(mat)
        polys = [xform(p, origin, ang) for p in polys]
        verts, faces = [], []
        for p in polys:
            b = len(verts)
            verts.extend(p)
            faces.append(list(range(b, b + len(p))))
        self.emit(group, verts, faces, mats, col=col)

    def profile_extrude(self, group, pieces, width, origin, ang, mat_side, col=True, back=True):
        """Extrude a side profile (in local s=forward, z=up) across local y in [-w/2, w/2].

        pieces: list of (points[(s,z)...], material, smooth). Pieces are consecutive and
        form the top/riding surface from s_start to s_end. The outline is closed down to
        z=0 (bottom not emitted). Side caps use mat_side. ``back`` adds the vertical back
        face at the last point (if it is above z=0).
        """
        hw = width / 2
        verts, faces, mats, smooth = [], [], [], []
        outline = []
        for pts, mat, sm in pieces:
            if outline and tuple(outline[-1]) == tuple(pts[0]):
                outline.extend(pts[1:])
            else:
                outline.extend(pts)
            b = len(verts)
            for s, z in pts:
                verts.append((s, -hw, z))
                verts.append((s, hw, z))
            for i in range(len(pts) - 1):
                i0 = b + 2 * i
                faces.append([i0, i0 + 2, i0 + 3, i0 + 1])
                mats.append(mat)
                smooth.append(sm)
        s_end, z_end = outline[-1]
        s_start, z_start = outline[0]
        # back face
        if back and z_end > 1e-4:
            b = len(verts)
            verts += [(s_end, -hw, z_end), (s_end, -hw, 0), (s_end, hw, 0), (s_end, hw, z_end)]
            faces.append([b, b + 1, b + 2, b + 3])
            mats.append(mat_side)
            smooth.append(False)
        if z_start > 1e-4:
            b = len(verts)
            verts += [(s_start, hw, z_start), (s_start, hw, 0), (s_start, -hw, 0), (s_start, -hw, z_start)]
            faces.append([b, b + 1, b + 2, b + 3])
            mats.append(mat_side)
            smooth.append(False)
        # side caps (closed outline incl. bottom)
        ring = list(outline)
        if ring[-1][1] > 1e-4:
            ring.append((s_end, 0.0))
        if ring[0][1] > 1e-4:
            ring.append((s_start, 0.0))
        # dedupe consecutive
        clean = []
        for p in ring:
            if not clean or (abs(p[0] - clean[-1][0]) > 1e-6 or abs(p[1] - clean[-1][1]) > 1e-6):
                clean.append(p)
        if abs(clean[0][0] - clean[-1][0]) < 1e-6 and abs(clean[0][1] - clean[-1][1]) < 1e-6:
            clean.pop()
        b = len(verts)
        for s, z in clean:
            verts.append((s, -hw, z))
        faces.append(list(range(b, b + len(clean))))  # -y side (outline order => normal -y)
        mats.append(mat_side)
        smooth.append(False)
        b = len(verts)
        for s, z in reversed(clean):
            verts.append((s, hw, z))
        faces.append(list(range(b, b + len(clean))))
        mats.append(mat_side)
        smooth.append(False)
        verts = xform(verts, origin, ang)
        self.emit(group, verts, faces, mats, smooth=smooth, col=col)

    def cylinder(self, group, p0, p1, r, mat, seg=8, caps=True, col=True, r1=None, smooth=True, phase=0.0):
        """Cylinder (or cone frustum if r1 given) between two 3D points."""
        p0 = np.array(p0, float)
        p1 = np.array(p1, float)
        r1 = r if r1 is None else r1
        d = p1 - p0
        L = np.linalg.norm(d)
        if L < 1e-6:
            return
        a = d / L
        ref = np.array([0, 0, 1.0]) if abs(a[2]) < 0.9 else np.array([1.0, 0, 0])
        u = np.cross(a, ref)
        u /= np.linalg.norm(u)
        v = np.cross(a, u)
        ring0, ring1 = [], []
        for i in range(seg):
            t = 2 * math.pi * i / seg + phase
            o = math.cos(t) * u + math.sin(t) * v
            ring0.append(tuple(p0 + o * r))
            ring1.append(tuple(p1 + o * r1))
        verts = ring0 + ring1
        faces = [[i, (i + 1) % seg, seg + (i + 1) % seg, seg + i] for i in range(seg)]
        mats = [mat] * seg
        sm = [smooth] * seg
        if caps:
            b = len(verts)
            verts += ring0[::-1]
            faces.append(list(range(b, b + seg)))
            b = len(verts)
            verts += ring1
            faces.append(list(range(b, b + seg)))
            mats += [mat, mat]
            sm += [False, False]
        self.emit(group, verts, faces, mats, smooth=sm, col=col)

    def tube(self, group, pts, r, mat, seg=8, col=True):
        """Polyline tube made of cylinders with small spheres-ish joints (caps)."""
        for a, b in zip(pts[:-1], pts[1:]):
            self.cylinder(group, a, b, r, mat, seg=seg, caps=True, col=col)

    def frustum(self, group, bottom_rect, top_rect, z0, z1, mat, mat_top=None, col=True):
        """Pyramid frustum: rects as (xmin,ymin,xmax,ymax)."""
        def corners(r, z):
            x0, y0, x1, y1 = r
            return [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)]
        lo = corners(bottom_rect, z0)
        hi = corners(top_rect, z1)
        polys = [hi]
        mats = [mat_top or mat]
        for i in range(4):
            j = (i + 1) % 4
            polys.append([lo[i], lo[j], hi[j], hi[i]])
            mats.append(mat)
        verts, faces = [], []
        for p in polys:
            b = len(verts)
            verts.extend(p)
            faces.append(list(range(b, b + len(p))))
        self.emit(group, verts, faces, mats, col=col)


# --------------------------------------------------------------------------------------
# UV helpers
# --------------------------------------------------------------------------------------
def box_uv(poly, tile):
    """World-space box projection for one polygon (no mirroring). tile=(tu,tv) meters."""
    p = np.array(poly, float)
    n = np.zeros(3)
    for i in range(len(p)):
        a, b = p[i], p[(i + 1) % len(p)]
        n += np.cross(a, b)
    ln = np.linalg.norm(n)
    n = n / ln if ln > 1e-12 else np.array([0, 0, 1.0])
    ax = np.abs(n)
    tu, tv = tile
    out = []
    if ax[2] >= ax[0] and ax[2] >= ax[1]:
        sgn = 1 if n[2] >= 0 else -1
        for q in p:
            out.append((q[0] * sgn / tu, q[1] / tv))
    elif ax[0] >= ax[1]:
        sgn = 1 if n[0] >= 0 else -1
        for q in p:
            out.append((q[1] * sgn / tu, q[2] / tv))
    else:
        sgn = -1 if n[1] >= 0 else 1
        for q in p:
            out.append((q[0] * sgn / tu, q[2] / tv))
    return out
