"""On-foot animation clips (idle, locomotion, jumps, emotes, combat)."""
from __future__ import annotations

import math

from mathutils import Vector

from posekit import Clip, PoseSeq, Track, q_eul, rig2bl, smoothstep, lerp, vadd

TAU = 2 * math.pi
ANKLE_H = 0.085          # ankle height above the sole bottom
HEEL_OFF = (0.0, -0.075, -ANKLE_H)  # rig-frame offset ankle -> heel bottom
BALL_OFF = (0.0, 0.10, -ANKLE_H)    # ankle -> ball of foot (sole bottom)


def S(x):
    return math.sin(TAU * x)


def Cc(x):
    return math.cos(TAU * x)


# ---------------------------------------------------------------------------
# Base poses
# ---------------------------------------------------------------------------
def arms(dir_l, dir_r=None, elbow=(10, 10), clav=((0, 0), (0, 0)), wrist=((0, 0, 0), (0, 0, 0))):
    dir_r = dir_r or dir_l
    return {"arm.L.dir": dir_l, "arm.R.dir": dir_r, "arm.L.elbow": elbow[0], "arm.R.elbow": elbow[1],
            "arm.L.clav": clav[0], "arm.R.clav": clav[1], "arm.L.wrist": wrist[0], "arm.R.wrist": wrist[1]}


STAND = {
    "hips.pos": (0.0, 0.0, -0.012), "hips.rot": (1.0, 0.0, 0.0),
    "spine.rot": (1.5, 0.0, 0.0), "chest.rot": (-1.5, 0.0, 0.0), "neck.rot": (1.0, 0, 0), "head.rot": (-1.5, 0, 0),
    "head.swing_max": 6.0,
    "leg.L.pos": (0.10, 0.0, ANKLE_H), "leg.R.pos": (-0.10, 0.0, ANKLE_H),
    "leg.L.rot": (0.0, 0.0, 7.0), "leg.R.rot": (0.0, 0.0, -7.0),
    "leg.L.pole": (0.15, 1.0, 0.0), "leg.R.pole": (-0.15, 1.0, 0.0),
    **arms((0.13, 0.03, -1.0), elbow=(12, 12), wrist=((6, 0, -4), (6, 0, -4))),
}


def pose(**over):
    out = dict(STAND)
    for k, v in over.items():
        out[k.replace("__", ".").replace("_L_", ".L.").replace("_R_", ".R.")] = v
    return out


def P(base=None, **kw):
    """Pose dict from a base with dotted keys given as a dict-friendly kwargs."""
    out = dict(base or {})
    out.update(kw)
    return out


def look_total(c, yaw_total, pitch_total=None, aim=1.0):
    """Gaze stabilisation: aim the head at an absolute rig-space yaw/pitch
    (the solver blends the head's world rotation toward it by `aim`).
    head.rot is then a small additive offset in the head's own frame."""
    c["head.aim"] = aim
    c["head.world"] = (pitch_total if pitch_total is not None else 0.0, 0.0, yaw_total)
    return c


def plant(f, l, yaw, pitch, ground=0.0):
    """Ankle target so the heel (pitch<0) or ball (pitch>0) touches `ground`."""
    off = HEEL_OFF if pitch < 0 else BALL_OFF
    q = q_eul((pitch, 0.0, yaw))
    o_rest = rig2bl(off)
    o_rot = q @ o_rest
    # contact point keeps the rest-pose horizontal position of that point
    contact = rig2bl((l, f, 0.0)) + Vector((q_eul((0, 0, yaw)) @ o_rest).xy.to_3d())
    contact.z = ground
    ank = contact - o_rot
    return (ank.x, -ank.y, ank.z)


