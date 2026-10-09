import {
  BoxGeometry,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Camera,
} from 'three/webgpu';
import { attribute, length, smoothstep, uv, vec3 } from 'three/tsl';
import type { Battle } from '../sim/battle';
import type { Faction, Ship } from '../sim/types';
import type { ShipViews } from '../ships/ShipViews';
import { waveField } from '../ocean/waves';
import { equipment } from '../game/quality';
import { pushCrew, type Clip, type ClipName, type CrewAsset, type CrewKey } from './crewModels';
import { CAST, GUN, HAND_ARMS, MELEE, OFFICER, SHOT, frac, lerpAngle, rnd, smooth, yawTo, type Member, type Roster, type Station } from './crewTypes';

/** What a tier of device can afford to show at once. */
const BUDGET = {
  high: { figures: 80, fights: 8, arrows: 56, sprites: 96, fallen: 64 },
  medium: { figures: 48, fights: 5, arrows: 32, sprites: 64, fallen: 40 },
  low: { figures: 24, fights: 3, arrows: 16, sprites: 40, fallen: 20 },
}[equipment.tier];

const WALK = 3.4;
const RUN = 4.3;
const CORPSE = 4;
const MAX_LINKS = 3;
const ROPE_SEGS = 5;
const PROPS_PER_LINK = 2 * ROPE_SEGS + 2 + 3;
const FLAGS = 8;
const PROPS = BUDGET.fights * MAX_LINKS * PROPS_PER_LINK + BUDGET.arrows + FLAGS * 2;

const PARTNERS = [MELEE, SHOT, GUN, OFFICER];
const PARTNER_PENALTY = [0, 4, 9, 12];

const ST_PATH = 0;
export const ST_DUEL = 1;
const ST_HOLD = 2;
const ST_RALLY = 3;
const ST_RETREAT = 4;
const ST_DYING = 5;

/** Flag colours by navy; the last is the white of a surrender. */
const FLAG_COLORS: [number, number, number][] = [
  [0.12, 0.32, 0.72],
  [0.78, 0.1, 0.08],
  [0.92, 0.7, 0.14],
  [0.93, 0.93, 0.9],
];
const FACTION_INDEX: Record<Faction, number> = { joseon: 0, japan: 1, ming: 2 };

type Link = {
  /** Rail points on the grappling ship (a) and the held ship (d), in each ship's own frame. */
  ax: number;
  az: number;
  ay: number;
  dx: number;
  dz: number;
  dy: number;
  plank: boolean;
  /** Rope length with a little slack. */
  rest: number;
  /** Time the link was cut, or -1. */
  cut: number;
  splashed: boolean;
};

type Fight = {
  used: boolean;
  seen: boolean;
  a: number;
  d: number;
  /** 0 grappled, 1 the held ship struck, 2 the boarders were thrown back. */
  mode: number;
  t0: number;
  endT: number;
  links: Link[];
  nlinks: number;
  /** Side of the held ship the grappling ship lies on, seen from each (+1 or -1 on the beam axis). */
  sa: number;
  sd: number;
  acc: number;
  next: number;
  dormant: boolean;
};

export type Figure = {
  used: boolean;
  fight: Fight | null;
  link: Link | null;
  mem: Member | null;
  partner: Member | null;
  partnerRole: number;
  from: number;
  to: number;
  key: CrewKey;
  faction: Faction;
  role: number;
  seed: number;
  state: number;
  u: number;
  dir: number;
  d1: number;
  d2: number;
  d3: number;
  sx: number;
  sz: number;
  lat: number;
  tx: number;
  tz: number;
  px: number;
  pz: number;
  landed: boolean;
  wx: number;
  wy: number;
  wz: number;
  wq: Quaternion;
  yaw: number;
  dieAt: number;
  hurt: number;
  fling: number;
  search: number;
  born: number;
  rally: number;
};

type Fallen = { used: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number; key: CrewKey; age: number; splashed: boolean; yaw: number };
type Arrow = { used: boolean; x0: number; y0: number; z0: number; vx: number; vy: number; vz: number; t: number; T: number; tid: number; lx: number; ly: number; lz: number; qx: number; qy: number; qz: number; qw: number; hit: number };
type Sprite = { used: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; s0: number; s1: number; r: number; g: number; b: number; a: number; g0: number };
type Capture = { id: number; t0: number; win: number; lose: number; by: number };

export type Placement = { x: number; z: number; yaw: number };

const G = 9.81;
const UP = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);

/**
 * Where a man really stands. When an enemy is alongside the crew leaves its stations and crowds the rail on that
 * side, so fighters meet on the contact line instead of each at his own post.
 */
/** Along-ship position of the pole the flag flies from: forward of the command tower, which would hide it. */
export function flagX(r: Roster) {
  return r.len * 0.3;
}

export function placement(r: Roster, role: number, mem: Member, st: Station, out: Placement) {
  out.x = st.x;
  out.z = st.z;
  out.yaw = st.yaw;
  const w = smooth(r.engage);
  if (w <= 0.001 || r.contactN === 0 || (role !== MELEE && role !== SHOT)) return out;
  const k = Math.min(r.contactN - 1, Math.floor(mem.seed * r.contactN));
  const s1 = frac(mem.seed * 37.7);
  const s2 = frac(mem.seed * 91.3);
  const side = r.cs[k]!;
  const tx = r.cx[k]! + (s1 - 0.5) * 6;
  const tz = side * Math.max(0.8, r.half - 1.7 - 1.3 * s2);
  out.x = st.x + (tx - st.x) * w;
  out.z = st.z + (tz - st.z) * w;
  out.yaw = lerpAngle(st.yaw, yawTo(0, side) + (s1 - 0.5) * 0.5, w);
  return out;
}

/**
 * Everything that happens between ships that are alongside each other: grappling ropes and planks, men crossing and
 * fighting on the enemy deck, volleys from the rails, the fall of the dead and the moment a ship strikes its colours.
 */
export class Boarding {
  readonly group = new Group();
  readonly pose = { clip: 'melee' as ClipName, t0: 0, rate: 1 };
  private readonly fights: Fight[] = [];
  private readonly figs: Figure[] = [];
  private readonly fallen: Fallen[] = [];
  private readonly arrows: Arrow[] = [];
  private readonly sprites: Sprite[] = [];
  private readonly captures = new Map<number, Capture>();
  private readonly captureList: Capture[] = [];
  private readonly lastAttacker = new Map<number, number>();
  private readonly cheerUntil = new Map<number, number>();
  private readonly kneel = new Map<CrewKey, Clip>();
  private readonly props: InstancedMesh;
  private readonly propColor: InstancedBufferAttribute;
  private readonly puffs: InstancedMesh;
  private readonly puffTint: InstancedBufferAttribute;
  private readonly puffFade: InstancedBufferAttribute;
  private nProps = 0;
  private time = 0;
  private dt = 0;
  private frame = 0;
  private readonly pl: Placement = { x: 0, z: 0, yaw: 0 };
  private readonly pl2: Placement = { x: 0, z: 0, yaw: 0 };
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly c = new Vector3();
  private readonly dirv = new Vector3();
  private readonly q = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly basis = new Matrix4();
  private readonly right = new Vector3();
  private readonly camPos = new Vector3();

