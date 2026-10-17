import type { Ship } from '../sim/types';
import type { Ease, Orbit, Range, SceneContext, Shot, Target, Track, V3 } from './types';

/** Where a subject is this frame: a point at its deck (a fleet's at the water), its heading and its size. */
export type Place = { x: number; y: number; z: number; heading: number; size: number };

/** What the rig reads from the engine: the ships' heave on the waves, the land, the water and the moon. */
export interface RigHost {
  readonly ctx: SceneContext;
  heaveOf(id: number): number;
  /** The ship as drawn, between sim steps. */
  poseOf?(s: Ship): { x: number; z: number; heading: number };
  ground(x: number, z: number): number;
  water(x: number, z: number): number;
  /** Bearing of the moon at night, of the sun by day, radians from +x toward +z. */
  lightBearing(): number;
  /** A cast figure's feet and facing on his deck, null while it is not on screen. */
  figure?(who: string): Place | null;
  /** The battle camera the scene hands over to. */
  homeEye?(): CameraPose | null;
}

export type CameraPose = { px: number; py: number; pz: number; lx: number; ly: number; lz: number; fov: number; roll: number; focus: number };

export const ease = (kind: Ease | undefined, t: number) => {
  const c = Math.min(1, Math.max(0, t));
  switch (kind ?? 'inOut') {
    case 'linear':
      return c;
    case 'in':
      return c * c * c;
    case 'out':
      return 1 - (1 - c) ** 3;
    default:
      return c * c * c * (c * (c * 6 - 15) + 10);
  }
};

export const lerpRange = (r: Range | undefined, k: number, fallback: number) => {
  if (r === undefined) return fallback;
  if (typeof r === 'number') return r;
  return r[0] + (r[1] - r[0]) * k;
};

function shipsOf(target: Target, ctx: SceneContext): Ship[] {
  const got = target.pick(ctx);
  if (!got) return [];
  return Array.isArray(got) ? got : [got];
}

/** The subject's place now, or null when nothing it names is afloat. */
export function locate(target: Target, host: RigHost): Place | null {
  const ships = shipsOf(target, host.ctx);
  if (!ships.length) return null;
  let place: Place;
  if (ships.length === 1) {
    const s = ships[0]!;
    const d = host.poseOf?.(s) ?? s;
    place = { x: d.x, y: host.heaveOf(s.id) + s.spec.deck, z: d.z, heading: d.heading, size: s.spec.length };
  } else {
    let x = 0;
    let z = 0;
    let hx = 0;
    let hz = 0;
    for (const s of ships) {
      const d = host.poseOf?.(s) ?? s;
      x += d.x;
      z += d.z;
      hx += Math.cos(d.heading);
      hz += Math.sin(d.heading);
    }
    x /= ships.length;
    z /= ships.length;
    let spread = 0;
    for (const s of ships) spread = Math.max(spread, Math.hypot(s.x - x, s.z - z));
    place = { x, y: 0, z, heading: Math.atan2(hz, hx), size: spread * 2 };
  }
  const frame = target.frame;
  if (frame === 'moon') place.heading = host.lightBearing();
  else if (frame && typeof frame === 'object') {
    const other = locate({ pick: frame.toward }, host);
    if (other) place.heading = Math.atan2(other.z - place.z, other.x - place.x);
  }
  return place;
}

/** A point of a subject's frame (forward, up, right) in the world. */
function offset(p: Place, v: V3) {
  const fx = Math.cos(p.heading);
  const fz = Math.sin(p.heading);
  return { x: p.x + fx * v[0] - fz * v[2], y: p.y + v[1], z: p.z + fz * v[0] + fx * v[2] };
}

/**
 * The camera of a shot at progress `k` (0..1, already eased) with the subject at `p`. A camera never goes under the
 * water or into a hill: it is lifted over them, as a crane would be.
 */
export function compose(shot: Omit<Shot, 'cam'> & { cam: Orbit | Track }, k: number, p: Place, host: RigHost, look?: Place | null): CameraPose {
  const cam = shot.cam;
  let px: number;
  let py: number;
  let pz: number;
  let lx: number;
  let ly: number;
  let lz: number;
  if (cam.type === 'orbit') {
    const yaw = p.heading + lerpRange(cam.yaw, k, 0);
    const pitch = lerpRange(cam.pitch, k, 0.1);
    const dist = lerpRange(cam.dist, k, 100);
    const lift = lerpRange(cam.lift, k, 0);
    const centre = cam.offset ? offset(p, cam.offset) : p;
    lx = centre.x;
    ly = centre.y + lift;
    lz = centre.z;
    const cp = Math.cos(pitch);
    px = lx + Math.cos(yaw) * cp * dist;
    pz = lz + Math.sin(yaw) * cp * dist;
    py = ly + Math.sin(pitch) * dist;
  } else {
    const a = cam.from;
    const b = cam.to;
    const at = offset(p, [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
    px = at.x;
    py = at.y;
    pz = at.z;
    const l = offset(look ?? p, cam.look);
    lx = l.x;
    ly = l.y;
    lz = l.z;
  }
  const tilt = lerpRange(shot.tilt, k, 0);
  if (tilt) {
    // Raise the look point along the vertical through it, by the angle seen from the camera.
    const d = Math.hypot(lx - px, lz - pz);
    const now = Math.atan2(ly - py, d);
    ly = py + Math.tan(Math.min(1.4, now + tilt)) * d;
  }
  const floor = Math.max(host.water(px, pz) + 1.4, host.ground(px, pz) + 6);
  if (py < floor) {
    ly += floor - py;
    py = floor;
  }
  return { px, py, pz, lx, ly, lz, fov: lerpRange(shot.fov, k, 36), roll: lerpRange(shot.roll, k, 0), focus: Math.hypot(lx - px, ly - py, lz - pz) };
}