# ---------------------------------------------------------------------------
# Locomotion
# ---------------------------------------------------------------------------
GAITS = {
    "walk": dict(T=1.0, stance=0.60, land=0.22, off=-0.24, lift=0.075, h=-0.035, bob=0.013, bob_ph=0.30,
                 sway=0.016, roll=4.0, hyaw=7.0, cyaw=9.0, lean=3.0, arm=22.0, arm_bias=3.0, out=0.12,
                 elbow=14.0, elbow_amp=16.0, strike=14.0, toeoff=28.0, kick=0.0, knee_drive=0.0, toe_out=6.0,
                 width=0.095, head_bob=2.0),
    "run": dict(T=0.66, stance=0.36, land=0.16, off=-0.30, lift=0.13, h=-0.07, bob=0.022, bob_ph=0.46,
                sway=0.008, roll=3.5, hyaw=10.0, cyaw=15.0, lean=11.0, arm=36.0, arm_bias=10.0, out=0.16,
                elbow=82.0, elbow_amp=14.0, strike=5.0, toeoff=40.0, kick=0.17, knee_drive=0.08, toe_out=4.0,
                width=0.085, head_bob=3.0),
    "sprint": dict(T=0.54, stance=0.30, land=0.18, off=-0.34, lift=0.16, h=-0.09, bob=0.026, bob_ph=0.46,
                   sway=0.006, roll=3.0, hyaw=12.0, cyaw=18.0, lean=19.0, arm=52.0, arm_bias=14.0, out=0.14,
                   elbow=92.0, elbow_amp=12.0, strike=2.0, toeoff=45.0, kick=0.22, knee_drive=0.12, toe_out=3.0,
                   width=0.08, head_bob=3.0),
}


def gait_speed(name):
    g = GAITS[name]
    return (g["land"] - g["off"]) / (g["stance"] * g["T"])


def _foot(p, g, sx):
    s = g["stance"]
    yaw = g["toe_out"] * sx
    l = g["width"] * sx
    if p < s:
        q = p / s
        f = g["land"] + (g["off"] - g["land"]) * q
        pitch = -g["strike"] * (1 - smoothstep(q / 0.18))
        if q > 0.55:
            pitch += g["toeoff"] * ((q - 0.55) / 0.45) ** 2
        pos = plant(f, l, yaw, pitch)
        toe = max(0.0, pitch)
        return pos, (pitch, 0.0, yaw), toe
    q = (p - s) / (1 - s)
    sw = (1 - s) * g["T"]   # swing duration (s)
    v = (g["land"] - g["off"]) / (s * g["T"])  # treadmill speed
    off_pos = plant(g["off"], l, yaw, g["toeoff"])
    land_pos = plant(g["land"], l, yaw, -g["strike"])
    kick, drive = g["kick"], g["knee_drive"]
    f_tr = Track([(0.0, off_pos[1]), (0.06, off_pos[1] - v * sw * 0.05),
                  (0.32, off_pos[1] - kick * 0.35 + 0.02), (0.68, g["land"] + 0.02 + drive * 0.3),
                  (0.93, land_pos[1] + v * sw * 0.025), (1.0, land_pos[1])])
    up0 = off_pos[2]
    u_tr = Track([(0.0, up0), (0.3, ANKLE_H + g["lift"] + kick), (0.62, ANKLE_H + g["lift"] * 0.75 + drive),
                  (0.9, land_pos[2] + 0.012), (1.0, land_pos[2])])
    p_tr = Track([(0.0, g["toeoff"]), (0.3, g["toeoff"] * 0.5 + kick * 60), (0.7, -5.0), (1.0, -g["strike"])])
    pitch = p_tr(q)
    toe = max(0.0, g["toeoff"] * (1 - smoothstep(q / 0.3)))
    return (l, f_tr(q), u_tr(q)), (pitch, 0.0, yaw), toe