  constructor(
    private readonly views: ShipViews,
    private readonly rosters: Map<number, Roster>,
    /** The rosters on screen this frame, filled by the crew before each update. */
    private readonly live: Roster[],
  ) {
    for (let i = 0; i < BUDGET.fights; i += 1) {
      const links: Link[] = [];
      for (let k = 0; k < MAX_LINKS; k += 1) links.push({ ax: 0, az: 0, ay: 0, dx: 0, dz: 0, dy: 0, plank: false, rest: 0, cut: -1, splashed: false });
      this.fights.push({ used: false, seen: false, a: 0, d: 0, mode: 0, t0: 0, endT: 0, links, nlinks: 0, sa: 1, sd: 1, acc: 0, next: 0, dormant: false });
    }
    for (let i = 0; i < BUDGET.figures; i += 1) {
      this.figs.push({
        used: false, fight: null, link: null, mem: null, partner: null, partnerRole: 0, from: 0, to: 0, key: 'rower', faction: 'joseon', role: MELEE, seed: 0, state: 0, u: 0, dir: 1, d1: 1, d2: 1, d3: 1,
        sx: 0, sz: 0, lat: 0, tx: 0, tz: 0, px: 0, pz: 0, landed: false, wx: 0, wy: 0, wz: 0, wq: new Quaternion(), yaw: 0, dieAt: 0, hurt: 0, fling: 0, search: 0, born: 0, rally: 0,
      });
    }
    for (let i = 0; i < BUDGET.fallen; i += 1) this.fallen.push({ used: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, key: 'rower', age: 0, splashed: false, yaw: 0 });
    for (let i = 0; i < BUDGET.arrows; i += 1) this.arrows.push({ used: false, x0: 0, y0: 0, z0: 0, vx: 0, vy: 0, vz: 0, t: 0, T: 1, tid: 0, lx: 0, ly: 0, lz: 0, qx: 0, qy: 0, qz: 0, qw: 1, hit: 0 });
    for (let i = 0; i < BUDGET.sprites; i += 1) this.sprites.push({ used: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, s0: 1, s1: 1, r: 1, g: 1, b: 1, a: 1, g0: 0 });

    // Ropes, planks, hooks, arrows and flags are boxes of one instanced mesh, each with its own colour.
    const geo = new BoxGeometry(1, 1, 1);
    this.propColor = new InstancedBufferAttribute(new Float32Array(PROPS * 3), 3);
    this.propColor.setUsage(DynamicDrawUsage);
    geo.setAttribute('iTint', this.propColor);
    const wood = new MeshStandardNodeMaterial({ roughness: 0.88 });
    wood.colorNode = attribute('iTint', 'vec3');
    this.props = new InstancedMesh(geo, wood, PROPS);
    this.props.instanceMatrix.setUsage(DynamicDrawUsage);
    this.props.count = 0;
    this.props.frustumCulled = false;
    this.props.castShadow = true;
    this.props.receiveShadow = true;
    this.group.add(this.props);

    // Muzzle flashes and splashes are soft round sprites turned toward the camera.
    const quad = new PlaneGeometry(1, 1);
    this.puffTint = new InstancedBufferAttribute(new Float32Array(BUDGET.sprites * 3), 3);
    this.puffFade = new InstancedBufferAttribute(new Float32Array(BUDGET.sprites), 1);
    this.puffTint.setUsage(DynamicDrawUsage);
    this.puffFade.setUsage(DynamicDrawUsage);
    quad.setAttribute('iTint', this.puffTint);
    quad.setAttribute('iFade', this.puffFade);
    const puffMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    puffMat.colorNode = attribute('iTint', 'vec3').mul(vec3(1));
    puffMat.opacityNode = smoothstep(0.5, 0.08, length(uv().sub(0.5))).mul(attribute('iFade', 'float'));
    this.puffs = new InstancedMesh(quad, puffMat, BUDGET.sprites);
    this.puffs.instanceMatrix.setUsage(DynamicDrawUsage);
    this.puffs.count = 0;
    this.puffs.frustumCulled = false;
    this.puffs.renderOrder = 5;
    this.group.add(this.puffs);
  }

  // ---------------------------------------------------------------- events

  noteBoard(a: number, b: number) {
    this.lastAttacker.set(b, a);
  }

  /** A ship strikes. The victor is named by the event, or is whoever was grappled with it. */
  noteStruck(id: number, by: number | undefined, battle: Battle) {
    if (this.captures.has(id)) return;
    const ship = battle.get(id);
    if (!ship) return;
    let win = by && by !== id ? by : 0;
    if (!win) {
      for (const f of this.fights) {
        if (!f.used || f.mode !== 0) continue;
        if (f.d === id) win = f.a;
        else if (f.a === id) win = f.d;
      }
    }
    if (!win) win = this.lastAttacker.get(id) ?? 0;
    const victor = win ? battle.get(win) : undefined;
    const capture = { id, t0: this.time, win: victor ? FACTION_INDEX[victor.spec.faction] : 3, lose: FACTION_INDEX[ship.spec.faction], by: win };
    this.captures.set(id, capture);
    this.captureList.push(capture);
    if (victor) this.cheerUntil.set(victor.id, this.time + 8);
  }

  captureOf(id: number) {
    return this.captures.get(id);
  }

  cheering(id: number) {
    return (this.cheerUntil.get(id) ?? -1) > this.time;
  }

  // ---------------------------------------------------------------- fights

  private find(a: number, d: number) {
    for (const f of this.fights) if (f.used && f.mode === 0 && f.a === a && f.d === d) return f;
    return null;
  }

  private open(sa: Ship, sd: Ship, rA: Roster, rD: Roster) {
    let f: Fight | null = null;
    for (const o of this.fights) {
      if (!o.used) {
        f = o;
        break;
      }
    }
    if (!f) return null;
    f.used = true;
    f.seen = true;
    f.a = sa.id;
    f.d = sd.id;
    f.mode = 0;
    f.t0 = this.time;
    f.endT = 0;
    f.acc = 0;
    f.next = 0;
    f.dormant = false;
    const lx = sd.x - sa.x;
    const lz = sd.z - sa.z;
    f.sa = -lx * Math.sin(sa.heading) + lz * Math.cos(sa.heading) >= 0 ? 1 : -1;
    f.sd = lx * Math.sin(sd.heading) - lz * Math.cos(sd.heading) >= 0 ? 1 : -1;
    // Links: spread along the grappling ship, each meeting the nearest rail point on the other.
    const want = equipment.tier === 'low' ? 2 : sa.spec.length > 26 ? 3 : 2;
    f.nlinks = want;
    for (let k = 0; k < want; k += 1) {
      const link = f.links[k]!;
      const xa = (k - (want - 1) / 2) * 0.3 * sa.spec.length * rA.plan.length;
      link.ax = xa;
      link.az = f.sa * rA.half;
      link.ay = rA.main + 0.5;
      this.views.localToWorld(sa.id, link.ax, link.ay, link.az, this.a);
      let best = 1e9;
      let bx = 0;
      const span = sd.spec.length * rD.plan.length * 0.5;
      for (let i = 0; i <= 8; i += 1) {
        const xd = (i / 8 - 0.5) * 2 * span * 0.8;
        this.views.localToWorld(sd.id, xd, rD.main + 0.5, f.sd * rD.half, this.b);
        const d = this.a.distanceToSquared(this.b);
        if (d < best) {
          best = d;
          bx = xd;
        }
      }
      link.dx = bx;
      link.dz = f.sd * rD.half;
      link.dy = rD.main + 0.5;
      const gap = Math.sqrt(best);
      link.plank = gap < 17;
      link.rest = gap * 1.06 + 0.5;
      link.cut = -1;
      link.splashed = false;
    }
    return f;
  }

