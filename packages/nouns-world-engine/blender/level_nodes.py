"""Tiny node-graph helper for writing procedural, *seamlessly tileable* Blender materials.

Tileability trick: every procedural texture is evaluated in 4D on a flat (Clifford) torus
  (u, v) -> (Ru cos 2πu, Ru sin 2πu, Rv cos 2πv, Rv sin 2πv),   Ru = tu/2π, Rv = tv/2π
where (tu, tv) is the physical tile size in meters. The torus is isometric to the tile, so
noise/voronoi "Scale" is in features-per-meter and the result wraps perfectly at the tile
edges. Regular patterns (pavers, bricks, windows) are built from fract(u*n) which wraps too.
"""
import math

import bpy

TAU = math.tau


class G:
    def __init__(self, mat, tile):
        self.mat = mat
        if not mat.use_nodes:
            mat.use_nodes = True
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.N = self.nt.nodes
        self.Lk = self.nt.links
        self.tu, self.tv = tile
        tc = self.N.new("ShaderNodeTexCoord")
        sep = self.N.new("ShaderNodeSeparateXYZ")
        self.Lk.new(tc.outputs["UV"], sep.inputs[0])
        self.u = sep.outputs[0]
        self.v = sep.outputs[1]
        self._torus = {}

    # ------------------------------------------------------------------ plumbing
    def _set(self, sock, val):
        if isinstance(val, bpy.types.NodeSocket):
            self.Lk.new(val, sock)
            return
        dv = sock.default_value
        try:
            n = len(dv)
        except TypeError:
            n = 0
        if n:
            if isinstance(val, (int, float)):
                val = (val,) * min(n, 3) + (1.0,) * (n - 3) if n == 4 else (val,) * n
            else:
                val = tuple(val)[:n] + (1.0,) * (n - len(val))
        sock.default_value = val

    @staticmethod
    def _sock(socks, ident):
        for s in socks:
            if s.identifier == ident:
                return s
        for s in socks:
            if s.name == ident and s.enabled:
                return s
        raise KeyError(ident)

    def m(self, op, a, b=0.0, c=0.0, clamp=False):
        n = self.N.new("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
        self._set(n.inputs[0], a)
        self._set(n.inputs[1], b)
        self._set(n.inputs[2], c)
        return n.outputs[0]

    def add(self, a, b):
        return self.m("ADD", a, b)

    def sub(self, a, b):
        return self.m("SUBTRACT", a, b)

    def mul(self, a, b):
        return self.m("MULTIPLY", a, b)

    def mx(self, a, b):
        return self.m("MAXIMUM", a, b)

    def mn(self, a, b):
        return self.m("MINIMUM", a, b)

    def clamp01(self, a):
        return self.m("ADD", a, 0.0, clamp=True)

    def inv(self, a):
        return self.m("SUBTRACT", 1.0, a)

    def mapr(self, x, a, b, c=0.0, d=1.0, smooth=True, clamp=True):
        n = self.N.new("ShaderNodeMapRange")
        n.data_type = "FLOAT"
        n.interpolation_type = "SMOOTHSTEP" if smooth else "LINEAR"
        n.clamp = clamp
        self._set(n.inputs["Value"], x)
        self._set(n.inputs["From Min"], a)
        self._set(n.inputs["From Max"], b)
        self._set(n.inputs["To Min"], c)
        self._set(n.inputs["To Max"], d)
        return n.outputs["Result"]

    def mixc(self, fac, a, b, blend="MIX"):
        n = self.N.new("ShaderNodeMix")
        n.data_type = "RGBA"
        n.blend_type = blend
        n.clamp_result = False
        self._set(self._sock(n.inputs, "Factor_Float"), fac)
        self._set(self._sock(n.inputs, "A_Color"), a)
        self._set(self._sock(n.inputs, "B_Color"), b)
        return self._sock(n.outputs, "Result_Color")

    def mulc(self, a, f):
        """color * scalar (or color)"""
        if isinstance(f, (int, float)):
            f = (f, f, f)
        if isinstance(f, bpy.types.NodeSocket) and f.type == "VALUE":
            comb = self.N.new("ShaderNodeCombineXYZ")
            for i in range(3):
                self.Lk.new(f, comb.inputs[i])
            f = comb.outputs[0]
        return self.mixc(1.0, a, f, "MULTIPLY")

    def ramp(self, fac, stops, interp="LINEAR"):
        n = self.N.new("ShaderNodeValToRGB")
        cr = n.color_ramp
        cr.interpolation = interp
        # first two elements exist already
        while len(cr.elements) < len(stops):
            cr.elements.new(0.5)
        for el, (pos, col) in zip(cr.elements, stops):
            el.position = pos
            el.color = tuple(col) + (1.0,) if len(col) == 3 else col
        self._set(n.inputs[0], fac)
        return n.outputs[0]

    def rgb(self, col):
        n = self.N.new("ShaderNodeRGB")
        n.outputs[0].default_value = tuple(col) + (1.0,)
        return n.outputs[0]

    # ------------------------------------------------------------------ coordinates
    def torus(self, seed=0, stretch=(1.0, 1.0)):
        key = (seed, stretch)
        if key in self._torus:
            return self._torus[key]
        su, sv = stretch
        Ru = self.tu / TAU * su
        Rv = self.tv / TAU * sv
        au = self.mul(self.u, TAU)
        av = self.mul(self.v, TAU)
        x = self.mul(self.m("COSINE", au), Ru)
        y = self.mul(self.m("SINE", au), Ru)
        z = self.mul(self.m("COSINE", av), Rv)
        w = self.mul(self.m("SINE", av), Rv)
        comb = self.N.new("ShaderNodeCombineXYZ")
        # seed offsets (keep periodicity: translation of the torus)
        ox, oy, oz, ow = [((seed * k * 7.31) % 97.0) for k in (1.0, 1.7, 2.3, 3.1)]
        self.Lk.new(self.add(x, ox), comb.inputs[0])
        self.Lk.new(self.add(y, oy), comb.inputs[1])
        self.Lk.new(self.add(z, oz), comb.inputs[2])
        res = (comb.outputs[0], self.add(w, ow))
        self._torus[key] = res
        return res

    def noise(self, scale, detail=3.0, rough=0.5, seed=0, stretch=(1.0, 1.0), out="Fac", dist=0.0, lac=2.0,
              ntype="FBM"):
        vec, w = self.torus(seed, stretch)
        n = self.N.new("ShaderNodeTexNoise")
        n.noise_dimensions = "4D"
        try:
            n.noise_type = ntype
        except Exception:
            pass
        self._set(n.inputs["Vector"], vec)
        self._set(n.inputs["W"], w)
        self._set(n.inputs["Scale"], scale)
        self._set(n.inputs["Detail"], detail)
        self._set(n.inputs["Roughness"], rough)
        self._set(n.inputs["Lacunarity"], lac)
        self._set(n.inputs["Distortion"], dist)
        return n.outputs[out]

    def voronoi(self, scale, feature="F1", seed=0, out="Distance", rand=1.0, stretch=(1.0, 1.0), metric="EUCLIDEAN"):
        vec, w = self.torus(seed, stretch)
        n = self.N.new("ShaderNodeTexVoronoi")
        n.voronoi_dimensions = "4D"
        n.feature = feature
        try:
            n.distance = metric
        except Exception:
            pass
        self._set(n.inputs["Vector"], vec)
        self._set(n.inputs["W"], w)
        self._set(n.inputs["Scale"], scale)
        self._set(n.inputs["Randomness"], rand)
        return n.outputs[out]

    def white(self, a, b, seed=0.0):
        n = self.N.new("ShaderNodeTexWhiteNoise")
        n.noise_dimensions = "3D"
        comb = self.N.new("ShaderNodeCombineXYZ")
        self._set(comb.inputs[0], a)
        self._set(comb.inputs[1], b)
        self._set(comb.inputs[2], float(seed) + 0.123)
        self.Lk.new(comb.outputs[0], n.inputs["Vector"])
        return n.outputs["Value"]

    # ------------------------------------------------------------------ patterns
    def grid(self, nx, ny, row_offset=0.0, seed=0.0):
        """Rectangular tiling of the texture into nx * ny cells (wraps).

        Returns dict: d (distance to nearest seam in meters), du, dv, r (random per cell), r2,
        fu, fv (0..1 position inside cell), row (row index)
        """
        vy = self.mul(self.v, ny)
        row = self.m("FLOOR", vy)
        fv = self.m("FRACT", vy)
        ux = self.mul(self.u, nx)
        if row_offset:
            par = self.m("MODULO", row, 2.0)
            ux = self.add(ux, self.mul(par, row_offset))
        col = self.m("FLOOR", ux)
        fu = self.m("FRACT", ux)
        col = self.m("FLOORED_MODULO", col, float(nx))
        du = self.mul(self.mn(fu, self.inv(fu)), self.tu / nx)
        dv = self.mul(self.mn(fv, self.inv(fv)), self.tv / ny)
        return {
            "d": self.mn(du, dv),
            "du": du,
            "dv": dv,
            "r": self.white(col, row, seed),
            "r2": self.white(col, row, seed + 17.0),
            "fu": fu,
            "fv": fv,
            "row": row,
            "col": col,
        }

    def rect(self, x0, x1, y0, y1, soft=0.002):
        """Mask of an axis-aligned rectangle in tile meters (u*tu, v*tv)."""
        X = self.mul(self.u, self.tu)
        Y = self.mul(self.v, self.tv)
        a = self.mapr(X, x0 - soft, x0 + soft)
        b = self.mapr(X, x1 + soft, x1 - soft)
        c = self.mapr(Y, y0 - soft, y0 + soft)
        d = self.mapr(Y, y1 + soft, y1 - soft)
        return self.mul(self.mul(a, b), self.mul(c, d))

    def X(self):
        return self.mul(self.u, self.tu)

    def Y(self):
        return self.mul(self.v, self.tv)