def gait(name):
    g = GAITS[name]
    T = g["T"]

    def fn(t):
        ph = (t / T) % 1.0
        c = dict(STAND)
        for side, sx, off in (("L", 1, 0.0), ("R", -1, 0.5)):
            pos, rot, toe = _foot((ph + off) % 1.0, g, sx)
            c[f"leg.{side}.pos"], c[f"leg.{side}.rot"], c[f"leg.{side}.toe"] = pos, rot, toe
            c[f"leg.{side}.pole"] = (0.12 * sx, 1.0, 0.0)
        bob = g["bob"] * Cc(2 * (ph - g["bob_ph"]))
        c["hips.pos"] = (g["sway"] * S(ph - 0.05), 0.0, g["h"] + bob)
        hy = -g["hyaw"] * Cc(ph)
        c["hips.rot"] = (g["lean"] * 0.35 + 1.5 * Cc(2 * (ph - 0.1)), -g["roll"] * S(ph - 0.05), hy)
        cy = g["cyaw"] * Cc(ph - 0.03)
        c["spine.rot"] = (g["lean"] * 0.35, g["roll"] * 0.5 * S(ph - 0.08), cy * 0.45 - hy * 0.2)
        c["chest.rot"] = (g["lean"] * 0.3 - 1.0 * Cc(2 * (ph - 0.15)), g["roll"] * 0.3 * S(ph - 0.1), cy * 0.55)
        c["neck.rot"] = (-g["lean"] * 0.3, 0.0, 0.0)
        c["head.rot"] = (0.0, -g["roll"] * 0.3 * S(ph - 0.12), 0.0)
        look_total(c, 0.0, pitch_total=g["head_bob"] * Cc(2 * (ph - g["bob_ph"] - 0.06)) - 2.0)
        for side, ss in (("L", 1), ("R", -1)):
            lag = 0.04
            sw = -Cc(ph - lag) * ss  # +1 = this arm forward
            ang = g["arm_bias"] + g["arm"] * sw
            out = g["out"] - 0.06 * max(0.0, sw) * (g["elbow"] / 90)
            c[f"arm.{side}.dir"] = (out, math.sin(math.radians(ang)), -math.cos(math.radians(ang)))
            el_sw = -Cc(ph - lag - 0.06) * ss
            c[f"arm.{side}.elbow"] = g["elbow"] + g["elbow_amp"] * (0.5 + 0.5 * el_sw)
            c[f"arm.{side}.clav"] = (1.0 + 1.5 * Cc(2 * (ph - 0.3)), 5.0 * sw)
            c[f"arm.{side}.twist"] = -8.0 * (g["elbow"] / 90)
            c[f"arm.{side}.wrist"] = (6.0 - 8.0 * -Cc(ph - lag - 0.12) * ss, 0.0, -4.0)
        return c

    return Clip(name, T, fn, True, {"speed": round(gait_speed(name), 3)})


# ---------------------------------------------------------------------------
# Idles
# ---------------------------------------------------------------------------
def idle():
    T = 4.0

    def fn(t):
        x = t / T
        c = dict(STAND)
        br = S(x * 2 - 0.1)       # 2 breaths per loop
        shift = S(x)              # weight shift once per loop
        c["hips.pos"] = (0.014 * shift, 0.0, -0.012 - 0.004 * (1 - abs(shift)) + 0.002 * br)
        c["hips.rot"] = (1.0, -2.2 * shift, 1.5 * S(x + 0.1))
        c["spine.rot"] = (1.5 - 0.6 * br, 1.2 * shift, -1.0 * S(x + 0.15))
        c["chest.rot"] = (-1.5 - 1.4 * br, 0.6 * shift, -0.6 * S(x + 0.2))
        c["neck.rot"] = (1.0 + 0.6 * br, 0.0, 0.0)
        c["head.rot"] = (-1.5 + 1.2 * S(x * 3 + 0.2), -1.2 * shift, 4.0 * S(x + 0.35) + 2.0 * S(x * 2 + 0.6))
        # weight leg straighter, free leg relaxes
        c["leg.L.pos"] = (0.10, 0.0, ANKLE_H)
        c["leg.R.pos"] = (-0.10, 0.0, ANKLE_H)
        for side, ss in (("L", 1), ("R", -1)):
            c[f"arm.{side}.dir"] = (0.13 + 0.012 * br + 0.01 * shift * ss, 0.03 + 0.015 * S(x + 0.25 * ss), -1.0)
            c[f"arm.{side}.elbow"] = 12 + 2.5 * S(x * 2 + 0.05 + 0.2 * ss)
            c[f"arm.{side}.clav"] = (1.2 * br + 0.8, 0.0)
            c[f"arm.{side}.wrist"] = (6 + 3 * S(x * 2 + 0.1), 0.0, -4.0)
        return c

    return Clip("idle", T, fn, True)