  private free(f: Fight) {
    f.used = false;
    for (const fig of this.figs) if (fig.used && fig.fight === f) this.release(fig);
  }

  /** The pair parted. Either the held ship struck and the boarders are its masters, or they are thrown back. */
  private close(f: Fight, battle: Battle) {
    const d = battle.get(f.d);
    const a = battle.get(f.a);
    f.endT = this.time;
    if (d && d.struck) {
      f.mode = 1;
      this.noteStruck(f.d, f.a, battle);
    } else {
      f.mode = 2;
      if (a && a.struck) this.noteStruck(f.a, f.d, battle);
    }
    for (let k = 0; k < f.nlinks; k += 1) f.links[k]!.cut = this.time + (f.mode === 1 ? 6 : 0.15);
    for (const fig of this.figs) {
      if (!fig.used || fig.fight !== f || fig.state === ST_DYING) continue;
      if (f.mode === 1) {
        if (fig.state !== ST_PATH) this.rally(fig, f);
      } else this.retreat(fig);
    }
  }

  private rally(fig: Figure, f: Fight) {
    if (fig.partner && fig.partner.duel === fig) fig.partner.duel = null;
    fig.partner = null;
    fig.state = ST_RALLY;
    fig.fight = null;
    fig.rally = this.time;
    const rD = this.rosters.get(f.d);
    if (rD) {
      const ang = fig.seed * 6.283;
      const rad = 1.4 + frac(fig.seed * 17) * 2.6;
      fig.tx = flagX(rD) + Math.cos(ang) * rad;
      fig.tz = Math.sin(ang) * rad * 0.8;
    }
  }

  private retreat(fig: Figure) {
    if (fig.partner && fig.partner.duel === fig) fig.partner.duel = null;
    fig.partner = null;
    if (fig.state === ST_PATH) {
      fig.dir = -1;
      return;
    }
    fig.state = ST_RETREAT;
  }

  private release(fig: Figure) {
    if (fig.partner && fig.partner.duel === fig) fig.partner.duel = null;
    if (fig.mem) {
      fig.mem.away = false;
      fig.mem.clip = 'idle';
    }
    fig.used = false;
    fig.mem = null;
    fig.partner = null;
    fig.fight = null;
    fig.link = null;
  }

  /** Looks for a free defender for this boarder to fight: the fighters first, nearest along the rail. */
  private findPartner(fig: Figure, rD: Roster, x: number) {
    let best: Member | null = null;
    let bestRole = 0;
    let bd = 1e9;
    for (let i = 0; i < PARTNERS.length; i += 1) {
      const role = PARTNERS[i]!;
      const pen = PARTNER_PENALTY[i]!;
      for (const m of rD.members[role]!) {
        if (m.dying >= 0 || m.gone || m.away || m.duel) continue;
        const d = Math.abs(rD.stations[role]![m.station]!.x - x) + pen;
        if (d < bd) {
          bd = d;
          best = m;
          bestRole = role;
        }
      }
    }
    if (!best) return false;
    best.duel = fig;
    fig.partner = best;
    fig.partnerRole = bestRole;
    return true;
  }

  begin(battle: Battle, time: number, dt: number, frame: number) {
    this.time = time;
    this.dt = dt;
    this.frame = frame;
    for (let i = 0; i < this.live.length; i += 1) {
      const r = this.live[i]!;
      r.contactN = 0;
      r.boarded = false;
      r.defending = false;
    }
    for (const f of this.fights) if (f.used) f.seen = false;
    for (const s of battle.ships) {
      if (!s.alive || !s.grappledWith) continue;
      const d = battle.get(s.grappledWith);
      if (!d || !d.alive) continue;
      this.lastAttacker.set(d.id, s.id);
      let f = this.find(s.id, d.id);
      if (!f) {
        // A lingering closed fight of the same pair makes way for the new boarding.
        for (const o of this.fights) if (o.used && o.mode !== 0 && o.a === s.id && o.d === d.id) this.free(o);
        const rA = this.rosters.get(s.id);
        const rD = this.rosters.get(d.id);
        if (rA && rD && rA.live === frame && rD.live === frame && s.sinking < 0.35 && d.sinking < 0.35) f = this.open(s, d, rA, rD);
      }
      if (f) f.seen = true;
    }
    for (let i = this.captureList.length - 1; i >= 0; i -= 1) {
      const c = this.captureList[i]!;
      const ship = battle.get(c.id);
      if (ship && ship.alive && ship.sinking <= 0.35) continue;
      this.captures.delete(c.id);
      this.captureList.splice(i, 1);
    }
    for (const s of battle.ships) {
      if (s.alive && s.struck && s.sinking <= 0.35 && !this.captures.has(s.id)) this.noteStruck(s.id, undefined, battle);
    }
    for (const f of this.fights) {
      if (!f.used) continue;
      const a = battle.get(f.a);
      const d = battle.get(f.d);
      const rA = this.rosters.get(f.a);
      const rD = this.rosters.get(f.d);
      if (!a || !d || !a.alive || !d.alive || !rA || !rD) {
        this.free(f);
        continue;
      }
      if (!f.seen && f.mode === 0) this.close(f, battle);
      const live = rA.live === this.frame && rD.live === this.frame;
      if (!live) {
        // Out of sight: nothing is drawn, the boarders go back to their posts.
        if (!f.dormant) {
          f.dormant = true;
          for (const fig of this.figs) if (fig.used && fig.fight === f) this.release(fig);
        }
        if (f.mode === 0) {
          for (let k = 0; k < f.nlinks; k += 1) {
            rA.cx[rA.contactN] = f.links[k]!.ax;
            rA.cs[rA.contactN] = f.sa;
            rA.contactN = Math.min(3, rA.contactN + 1);
          }
        }
        if (f.mode !== 0 && this.time - f.endT > 8) this.free(f);
        continue;
      }
      f.dormant = false;
      if (f.mode === 0) {
        rA.boarded = true;
        rD.boarded = true;
        rD.defending = true;
        for (let k = 0; k < f.nlinks; k += 1) {
          const l = f.links[k]!;
          if (rA.contactN < 3) {
            rA.cx[rA.contactN] = l.ax;
            rA.cs[rA.contactN] = f.sa;
            rA.contactN += 1;
          }
          if (rD.contactN < 3) {
            rD.cx[rD.contactN] = l.dx;
            rD.cs[rD.contactN] = f.sd;
            rD.contactN += 1;
          }
        }
        this.sendBoarders(f, a, d, rA, rD);
      } else if (this.time - f.endT > 14 && !this.anyFigure(f)) this.free(f);
    }
    for (let i = 0; i < this.live.length; i += 1) {
      const r = this.live[i]!;
      const target = r.boarded ? 1 : 0;
      r.engage += Math.max(-dt / 1.4, Math.min(dt / 1.2, target - r.engage));
      r.hold = r.defending;
    }
  }

