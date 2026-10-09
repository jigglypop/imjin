import { BoxGeometry, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardNodeMaterial, Quaternion, Vector3, type Camera } from 'three/webgpu';
import { attribute } from 'three/tsl';
import type { Battle } from '../sim/battle';
import type { Faction, Ship } from '../sim/types';
import type { ShipViews } from '../ships/ShipViews';
import { blocked, layoutFor, mainDeck } from '../ships/decks';
import { waveField } from '../ocean/waves';
import { equipment } from '../game/quality';
import { pushCrew, type Clip, type ClipName, type CrewAsset, type CrewKey } from './crewModels';
import { CAST, GUN, HAND_ARMS, MELEE, OFFICER, SHOT, figureScale, frac, lerpAngle, rnd, smooth, yawTo, type Member, type Roster, type Station } from './crewTypes';
import { ArrowField } from './arrows';
import { PuffField } from './puffs';

/** What a tier of device can afford to show at once. `perFight` caps the men crossing and fighting for one grappled pair. */
const BUDGET = {
  high: { figures: 120, fights: 8, perFight: 40, fallen: 64 },
  medium: { figures: 72, fights: 5, perFight: 24, fallen: 40 },
  low: { figures: 28, fights: 3, perFight: 12, fallen: 20 },
}[equipment.tier];

const WALK = 3.4;
const RUN = 4.3;
const CORPSE = 4;
const MAX_LINKS = 3;
const ROPE_SEGS = 5;
const PROPS_PER_LINK = 2 * ROPE_SEGS + 2 + 3;
const FLAGS = 8;
/** Boxes of a flag: pole, four strips of cloth. */
const FLAG_BOXES = 5;
/** Weapons a beaten crew lets fall, per captured ship, two boxes each. */
const DROPS = 8;
const PROPS = BUDGET.fights * MAX_LINKS * PROPS_PER_LINK + FLAGS * (FLAG_BOXES + DROPS * 2);

const PARTNERS = [MELEE, SHOT, GUN, OFFICER];
const PARTNER_PENALTY = [0, 4, 9, 12];

const ST_PATH = 0;
export const ST_DUEL = 1;
const ST_HOLD = 2;
const ST_RALLY = 3;
const ST_RETREAT = 4;
const ST_DYING = 5;

/** How a boarder gets over: along a plank, in a leap from rail to rail, or hand over hand on a grappling rope. */
const PLANK = 0;
const LEAP = 1;
const ROPE = 2;

/**
 * Flag colours by navy: faded indigo for Joseon, oxblood for Japan, ochre for Ming; the last is the dull white of a
 * surrender.
 */
const FLAG_COLORS: [number, number, number][] = [
  [0.2, 0.27, 0.4],
  [0.46, 0.17, 0.14],
  [0.64, 0.5, 0.2],
  [0.86, 0.84, 0.78],
];
const FACTION_INDEX: Record<Faction, number> = { joseon: 0, japan: 1, ming: 2 };

type Link = {
  /** Rail points on the grappling ship (a) and the held ship (d), in each ship's own frame: the top of the rail. */
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
  /** How he crosses: PLANK, LEAP or ROPE. */
  style: number;
  u: number;
  dir: number;
  /** Time on the grappling ship's deck: walk to the foot of the rail (up to dw), then vault onto it. */
  d1: number;
  dw: number;
  /** Time crossing, and time on the held ship from the rail to his place. */
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
  /** Battle time of the next flash of steel while he duels. */
  spark: number;
  /** He fights from the top of the enemy's rail, over the heads of its crew; up is how high he stands above the deck. */
  rail: boolean;
  up: number;
  /** Battle time he stops holding the rail when no man is left to fight there. */
  railUntil: number;
};

type Fallen = { used: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number; key: CrewKey; age: number; splashed: boolean; yaw: number };
/** A weapon a beaten man lets fall, in the ship's own frame. */
type Drop = { x: number; z: number; yaw: number; len: number; late: number };
type Capture = { id: number; t0: number; win: number; lose: number; by: number; drops: Drop[]; dropped: boolean };

export type Placement = { x: number; z: number; yaw: number };

const G = 9.81;
const UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);

/** Along-ship position of the pole the flag flies from: forward of the command tower, which would hide it. */
export function flagX(r: Roster) {
  return r.len * 0.3;
}