def idle_look():
    T = 5.0
    base = dict(STAND)
    look_l = P(base, **{"hips.rot": (1.0, -1.5, 3.0), "spine.rot": (1.5, 0.5, 4.0), "chest.rot": (-2.0, 0.5, 8.0),
                        "neck.rot": (1.0, 0, 12.0), "head.rot": (-3.0, 3.0, 26.0),
                        "hips.pos": (0.012, 0.0, -0.014)})
    look_r = P(base, **{"hips.rot": (1.0, 2.0, -4.0), "spine.rot": (1.5, -0.5, -5.0),
                        "chest.rot": (-1.0, -0.5, -9.0), "neck.rot": (2.0, 0, -12.0), "head.rot": (2.0, -2.0, -28.0),
                        "hips.pos": (-0.014, 0.0, -0.014), "leg.L.pos": (0.105, 0.01, ANKLE_H)})
    look_up = P(base, **{"head.rot": (-12.0, 2.0, 6.0), "neck.rot": (-4.0, 0, 2.0), "chest.rot": (-3.5, 0, 0)})
    seq = PoseSeq([
        (0.0, base), (0.55, base, "h"),
        (0.95, look_l), (1.75, P(look_l, **{"head.rot": (-2.0, 3.5, 30.0)}), "h"),
        (2.25, look_up), (2.6, P(look_up, **{"head.rot": (-11.0, -1.0, -4.0)}), "h"),
        (3.0, look_r), (3.9, P(look_r, **{"head.rot": (3.0, -2.5, -24.0)}), "h"),
        (4.5, base),
    ], period=T, lag={"head": 0.0, "neck": 0.03, "chest": 0.07, "spine": 0.1, "hips": 0.14, "arm": 0.12})

    def fn(t):
        c = seq(t)
        x = t / T
        br = S(x * 2.5)
        c["chest.rot"] = vadd(c["chest.rot"], (-1.2 * br, 0, 0))
        for side, ss in (("L", 1), ("R", -1)):
            c[f"arm.{side}.dir"] = (0.13 + 0.01 * br, 0.03 + 0.01 * S(x * 2 + 0.25 * ss), -1.0)
            c[f"arm.{side}.clav"] = (0.8 + 1.0 * br, 0.0)
            c[f"arm.{side}.elbow"] = 12 + 2 * S(x * 2 + 0.2 * ss)
        return c

    return Clip("idle_look", T, fn, True)


# ---------------------------------------------------------------------------
# Jumping
# ---------------------------------------------------------------------------
CROUCH = P(STAND, **{
    "hips.pos": (0.0, -0.04, -0.15), "hips.rot": (14.0, 0, 0), "spine.rot": (12.0, 0, 0), "chest.rot": (6.0, 0, 0),
    "neck.rot": (-8.0, 0, 0), "head.rot": (-12.0, 0, 0),
    **arms((0.2, -0.75, -0.6), elbow=(25, 25), clav=((-2, -4), (-2, -4)), wrist=((-10, 0, 0), (-10, 0, 0))),
    "leg.L.pole": (0.25, 1.0, 0.0), "leg.R.pole": (-0.25, 1.0, 0.0),
})
PUSH_OFF = P(STAND, **{
    "hips.pos": (0.0, 0.02, 0.025), "hips.rot": (4.0, 0, 0), "spine.rot": (-2.0, 0, 0), "chest.rot": (-6.0, 0, 0),
    "neck.rot": (-2.0, 0, 0), "head.rot": (-6.0, 0, 0),
    **arms((0.55, 0.85, 0.05), elbow=(25, 25), clav=((3, 6), (3, 6)), wrist=((10, 0, 0), (10, 0, 0))),
    "leg.L.pos": (0.10, 0.06, 0.13), "leg.R.pos": (-0.10, 0.06, 0.13),
    "leg.L.rot": (42.0, 0, 7), "leg.R.rot": (42.0, 0, -7), "leg.L.toe": 40.0, "leg.R.toe": 40.0,
})
AIR = P(STAND, **{
    "hips.pos": (0.0, 0.0, 0.0), "hips.rot": (6.0, 0, 0), "spine.rot": (4.0, 0, 0), "chest.rot": (-4.0, 0, 0),
    "neck.rot": (0.0, 0, 0), "head.rot": (-6.0, 0, 0),
    **arms((0.75, 0.35, -0.05), elbow=(35, 35), clav=((3, 2), (3, 2)), wrist=((0, 0, 0), (0, 0, 0))),
    "leg.L.pos": (0.11, 0.08, 0.27), "leg.R.pos": (-0.10, -0.06, 0.20),
    "leg.L.rot": (-10.0, 0, 8), "leg.R.rot": (20.0, 0, -8),
    "leg.L.pole": (0.2, 1.0, 0.3), "leg.R.pole": (-0.2, 1.0, 0.2),
})