  private anyFigure(f: Fight) {
    for (const fig of this.figs) if (fig.used && fig.fight === f) return true;
    return false;
  }

  /** Lends men from the grappling ship to the plank, as fast as the fight and the ship's fighting strength allow. */
  private sendBoarders(f: Fight, a: Ship, d: Ship, rA: Roster, rD: Roster) {
    const age = this.time - f.t0;
    const ready = f.links[0]!.plank ? 1.2 : 0.8;
    if (age < ready) return;
    const strength = (a.roles[MELEE] + a.roles[SHOT] * 0.6) / Math.max(1, a.spec.crew * (a.spec.crewPlan[MELEE]! + a.spec.crewPlan[SHOT]! * 0.6));
    f.acc = Math.min(5, f.acc + this.dt * (1 + 2.4 * Math.min(1, strength)));
    if (f.acc < 1) return;
    // Count the men already across and those still on deck who can go.
    let away = 0;
    let free = 0;
    for (let role = SHOT; role <= MELEE; role += 1) {
      for (const m of rA.members[role]!) {
        if (m.dying >= 0 || m.gone) continue;
        if (m.away) away += 1;
        else free += 1;
      }
    }
    if (free + away <= 0 || away >= (free + away) * 0.75) return;
    let spawned = 0;
    while (f.acc >= 1 && spawned < 3) {
      const fig = this.spawnBoarder(f, a, d, rA, rD);
      f.acc -= 1;
      if (!fig) break;
      spawned += 1;
    }
  }

  private spawnBoarder(f: Fight, a: Ship, d: Ship, rA: Roster, rD: Roster) {
    let fig: Figure | null = null;
    for (const o of this.figs) {
      if (!o.used) {
        fig = o;
        break;
      }
    }
    if (!fig) return null;
    // The fighters go first, then the shooters who have put down their guns.
    let mem: Member | null = null;
    let role = MELEE;
    for (let pass = 0; pass < 2 && !mem; pass += 1) {
      role = pass === 0 ? MELEE : SHOT;
      const list = rA.members[role]!;
      const n = list.length;
      const start = Math.floor(Math.random() * Math.max(1, n));
      for (let i = 0; i < n; i += 1) {
        const m = list[(start + i) % n]!;
        if (m.dying >= 0 || m.gone || m.away || m.duel || m.fireAt >= 0) continue;
        mem = m;
        break;
      }
    }
    if (!mem) return null;
    const st = rA.stations[role]![mem.station]!;
    placement(rA, role, mem, st, this.pl);
    const link = f.links[f.next % f.nlinks]!;
    f.next += 1;
    fig.used = true;
    fig.fight = f;
    fig.link = link;
    fig.mem = mem;
    fig.from = a.id;
    fig.to = d.id;
    fig.faction = a.spec.faction;
    fig.role = role;
    fig.key = CAST[a.spec.faction][role]!;
    fig.seed = mem.seed;
    fig.state = ST_PATH;
    fig.u = 0;
    fig.dir = 1;
    fig.sx = this.pl.x;
    fig.sz = this.pl.z;
    fig.lat = (frac(mem.seed * 53.1) - 0.5) * 0.5;
    fig.landed = false;
    fig.born = this.time;
    fig.partner = null;
    fig.search = 0;
    mem.away = true;
    const walk = Math.hypot(link.ax + fig.lat - fig.sx, link.az - fig.sz);
    fig.d1 = Math.max(0.35, walk / RUN);
    this.views.localToWorld(a.id, link.ax, link.ay, link.az, this.a);
    this.views.localToWorld(d.id, link.dx, link.dy, link.dz, this.b);
    const gap = this.a.distanceTo(this.b);
    fig.d2 = link.plank ? Math.max(0.6, gap / WALK) : Math.max(0.5, gap / 4.5 + 0.3);
    if (this.findPartner(fig, rD, link.dx)) this.partnerSpot(fig, rD, f.sd);
    else this.holdSpot(fig, rD, link, f.sd);
    fig.d3 = Math.max(0.4, Math.hypot(fig.tx - link.dx, fig.tz - link.dz) / RUN);
    return fig;
  }

  private holdSpot(fig: Figure, rD: Roster, link: Link, sd: number) {
    fig.tx = link.dx + (frac(fig.seed * 29) - 0.5) * 5;
    fig.tz = sd * Math.max(0.6, rD.half - 2.6 - frac(fig.seed * 61) * 2.2);
  }

  /** Stands the boarder against his man, on the side nearest the rail he came over. */
  private partnerSpot(fig: Figure, rD: Roster, sd: number) {
    const m = fig.partner!;
    const st = rD.stations[fig.partnerRole]![m.station]!;
    placement(rD, fig.partnerRole, m, st, this.pl2);
    const ang = (frac(fig.seed * 23) - 0.5) * 1.1;
    fig.tx = this.pl2.x + Math.sin(ang) * 1.05;
    fig.tz = this.pl2.z + sd * Math.cos(ang) * 1.05;
    fig.yaw = yawTo(-Math.sin(ang), -sd * Math.cos(ang));
  }

  // ---------------------------------------------------------------- drawing

  /** Draws every boarder, body, arrow, flash and rope for this frame. */
  draw(battle: Battle, assets: Map<CrewKey, CrewAsset>, camera: Camera) {
    this.camPos.copy(camera.position);
    this.nProps = 0;
    for (const f of this.fights) if (f.used && !f.dormant) this.drawLinks(f);
    for (const fig of this.figs) if (fig.used) this.drawFigure(fig, assets);
    this.drawFallen(assets);
    this.drawArrows();
    this.drawFlags(battle);
    this.drawSprites(camera);
    this.props.count = this.nProps;
    this.props.instanceMatrix.needsUpdate = true;
    this.propColor.needsUpdate = true;
    this.props.visible = this.nProps > 0;
  }

