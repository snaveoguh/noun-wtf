"""Procedural animation toolkit: spline tracks, key-pose sequencing with
overlap, a custom FK/IK solver and an FK baker that writes per-frame keys
into Blender actions (one action per glTF animation clip).

Authoring frame ("rig frame"): (l, f, u) = (character/board left, forward =
skateboard nose = +Z in three.js, up). Blender armature space is
(x, y, z) = (l, -f, u).

Euler triples are (pitch, side, yaw) in degrees:
  pitch + : top of an upright bone tips FORWARD (for a hanging limb: swings back)
  side  + : top tips toward the character's LEFT
  yaw   + : turns toward the LEFT (counter-clockwise seen from above)
Arm controls use mirrored "side" semantics (out = away from the body) so
the same numbers give mirror poses on L and R.
"""
from __future__ import annotations

import math
from bisect import bisect_right

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

R = math.radians

# Big-head limits (Nouns proportions: a 1.1 m box head pivoting 5 cm above
# its bottom). The head's pitch/roll relative to the chest is clamped (yaw
# stays free) so its edges never sink into the shoulders, and clavicle
# shrugs are capped so the shoulders never rise into the head.
HEAD_SWING_MAX = 6.0     # degrees, None = unlimited
CLAV_UP_MAX = 3.0        # degrees, None = unlimited
# Forward (positive) pitch of hips/spine/chest is scaled down: the clips were
# keyed for a small head; a skater leaning 20-35 deg under a 1.1 m head reads
# as the head toppling. Upright torso = balanced silhouette. IK keeps the feet.
TORSO_PITCH_SCALE = 0.5


# ---------------------------------------------------------------------------
# Splines
# ---------------------------------------------------------------------------
class Track:
    """Cubic Hermite spline through keys (t, value[, flag]).

    Tangents are Catmull-Rom (non-uniform) so motion flows through keys;
    flag 'h' (hold) forces a zero tangent: the key becomes an eased
    stop - use it for anticipation extremes and settles. Non-looping
    tracks ease in/out at both ends. With `period`, the track wraps
    seamlessly (value at t == value at t + period, C1 continuous)."""

    def __init__(self, keys, period=None):
        ks = sorted(keys, key=lambda k: k[0])
        if period is not None:
            ks = [k for k in ks if k[0] < period - 1e-9]
        self.t = np.array([k[0] for k in ks], float)
        self.v = np.array([np.atleast_1d(np.asarray(k[1], float)) for k in ks])
        self.hold = [len(k) > 2 and "h" in k[2] for k in ks]
        self.lin = [len(k) > 2 and "l" in k[2] for k in ks]
        self.period = period
        self.scalar = np.ndim(ks[0][1]) == 0
        self.m = self._tangents()

    def _tangents(self):
        n = len(self.t)
        m = np.zeros_like(self.v)
        if n < 2:
            return m
        for i in range(n):
            if self.hold[i]:
                continue
            if self.period is not None:
                tp = self.t[i - 1] - (self.period if i == 0 else 0)
                vp = self.v[i - 1]
                tn = self.t[(i + 1) % n] + (self.period if i == n - 1 else 0)
                vn = self.v[(i + 1) % n]
            else:
                if i == 0 or i == n - 1:
                    continue
                tp, vp, tn, vn = self.t[i - 1], self.v[i - 1], self.t[i + 1], self.v[i + 1]
            m[i] = (vn - vp) / max(tn - tp, 1e-9)
        return m

    def __call__(self, t):
        T, V, M = self.t, self.v, self.m
        n = len(T)
        if n == 1:
            out = V[0]
        else:
            if self.period is not None:
                t = t % self.period
                if t < T[0]:
                    t += self.period
                i = bisect_right(T, t) - 1
                j = (i + 1) % n
                t0, t1 = T[i], T[j] + (self.period if j == 0 else 0)
            else:
                if t <= T[0]:
                    return self._ret(V[0])
                if t >= T[-1]:
                    return self._ret(V[-1])
                i = bisect_right(T, t) - 1
                j = i + 1
                t0, t1 = T[i], T[j]
            h = t1 - t0
            s = (t - t0) / h
            if self.lin[i]:
                out = V[i] * (1 - s) + V[j] * s
            else:
                h00 = 2 * s ** 3 - 3 * s ** 2 + 1
                h10 = s ** 3 - 2 * s ** 2 + s
                h01 = -2 * s ** 3 + 3 * s ** 2
                h11 = s ** 3 - s ** 2
                out = h00 * V[i] + h10 * h * M[i] + h01 * V[j] + h11 * h * M[j]
        return self._ret(out)

    def _ret(self, out):
        return float(out[0]) if self.scalar else tuple(float(x) for x in out)