def jump_start():
    seq = PoseSeq([(0.0, STAND), (0.11, CROUCH, "h"), (0.25, PUSH_OFF)],
                  lag={"arm": 0.02, "head": 0.03})
    return Clip("jump_start", 0.25, seq, False)


def jump_air():
    T = 0.8

    def fn(t):
        x = t / T
        c = dict(AIR)
        c["leg.L.pos"] = (0.11, 0.07 + 0.03 * S(x), 0.26 + 0.025 * Cc(x))
        c["leg.R.pos"] = (-0.10, -0.05 - 0.03 * S(x), 0.20 - 0.025 * Cc(x))
        c["leg.L.rot"] = (-10 + 8 * S(x + 0.1), 0, 8)
        c["leg.R.rot"] = (20 - 8 * S(x + 0.1), 0, -8)
        c["hips.pos"] = (0.0, 0.0, 0.005 * S(x * 2))
        c["chest.rot"] = (-4.0 + 1.5 * S(x + 0.2), 1.5 * S(x + 0.3), 0)
        for side, ss in (("L", 1), ("R", -1)):
            c[f"arm.{side}.dir"] = (0.75 + 0.08 * S(x + 0.25 * ss), 0.35 + 0.12 * S(x + 0.1 + 0.5 * (ss < 0)),
                                    -0.05 + 0.08 * Cc(x + 0.5 * (ss < 0)))
            c[f"arm.{side}.elbow"] = 35 + 10 * S(x + 0.3 * ss)
            c[f"arm.{side}.wrist"] = (10 * S(x + 0.4 * ss), 0, 0)
        return c

    return Clip("jump_air", T, fn, True)


def fall():
    T = 0.8

    def fn(t):
        x = t / T
        c = dict(AIR)
        c["hips.rot"] = (-6.0 + 2 * S(x), 2.0 * S(x + 0.2), 0)
        c["spine.rot"] = (-6.0, 1.5 * S(x + 0.3), 2.0 * S(x))
        c["chest.rot"] = (-8.0, 2.0 * S(x + 0.4), 2.5 * S(x + 0.1))
        c["head.rot"] = (8.0, -2.0 * S(x + 0.5), -3 * S(x + 0.2))
        for side, ss, ph in (("L", 1, 0.0), ("R", -1, 0.5)):
            a = TAU * (x + ph)
            # windmilling arms high above the shoulders
            c[f"arm.{side}.dir"] = (1.0, 0.45 * math.sin(a), -0.1 + 0.12 * math.cos(a))
            c[f"arm.{side}.elbow"] = 20 + 15 * math.sin(a + 1.0)
            c[f"arm.{side}.clav"] = (9 + 4 * math.cos(a), 0)
            c[f"arm.{side}.wrist"] = (20 * math.sin(a + 1.6), 0, 0)
            # bicycling legs
            c[f"leg.{side}.pos"] = (0.10 * ss, 0.07 * math.sin(a + 0.6), 0.16 + 0.07 * math.cos(a + 0.6))
            c[f"leg.{side}.rot"] = (15 * math.sin(a), 0, 6 * ss)
            c[f"leg.{side}.pole"] = (0.15 * ss, 1.0, 0.2)
        return c

    return Clip("fall", T, fn, True)