  private putBox(px: number, py: number, pz: number, qx: number, qy: number, qz: number, qw: number, sx: number, sy: number, sz: number, r: number, g: number, b: number) {
    if (this.nProps >= PROPS) return;
    const i = this.nProps++;
    const m = this.props.instanceMatrix.array as Float32Array;
    const o = i * 16;
    const x2 = qx + qx;
    const y2 = qy + qy;
    const z2 = qz + qz;
    const xx = qx * x2;
    const xy = qx * y2;
    const xz = qx * z2;
    const yy = qy * y2;
    const yz = qy * z2;
    const zz = qz * z2;
    const wx = qw * x2;
    const wy = qw * y2;
    const wz = qw * z2;
    m[o] = (1 - (yy + zz)) * sx;
    m[o + 1] = (xy + wz) * sx;
    m[o + 2] = (xz - wy) * sx;
    m[o + 3] = 0;
    m[o + 4] = (xy - wz) * sy;
    m[o + 5] = (1 - (xx + zz)) * sy;
    m[o + 6] = (yz + wx) * sy;
    m[o + 7] = 0;
    m[o + 8] = (xz + wy) * sz;
    m[o + 9] = (yz - wx) * sz;
    m[o + 10] = (1 - (xx + yy)) * sz;
    m[o + 11] = 0;
    m[o + 12] = px;
    m[o + 13] = py;
    m[o + 14] = pz;
    m[o + 15] = 1;
    const c = this.propColor.array as Float32Array;
    c[i * 3] = r;
    c[i * 3 + 1] = g;
    c[i * 3 + 2] = b;
  }

  /** A thin box laid from one point to another. */
  private putSeg(ax: number, ay: number, az: number, bx: number, by: number, bz: number, thick: number, r: number, g: number, b: number) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    this.dirv.set(dx / len, dy / len, dz / len);
    this.q.setFromUnitVectors(Z_AXIS, this.dirv);
    this.putBox((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, this.q.x, this.q.y, this.q.z, this.q.w, thick, thick, len, r, g, b);
  }

  /** A rope hanging between two points, sagging while it is slack. */
  private putRope(ax: number, ay: number, az: number, bx: number, by: number, bz: number, rest: number, grow: number, fall: number) {
    const d = Math.hypot(bx - ax, by - ay, bz - az);
    const sag = Math.min(3.2, Math.sqrt(Math.max(0, (3 * d * (rest - d)) / 8)) + 0.08 + fall * 0.8);
    const reach = grow;
    let px = ax;
    let py = ay;
    let pz = az;
    for (let i = 1; i <= ROPE_SEGS; i += 1) {
      const s = (i / ROPE_SEGS) * reach;
      const nx = ax + (bx - ax) * s;
      let ny = ay + (by - ay) * s - sag * 4 * s * (1 - s);
      const nz = az + (bz - az) * s;
      ny -= fall * fall * 4.9 * s;
      this.putSeg(px, py, pz, nx, ny, nz, 0.14, 0.6, 0.5, 0.32);
      px = nx;
      py = ny;
      pz = nz;
    }
  }

  private drawLinks(f: Fight) {
    const age = this.time - f.t0;
    for (let k = 0; k < f.nlinks; k += 1) {
      const l = f.links[k]!;
      const fall = l.cut >= 0 && this.time > l.cut ? this.time - l.cut : 0;
      if (fall > 1.5) continue;
      // Hooks fly over, then the planks are run out.
      const grow = smooth((age - k * 0.12) / 0.45);
      if (grow <= 0) continue;
      this.views.localToWorld(f.a, l.ax, l.ay, l.az, this.a);
      this.views.localToWorld(f.d, l.dx, l.dy, l.dz, this.b);
      const gap = this.a.distanceTo(this.b);
      if (l.cut < 0 && gap > l.rest * 1.5 + 3) l.cut = this.time;
      const ax = this.a.x;
      const ay = this.a.y;
      const az = this.a.z;
      const bx = this.b.x;
      const by = this.b.y;
      const bz = this.b.z;
      // Two ropes a body-width apart on each link.
      for (let side = -1; side <= 1; side += 2) {
        this.views.localToWorld(f.a, l.ax + side * 1.3, l.ay + 0.9, l.az, this.c);
        const sx = this.c.x;
        const sy = this.c.y;
        const sz = this.c.z;
        this.views.localToWorld(f.d, l.dx + side * 1.3, l.dy + 0.15, l.dz, this.c);
        this.putRope(sx, sy, sz, this.c.x, this.c.y, this.c.z, l.rest, grow, fall);
        if (grow >= 1) {
          this.putBox(this.c.x, this.c.y - fall * fall * 4.9, this.c.z, 0, 0, 0, 1, 0.22, 0.16, 0.22, 0.12, 0.12, 0.13);
        }
      }
      if (l.plank && age > 0.6) {
        const lay = smooth((age - 0.6) / 0.7);
        const drop = fall * fall * 4.9;
        const len = (gap + 1.4) * lay;
        // The plank is pushed out from the grappling ship, resting on both rails.
        this.dirv.set(bx - ax, by - ay, bz - az).normalize();
        this.right.crossVectors(UP, this.dirv);
        if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
        this.right.normalize();
        this.c.crossVectors(this.dirv, this.right);
        this.basis.makeBasis(this.right, this.c, this.dirv);
        this.q2.setFromRotationMatrix(this.basis);
        const half = len / 2 - 0.5;
        this.putBox(ax + this.dirv.x * half, ay + this.dirv.y * half - drop, az + this.dirv.z * half, this.q2.x, this.q2.y, this.q2.z, this.q2.w, 0.95, 0.09, len, 0.45, 0.33, 0.2);
        // The side rails of the walkway.
        if (lay >= 1) {
          for (let side = -1; side <= 1; side += 2) {
            this.putBox(ax + this.dirv.x * half + this.right.x * side * 0.45, ay + this.dirv.y * half - drop + 0.06, az + this.dirv.z * half + this.right.z * side * 0.45, this.q2.x, this.q2.y, this.q2.z, this.q2.w, 0.06, 0.1, len, 0.3, 0.22, 0.14);
          }
        }
        if (fall > 0.7 && !l.splashed) {
          l.splashed = true;
          this.splash(ax + this.dirv.x * half, az + this.dirv.z * half, 1.4);
        }
      }
    }
  }

  // ---------------------------------------------------------------- figures