/**
 * Where a man really stands. When an enemy is alongside the crew leaves its stations and crowds the rail on that
 * side, so fighters meet on the contact line instead of each at his own post.
 */
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
  const lay = r.layout;
  const tx = Math.max(lay.x0, Math.min(lay.x1, r.cx[k]! + (s1 - 0.5) * 7));
  // Packed against the rail, in rows; a tower or cabin there pushes them out to the rail itself.
  let tz = side * Math.max(0.8, lay.edge(tx) - 0.55 - 1.25 * s2);
  if (blocked(lay, tx, tz, 0.35)) tz = side * Math.max(0.8, lay.edge(tx) - 0.45);
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
  /** Arrows in the air and in the planks, and the smoke, flashes and splashes of the scene. */
  readonly arrows: ArrowField;
  readonly puffs: PuffField;
  private readonly fights: Fight[] = [];
  private readonly figs: Figure[] = [];
  private readonly fallen: Fallen[] = [];
  private readonly captures = new Map<number, Capture>();
  private readonly captureList: Capture[] = [];
  private readonly lastAttacker = new Map<number, number>();
  private readonly cheerUntil = new Map<number, number>();
  private readonly kneel = new Map<CrewKey, Clip>();
  private readonly props: InstancedMesh;
  private readonly propColor: InstancedBufferAttribute;
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
  private readonly q3 = new Quaternion();
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
        used: false, fight: null, link: null, mem: null, partner: null, partnerRole: 0, from: 0, to: 0, key: 'rower', faction: 'joseon', role: MELEE, seed: 0, state: 0, style: PLANK, u: 0, dir: 1, d1: 1, dw: 1, d2: 1, d3: 1,
        sx: 0, sz: 0, lat: 0, tx: 0, tz: 0, px: 0, pz: 0, landed: false, wx: 0, wy: 0, wz: 0, wq: new Quaternion(), yaw: 0, dieAt: 0, hurt: 0, fling: 0, search: 0, born: 0, rally: 0, spark: 0, rail: false, up: 0, railUntil: 0,
      });
    }
    for (let i = 0; i < BUDGET.fallen; i += 1) this.fallen.push({ used: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, key: 'rower', age: 0, splashed: false, yaw: 0 });

    // Ropes, planks, hooks, flags and dropped weapons are boxes of one instanced mesh, each with its own colour.
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

    this.puffs = new PuffField();
    this.arrows = new ArrowField(views, this.puffs);
    this.group.add(this.arrows.group);
    this.group.add(this.puffs.group);
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
    const drops: Drop[] = [];
    for (let i = 0; i < DROPS; i += 1) drops.push({ x: 0, z: 0, yaw: 0, len: 1, late: 0 });
    const capture = { id, t0: this.time, win: victor ? FACTION_INDEX[victor.spec.faction] : 3, lose: FACTION_INDEX[ship.spec.faction], by: win, drops, dropped: false };
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
    // Links: spread along the grappling ship at its boarding points, each meeting the nearest rail point on the other.
    const want = equipment.tier === 'low' ? 2 : sa.spec.length > 26 ? 3 : 2;
    f.nlinks = want;
    const la = rA.layout;
    const ld = rD.layout;
    const pts = la.boarding;
    for (let k = 0; k < want; k += 1) {
      const link = f.links[k]!;
      const pick = Math.round((k * (pts.length - 1)) / (want - 1));
      let xa = pts[Math.min(pts.length - 1, pick)]!;
      if (k > 0 && Math.abs(xa - f.links[k - 1]!.ax) < 2) xa = f.links[k - 1]!.ax + 4;
      xa = Math.max(la.x0 + 1, Math.min(la.x1 - 1, xa));
      link.ax = xa;
      link.az = f.sa * (la.edge(xa) + 0.1);
      link.ay = rA.main + la.railUp;
      this.views.localToWorld(sa.id, link.ax, link.ay, link.az, this.a);
      let best = 1e9;
      let bx = 0;
      const span = ld.x1 - ld.x0 - 3;
      for (let i = 0; i <= 12; i += 1) {
        const xd = ld.x0 + 1.5 + (span * i) / 12;
        this.views.localToWorld(sd.id, xd, rD.main + ld.railUp, f.sd * (ld.edge(xd) + 0.1), this.b);
        const d = this.a.distanceToSquared(this.b);
        if (d < best) {
          best = d;
          bx = xd;
        }
      }
      link.dx = bx;
      link.dz = f.sd * (ld.edge(bx) + 0.1);
      link.dy = rD.main + ld.railUp;
      const gap = Math.sqrt(best);
      // A plank only where the rails are about level; a high wall is climbed by rope.
      this.views.localToWorld(sd.id, link.dx, link.dy, link.dz, this.b);
      link.plank = gap >= 4.5 && gap < 17 && Math.abs(this.b.y - this.a.y) < 1.5;
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
      this.clear(rD, fig);
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

  /** Moves a figure's target out of a cabin or tower, to the open deck beside it. */
  private clear(rD: Roster, fig: Figure) {
    const lay = rD.layout;
    fig.tx = Math.max(lay.x0, Math.min(lay.x1, fig.tx));
    const edge = lay.edge(fig.tx);
    fig.tz = Math.max(-edge + 0.4, Math.min(edge - 0.4, fig.tz));
    if (blocked(lay, fig.tx, fig.tz, 0.3)) fig.tz = (fig.tz >= 0 ? 1 : -1) * Math.max(0.6, edge - 0.7);
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

  /**
   * Lends men from the grappling ship to the rail, in waves that follow its fighting strength: a ship full of
   * soldiers sends a crowd, a weak one a handful, and no pair puts more than the tier's share on screen.
   */
  private sendBoarders(f: Fight, a: Ship, d: Ship, rA: Roster, rD: Roster) {
    const age = this.time - f.t0;
    const ready = f.links[0]!.plank ? 1.2 : 0.8;
    if (age < ready) return;
    const full = Math.max(1, a.spec.crew * (a.spec.crewPlan[MELEE]! + a.spec.crewPlan[SHOT]! * 0.6));
    const men = a.roles[MELEE] + a.roles[SHOT] * 0.6;
    const strength = Math.min(1.2, men / full);
    f.acc = Math.min(6, f.acc + this.dt * (1.8 + 4.4 * strength));
    if (f.acc < 1) return;
    // The men on screen for this pair: as many as its fighters are worth, a body for every few real men.
    const want = Math.max(4, Math.min(BUDGET.perFight, Math.round(men / 4.5)));
    let mine = 0;
    for (const fig of this.figs) if (fig.used && fig.fight === f && fig.state !== ST_DYING) mine += 1;
    if (mine >= want) return;
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
    if (free + away <= 0 || away >= (free + away) * 0.85) return;
    let spawned = 0;
    while (f.acc >= 1 && spawned < 4 && mine + spawned < want) {
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
    this.views.localToWorld(a.id, link.ax, link.ay, link.az, this.a);
    this.views.localToWorld(d.id, link.dx, link.dy, link.dz, this.b);
    const gap = this.a.distanceTo(this.b);
    const reach = Math.hypot(this.b.x - this.a.x, this.b.z - this.a.z);
    const rise = this.b.y - this.a.y;
    const roll = frac(mem.seed * 71.3);
    // A plank where the hulls lie apart, a leap where the rails are within reach, a rope where the wall is high.
    let style: number;
    if (link.plank && reach > 3.5 && link.cut < 0) style = roll < 0.7 || reach > 8 ? PLANK : LEAP;
    else if (reach <= 7 && rise <= 1.4) style = roll < 0.78 ? LEAP : ROPE;
    else style = ROPE;
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
    fig.style = style;
    fig.u = 0;
    fig.dir = 1;
    fig.sx = this.pl.x;
    fig.sz = this.pl.z;
    // Across the rail men spread along it; on a rope they hang from one of the two lines; on a plank they keep to it.
    fig.lat = style === ROPE ? (roll < 0.5 ? -1.3 : 1.3) + (frac(mem.seed * 53.1) - 0.5) * 0.3 : style === PLANK ? (frac(mem.seed * 53.1) - 0.5) * 0.5 : (frac(mem.seed * 53.1) - 0.5) * 5;
    fig.landed = false;
    fig.born = this.time;
    fig.partner = null;
    fig.search = 0;
    fig.spark = this.time + 0.6 + Math.random();
    // Some climb up on the enemy's wall and fight from it, in sight of the camera.
    fig.rail = rD.layout.railUp >= 0.9 && frac(mem.seed * 19.7) < 0.45;
    fig.up = 0;
    fig.railUntil = 0;
    mem.away = true;
    const railUp = link.ay - rA.main;
    const foot = Math.abs(link.az) - 0.6;
    fig.dw = Math.max(0.3, Math.hypot(link.ax + fig.lat - fig.sx, Math.sign(link.az) * foot - fig.sz) / RUN);
    fig.d1 = fig.dw + 0.16 + railUp * 0.12;
    if (style === PLANK) fig.d2 = Math.max(0.6, gap / WALK);
    else if (style === LEAP) fig.d2 = Math.max(0.5, 0.38 + gap * 0.06);
    else fig.d2 = Math.max(0.9, gap / 2.6 + Math.max(0, rise) / 1.4 + 0.3);
    if (this.findPartner(fig, rD, link.dx)) this.partnerSpot(fig, rD, f.sd);
    else this.holdSpot(fig, rD, link, f.sd);
    fig.d3 = Math.max(0.5, Math.hypot(fig.tx - link.dx, fig.tz - link.dz) / RUN + 0.2);
    return fig;
  }

  private holdSpot(fig: Figure, rD: Roster, link: Link, sd: number) {
    if (fig.rail) {
      fig.tx = link.dx + fig.lat;
      fig.tz = link.dz;
      return;
    }
    fig.tx = link.dx + (frac(fig.seed * 29) - 0.5) * 5;
    fig.tz = sd * Math.max(0.6, rD.layout.edge(fig.tx) - 1.0 - frac(fig.seed * 61) * 2.2);
    this.clear(rD, fig);
  }

  /** Stands the boarder against his man, on the side nearest the rail he came over. */
  private partnerSpot(fig: Figure, rD: Roster, sd: number) {
    const m = fig.partner!;
    const st = rD.stations[fig.partnerRole]![m.station]!;
    placement(rD, fig.partnerRole, m, st, this.pl2);
    if (fig.rail) {
      // On the wall above his man, who looks up at him.
      fig.tx = this.pl2.x + (frac(fig.seed * 23) - 0.5) * 0.8;
      fig.tz = sd * (rD.layout.edge(fig.tx) + 0.1);
      fig.yaw = yawTo(this.pl2.x - fig.tx, this.pl2.z - fig.tz);
      return;
    }
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
    this.drawFlags(battle);
    this.arrows.update(this.dt, this.camPos);
    this.puffs.update(this.dt, camera);
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

  /** Sag of a rope of this slack between two points, metres. */
  private sag(d: number, rest: number) {
    return Math.min(3.2, Math.sqrt(Math.max(0, (3 * d * (rest - d)) / 8)) + 0.08);
  }

  /** A rope hanging between two points, sagging while it is slack. */
  private putRope(ax: number, ay: number, az: number, bx: number, by: number, bz: number, rest: number, grow: number, fall: number, thick: number) {
    const d = Math.hypot(bx - ax, by - ay, bz - az);
    const sag = this.sag(d, rest) + fall * 0.8;
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
      this.putSeg(px, py, pz, nx, ny, nz, thick, 0.075, 0.058, 0.04);
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
      const reach = Math.hypot(this.b.x - this.a.x, this.b.z - this.a.z);
      if (l.cut < 0 && gap > l.rest * 1.5 + 3) l.cut = this.time;
      // The crews haul the lines in as the hulls close, so a rope a man climbs is a taut one.
      if (l.cut < 0) l.rest = Math.min(l.rest, gap * 1.04 + 0.4);
      // Ropes and planks are thicker the farther the camera, so a link still shows at the battle camera's distance.
      const tg = Math.max(1, Math.min(3, Math.hypot(this.a.x - this.camPos.x, this.a.y - this.camPos.y, this.a.z - this.camPos.z) / 70));
      const ax = this.a.x;
      const ay = this.a.y;
      const az = this.a.z;
      const bx = this.b.x;
      const by = this.b.y;
      const bz = this.b.z;
      // Two ropes a body-width apart on each link.
      for (let side = -1; side <= 1; side += 2) {
        this.views.localToWorld(f.a, l.ax + side * 1.3, l.ay + 0.15, l.az, this.c);
        const sx = this.c.x;
        const sy = this.c.y;
        const sz = this.c.z;
        this.views.localToWorld(f.d, l.dx + side * 1.3, l.dy + 0.05, l.dz, this.c);
        this.putRope(sx, sy, sz, this.c.x, this.c.y, this.c.z, l.rest, grow, fall, 0.085 * tg);
        if (grow >= 1) {
          this.putBox(this.c.x, this.c.y - fall * fall * 4.9, this.c.z, 0, 0, 0, 1, 0.22 * tg, 0.16 * tg, 0.22 * tg, 0.04, 0.04, 0.045);
        }
      }
      if (l.plank && reach > 3.2 && age > 0.6) {
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
        this.putBox(ax + this.dirv.x * half, ay + this.dirv.y * half - drop, az + this.dirv.z * half, this.q2.x, this.q2.y, this.q2.z, this.q2.w, 0.95 * Math.min(tg, 2), 0.12 * tg, len, 0.1, 0.07, 0.045);
        // The side rails of the walkway.
        if (lay >= 1) {
          for (let side = -1; side <= 1; side += 2) {
            this.putBox(ax + this.dirv.x * half + this.right.x * side * 0.45, ay + this.dirv.y * half - drop + 0.06, az + this.dirv.z * half + this.right.z * side * 0.45, this.q2.x, this.q2.y, this.q2.z, this.q2.w, 0.06, 0.1, len, 0.07, 0.05, 0.035);
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
    let lean = 0;
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
        fig.up = fig.rail ? link.dy - rD.main : 0;
        if (f && f.mode === 0) {
          fig.state = fig.partner ? ST_DUEL : ST_HOLD;
          fig.search = this.time + 0.5;
          fig.railUntil = this.time + 2.5;
        } else if (f) this.rally(fig, f);
      }
      const u = fig.u;
      clip = 'run';
      rate = 1.15;
      t0 = fig.born;
      if (u < fig.d1) {
        // Run to the foot of the rail, then vault up on it.
        const k = smooth(Math.min(1, u / fig.dw));
        const v = u > fig.dw ? smooth((u - fig.dw) / (fig.d1 - fig.dw)) : 0;
        const foot = Math.sign(link.az) * (Math.abs(link.az) - 0.6);
        const lx = fig.sx + (link.ax + fig.lat - fig.sx) * k;
        const lz = fig.sz + (foot - fig.sz) * k + (link.az - foot) * v;
        this.views.localToWorld(fig.from, lx, rA!.main + (link.ay - rA!.main) * v, lz, this.c);
        yaw = yawTo(link.ax + fig.lat - fig.sx, link.az - fig.sz);
        frame = rA!;
      } else if (u < fig.d1 + fig.d2) {
        const k = (u - fig.d1) / fig.d2;
        this.views.localToWorld(fig.from, link.ax + fig.lat, link.ay, link.az, this.a);
        this.views.localToWorld(fig.to, link.dx + fig.lat, link.dy, link.dz, this.b);
        const dx = this.b.x - this.a.x;
        const dz = this.b.z - this.a.z;
        const len = Math.hypot(dx, dz) || 1;
        const cut = link.cut >= 0 && this.time > link.cut;
        let style = fig.style;
        if (style === PLANK && cut) style = LEAP;
        if (style === ROPE && cut) {
          // The line is gone with him on it.
          this.fall(fig.key, this.a.x + dx * k, this.a.y + (this.b.y - this.a.y) * k - 1, this.a.z + dz * k, dx * 0.4, 0.5, dz * 0.4);
          if (fig.mem) fig.mem.gone = true;
          this.release(fig);
          return;
        }
        yaw = yawTo(dx, dz);
        if (style === PLANK) {
          // Offsets across the plank so the men do not walk through one another.
          const off = fig.lat * 0.6;
          this.c.set(this.a.x + dx * k - (dz / len) * off, this.a.y + (this.b.y - this.a.y) * k, this.a.z + dz * k + (dx / len) * off);
        } else if (style === LEAP) {
          // Over the rail in an arc, weapon up, coming down on the far wall.
          const arc = 0.6 + Math.hypot(dx, dz) * 0.12;
          this.c.set(this.a.x + dx * k, this.a.y + (this.b.y - this.a.y) * k + Math.sin(k * Math.PI) * arc, this.a.z + dz * k);
          clip = 'melee';
          rate = 1.3;
          t0 = this.time - k * fig.d2;
          lean = 0.3 * Math.sin(k * Math.PI);
        } else {
          // Hand over hand along the grappling rope, the body hanging below it.
          const d = Math.hypot(dx, dz, this.b.y - this.a.y);
          const hang = 1.25 * smooth(Math.min(1, Math.min(k, 1 - k) * 7));
          this.c.set(this.a.x + dx * k, this.a.y + (this.b.y - this.a.y) * k - this.sag(d, link.rest) * 4 * k * (1 - k) - hang, this.a.z + dz * k);
          clip = 'cheer';
          rate = 1.5;
          t0 = fig.born + fig.seed;
        }
      } else {
        // Over the far rail and down on the deck.
        const k = smooth((u - fig.d1 - fig.d2) / fig.d3);
        const lx = link.dx + fig.lat + (fig.tx - link.dx - fig.lat) * k;
        const lz = link.dz + (fig.tz - link.dz) * k;
        const s = Math.min(1, (u - fig.d1 - fig.d2) / (fig.d3 * 0.45));
        this.views.localToWorld(fig.to, lx, rD.main + (link.dy - rD.main) * (fig.rail ? 1 : 1 - s * s), lz, this.c);
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
      this.views.localToWorld(fig.to, fig.px, rD.main + fig.up, fig.pz, this.c);
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
        this.clash(fig, rD);
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
        this.views.localToWorld(fig.to, fig.px, rD.main + fig.up, fig.pz, this.c);
        frame = rD;
        yaw = fig.yaw;
      } else this.c.set(fig.wx, fig.wy, fig.wz);
      if (this.time < fig.dieAt) {
        clip = 'hit';
        rate = 1.5;
        t0 = fig.hurt;
      } else if (fig.fling !== 0 || !fig.landed || fig.up > 0.5) {
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
      if (lean !== 0) this.q.multiply(this.q3.setFromAxisAngle(X_AXIS, lean));
    }
    if (fig.state !== ST_DYING) {
      fig.wx = this.c.x;
      fig.wy = this.c.y;
      fig.wz = this.c.z;
      fig.wq.copy(this.q);
    }
    const dist = Math.hypot(this.c.x - this.camPos.x, this.c.y - this.camPos.y, this.c.z - this.camPos.z);
    pushCrew(asset.lods[this.lodAt(dist)]!, this.c.x, this.c.y, this.c.z, figureScale(dist), this.q.x, this.q.y, this.q.z, this.q.w, c, t0, rate, weapon, dark);
  }

  private lodAt(d: number) {
    return d < 85 ? 0 : d < 230 ? 1 : 2;
  }

  /** The glint where a boarder's blade meets his man's, now and then, and a pale puff of splinters with it. */
  private clash(fig: Figure, rD: Roster) {
    if (this.time < fig.spark) return;
    fig.spark = this.time + 0.45 + Math.random() * 0.9;
    const dist = Math.hypot(this.c.x - this.camPos.x, this.c.y - this.camPos.y, this.c.z - this.camPos.z);
    if (dist > 190 || this.puffs.room < 14) return;
    this.dirv.set(Math.sin(fig.yaw), 0, Math.cos(fig.yaw)).applyQuaternion(rD.q);
    this.puffs.spark(this.c.x + this.dirv.x * 0.55, this.c.y + 1.3, this.c.z + this.dirv.z * 0.55, Math.max(1, dist / 55));
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
      fig.railUntil = this.time + 1.4;
      this.holdSpot(fig, rD, fig.link ?? f!.links[0]!, sd);
    }
    if (fig.state === ST_HOLD && this.time >= fig.search) {
      fig.search = this.time + 0.6;
      if (f && f.mode === 0 && this.findPartner(fig, rD, fig.px)) fig.state = ST_DUEL;
    }
    if (fig.state === ST_DUEL && fig.partner) this.partnerSpot(fig, rD, sd);
    // A man on the wall with nobody to fight comes down after a moment; one with a man below stays up.
    if (fig.rail && fig.state === ST_HOLD && this.time > fig.railUntil) fig.rail = false;
    const up = fig.rail && (fig.state === ST_DUEL || fig.state === ST_HOLD) ? (fig.link ? fig.link.dy - rD.main : 0) : 0;
    fig.up += (up - fig.up) * Math.min(1, this.dt * 6);
    if (fig.state === ST_HOLD && !fig.rail && fig.up > 0.05) this.holdSpot(fig, rD, fig.link ?? f!.links[0]!, sd);
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
      // Back over the rail the way he came: he climbs the wall first.
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
          this.splash(f.x, f.z, 1.1);
        }
        f.y = h - 0.9 - Math.max(0, f.age - 3) * 0.35;
        f.spin = 1.45;
      }
      if (f.age > 9) {
        f.used = false;
        continue;
      }
      const asset = assets.get(f.key);
      if (!asset) continue;
      const clip = asset.clips.die ?? asset.clips.idle!;
      this.q2.setFromAxisAngle(UP, f.yaw);
      this.q.setFromAxisAngle(this.right.set(1, 0, 0), Math.min(1.45, f.spin));
      this.q.premultiply(this.q2);
      const dist = Math.hypot(f.x - this.camPos.x, f.y - this.camPos.y, f.z - this.camPos.z);
      pushCrew(asset.lods[this.lodAt(dist)]!, f.x, f.y, f.z, figureScale(dist), this.q.x, this.q.y, this.q.z, this.q.w, clip, this.time - 10, -1, 0, Math.min(0.8, f.age / 7));
    }
  }

  // ---------------------------------------------------------------- volleys

  /**
   * A shot leaves a rail: a flash and white smoke for a matchlock, an arrow arcing over for a bow. The arrow flies
   * at a man's ship and lands in its deck or hull, or falls short into the sea.
   */
  fire(ship: Ship, battle: Battle, x: number, y: number, z: number, dx: number, dz: number, bow: boolean) {
    const far = Math.hypot(x - this.camPos.x, y - this.camPos.y, z - this.camPos.z);
    if (!bow) {
      this.puffs.gunshot(x, y, z, dx, dz, Math.max(1, Math.min(2.6, far / 70)));
      return;
    }
    const target = battle.get(ship.targetId);
    if (target && battle.isActive(target) && target.team !== ship.team) {
      const dist = Math.hypot(target.x - x, target.z - z);
      const T = Math.max(0.5, dist / 56);
      if (Math.random() < 0.22) {
        // Short or long of the ship: the sea takes it.
        const ux = (target.x - x) / (dist || 1);
        const uz = (target.z - z) / (dist || 1);
        const along = dist + rnd(-10, 5);
        const side = rnd(-5, 5);
        const wx = x + ux * along - uz * side;
        const wz = z + uz * along + ux * side;
        this.arrows.launch(x, y, z, 0, wx, waveField.heightAt(wx, wz, waveField.time, 8), wz, T);
        return;
      }
      this.hitPoint(target, x, z);
      this.arrows.launch(x, y, z, target.id, this.a.x, this.a.y, this.a.z, T);
      return;
    }
    // Nothing to aim at: the arrow drops in the water ahead.
    const wx = x + dx * 70;
    const wz = z + dz * 70;
    this.arrows.launch(x, y, z, 0, wx, waveField.heightAt(wx, wz, waveField.time, 8), wz, 1.3);
  }

  /** A place on the target ship, in its own frame, for an arrow from (sx, sz): in the planks of the deck or in the wall facing the shooter. */
  private hitPoint(target: Ship, sx: number, sz: number) {
    const key = this.views.states.get(target.id)?.key ?? `${target.spec.kind}#0`;
    const lay = layoutFor(key, target.spec.kind, target.spec.length, target.spec.beam);
    const main = mainDeck(key, target.spec.kind, target.spec.deck);
    const c = Math.cos(target.heading);
    const s = Math.sin(target.heading);
    const side = -(sx - target.x) * s + (sz - target.z) * c >= 0 ? 1 : -1;
    const x = lay.x0 + 1 + (lay.x1 - lay.x0 - 2) * Math.random();
    if (Math.random() < 0.3) {
      this.a.set(x, main + rnd(-1.1, lay.railUp * 0.85), side * (lay.edge(x) + 0.35));
      return;
    }
    let z = (Math.random() * 2 - 1) * lay.edge(x) * 0.85;
    for (let i = 0; i < 4 && blocked(lay, x, z, 0.1); i += 1) z = (Math.random() * 2 - 1) * lay.edge(x) * 0.85;
    // A cabin or tower in the way: the arrow sticks in its wall instead.
    if (blocked(lay, x, z, 0.1)) this.a.set(x, main + rnd(0.3, 1.2), side * (lay.edge(x) + 0.35));
    else this.a.set(x, main, z);
  }

  // ---------------------------------------------------------------- flags

  private drawFlags(battle: Battle) {
    let n = 0;
    for (const c of this.captureList) {
      const r = this.rosters.get(c.id);
      const ship = battle.get(c.id);
      if (!r || !ship || r.live !== this.frame || n >= FLAGS) continue;
      n += 1;
      const t = this.time - c.t0;
      if (!c.dropped) this.dropArms(c, r);
      this.drawDrops(c, r, t);
      const L = ship.spec.length;
      // From the battle camera a flag is a few pixels: it grows with the distance, up to twice its size.
      const grow = Math.max(1, Math.min(2.2, r.dist / 120));
      const poleH = Math.min(11, Math.max(6.5, L * 0.3)) * (0.85 + grow * 0.15);
      const mx = flagX(r);
      const base = r.main;
      // The colours come down, change, and go back up.
      const lowered = smooth(t / 0.9) * (1 - smooth((t - 2.4) / 1.2));
      const top = base + poleH;
      const clothY = top - 0.45 - lowered * poleH * 0.55;
      const mix = smooth((t - 0.9) / 1.5);
      const from = FLAG_COLORS[c.lose]!;
      const to = FLAG_COLORS[c.win]!;
      const w = Math.min(4.6, Math.max(2.2, L * 0.12)) * grow;
      this.views.localToWorld(c.id, mx, base + poleH / 2, 0, this.c);
      this.putBox(this.c.x, this.c.y, this.c.z, r.q.x, r.q.y, r.q.z, r.q.w, 0.1 * grow, poleH, 0.1 * grow, 0.22, 0.16, 0.11);
      // The cloth is four strips that ripple one after another.
      const strips = FLAG_BOXES - 1;
      const sw = w / strips;
      for (let i = 0; i < strips; i += 1) {
        const ripple = Math.sin(this.time * 3.1 - i * 1.1 + c.id) * 0.1 * (i + 1) * grow;
        this.q2.setFromAxisAngle(UP, ripple * 0.8);
        this.q.multiplyQuaternions(r.q, this.q2);
        this.views.localToWorld(c.id, mx - (i + 0.5) * sw - 0.05, clothY + Math.sin(this.time * 2.3 - i * 0.9 + c.id) * 0.06 * grow, ripple, this.c);
        const shade = 0.94 + 0.08 * Math.sin(i * 1.9 + this.time * 2.2 + c.id);
        this.putBox(
          this.c.x,
          this.c.y,
          this.c.z,
          this.q.x,
          this.q.y,
          this.q.z,
          this.q.w,
          sw * 1.02,
          w * 0.62,
          0.04 * grow,
          (from[0]! + (to[0]! - from[0]!) * mix) * shade,
          (from[1]! + (to[1]! - from[1]!) * mix) * shade,
          (from[2]! + (to[2]! - from[2]!) * mix) * shade,
        );
      }
    }
  }

  /** Picks the men who will throw their weapons down: where they stand, which way the weapon lies. */
  private dropArms(c: Capture, r: Roster) {
    c.dropped = true;
    let n = 0;
    for (let role = MELEE; role >= SHOT && n < DROPS; role -= 1) {
      const list = r.members[role]!;
      for (let i = 0; i < list.length && n < DROPS; i += 1) {
        const m = list[i]!;
        if (m.dying >= 0 || m.gone || m.away) continue;
        const st = r.stations[role]![m.station]!;
        placement(r, role, m, st, this.pl);
        const d = c.drops[n]!;
        d.x = this.pl.x + Math.sin(this.pl.yaw) * 0.5;
        d.z = this.pl.z + Math.cos(this.pl.yaw) * 0.5;
        d.yaw = (frac(m.seed * 43.7) - 0.5) * 2.4 + (role === MELEE ? 0.6 : 2.2);
        d.len = role === MELEE ? 1.1 : 2.2;
        d.late = 0.15 + frac(m.seed * 17.3) * 0.7;
        n += 1;
      }
    }
    // The rest stay out of the count.
    for (let i = n; i < DROPS; i += 1) c.drops[i]!.len = 0;
  }

  /** Spears and swords falling from the hands of the beaten and lying on the deck. */
  private drawDrops(c: Capture, r: Roster, t: number) {
    for (const d of c.drops) {
      if (d.len <= 0) continue;
      const s = Math.min(1, (t - d.late) / 0.45);
      if (s <= 0) continue;
      // Falls from the hand and tumbles flat.
      const y = r.main + 0.08 + 1.0 * (1 - s * s);
      this.q2.setFromAxisAngle(UP, d.yaw);
      this.q3.setFromAxisAngle(X_AXIS, (1 - s) * 1.1);
      this.q.multiplyQuaternions(r.q, this.q2).multiply(this.q3);
      this.views.localToWorld(c.id, d.x, y, d.z, this.c);
      this.putBox(this.c.x, this.c.y, this.c.z, this.q.x, this.q.y, this.q.z, this.q.w, 0.07, 0.07, d.len, 0.34, 0.25, 0.16);
      // The head, dark iron, at the tip.
      this.dirv.set(0, 0, d.len * 0.5).applyQuaternion(this.q);
      this.putBox(this.c.x + this.dirv.x, this.c.y + this.dirv.y, this.c.z + this.dirv.z, this.q.x, this.q.y, this.q.z, this.q.w, 0.09, 0.09, d.len > 1.5 ? 0.3 : 0.16, 0.2, 0.2, 0.21);
    }
  }

  // ---------------------------------------------------------------- splashes

  /** White water thrown up where something hits the sea. */
  splash(x: number, z: number, size: number) {
    this.puffs.splash(x, waveField.heightAt(x, z, waveField.time, 8), z, size);
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