LAND_DEEP = P(STAND, **{
    "hips.pos": (0.0, -0.05, -0.19), "hips.rot": (20.0, 0, 0), "spine.rot": (12.0, 0, 0), "chest.rot": (8.0, 0, 0),
    "neck.rot": (-10.0, 0, 0), "head.rot": (-14.0, 0, 0),
    **arms((0.45, 0.45, -0.75), elbow=(40, 40), clav=((-4, 6), (-4, 6)), wrist=((-20, 0, 0), (-20, 0, 0))),
    "leg.L.pos": (0.11, 0.0, ANKLE_H), "leg.R.pos": (-0.11, 0.0, ANKLE_H),
    "leg.L.pole": (0.3, 1.0, 0.0), "leg.R.pole": (-0.3, 1.0, 0.0),
})


def land():
    touch = P(AIR, **{"leg.L.pos": (0.11, 0.02, ANKLE_H + 0.01), "leg.R.pos": (-0.11, -0.01, ANKLE_H + 0.01),
                      "leg.L.rot": (-8, 0, 7), "leg.R.rot": (-8, 0, -7), "hips.pos": (0, 0, -0.04)})
    seq = PoseSeq([(0.0, touch), (0.09, LAND_DEEP, "h"),
                   (0.22, P(STAND, **{"hips.pos": (0, -0.01, -0.05), "spine.rot": (5, 0, 0)})), (0.35, STAND, "h")],
                  lag={"arm": 0.03, "head": 0.04, "chest": 0.02})
    return Clip("land", 0.35, seq, False)


# ---------------------------------------------------------------------------
# Emotes
# ---------------------------------------------------------------------------
def wave():
    T = 2.0
    up = P(STAND, **{
        "hips.pos": (-0.012, 0.0, -0.012), "hips.rot": (1, 2.0, 3.0), "spine.rot": (0, -2.0, 2.0),
        "chest.rot": (-3.0, -3.0, 4.0), "head.rot": (-4.0, 6.0, 4.0),
        "arm.R.dir": (1.0, 0.45, -0.05), "arm.R.elbow": 30.0, "arm.R.clav": (2.0, 6.0), "arm.R.twist": -85.0,
        "arm.R.wrist": (0.0, -10.0, 0.0),
        "arm.L.dir": (0.14, 0.04, -1.0), "arm.L.elbow": 14.0,
    })

    def w(a):
        return P(up, **{"arm.R.wrist": (0.0, a, 0.0), "arm.R.elbow": 30.0 + a * 0.5,
                        "arm.R.dir": (1.0, 0.45 + a * 0.006, -0.05)})

    seq = PoseSeq([
        (0.0, STAND), (0.12, P(STAND, **{"arm.R.dir": (0.25, -0.1, -0.9), "arm.R.elbow": 20.0}), ""),
        (0.38, up), (0.55, w(30)), (0.75, w(-25)), (0.95, w(30)), (1.15, w(-25)), (1.35, w(20), ""),
        (1.6, P(STAND, **{"arm.R.dir": (0.3, 0.2, -0.9), "arm.R.elbow": 30.0})), (2.0, STAND, "h"),
    ], lag={"arm.R.wrist": 0.04, "arm.R.elbow": 0.02, "head": 0.06, "chest": 0.03})
    return Clip("wave", T, seq, False)