  private drawFigure(fig: Figure, assets: Map<CrewKey, CrewAsset>) {
    const dt = this.dt;
    const rA = this.rosters.get(fig.from);
    const rD = this.rosters.get(fig.to);
    if (!rD || rD.live !== this.frame || (fig.state === ST_PATH && (!rA || rA.live !== this.frame))) {
      this.release(fig);
      return;
    }
    const asset = assets.get(fig.key);
    if (!asset) return;
    const f = fig.fight;
    // The man was cut down: flinch, then fall where he stands or over the side.
    if (fig.mem && fig.mem.dying >= 0) {
      const mem = fig.mem;
      fig.state = ST_DYING;
      fig.dieAt = mem.dying;
      fig.hurt = mem.hurt;
      fig.fling = mem.fling;
      if (fig.partner && fig.partner.duel === fig) fig.partner.duel = null;
      fig.partner = null;
      fig.mem = null;
      mem.gone = true;
      mem.away = false;
    }
    let clip: ClipName = 'ready';
    let rate = 1;
    let t0 = this.time;
    const weapon = HAND_ARMS[fig.faction][fig.role]!;
    let dark = 0;
    let frame: Roster | null = null;
    let yaw = 0;
    if (fig.state === ST_PATH) {
      const total = fig.d1 + fig.d2 + fig.d3;
      fig.u += dt * fig.dir;
      const link = fig.link!;
      if (fig.dir < 0 && fig.u <= 0) {
        this.release(fig);
        return;
      }
      if (fig.u >= total) {
        fig.u = total;
        fig.landed = true;
        fig.px = fig.tx;
        fig.pz = fig.tz;
        if (f && f.mode === 0) {
          fig.state = fig.partner ? ST_DUEL : ST_HOLD;
          fig.search = this.time + 0.5;
        } else if (f) this.rally(fig, f);
      }
      const u = fig.u;
      clip = 'run';
      rate = 1.15;
      t0 = fig.born;
      if (u < fig.d1) {
        const k = smooth(u / fig.d1);
        const lx = fig.sx + (link.ax + fig.lat - fig.sx) * k;
        const lz = fig.sz + (link.az - fig.sz) * k;
        this.views.localToWorld(fig.from, lx, rA!.main + (link.ay - rA!.main) * k, lz, this.c);
        yaw = yawTo(link.ax + fig.lat - fig.sx, link.az - fig.sz);
        frame = rA!;
      } else if (u < fig.d1 + fig.d2) {
        const k = (u - fig.d1) / fig.d2;
        this.views.localToWorld(fig.from, link.ax + fig.lat, link.ay, link.az, this.a);
        this.views.localToWorld(fig.to, link.dx + fig.lat, link.dy, link.dz, this.b);
        const dx = this.b.x - this.a.x;
        const dz = this.b.z - this.a.z;
        const len = Math.hypot(dx, dz) || 1;
        // Offsets across the plank so the men do not walk through one another.
        const off = fig.lat * 0.6;
        const jump = !link.plank || (link.cut >= 0 && this.time > link.cut);
        this.c.set(this.a.x + dx * k - (dz / len) * off, this.a.y + (this.b.y - this.a.y) * k + (jump ? Math.sin(k * Math.PI) * (0.7 + len * 0.1) : 0), this.a.z + dz * k + (dx / len) * off);
        yaw = yawTo(dx, dz);
      } else {
        const k = smooth((u - fig.d1 - fig.d2) / fig.d3);
        const lx = link.dx + fig.lat + (fig.tx - link.dx - fig.lat) * k;
        const lz = link.dz + (fig.tz - link.dz) * k;
        this.views.localToWorld(fig.to, lx, link.dy + (rD.main - link.dy) * k, lz, this.c);
        yaw = yawTo(fig.tx - link.dx - fig.lat, fig.tz - link.dz);
        frame = rD;
        fig.px = lx;
        fig.pz = lz;
        fig.landed = true;
      }
      if (fig.dir < 0) yaw += Math.PI;
      fig.yaw = yaw;
    } else if (fig.state !== ST_DYING) {
      this.stepOnDeck(fig, rD);
      this.views.localToWorld(fig.to, fig.px, rD.main, fig.pz, this.c);
      frame = rD;
      yaw = fig.yaw;
      if (fig.state === ST_RETREAT || Math.hypot(fig.tx - fig.px, fig.tz - fig.pz) > 0.3) {
        clip = 'run';
        rate = 1.15;
        t0 = fig.born;
      } else if (fig.state === ST_DUEL && fig.partner) {
        this.duelClip(fig, 0, asset);
        clip = this.pose.clip;
        t0 = this.pose.t0;
        rate = this.pose.rate;
      } else if (fig.state === ST_RALLY) {
        clip = this.time - fig.rally > 11 ? 'idle' : 'cheer';
        t0 = fig.rally + fig.seed;
        yaw = lerpAngle(yaw, yawTo(-fig.px, -fig.pz), 0.5);
      } else {
        clip = 'ready';
        t0 = fig.born;
      }
    } else {
      // Dying: on the deck he stays with the ship, in the air he stays where he fell.
      if (fig.landed) {
        this.views.localToWorld(fig.to, fig.px, rD.main, fig.pz, this.c);
        frame = rD;
        yaw = fig.yaw;
      } else this.c.set(fig.wx, fig.wy, fig.wz);
      if (this.time < fig.dieAt) {
        clip = 'hit';
        rate = 1.5;
        t0 = fig.hurt;
      } else if (fig.fling !== 0 || !fig.landed) {
        // Over the rail (and anyone who dies before reaching the deck falls too, not hangs) toward the gap between the hulls.
        const side = fig.fight ? fig.fight.sd : fig.pz >= 0 ? 1 : -1;
        this.dirv.set(0, 0, side).applyQuaternion(rD.q);
        this.fall(fig.key, this.c.x, this.c.y, this.c.z, this.dirv.x * rnd(1.5, 3.2), rnd(2, 4), this.dirv.z * rnd(1.5, 3.2));
        this.release(fig);
        return;
      } else {
        clip = 'die';
        t0 = fig.dieAt;
        dark = Math.min(1, (this.time - fig.dieAt) / 2.6) * 0.6;
        if (this.time - fig.dieAt > CORPSE) {
          this.release(fig);
          return;
        }
      }
    }
    let c = asset.clips[clip];
    if (!c) {
      clip = asset.clips.ready ? 'ready' : 'idle';
      c = asset.clips[clip]!;
    }
    // A figure on a deck takes the ship's tilt; on the plank or in the air only its heading.
    if (fig.state === ST_DYING && !fig.landed) this.q.copy(fig.wq);
    else {
      this.q2.setFromAxisAngle(UP, yaw);
      if (frame) this.q.multiplyQuaternions(frame.q, this.q2);
      else this.q.copy(this.q2);
    }
    if (fig.state !== ST_DYING) {
      fig.wx = this.c.x;
      fig.wy = this.c.y;
      fig.wz = this.c.z;
      fig.wq.copy(this.q);
    }
    pushCrew(asset.lods[this.lodOf(this.c.x, this.c.y, this.c.z)]!, this.c.x, this.c.y, this.c.z, 1, this.q.x, this.q.y, this.q.z, this.q.w, c, t0, rate, weapon, dark);
  }

  private lodOf(x: number, y: number, z: number) {
    const d = Math.hypot(x - this.camPos.x, y - this.camPos.y, z - this.camPos.z);
    return d < 85 ? 0 : d < 230 ? 1 : 2;
  }