def smoothstep(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def ease_in_out(x, p=2.0):
    x = min(1.0, max(0.0, x))
    return x ** p / (x ** p + (1 - x) ** p)


def lerp(a, b, t):
    if isinstance(a, (tuple, list)):
        return tuple(x + (y - x) * t for x, y in zip(a, b))
    return a + (b - a) * t


def vadd(a, b, k=1.0):
    return tuple(x + y * k for x, y in zip(a, b))


# ---------------------------------------------------------------------------
# Controls
# ---------------------------------------------------------------------------
def default_controls():
    c = {
        "hips.pos": (0.0, 0.0, 0.0), "hips.rot": (0.0, 0.0, 0.0),
        "spine.rot": (0.0, 0.0, 0.0), "chest.rot": (0.0, 0.0, 0.0),
        "neck.rot": (0.0, 0.0, 0.0), "head.rot": (0.0, 0.0, 0.0),
        "head.aim": 0.0, "head.world": (0.0, 0.0, 0.0),
        "board.pos": (0.0, 0.0, 0.0), "board.rot": (0.0, 0.0, 0.0),
        "head.swing_max": HEAD_SWING_MAX if HEAD_SWING_MAX is not None else 180.0,
    }
    for s, sx in (("L", 1), ("R", -1)):
        c.update({
            f"arm.{s}.clav": (0.0, 0.0), f"arm.{s}.dir": (0.0, 0.0, -1.0), f"arm.{s}.twist": 0.0,
            f"arm.{s}.elbow": 0.0, f"arm.{s}.wrist": (0.0, 0.0, 0.0), f"arm.{s}.ik": 0.0,
            f"arm.{s}.target": (0.27 * sx, 0.0, 0.585), f"arm.{s}.pole": (0.3, -1.0, 0.0),
            f"leg.{s}.pos": (0.09 * sx, 0.0, 0.085), f"leg.{s}.rot": (0.0, 0.0, 0.0),
            f"leg.{s}.toe": 0.0, f"leg.{s}.pole": (0.12 * sx, 1.0, 0.0),
        })
    return c


def mirror_controls(c):
    """Swap L/R of a control dict (for mirrored poses)."""
    out = dict(c)
    for k, v in c.items():
        if ".L." in k or ".R." in k:
            other = k.replace(".L.", ".X.").replace(".R.", ".L.").replace(".X.", ".R.")
            if k.startswith("leg.") and k.endswith((".pos", ".pole")):
                v = (-v[0], v[1], v[2])
            elif k.startswith("leg.") and k.endswith(".rot"):
                v = (v[0], -v[1], -v[2])
            elif k.startswith("arm.") and k.endswith(".target"):
                v = (-v[0], v[1], v[2])
            out[other] = v
        elif k.endswith(".rot"):
            out[k] = (v[0], -v[1], -v[2])
        elif k.endswith(".pos"):
            out[k] = (-v[0], v[1], v[2])
    return out


class PoseSeq:
    """Key-pose animation: [(t, {control: value}, flags), ...].

    Every control mentioned in any pose gets its own Track; poses that do
    not mention a control inherit the value from the previous pose (or the
    base). `lag` maps control-name prefixes to a time delay (seconds) so
    e.g. arms/head trail the body (overlapping action / follow-through)."""

    def __init__(self, keys, base=None, period=None, lag=None):
        base = dict(base or {})
        names = set()
        for k in keys:
            names |= set(k[1].keys())
        self.tracks = {}
        self.period = period
        self.lag = lag or {}
        self.t0 = keys[0][0]
        self.t1 = keys[-1][0]
        for name in names:
            cur = base.get(name, keys[0][1].get(name))
            if cur is None:
                cur = next(k[1][name] for k in keys if name in k[1])
            ks = []
            for k in keys:
                flags = k[2] if len(k) > 2 else ""
                if name in k[1]:
                    cur = k[1][name]
                ks.append((k[0], cur, flags))
            self.tracks[name] = Track(ks, period=period)

    def _lag(self, name):
        best, d = 0.0, -1
        for pre, val in self.lag.items():
            if name.startswith(pre) and len(pre) > d:
                best, d = val, len(pre)
        return best

    def __call__(self, t):
        out = {}
        for name, tr in self.tracks.items():
            tt = t - self._lag(name)
            if self.period is None:
                tt = max(self.t0, tt)
            out[name] = tr(tt)
        return out


# ---------------------------------------------------------------------------
# Solver
# ---------------------------------------------------------------------------
def rig2bl(v):
    return Vector((v[0], -v[1], v[2]))


def q_eul(e):
    p, s, y = e
    return Quaternion((0, 0, 1), R(y)) @ Quaternion((0, 1, 0), R(s)) @ Quaternion((1, 0, 0), R(p))


def mirror_q(q):
    return Quaternion((q.w, q.x, -q.y, -q.z))


def frame_rot(y_rest, f_rest, y_new, f_new):
    a = Matrix((y_rest, f_rest, y_rest.cross(f_rest))).transposed()
    b = Matrix((y_new, f_new, y_new.cross(f_new))).transposed()
    return (b @ a.transposed()).to_quaternion()


def two_bone(H, A, l1, l2, pole):
    dv = A - H
    d = dv.length
    u = dv.normalized() if d > 1e-6 else Vector((0, 0, -1))
    d = min(max(d, abs(l1 - l2) + 1e-4), (l1 + l2) * 0.9999)
    n = pole - u * pole.dot(u)
    if n.length < 1e-6:
        n = u.orthogonal()
    n.normalize()
    ca = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
    a = math.acos(min(1.0, max(-1.0, ca)))
    K = H + (u * math.cos(a) + n * math.sin(a)) * l1
    E = H + u * d
    s1 = (K - H).normalized()
    s2 = (E - K).normalized()
    m = u.cross(n)
    return s1, m.cross(s1).normalized(), s2, m.cross(s2).normalized()


class RigSolver:
    def __init__(self, arm_obj, bone_names):
        self.arm = arm_obj
        bones = arm_obj.data.bones
        self.names = bone_names
        self.parent = {b: (bones[b].parent.name if bones[b].parent else None) for b in bone_names}
        self.M = {b: bones[b].matrix_local.copy() for b in bone_names}
        self.Minv = {b: m.inverted() for b, m in self.M.items()}
        self.Rr = {b: self.M[b].to_quaternion() for b in bone_names}
        self.head = {b: bones[b].head_local.copy() for b in bone_names}
        self.length = {b: bones[b].length for b in bone_names}
        self.rel_inv = {}
        for b in bone_names:
            p = self.parent[b]
            self.rel_inv[b] = (self.Minv[p] @ self.M[b]).inverted() if p else self.Minv[b]

    # -- helpers ----------------------------------------------------------
    def _place(self, W, b, rot, head):
        W[b] = Matrix.Translation(head) @ rot.to_matrix().to_4x4()

    def _carried(self, W, b):
        p = self.parent[b]
        return W[p] @ (self.Minv[p] @ self.head[b])

    def _delta(self, W, b):
        return W[b].to_quaternion() @ self.Rr[b].inverted()

    def _fk(self, W, b, D):
        p = self.parent[b]
        self._place(W, b, self._delta(W, p) @ D @ self.Rr[b], self._carried(W, b))

    # -- main ---------------------------------------------------------------
    def solve(self, c):
        W = {}
        W["root"] = self.M["root"].copy()
        # board
        self._place(W, "board", q_eul(c["board.rot"]) @ self.Rr["board"],
                    self.head["board"] + rig2bl(c["board.pos"]))
        board_d = W["board"] @ self.Minv["board"]
        board_q = board_d.to_quaternion()
        # torso chain
        self._place(W, "hips", q_eul(c["hips.rot"]) @ self.Rr["hips"], self.head["hips"] + rig2bl(c["hips.pos"]))
        for b in ("spine", "chest", "neck", "head"):
            self._fk(W, b, q_eul(c[f"{b}.rot"]))
        aim = c.get("head.aim", 0.0)
        if aim > 1e-4:
            # gaze stabilisation: blend toward an absolute rig-space head orientation
            # (head.world = pitch, side, yaw), with head.rot still applied on top.
            fk_rot = W["head"].to_quaternion()
            tgt = q_eul(c["head.world"]) @ q_eul(c["head.rot"]) @ self.Rr["head"]
            self._place(W, "head", fk_rot.slerp(tgt, min(1.0, aim)), W["head"].translation.copy())
        chest_d = self._delta(W, "chest")
        if HEAD_SWING_MAX is not None and c.get("head.swing_max", HEAD_SWING_MAX) < 179.0:
            rel = chest_d.inverted() @ self._delta(W, "head")
            tw = Quaternion((rel.w, 0.0, 0.0, rel.z))
            tw = tw.normalized() if tw.magnitude > 1e-9 else Quaternion()
            sw = rel @ tw.inverted()
            if sw.w < 0:
                sw = -sw
            ang = 2.0 * math.acos(min(1.0, sw.w))
            lim = R(c.get("head.swing_max", HEAD_SWING_MAX))
            if ang > lim:
                sw = Quaternion(sw.axis, lim)
                self._place(W, "head", chest_d @ sw @ tw @ self.Rr["head"], W["head"].translation.copy())
        hips_d = self._delta(W, "hips")
        for s in ("L", "R"):
            mir = (lambda q: q) if s == "L" else mirror_q
            sx = 1 if s == "L" else -1
            # clavicle
            up, fwd = c[f"arm.{s}.clav"]
            if CLAV_UP_MAX is not None:
                up = min(up, CLAV_UP_MAX)
            self._fk(W, f"shoulder.{s}", mir(Quaternion((0, 0, 1), R(-fwd)) @ Quaternion((0, 1, 0), R(-up))))
            # FK arm
            o, f, u = c[f"arm.{s}.dir"]
            dvec = Vector((o, -f, u))
            # Directions are interpolated component-wise; when a swing passes
            # "through" the shoulder (|d| shrinks) bias it downward so the arm
            # swings like a pendulum instead of flipping out sideways.
            if dvec.length < 0.9:
                dvec.z -= (0.9 - dvec.length) * 1.5
            if dvec.length < 1e-6:
                dvec = Vector((0, 0, -1))
            dvec.normalize()
            swing = Vector((1, 0, 0)).rotation_difference(dvec)
            q = Quaternion(dvec, R(c[f"arm.{s}.twist"])) @ swing @ Quaternion((0, 1, 0), R(-90))
            ua, fa = f"upperarm.{s}", f"forearm.{s}"
            ua_rot_fk = chest_d @ mir(q) @ self.Rr[ua]
            S = self._carried(W, ua)
            ik = c[f"arm.{s}.ik"]
            if ik > 1e-4:
                po = c[f"arm.{s}.pole"]
                pole = chest_d @ Vector((po[0] * sx, -po[1], po[2]))
                T = rig2bl(c[f"arm.{s}.target"])
                s1, f1, s2, f2 = two_bone(S, T, self.length[ua], self.length[fa], pole)
                yr, frest = Vector((0, 0, -1)), Vector((0, 1, 0))
                ua_ik = frame_rot(yr, frest, s1, f1) @ self.Rr[ua]
                fa_ik = frame_rot(yr, frest, s2, f2) @ self.Rr[fa]
                self._place(W, ua, ua_rot_fk.slerp(ua_ik, ik), S)
                # forearm FK in the blended upper-arm frame
                fa_fk = self._delta(W, ua) @ Quaternion((1, 0, 0), R(-c[f"arm.{s}.elbow"])) @ self.Rr[fa]
                fa_rot = fa_fk.slerp(fa_ik, ik)
                self._place(W, fa, fa_rot, self._carried(W, fa))
            else:
                self._place(W, ua, ua_rot_fk, S)
                self._fk(W, fa, Quaternion((1, 0, 0), R(-c[f"arm.{s}.elbow"])))
            self._fk(W, f"hand.{s}", mir(q_eul(c[f"arm.{s}.wrist"])))
            # leg IK
            th, sh, ft, to = f"thigh.{s}", f"shin.{s}", f"foot.{s}", f"toe.{s}"
            H = self._carried(W, th)
            A = board_d @ rig2bl(c[f"leg.{s}.pos"])
            pl = c[f"leg.{s}.pole"]
            pole = hips_d @ rig2bl(pl)
            s1, f1, s2, f2 = two_bone(H, A, self.length[th], self.length[sh], pole)
            yr, frest = Vector((0, 0, -1)), Vector((0, -1, 0))
            self._place(W, th, frame_rot(yr, frest, s1, f1) @ self.Rr[th], H)
            self._place(W, sh, frame_rot(yr, frest, s2, f2) @ self.Rr[sh], self._carried(W, sh))
            self._place(W, ft, board_q @ q_eul(c[f"leg.{s}.rot"]) @ self.Rr[ft], self._carried(W, ft))
            self._fk(W, to, Quaternion((1, 0, 0), R(-c[f"leg.{s}.toe"])))
        # world -> basis
        basis = {}
        for b in self.names:
            p = self.parent[b]
            B = self.rel_inv[b] @ (W[p].inverted() @ W[b] if p else W[b])
            loc, rot, _ = B.decompose()
            basis[b] = (loc, rot)
        return basis, W


# ---------------------------------------------------------------------------
# Baking
# ---------------------------------------------------------------------------
LOC_BONES = ("hips", "board")


class Clip:
    def __init__(self, name, duration, fn, loop, meta=None):
        self.name, self.duration, self.fn, self.loop = name, duration, fn, loop
        self.meta = meta or {}

    @property
    def frames(self):
        return int(round(self.duration * 30))


def eval_controls(clip, t):
    c = default_controls()
    c.update(clip.fn(t))
    if TORSO_PITCH_SCALE != 1.0:
        for k in ("hips.rot", "spine.rot", "chest.rot"):
            p, sd, y = c[k]
            if p > 0:
                c[k] = (p * TORSO_PITCH_SCALE, sd, y)
    return c


def bake(solver: RigSolver, clip: Clip, fps=30):
    arm = solver.arm
    n = clip.frames
    samples = []
    for i in range(n + 1):
        t = i / fps
        if clip.loop and i == n:
            t = 0.0  # exact seamless loop: last frame == first frame
        basis, _ = solver.solve(eval_controls(clip, t))
        samples.append(basis)
    act = bpy.data.actions.new(clip.name)
    act.use_fake_user = True
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = act
    for b in solver.names:
        if b == "root":
            continue
        qs = [samples[i][b][1] for i in range(n + 1)]
        for i in range(1, len(qs)):
            if qs[i].dot(qs[i - 1]) < 0:
                qs[i] = -qs[i]
        paths = [("rotation_quaternion", 4, [[q[k] for q in qs] for k in range(4)])]
        if b in LOC_BONES:
            ls = [samples[i][b][0] for i in range(n + 1)]
            paths.append(("location", 3, [[v[k] for v in ls] for k in range(3)]))
        for prop, count, chans in paths:
            dp = f'pose.bones["{b}"].{prop}'
            for k in range(count):
                fc = act.fcurve_ensure_for_datablock(arm, dp, index=k, group_name=b)
                fc.keyframe_points.add(n + 1)
                co = np.empty(2 * (n + 1), np.float32)
                co[0::2] = np.arange(n + 1)
                co[1::2] = chans[k]
                fc.keyframe_points.foreach_set("co", co)
                fc.keyframe_points.foreach_set("interpolation", [1] * (n + 1))  # LINEAR (baked)
                fc.update()
    act.use_frame_range = True
    act.frame_start, act.frame_end = 0, n
    act.use_cyclic = clip.loop
    return act