def dance():
    """4-beat groove at 120 bpm: bounce on every beat, step-touch side to side,
    alternating raise-the-roof arms, head bob. Seamless 2 s loop."""
    T = 2.0
    beat = T / 4

    def fn(t):
        x = t / T
        b = (t / beat) % 1.0
        c = dict(STAND)
        bounce = -0.045 * (0.5 + 0.5 * Cc(b)) ** 1.5      # down on the beat
        side = S(x)                                       # sway left/right per bar
        # step-touch: left foot steps out on beats 1-2, right on 3-4
        stepL = 0.05 * max(0.0, S(x)) ** 0.7
        stepR = 0.05 * max(0.0, -S(x)) ** 0.7
        liftL = 0.05 * max(0.0, S(2 * x - 0.25)) ** 4 * (x > 0.5)
        liftR = 0.05 * max(0.0, S(2 * x - 0.25)) ** 4 * (x <= 0.5)
        c["leg.L.pos"] = (0.10 + stepL, 0.01, ANKLE_H + liftL)
        c["leg.R.pos"] = (-0.10 - stepR, 0.01, ANKLE_H + liftR)
        c["leg.L.rot"] = (8 * liftL / 0.05, 0, 10)
        c["leg.R.rot"] = (8 * liftR / 0.05, 0, -10)
        c["leg.L.pole"] = (0.35, 1, 0)
        c["leg.R.pole"] = (-0.35, 1, 0)
        c["hips.pos"] = (0.04 * side, 0.0, -0.03 + bounce)
        c["hips.rot"] = (4.0, -7.0 * side, 10.0 * S(x + 0.25))
        c["spine.rot"] = (3.0, 4.0 * side, -6.0 * S(x + 0.25))
        c["chest.rot"] = (2.0 + 3.0 * Cc(b - 0.1), 4.0 * side, -6.0 * S(x + 0.28))
        c["neck.rot"] = (0.0, -2.0 * side, 0.0)
        c["head.rot"] = (6.0 * Cc(b - 0.15) - 2, -4 * side, 8 * S(x + 0.2))
        for s_, ss, ph in (("L", 1, 0.0), ("R", -1, 0.5)):
            # raise-the-roof: arm pumps up on alternate beats
            pump = 0.5 + 0.5 * Cc(2 * x - ph * 2 + 0.0)
            hit = 0.5 + 0.5 * Cc(b - 0.08)
            c[f"arm.{s_}.dir"] = (0.95, 0.3 + 0.25 * pump, -0.9 + 0.3 * pump)
            c[f"arm.{s_}.elbow"] = 80 - 20 * pump * hit
            c[f"arm.{s_}.twist"] = -10.0
            c[f"arm.{s_}.clav"] = (6 * pump + 3 * hit, 3)
            c[f"arm.{s_}.wrist"] = (-25 * hit, 0, 0)
        return c

    return Clip("dance", T, fn, True)


def celebrate():
    T = 1.5
    pump_up = P(STAND, **{
        "hips.pos": (0.0, 0.0, 0.0), "hips.rot": (-2, 0, 0), "spine.rot": (-6, 0, 0), "chest.rot": (-8, 0, 3),
        "neck.rot": (-3, 0, 0), "head.rot": (-12, 0, 4),
        "arm.R.dir": (1.0, 0.25, 0.05), "arm.R.elbow": 12.0, "arm.R.clav": (3, 3), "arm.R.twist": -30.0,
        "arm.R.wrist": (-10, 0, 0),
        "arm.L.dir": (0.35, 0.55, -0.6), "arm.L.elbow": 105.0, "arm.L.clav": (-2, 6), "arm.L.twist": -20.0,
        "leg.L.pos": (0.11, 0.0, ANKLE_H + 0.05), "leg.R.pos": (-0.11, 0.0, ANKLE_H + 0.05),
        "leg.L.rot": (35, 0, 7), "leg.R.rot": (35, 0, -7), "leg.L.toe": 35.0, "leg.R.toe": 35.0,
    })
    pump_dn = P(STAND, **{
        "hips.pos": (0.0, -0.02, -0.08), "hips.rot": (8, 0, 0), "spine.rot": (8, 0, 0), "chest.rot": (6, 0, -4),
        "neck.rot": (-6, 0, 0), "head.rot": (-4, 0, 0),
        "arm.R.dir": (0.45, 0.6, -0.45), "arm.R.elbow": 115.0, "arm.R.clav": (-3, 8), "arm.R.twist": -25.0,
        "arm.L.dir": (0.35, 0.5, -0.6), "arm.L.elbow": 100.0, "arm.L.clav": (-2, 6), "arm.L.twist": -20.0,
        "leg.L.pole": (0.25, 1, 0), "leg.R.pole": (-0.25, 1, 0),
    })
    seq = PoseSeq([
        (0.0, STAND), (0.18, pump_dn, "h"), (0.38, pump_up), (0.55, P(pump_dn, **{"hips.pos": (0, -0.02, -0.05)})),
        (0.75, pump_up), (0.92, P(pump_dn, **{"hips.pos": (0, -0.02, -0.05)})), (1.12, pump_up, "h"),
        (1.5, STAND, "h"),
    ], lag={"arm": 0.025, "head": 0.05, "chest": 0.02})
    return Clip("celebrate", T, seq, False)