  /** Moves a figure on the deck toward its target and picks a new man to fight when his is gone. */
  private stepOnDeck(fig: Figure, rD: Roster) {
    const f = fig.fight;
    const sd = f ? f.sd : fig.tz >= 0 ? 1 : -1;
    // A boarder whose man fell looks for another.
    if (fig.state === ST_DUEL && (!fig.partner || fig.partner.dying >= 0 || fig.partner.gone)) {
      if (fig.partner && fig.partner.duel === fig) fig.partner.duel = null;
      fig.partner = null;
      fig.state = ST_HOLD;
      fig.search = this.time + 0.3;
      this.holdSpot(fig, rD, fig.link ?? f!.links[0]!, sd);
    }
    if (fig.state === ST_HOLD && this.time >= fig.search) {
      fig.search = this.time + 0.6;
      if (f && f.mode === 0 && this.findPartner(fig, rD, fig.px)) fig.state = ST_DUEL;
    }
    if (fig.state === ST_DUEL && fig.partner) this.partnerSpot(fig, rD, sd);
    if (fig.state === ST_RETREAT) {
      const link = fig.link!;
      fig.tx = link.dx + fig.lat;
      fig.tz = link.dz;
    }
    const dx = fig.tx - fig.px;
    const dz = fig.tz - fig.pz;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.02) {
      const step = Math.min(dist, RUN * this.dt);
      fig.px += (dx / dist) * step;
      fig.pz += (dz / dist) * step;
      if (dist > 0.3) fig.yaw = yawTo(dx, dz);
    }
    if (fig.state === ST_RETREAT && dist < 0.35) {
      fig.state = ST_PATH;
      fig.dir = -1;
      fig.u = fig.d1 + fig.d2 + 0.001;
    }
    if (fig.state === ST_HOLD && dist <= 0.3) fig.yaw = lerpAngle(fig.yaw, yawTo(0, -sd), 0.1);
  }

  /** A duel in cycles of a few seconds: both swing and thrust, now and then one of the pair reels from a blow. */
  duelClip(f: Figure, side: number, asset: CrewAsset) {
    const T = 3.4;
    const phase = this.time / T + f.seed * 7;
    const cyc = Math.floor(phase);
    const start = (cyc - f.seed * 7) * T;
    const u = this.time - start;
    const h = frac(Math.sin(cyc * 12.9898 + f.seed * 78.233) * 43758.5453);
    const loser = frac(h * 37.7) < 0.5 ? 0 : 1;
    const p = this.pose;
    if (h < 0.7 && loser === side && u > 1.3 && u < 2.9) {
      p.clip = 'hit';
      p.t0 = start + 1.3;
      p.rate = 1.1;
      return p;
    }
    p.clip = asset.clips.thrust && frac(f.seed * 13 + side * 0.37) > 0.5 ? 'thrust' : 'melee';
    p.t0 = f.seed * 3 + side * 1.1;
    p.rate = 1 + (f.seed - 0.5) * 0.25;
    return p;
  }

  /** The heading a defender takes to face the boarder he is fighting. */
  duelYaw(fig: Figure, x: number, z: number) {
    return yawTo(fig.px - x, fig.pz - z);
  }

  // ---------------------------------------------------------------- the fallen

  /** Throws a body into the air; it falls to the sea with a splash. */
  fall(key: CrewKey, x: number, y: number, z: number, vx: number, vy: number, vz: number) {
    let f: Fallen | null = null;
    for (const o of this.fallen) {
      if (!o.used) {
        f = o;
        break;
      }
    }
    if (!f) f = this.fallen[0]!;
    f.used = true;
    f.x = x;
    f.y = y;
    f.z = z;
    f.vx = vx;
    f.vy = vy;
    f.vz = vz;
    f.spin = 0;
    f.key = key;
    f.age = 0;
    f.splashed = false;
    f.yaw = Math.atan2(vx, vz);
  }

  private drawFallen(assets: Map<CrewKey, CrewAsset>) {
    const dt = this.dt;
    const t = waveField.time;
    for (const f of this.fallen) {
      if (!f.used) continue;
      f.age += dt;
      const h = waveField.heightAt(f.x, f.z, t, 8);
      if (f.y > h - 0.2) {
        f.vy -= G * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.z += f.vz * dt;
        f.spin += dt * 3.2;
      } else {
        if (!f.splashed) {
          f.splashed = true;
          this.splash(f.x, f.z, 1);
        }
        f.y = h - 0.9 - Math.max(0, f.age - 4) * 0.3;
        f.spin = 1.45;
      }
      if (f.age > 12) {
        f.used = false;
        continue;
      }
      const asset = assets.get(f.key);
      if (!asset) continue;
      const clip = asset.clips.die ?? asset.clips.idle!;
      this.q2.setFromAxisAngle(UP, f.yaw);
      this.q.setFromAxisAngle(this.right.set(1, 0, 0), Math.min(1.45, f.spin));
      this.q.premultiply(this.q2);
      pushCrew(asset.lods[this.lodOf(f.x, f.y, f.z)]!, f.x, f.y, f.z, 1, this.q.x, this.q.y, this.q.z, this.q.w, clip, this.time - 10, -1, 0, Math.min(0.8, f.age / 8));
    }
  }

  // ---------------------------------------------------------------- volleys

  /** A shot leaves a rail: a flash for a matchlock, an arrow arcing over for a bow. */
  fire(ship: Ship, battle: Battle, x: number, y: number, z: number, dx: number, dz: number, bow: boolean) {
    if (!bow) {
      this.spawnSprite(x + dx * 0.9, y, z + dz * 0.9, dx * 2, 0.2, dz * 2, 0.4, 1, 0.13, 1, 0.72, 0.3, 1, 0);
      this.spawnSprite(x + dx * 0.8, y, z + dz * 0.8, dx, 0.1, dz, 0.22, 0.5, 0.09, 1, 0.96, 0.8, 1, 0);
      return;
    }
    let a: Arrow | null = null;
    for (const o of this.arrows) {
      if (!o.used) {
        a = o;
        break;
      }
    }
    if (!a) return;
    const target = battle.get(ship.targetId);
    let tx: number;
    let ty: number;
    let tz: number;
    a.tid = 0;
    if (target && battle.isActive(target) && target.team !== ship.team) {
      const rT = this.rosters.get(target.id);
      a.lx = rnd(-0.3, 0.3) * target.spec.length;
      a.ly = (rT ? rT.main : target.spec.deck) + 1;
      a.lz = rnd(-0.35, 0.35) * target.spec.beam;
      this.views.localToWorld(target.id, a.lx, a.ly, a.lz, this.c);
      tx = this.c.x;
      ty = this.c.y;
      tz = this.c.z;
      a.tid = target.id;
    } else {
      tx = x + dx * 70;
      tz = z + dz * 70;
      ty = 0;
    }
    const dist = Math.hypot(tx - x, tz - z);
    a.T = Math.max(0.35, dist / 52);
    a.x0 = x;
    a.y0 = y;
    a.z0 = z;
    a.vx = (tx - x) / a.T;
    a.vz = (tz - z) / a.T;
    a.vy = (ty - y + 0.5 * G * a.T * a.T) / a.T;
    a.t = 0;
    a.hit = 0;
    a.used = true;
  }

  private drawArrows() {
    const dt = this.dt;
    for (const a of this.arrows) {
      if (!a.used) continue;
      a.t += dt;
      if (a.t <= a.T) {
        const t = a.t;
        const x = a.x0 + a.vx * t;
        const y = a.y0 + a.vy * t - 0.5 * G * t * t;
        const z = a.z0 + a.vz * t;
        this.dirv.set(a.vx, a.vy - G * t, a.vz).normalize();
        this.q.setFromUnitVectors(Z_AXIS, this.dirv);
        a.qx = this.q.x;
        a.qy = this.q.y;
        a.qz = this.q.z;
        a.qw = this.q.w;
        this.putBox(x, y, z, a.qx, a.qy, a.qz, a.qw, 0.07, 0.07, 2.2, 0.95, 0.9, 0.75);
        continue;
      }
      if (a.hit === 0) {
        a.hit = this.time;
        if (!a.tid) this.splash(a.x0 + a.vx * a.T, a.z0 + a.vz * a.T, 0.5);
      }
      if (!a.tid || this.time - a.hit > 2.5 || !this.views.states.get(a.tid)) {
        a.used = false;
        continue;
      }
      // Stuck in the deck, it rides with the ship.
      this.views.localToWorld(a.tid, a.lx, a.ly, a.lz, this.c);
      this.putBox(this.c.x, this.c.y, this.c.z, a.qx, a.qy, a.qz, a.qw, 0.06, 0.06, 1.2, 0.95, 0.9, 0.75);
    }
  }

  // ---------------------------------------------------------------- flags

  private drawFlags(battle: Battle) {
    let n = 0;
    for (const c of this.captureList) {
      const r = this.rosters.get(c.id);
      const ship = battle.get(c.id);
      if (!r || !ship || r.live !== this.frame || n >= FLAGS) continue;
      n += 1;
      const L = ship.spec.length;
      const poleH = Math.min(11, Math.max(6, L * 0.3));
      const mx = flagX(r);
      const base = r.main;
      const t = this.time - c.t0;
      // The colours come down, change, and go back up.
      const lowered = smooth(t / 0.9) * (1 - smooth((t - 2.4) / 1.2));
      const top = base + poleH;
      const clothY = top - 0.45 - lowered * poleH * 0.55;
      const mix = smooth((t - 0.9) / 1.5);
      const from = FLAG_COLORS[c.lose]!;
      const to = FLAG_COLORS[c.win]!;
      const w = Math.min(4.6, Math.max(2.2, L * 0.12));
      const sway = Math.sin(this.time * 2.6 + c.id) * 0.12;
      this.views.localToWorld(c.id, mx, base + poleH / 2, 0, this.c);
      this.putBox(this.c.x, this.c.y, this.c.z, r.q.x, r.q.y, r.q.z, r.q.w, 0.1, poleH, 0.1, 0.24, 0.17, 0.11);
      this.q2.setFromAxisAngle(UP, sway);
      this.q.multiplyQuaternions(r.q, this.q2);
      this.views.localToWorld(c.id, mx - w / 2 - 0.05, clothY, 0, this.c);
      this.putBox(this.c.x, this.c.y, this.c.z, this.q.x, this.q.y, this.q.z, this.q.w, w, w * 0.62, 0.04, from[0]! + (to[0]! - from[0]!) * mix, from[1]! + (to[1]! - from[1]!) * mix, from[2]! + (to[2]! - from[2]!) * mix);
    }
  }

  // ---------------------------------------------------------------- sprites

  private spawnSprite(x: number, y: number, z: number, vx: number, vy: number, vz: number, s0: number, s1: number, life: number, r: number, g: number, b: number, a: number, g0: number) {
    for (const s of this.sprites) {
      if (s.used) continue;
      s.used = true;
      s.x = x;
      s.y = y;
      s.z = z;
      s.vx = vx;
      s.vy = vy;
      s.vz = vz;
      s.age = 0;
      s.life = life;
      s.s0 = s0;
      s.s1 = s1;
      s.r = r;
      s.g = g;
      s.b = b;
      s.a = a;
      s.g0 = g0;
      return;
    }
  }

  /** White water thrown up where something hits the sea. */
  splash(x: number, z: number, size: number) {
    const y = waveField.heightAt(x, z, waveField.time, 8);
    for (let i = 0; i < 4; i += 1) {
      this.spawnSprite(x + rnd(-0.3, 0.3) * size, y + 0.1, z + rnd(-0.3, 0.3) * size, rnd(-1, 1) * size, rnd(2.2, 4) * size, rnd(-1, 1) * size, 0.5 * size, 1.5 * size, rnd(0.7, 1.1), 0.88, 0.94, 1, 0.85, 7);
    }
  }

  private drawSprites(camera: Camera) {
    const dt = this.dt;
    const m = this.puffs.instanceMatrix.array as Float32Array;
    const tint = this.puffTint.array as Float32Array;
    const fade = this.puffFade.array as Float32Array;
    const cq = camera.quaternion;
    const x2 = cq.x * 2;
    const y2 = cq.y * 2;
    const z2 = cq.z * 2;
    const xx = cq.x * x2;
    const xy = cq.x * y2;
    const xz = cq.x * z2;
    const yy = cq.y * y2;
    const yz = cq.y * z2;
    const zz = cq.z * z2;
    const wx = cq.w * x2;
    const wy = cq.w * y2;
    const wz = cq.w * z2;
    let n = 0;
    for (const s of this.sprites) {
      if (!s.used) continue;
      s.age += dt;
      if (s.age >= s.life) {
        s.used = false;
        continue;
      }
      const k = s.age / s.life;
      s.vy -= s.g0 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      const size = s.s0 + (s.s1 - s.s0) * k;
      const o = n * 16;
      m[o] = (1 - (yy + zz)) * size;
      m[o + 1] = (xy + wz) * size;
      m[o + 2] = (xz - wy) * size;
      m[o + 3] = 0;
      m[o + 4] = (xy - wz) * size;
      m[o + 5] = (1 - (xx + zz)) * size;
      m[o + 6] = (yz + wx) * size;
      m[o + 7] = 0;
      m[o + 8] = (xz + wy) * size;
      m[o + 9] = (yz - wx) * size;
      m[o + 10] = (1 - (xx + yy)) * size;
      m[o + 11] = 0;
      m[o + 12] = s.x;
      m[o + 13] = s.y;
      m[o + 14] = s.z;
      m[o + 15] = 1;
      tint[n * 3] = s.r;
      tint[n * 3 + 1] = s.g;
      tint[n * 3 + 2] = s.b;
      fade[n] = s.a * (1 - k) * (1 - k * 0.3);
      n += 1;
    }
    this.puffs.count = n;
    this.puffs.visible = n > 0;
    this.puffs.instanceMatrix.needsUpdate = true;
    this.puffTint.needsUpdate = true;
    this.puffFade.needsUpdate = true;
  }

  // ---------------------------------------------------------------- surrender

  /** The pose of a man who has put down his arms: a held crouch. Shaped from the first frames of the fall. */
  kneelClip(asset: CrewAsset): Clip | null {
    const die = asset.clips.die;
    if (!die) return null;
    let c = this.kneel.get(asset.key);
    if (!c) {
      c = { start: die.start, frames: 13, loop: false };
      this.kneel.set(asset.key, c);
    }
    return c;
  }
}
