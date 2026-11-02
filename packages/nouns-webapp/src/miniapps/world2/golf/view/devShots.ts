// ── Noun Golf view: named shots for screenshots (dev, pure) ─────────────
//
//   const g = window.__w2, p = g.golfView.pose('island');
//   g.player.spawn(new V(p.rider.x, p.rider.y, p.rider.z), p.rider.yaw);
//   g.camHook = cam => { cam.position.set(p.cam.x, p.cam.y, p.cam.z); cam.lookAt(p.look.x, p.look.y, p.look.z); };
//
// The rider goes near the target (the mountain streams round the rider),
// the camera wherever the shot wants it.

import type { CourseLayout, V3 } from '../contract';

export type DevShot = 'mid' | 'top' | 'air' | 'tee1' | 'green' | 'clubhouse' | 'island' | 'noggle' | 'range' | 'entrance';

export interface DevPose {
  rider: V3 & { yaw: number };
  cam: V3;
  look: V3;
}

function along(x: number, z: number, yaw: number, a: number, s: number) {
  return { x: x + Math.sin(yaw) * a + Math.cos(yaw) * s, z: z + Math.cos(yaw) * a - Math.sin(yaw) * s };
}

export function devPose(L: CourseLayout, shot: DevShot): DevPose {
  const club = L.buildings.find(b => b.id === 'clubhouse')!;
  const h1 = L.holes[0];
  switch (shot) {
    case 'air': {
      const c = along(club.x, club.z, club.yaw, 300, -140);
      const l = along(club.x, club.z, club.yaw, 120, 0);
      return {
        rider: { x: L.spawn.x, y: L.spawn.y, z: L.spawn.z, yaw: L.spawn.yaw },
        cam: { x: c.x, y: club.y + 150, z: c.z },
        look: { x: l.x, y: club.y - 10, z: l.z },
      };
    }
    case 'top': {
      // Straight down over the 1st's fairway
      const m = h1.line[0];
      const e = h1.line[h1.line.length - 1];
      const x = (m.x * 0.4 + e.x * 0.6);
      const z = (m.z * 0.4 + e.z * 0.6);
      return {
        rider: { x, y: h1.pin.y, z, yaw: 0 },
        cam: { x: x + 0.01, y: h1.pin.y + 190, z },
        look: { x, y: h1.pin.y, z },
      };
    }
    case 'tee1': {
      const t = h1.teeSpot;
      const yaw = h1.tee.yaw;
      const c = along(t.x, t.z, yaw, -14, 2);
      const l = along(t.x, t.z, yaw, 120, 0);
      return { rider: { ...t, yaw }, cam: { x: c.x, y: t.y + 3.2, z: c.z }, look: { x: l.x, y: t.y - 4, z: l.z } };
    }
    case 'mid': {
      // Mid-course: the 7th tee (THE LAKE), ~800 m west of the clubhouse
      const h = L.holes[6];
      const t = h.teeSpot;
      const yaw = h.tee.yaw;
      const c = along(t.x, t.z, yaw, -14, 2);
      const l = along(t.x, t.z, yaw, 160, 0);
      return { rider: { ...t, yaw }, cam: { x: c.x, y: t.y + 4, z: c.z }, look: { x: l.x, y: t.y - 4, z: l.z } };
    }
    case 'green': {
      const p = h1.pin;
      const yaw = h1.tee.yaw;
      const c = along(p.x, p.z, yaw, -8, 3);
      const r = along(p.x, p.z, yaw, -14, 0);
      return { rider: { x: r.x, y: p.y, z: r.z, yaw }, cam: { x: c.x, y: p.y + 1.7, z: c.z }, look: { x: p.x, y: p.y + 1.1, z: p.z } };
    }
    case 'clubhouse': {
      const c = along(club.x, club.z, club.yaw, 52, 14);
      const r = along(club.x, club.z, club.yaw, 40, 0);
      return {
        rider: { x: r.x, y: club.y, z: r.z, yaw: club.yaw + Math.PI },
        cam: { x: c.x, y: club.y + 9, z: c.z },
        look: { x: club.x, y: club.y + 6, z: club.z },
      };
    }
    case 'range': {
      const t = L.range.tee;
      const c = along(t.x, t.z, L.range.yaw, -18, 30);
      const l = along(t.x, t.z, L.range.yaw, 120, 0);
      return { rider: { x: t.x, y: L.range.bays[4].y, z: t.z, yaw: L.range.yaw }, cam: { x: c.x, y: L.range.bays[4].y + 9, z: c.z }, look: { x: l.x, y: L.range.bays[4].y, z: l.z } };
    }
    case 'island':
    case 'noggle': {
      const h = L.holes[shot === 'island' ? 14 : 18];
      const p = h.green[0];
      const last = h.line[h.line.length - 1];
      const prev = h.line[h.line.length - 2];
      const yaw = Math.atan2(last.x - prev.x, last.z - prev.z);
      const c = along(last.x, last.z, yaw, shot === 'island' ? -62 : -40, 18);
      const r = along(last.x, last.z, yaw, -70, 0);
      return {
        rider: { x: r.x, y: h.pin.y, z: r.z, yaw },
        cam: { x: c.x, y: h.pin.y + (shot === 'island' ? 20 : 26), z: c.z },
        look: { x: shot === 'noggle' ? last.x : p.x, y: h.pin.y, z: shot === 'noggle' ? last.z : p.z },
      };
    }
    case 'entrance':
    default: {
      // The arch at u = −38 (scenery.ts entrance): in front of it, looking in
      const s = L.holes[3].teeSpot;
      return { rider: { ...s, yaw: 0 }, cam: { x: s.x, y: s.y + 6, z: s.z }, look: { x: s.x, y: s.y, z: s.z + 10 } };
    }
  }
}