# ---------------------------------------------------------------------------
# Combat (for fun)
# ---------------------------------------------------------------------------
GUARD = P(STAND, **{
    "hips.pos": (0.0, 0.0, -0.05), "hips.rot": (6, 0, 12), "spine.rot": (3, 0, 4), "chest.rot": (2, 0, 4),
    "neck.rot": (0, 0, -8), "head.rot": (-6, 0, -10),
    "leg.L.pos": (0.11, 0.09, ANKLE_H), "leg.R.pos": (-0.09, -0.10, ANKLE_H),
    "leg.L.rot": (0, 0, 12), "leg.R.rot": (0, 0, -25),
    "arm.L.dir": (0.3, 0.45, -0.8), "arm.L.elbow": 100.0, "arm.L.twist": -30.0, "arm.L.wrist": (-20, 0, 0),
    "arm.R.dir": (0.35, 0.35, -0.85), "arm.R.elbow": 105.0, "arm.R.twist": -30.0, "arm.R.wrist": (-20, 0, 0),
})


def punch():
    wind = P(GUARD, **{"hips.rot": (6, 0, 20), "chest.rot": (2, 0, 10), "arm.R.dir": (0.35, 0.1, -0.8),
                       "arm.R.elbow": 135.0, "hips.pos": (0, -0.02, -0.06)})
    hit = P(GUARD, **{"hips.rot": (8, 0, -14), "spine.rot": (5, 0, -10), "chest.rot": (4, 0, -14),
                      "neck.rot": (0, 0, 8), "head.rot": (-6, 0, 18), "hips.pos": (0.0, 0.05, -0.07),
                      "arm.R.dir": (-0.05, 1.0, 0.1), "arm.R.elbow": 4.0, "arm.R.clav": (4, 14),
                      "arm.R.twist": -80.0, "arm.R.wrist": (0, 0, 0),
                      "arm.L.dir": (0.3, 0.3, -0.8), "arm.L.elbow": 125.0,
                      "leg.R.pos": (-0.09, -0.10, ANKLE_H + 0.02), "leg.R.rot": (14, 0, -35),
                      "leg.R.toe": 14.0})
    seq = PoseSeq([(0.0, GUARD), (0.09, wind, "h"), (0.17, hit), (0.24, hit, "h"),
                   (0.5, GUARD, "h")], lag={"arm.L": 0.03, "head": 0.03})
    return Clip("punch", 0.5, seq, False)


def kick():
    T = 0.75
    chamber = P(GUARD, **{"hips.rot": (-4, 0, 6), "spine.rot": (-4, 0, 0), "chest.rot": (-2, 0, -4),
                          "hips.pos": (0.02, -0.02, -0.03),
                          "leg.R.pos": (-0.08, 0.12, 0.34), "leg.R.rot": (30, 0, -5), "leg.R.pole": (-0.1, 1, 0.6),
                          "arm.L.dir": (0.7, 0.2, -0.3), "arm.L.elbow": 60.0,
                          "arm.R.dir": (0.6, -0.4, -0.4), "arm.R.elbow": 70.0})
    ext = P(chamber, **{"hips.rot": (-10, 0, 8), "spine.rot": (-8, 0, 0), "hips.pos": (0.02, -0.05, -0.02),
                        "leg.R.pos": (-0.07, 0.42, 0.44), "leg.R.rot": (50, 0, -5), "leg.R.toe": -10.0,
                        "head.rot": (8, 0, -6)})
    seq = PoseSeq([(0.0, GUARD), (0.14, chamber), (0.25, ext), (0.33, ext, "h"), (0.47, chamber),
                   (0.75, GUARD, "h")], lag={"arm": 0.03, "head": 0.04})
    return Clip("kick", T, seq, False)


def clips():
    return [idle(), idle_look(), gait("walk"), gait("run"), gait("sprint"), jump_start(), jump_air(), fall(),
            land(), wave(), dance(), celebrate(), punch(), kick()]
