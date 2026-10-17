import type { Faction } from '../sim/types';
import { Group, Quaternion, Vector3, type Camera } from 'three/webgpu';
import type { Battle } from '../sim/battle';
import type { BattleEvent, Ship, Team } from '../sim/types';
import type { ShipViews } from '../ships/ShipViews';
import { DECKS, blocked, layoutFor, mainDeck, type DeckLayout, type DeckPlan } from '../ships/decks';
import { byModel } from '../ships/anchors';
import { equipment } from '../game/quality';
import { beginCrew, crewTime, endCrew, loadCrew, pushCrew, type Clip, type ClipName, type CrewAsset, type CrewKey } from './crewModels';
import { disposeTree } from '../render/dispose';
import { Boarding, ST_DUEL, placement } from './Boarding';
import { DeckGear } from './deckGear';
import {
  ARMS,
  CAST,
  CREW_RANGE,
  DRUM,
  GUN,
  HAND_ARMS,
  MELEE,
  NO_WEAPON,
  OAR,
  OFFICER,
  ROLES,
  SHOT,
  W,
  deathClip,
  figureScale,
  frac,
  layBody,
  lerpAngle,
  rnd,
  seeded,
  smooth,
  yawTo,
  type Deck,
  type Member,
  type Roster,
  type Station,
} from './crewTypes';

const LOD_NEAR = { high: 85, medium: 65, low: 45 }[equipment.tier];
const LOD_MID = { high: 230, medium: 180, low: 140 }[equipment.tier];
const DEATH = 2.6;
/** Fighting men are drawn in greater numbers where the device can take it, so a boarding looks like a crowd. */
const FIGHTERS = { high: 2.2, medium: 1.6, low: 1.15 }[equipment.tier];
/** Men who leave their posts to carry water when the ship burns, by tier. */
const FIREFIGHTERS = { high: 4, medium: 3, low: 2 }[equipment.tier];
/** Frame of the archers' shoot clip at which the arrow is loosed, and how long the clip plays on after it. */
const BOW = { frame: 35, tail: 1.7 };
/** Seconds an archer then reaches back to his quiver for the next arrow. */
const BOW_REARM = 1.6;
/** Seconds a matchlock man holds his aim through the recoil, then spends reloading. */
const GUN_RECOIL = 0.5;
const GUN_RELOAD = 7;
const FPS = 15;
/** Leading frames of the bow soldiers' shoot clip that hold no pose. */
const SHOOT_SKIP = 11;
/** Height of the top of a wall above a shooter's feet that he can shoot over, and the least firing step worth building. */
const STEP_CLEAR = 1.2;
const STEP_MIN = 0.2;
/** How long a ship's drum beats the charge after the leader's drum was sounded (the 'drum' event). */
const DRUM_CALL = 8;
/** Where a hit lands, by ship, so the men near it are the ones who fall and are thrown over the side. */
type Hit = { x: number; z: number; t: number };

function stations(ship: Ship, figures: DeckPlan['figures'], plan: DeckPlan, lay: DeckLayout): Station[][] {
  const L = ship.spec.length;
  const rand = seeded(ship.id * 7919 + 13);
  const out: Station[][] = [[], [], [], [], [], []];
  const lowDeck: Deck = lay.oarDrop > 0 ? 0 : 1;
  const x0 = lay.x0 + 0.8;
  const x1 = lay.x1 - 0.8;
  // Rowers: a line down each side, facing their oars.
  const perSide = Math.max(1, Math.ceil(figures.oar / 2));
  for (let i = 0; i < figures.oar; i += 1) {
    const side = i % 2 === 0 ? 1 : -1;
    const k = Math.floor(i / 2);
    const x = lay.oars.length ? lay.oars[Math.min(lay.oars.length - 1, Math.floor(((k + 0.5) * lay.oars.length) / perSide))]! : (-0.36 + (0.7 * (k + 0.5)) / perSide) * L;
    let z = side * Math.max(0.7, lay.edge(x) - (lay.oarDrop > 0 ? 1.6 : 0.6));
    // On an open deck the rowers sit outside any cabin.
    if (lay.oarDrop === 0 && blocked(lay, x, z, 0.3)) z = side * Math.max(0.7, lay.edge(x) - 0.35);
    out[OAR]!.push({ x, z, yaw: yawTo(0, side), deck: lowDeck, up: 0 });
  }
  // Gunners stand at the guns of each broadside.
  const sides = [0, 1].map((side) => ship.guns.filter((g) => g.side === side).length);
  for (let i = 0; i < figures.gun; i += 1) {
    const side = i % 2;
    const ports = lay.guns?.[side];
    const count = Math.max(1, ports?.length ?? sides[side]!);
    const slot = Math.floor(i / 2) % count;
    const along = ports && ports.length ? ports[Math.min(ports.length - 1, slot)]! : count <= 1 ? 0 : (slot / (count - 1) - 0.5) * L * 0.66;
    const x = along + (Math.floor(i / 2) >= count ? 1.2 : 0);
    const z = (side === 0 ? -1 : 1) * Math.max(0.7, lay.edge(x) - 0.9);
    out[GUN]!.push({ x, z, yaw: yawTo(0, Math.sign(z)), deck: 1, up: 0 });
  }
  // Shooters line the rails in two ranks, where no cabin stands: the front rank kneels to reload while the rear fires.
  // Where the wall is higher than a man's chest the front rank stands on a firing step built against it.
  const step = Math.max(0, lay.railUp - STEP_CLEAR);
  for (let i = 0; i < figures.shot; i += 1) {
    const side = i % 2 === 0 ? 1 : -1;
    const rank = Math.floor(i / 2) % 2;
    const at = (x: number) => side * Math.max(0.7, lay.edge(x) - 0.5 - rank * 1.05);
    let x = x0 + (x1 - x0) * rand();
    for (let t = 0; t < 8 && blocked(lay, x, at(x), 0.2); t += 1) x = x0 + (x1 - x0) * rand();
    out[SHOT]!.push({ x, z: at(x), yaw: yawTo(rand() * 0.6 - 0.3, side), deck: 1, up: rank === 0 && step > STEP_MIN ? step : 0 });
  }
  // Deck fighters hold the middle, or what is left of it beside a tower or cabin.
  for (let i = 0; i < figures.melee; i += 1) {
    let x = 0;
    let z = 0;
    let ok = false;
    for (let t = 0; t < 16 && !ok; t += 1) {
      x = Math.max(x0, Math.min(x1, (rand() - 0.5) * L * 0.6));
      z = (rand() - 0.5) * 2 * lay.edge(x) * 0.7;
      ok = !blocked(lay, x, z, 0.5);
    }
    if (!ok) z = (rand() < 0.5 ? -1 : 1) * Math.max(0.7, lay.edge(x) - 1.3);
    out[MELEE]!.push({ x, z, yaw: yawTo(1, (rand() - 0.5) * 0.8), deck: 1, up: 0 });
  }
  if (lay.command) out[OFFICER]!.push({ x: lay.command.x, z: 0, yaw: yawTo(1, 0), deck: 2, up: 0 });
  else {
    let x = Math.max(x0, -0.32 * L);
    for (let t = 0; t < 10 && blocked(lay, x, 0, 0.5); t += 1) x -= 1;
    out[OFFICER]!.push({ x: Math.max(lay.x0 + 0.3, x), z: 0, yaw: yawTo(1, 0), deck: 1, up: 0 });
  }
  // The drummer beats the war drum beside the captain on the command platform, or aft on the main deck. He faces
  // across the ship, so the drum stands clear of the captain and both read from the side.
  if (plan.drum) {
    if (lay.command) out[DRUM]!.push({ x: lay.command.x - 1.1, z: 0.4, yaw: yawTo(0, -1), deck: 2, up: 0 });
    else {
      let x = Math.max(x0, -0.3 * L) + 1.6;
      for (let t = 0; t < 12 && blocked(lay, x, 0.4, 0.9); t += 1) x += 1;
      out[DRUM]!.push({ x, z: 0.4, yaw: yawTo(0, -1), deck: 1, up: 0 });
    }
  }
  return out;
}

/** Each gun station's gun: the k-th man on a side serves that side's k-th gun, in the order the ship lists them. */
function gunsOf(ship: Ship, list: Station[]) {
  const bySide: number[][] = [[], []];
  ship.guns.forEach((g, i) => {
    if (g.side === 0 || g.side === 1) bySide[g.side]!.push(i);
  });
  return list.map((_, i) => {
    const guns = bySide[i % 2]!;
    return guns.length ? guns[Math.floor(i / 2) % guns.length]! : -1;
  });
}

type ShipFacts = { reloading: boolean; cheering: boolean; engaged: boolean; charging: boolean; advance: number; routing: boolean; burning: boolean; drumming: boolean };

export type CrewView = { cutaway: number; cut: Set<number>; winner: Team | null };
const NO_VIEW: CrewView = { cutaway: 0, cut: new Set(), winner: null };

/**
 * The crews of the ships near the camera: rowers, gunners, archers or arquebusiers, deck fighters, captains and
 * drummers, each a skinned figure at a station on the right deck, animated by what the ship is doing. Gun crews swab,
 * load and ram by the stage of their gun; archers loose and reach for the next arrow; arquebusiers fire by ranks and
 * reload kneeling or standing; the captain signals with his flag; the drum beats the advance and the charge; men
 * carry water to a fire. When ships are grappled the hooks are thrown, the fighters cross on planks and ropes and
 * duel on the enemy deck, the dead fall where they stand and stay there or go over the side and swim, and a beaten
 * crew drops its arms.
 */
export class Crew {
  readonly group = new Group();
  private assets: Map<CrewKey, CrewAsset> | null = null;
  private disposed = false;
  private readonly rosters = new Map<number, Roster>();
  /** The rosters of ships close enough to draw this frame. */
  private readonly live: Roster[] = [];
  private readonly boarding: Boarding;

  /** Where a matchlock ball the crews fire strikes its target (Effects leaves its mark). */
  set onMusket(hook: ((target: Ship, sx: number, sz: number) => void) | null) {
    this.boarding.onMusket = hook;
  }
  private readonly gear = new DeckGear();
  /** When a ship last lost men in a melee, so a death can be told from a death by shot. */
  private readonly meleeAt = new Map<number, number>();
  /** The last hit on each ship, in its own frame. */
  private readonly hits = new Map<number, Hit>();
  /** Until when each ship's drum beats the charge. */
  private readonly drumUntil = new Map<number, number>();
  private time = 0;
  private frame = 0;
  private readonly pl = { x: 0, z: 0, yaw: 0 };
  private readonly p = new Vector3();
  private readonly e = new Vector3();
  private readonly s = new Vector3();
  private readonly yawQ = new Quaternion();
  private readonly q = new Quaternion();
  private readonly tilt = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly side = new Vector3(1, 0, 0);
  private readonly dir = new Vector3();
  /** Clip choice for the man being drawn; a scratch record so no frame allocates. */
  private readonly pick = { clip: 'idle' as ClipName, rate: 1, t0: 0, fixed: false, kneel: false, data: null as Clip | null, weapon: 0, yaw: 0, scale: 1, lean: 0, dark: 0 };
  private battle: Battle | null = null;
  /** Ship-wide facts looked up once per ship each frame, not per man. */
  private readonly shipState: ShipFacts = { reloading: false, cheering: false, engaged: false, charging: false, advance: 0, routing: false, burning: false, drumming: false };
  /** Clips cut from the baked ones, cached per model: the archers' draw as a single pass, the arquebusiers' held aim. */
  private readonly bowShots = new Map<CrewKey, Clip>();
  private readonly aims = new Map<CrewKey, Clip>();

  constructor(private readonly views: ShipViews) {
    this.boarding = new Boarding(views, this.rosters, this.live);
    this.group.add(this.boarding.group, this.gear.group);
    void crewAssets().then((assets) => {
      if (this.disposed) return;
      this.assets = assets;
      this.attach(assets);
    });
  }

  private attached = 0;
  private attach(assets: Map<CrewKey, CrewAsset>) {
    for (const a of assets.values()) for (const l of a.lods) if (l.mesh.parent !== this.group) this.group.add(l.mesh);
    this.attached = assets.size;
  }

  /** Frees the boarding props, the deck gear and the sprites. The skinned crew meshes are cached for the next battle and only leave this group. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.assets = null;
    disposeTree(this.boarding.group);
    disposeTree(this.gear.group);
    this.group.removeFromParent();
    this.group.clear();
  }

  /** Ships whose captain is not drawn: a cutscene's named commander stands at his post (src/cinema/cast.ts). */
  readonly standIns = new Set<number>();

  /**
   * Where a named commander stands for a close-up, in ship space: a step forward of the captain's mark on a panokseon's
   * command platform; on any other ship, at the head of the main deck, where nothing stands between him and a camera off
   * the bow (the deck plans' cabins do not always match the drawn model, so the middle of the deck is not trusted).
   */
  commandPost(ship: Ship) {
    const r = this.roster(ship);
    const st = r.stations[OFFICER]?.[0];
    if (!st) return null;
    const y = this.deckY(r, st.deck);
    // The panokseon's and the atakebune's command platforms are open; the Ming castles wall theirs in, and an
    // atakebune's bow is enclosed (a camera there sees black).
    if (st.deck === 2 && (ship.spec.kind === 'panokseon' || ship.spec.kind === 'atakebune')) return { x: st.x + 0.6, y, z: st.z };
    if (st.deck === 2) return { x: r.layout.x1 - 1.4, y: r.main, z: 0 };
    return { x: r.layout.x1 - 1.4, y, z: 0 };
  }

  private deckY(r: Roster, deck: Deck) {
    return deck === 0 ? r.main - r.layout.oarDrop : deck === 2 ? r.main + (r.layout.command?.up ?? 0) : r.main;
  }

  /** Height a man at this station stands at: on his deck, or on the firing step until the crew crowds to the rail. */
  private standY(r: Roster, st: Station) {
    return this.deckY(r, st.deck) + st.up * (1 - smooth(r.engage));
  }

  private roster(ship: Ship): Roster {
    let r = this.rosters.get(ship.id);
    const key = this.views.states.get(ship.id)?.anchors ?? `${ship.spec.kind}#0`;
    if (r && r.key === key) return r;
    const plan = byModel(DECKS, ship.spec.kind);
    const figures = { oar: plan.figures.oar, gun: plan.figures.gun, shot: Math.round(plan.figures.shot * FIGHTERS), melee: Math.round(plan.figures.melee * FIGHTERS) };
    const layout = layoutFor(key, ship.spec.kind, ship.spec.length, ship.spec.beam);
    const st = stations(ship, figures, plan, layout);
    const fresh: Roster = {
      key,
      plan,
      main: mainDeck(key, ship.spec.kind, ship.spec.deck),
      stations: st,
      figures,
      members: [[], [], [], [], [], []],
      layout,
      grow: 1,
      len: ship.spec.length,
      q: new Quaternion(),
      live: -1,
      dist: 0,
      lod: 0,
      showMain: true,
      showLow: true,
      showCommand: true,
      engage: r?.engage ?? 0,
      contactN: 0,
      cx: [0, 0, 0, 0],
      cs: [1, 1, 1, 1],
      defending: false,
      boarded: false,
      hold: false,
      corpses: [],
      gunOf: gunsOf(ship, st[GUN]!),
    };
    this.rosters.set(ship.id, fresh);
    return fresh;
  }

  private figureCount(r: Roster, role: number) {
    const f = r.figures;
    return role === OAR ? f.oar : role === GUN ? f.gun : role === SHOT ? f.shot : f.melee;
  }

  /** Brings the figures at each station in line with the crew left. The men who fall are picked where the fight is. */
  private muster(ship: Ship, r: Roster) {
    const held = r.hold || ship.struck;
    for (let role = 0; role < ROLES; role += 1) {
      let want: number;
      if (role === OFFICER) want = ship.crew > ship.spec.crew * 0.08 ? 1 : 0;
      else if (role === DRUM) want = ship.crew > ship.spec.crew * 0.15 ? r.stations[DRUM]!.length : 0;
      else {
        const need = ship.spec.crew * ship.spec.crewPlan[role]!;
        want = need > 0 ? Math.min(r.stations[role]!.length, Math.round((ship.roles[role]! / need) * this.figureCount(r, role))) : 0;
        // A few of the beaten crew are always left to be seen laying down their arms.
        if (held && ship.crew >= 1) {
          if (role === MELEE) want = Math.max(want, Math.min(3, r.stations[role]!.length));
          else if (role === SHOT) want = Math.max(want, Math.min(2, r.stations[role]!.length));
        }
      }
      const list = r.members[role]!;
      let alive = 0;
      for (const mem of list) if (mem.dying < 0 && !mem.gone) alive += 1;
      if (alive < want) {
        for (let i = 0; i < r.stations[role]!.length && alive < want; i += 1) {
          let used = false;
          for (const mm of list) if (mm.station === i) used = true;
          if (used) continue;
          list.push({
            station: i,
            seed: Math.random(),
            clip: 'idle',
            t0: this.time - Math.random() * 4,
            dying: -1,
            hurt: -1,
            fling: 0,
            gone: false,
            away: false,
            duel: null,
            fireAt: -1,
            fireOrder: -1,
            fireYaw: 0,
            fireArms: 0,
            fired: true,
            lastFire: -100,
            act: null,
            actT0: 0,
            actUntil: 0,
            actRate: 1,
            actWeapon: 0,
            actYaw: NaN,
          });
          alive += 1;
        }
      } else if (alive > want) {
        let k = 0;
        while (alive > want) {
          const victim = this.victim(ship, r, role, list);
          if (!victim) break;
          this.kill(ship, r, role, victim, k);
          alive -= 1;
          k += 1;
        }
      }
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const m = list[i]!;
        if (m.gone || (m.dying >= 0 && this.time - m.dying > DEATH)) {
          // The dead stay where they fell, on their own deck.
          if (!m.gone && m.fling === 0) {
            const st = r.stations[role]![m.station]!;
            placement(r, role, m, st, this.pl);
            layBody(r, this.pl.x, this.pl.z, this.standY(r, st), this.pl.yaw, CAST[ship.spec.faction][role]!, deathClip(m.seed), m.dying);
          }
          list.splice(i, 1);
        }
      }
    }
  }

  /** The man who falls next: the ones in the thick of a fight, or where a shot has just struck, go before the rest. */
  private victim(ship: Ship, r: Roster, role: number, list: Member[]) {
    const hit = this.hits.get(ship.id);
    const fresh = hit && this.time - hit.t < 1.5 ? hit : null;
    let best: Member | null = null;
    let bs = -1;
    for (const m of list) {
      if (m.dying >= 0 || m.gone) continue;
      const fighting = role === MELEE || role === SHOT;
      let score = (m.away ? 4 : m.duel ? 3 : r.boarded && fighting ? 2 : 1) + frac(m.seed * 97) * 0.9;
      if (fresh) {
        const st = r.stations[role]![m.station]!;
        score += 3 * Math.max(0, 1 - Math.hypot(st.x - fresh.x, st.z - fresh.z) / 7);
      }
      if (score > bs) {
        bs = score;
        best = m;
      }
    }
    return best;
  }

  /** Marks a man dead a moment from now, so a death lands on a blow and several do not drop in one frame. */
  private kill(ship: Ship, r: Roster, role: number, mem: Member, k: number) {
    mem.hurt = this.time;
    mem.dying = this.time + Math.min(1.4, k * 0.18 + Math.random() * 0.35);
    mem.fling = 0;
    mem.act = null;
    if (role === OAR && r.layout.oarDrop > 0) return;
    if (mem.away) {
      mem.fling = Math.random() < 0.55 ? 1 : 0;
      return;
    }
    const st = r.stations[role]![mem.station]!;
    const melee = r.boarded || this.time - (this.meleeAt.get(ship.id) ?? -99) < 3;
    const hit = this.hits.get(ship.id);
    const blast = !!hit && this.time - hit.t < 1.5 && Math.hypot(st.x - hit.x, st.z - hit.z) < 5;
    // Men at the rail are knocked over it; the blow, or the ball that struck beside them, throws them toward the side
    // they stand on.
    const atRail = Math.abs(st.z) > r.layout.edge(st.x) * (blast ? 0.45 : 0.7);
    if (atRail && Math.random() < (blast ? 0.7 : melee ? 0.55 : 0.35)) mem.fling = st.z >= 0 ? 1 : -1;
  }

  handle(events: BattleEvent[], battle: Battle) {
    for (const e of events) {
      if (e.type === 'casualty') {
        if (e.melee) this.meleeAt.set(e.ship, this.time);
      } else if (e.type === 'musket') {
        this.volley(e, battle);
        this.signal(e.ship, 'wave', 2.4);
      } else if (e.type === 'volley') this.signal(e.ship, 'signal', 2.6);
      else if (e.type === 'hit') this.noteHit(e, battle);
      else if (e.type === 'drum') this.drumUntil.set(e.ship, this.time + DRUM_CALL);
      else if (e.type === 'morale') {
        if (e.state === 'rallying') this.boarding.cheer(e.ship, 3);
      } else if (e.type === 'board') this.boarding.noteBoard(e.a, e.b);
      else if (e.type === 'struck') this.boarding.noteStruck(e.ship, (e as { by?: number }).by, battle);
    }
  }

  private noteHit(e: Extract<BattleEvent, { type: 'hit' }>, battle: Battle) {
    const ship = battle.get(e.ship);
    if (!ship || !this.rosters.has(ship.id)) return;
    const c = Math.cos(ship.heading);
    const sn = Math.sin(ship.heading);
    const dx = e.x - ship.x;
    const dz = e.z - ship.z;
    let h = this.hits.get(ship.id);
    if (!h) {
      h = { x: 0, z: 0, t: 0 };
      this.hits.set(ship.id, h);
    }
    h.x = dx * c + dz * sn;
    h.z = -dx * sn + dz * c;
    h.t = this.time;
  }

  /** The captain gives an order with his flag: a sweep for a volley of the small arms, a great wave for a broadside. */
  private signal(id: number, clip: ClipName, seconds: number) {
    const r = this.rosters.get(id);
    const m = r?.members[OFFICER]![0];
    if (!r || !m || m.dying >= 0 || m.duel || r.live < this.frame - 2 || (m.act && this.time < m.actUntil)) return;
    m.act = clip;
    m.actT0 = this.time;
    m.actUntil = this.time + seconds;
    m.actRate = 1;
    m.actWeapon = W.flag;
    m.actYaw = NaN;
  }

  /**
   * Orders the shooters on the facing side to fire. Archers loose together; arquebusiers come up to the aim a moment
   * apart and fire a ragged volley, the men still reloading from the last one left out while others are ready.
   */
  private volley(e: Extract<BattleEvent, { type: 'musket' }>, battle: Battle) {
    const ship = battle.get(e.ship);
    const r = ship ? this.rosters.get(ship.id) : undefined;
    if (!ship || !r || r.live < this.frame - 2 || r.engage > 0.4 || ship.struck) return;
    const c = Math.cos(ship.heading);
    const sn = Math.sin(ship.heading);
    const lx = e.dx * c + e.dz * sn;
    const lz = -e.dx * sn + e.dz * c;
    const side = lz >= 0 ? 1 : -1;
    const bow = e.arms === 'bow';
    const busy = bow ? BOW.tail + BOW_REARM : GUN_RECOIL + GUN_RELOAD;
    let left = e.count;
    const list = r.members[SHOT]!;
    for (let pass = 0; pass < 3 && left > 0; pass += 1) {
      for (const m of list) {
        if (left <= 0) break;
        if (m.dying >= 0 || m.gone || m.away || m.duel || m.fireAt >= 0 || m.act) continue;
        const st = r.stations[SHOT]![m.station]!;
        if (pass < 2 && st.z >= 0 !== side > 0) continue;
        if (pass === 0 && this.time - m.lastFire < busy) continue;
        m.fireOrder = this.time;
        m.fireAt = this.time + (bow ? rnd(0.05, 0.25) : rnd(0.35, 0.9));
        m.fireYaw = yawTo(lx, lz) + rnd(-0.06, 0.06);
        m.fireArms = bow ? 1 : 0;
        m.fired = false;
        left -= 1;
      }
    }
  }

  update(battle: Battle, dt: number, camera: Camera, view: CrewView = NO_VIEW) {
    this.time += dt;
    crewTime.value = this.time;
    const assets = this.assets;
    if (!assets) return;
    // A war's crews that arrived after this battle's crew was made join the scene.
    if (assets.size !== this.attached) this.attach(assets);
    this.frame += 1;
    this.battle = battle;
    beginCrew(assets);
    this.gear.begin();
    this.live.length = 0;
    const cam = camera.position;
    for (const ship of battle.ships) {
      if (!ship.alive) {
        this.rosters.delete(ship.id);
        this.meleeAt.delete(ship.id);
        this.hits.delete(ship.id);
        this.drumUntil.delete(ship.id);
        continue;
      }
      if (ship.sinking > 0.35) continue;
      const v = this.views.states.get(ship.id);
      if (!v || !v.visible) continue;
      const dist = Math.hypot(ship.x - cam.x, ship.z - cam.z, cam.y);
      if (dist > CREW_RANGE) continue;
      const r = this.roster(ship);
      r.live = this.frame;
      this.live.push(r);
      r.dist = dist;
      r.grow = figureScale(dist);
      r.lod = dist < LOD_NEAR ? 0 : dist < LOD_MID ? 1 : 2;
      const cut = view.cut.has(ship.id) ? view.cutaway : 0;
      const lowDeck = r.layout.oarDrop > 0;
      r.showMain = cut === 0 ? r.plan.open : cut < 3 || !lowDeck;
      r.showLow = !lowDeck ? r.showMain : cut === 3;
      r.showCommand = cut <= 1 && (cut > 0 || r.plan.open);
      v.matrix.decompose(this.e, r.q, this.s);
      this.muster(ship, r);
    }
    this.boarding.begin(battle, this.time, dt, this.frame);
    for (const ship of battle.ships) {
      const r = this.rosters.get(ship.id);
      if (r && r.live === this.frame) this.drawCrew(battle, ship, r, view, assets);
    }
    this.boarding.draw(battle, assets, camera);
    endCrew(assets);
    this.gear.end();
  }

  /** What a man at his post is doing, given what the ship is doing. */
  private choose(ship: Ship, r: Roster, role: number, index: number, mem: Member, st: Station, asset: CrewAsset, view: CrewView, facts: ShipFacts) {
    const p = this.pick;
    const faction = ship.spec.faction;
    p.rate = 1;
    p.fixed = false;
    p.weapon = ARMS[faction][role]!;
    p.yaw = this.pl.yaw;
    p.scale = 1;
    p.lean = 0;
    p.dark = 0;
    p.kneel = false;
    p.data = null;
    p.clip = 'idle';
    if (mem.act && this.time >= mem.actUntil) mem.act = null;
    if (mem.dying >= 0) {
      p.fixed = true;
      if (this.time < mem.dying) {
        p.clip = 'hit';
        p.t0 = mem.hurt;
        p.rate = 1.5;
      } else {
        p.clip = deathClip(mem.seed);
        p.t0 = mem.dying;
        p.dark = Math.min(1, (this.time - mem.dying) / DEATH) * 0.6;
      }
    } else if (mem.act && asset.clips[mem.act]) {
      p.clip = mem.act;
      p.t0 = mem.actT0;
      p.rate = mem.actRate;
      p.weapon = mem.actWeapon;
      if (!Number.isNaN(mem.actYaw)) p.yaw = mem.actYaw;
      p.fixed = true;
    } else if (view.winner && ship.team === view.winner) {
      p.clip = 'cheer';
    } else if (ship.struck && role !== OAR) {
      // The beaten crew lets its weapons fall and crouches where it stands.
      const cap = this.boarding.captureOf(ship.id);
      p.weapon = NO_WEAPON;
      p.kneel = true;
      p.fixed = true;
      p.t0 = (cap ? cap.t0 : this.time - 9) + mem.seed * 0.7;
    } else if (mem.duel && mem.duel.state === ST_DUEL) {
      const fig = mem.duel;
      this.boarding.duelClip(fig, 1, asset);
      p.clip = this.boarding.pose.clip;
      p.t0 = this.boarding.pose.t0;
      p.rate = this.boarding.pose.rate;
      p.fixed = true;
      p.weapon = HAND_ARMS[faction][role]!;
      p.yaw = this.boarding.duelYaw(fig, this.pl.x, this.pl.z);
    } else if (role === OAR) {
      const f = Math.abs(ship.speed) / ship.spec.maxSpeed;
      if (f > 0.12) {
        p.clip = 'row';
        p.rate = 0.55 + f * 0.7;
      }
    } else if (role === DRUM) this.drummer(facts);
    else if (facts.burning && !r.boarded && (role === GUN || role === MELEE) && index < FIREFIGHTERS / 2) this.firefighter(ship, r, mem, st);
    else if (role === GUN) this.gunner(ship, r, mem, facts);
    else if (role === OFFICER) this.officer(mem, facts);
    else if (r.boarded) {
      p.clip = role === MELEE && mem.seed <= 0.5 && asset.clips.thrust ? 'thrust' : 'melee';
      p.rate = 1 + mem.seed * 0.3;
      if (role === SHOT) p.weapon = HAND_ARMS[faction][SHOT]!;
    } else if (facts.cheering) {
      p.clip = 'cheer';
    } else if (facts.routing) {
      // A broken crew does not fight: the men stand about, looking for a way out.
      p.clip = 'idle';
    } else if (role === SHOT) this.shooter(ship, r, mem, st, asset, facts.engaged);
    else if (facts.charging) {
      // Closing to board: weapons raised and a shout.
      p.clip = 'cheer';
      p.rate = 1.15;
    } else p.clip = facts.engaged ? 'ready' : 'idle';
  }

  /** The shoot clip as a single pass. The soldiers' bake has junk frames either end of the draw, which are skipped. */
  private bowShot(asset: CrewAsset) {
    const shoot = asset.clips.shoot;
    if (!shoot) return null;
    let c = this.bowShots.get(asset.key);
    if (!c) {
      c = { start: shoot.start + SHOOT_SKIP, frames: shoot.frames - 15, loop: false };
      this.bowShots.set(asset.key, c);
    }
    return c;
  }

  /** The first frame of the aim clip, held: the matchlock levelled at the cheek. */
  private aimHold(asset: CrewAsset) {
    const aim = asset.clips.aim;
    if (!aim) return null;
    let c = this.aims.get(asset.key);
    if (!c) {
      c = { start: aim.start, frames: 1, loop: true };
      this.aims.set(asset.key, c);
    }
    return c;
  }

  /**
   * A shooter waits until his order comes, then faces the enemy and fires on cue. An archer's arrow leaves on the
   * release of his draw and he reaches back for the next; an arquebusier comes up to the aim, fires, rides the recoil
   * and reloads, kneeling in the front rank and standing in the rear.
   */
  private shooter(ship: Ship, r: Roster, mem: Member, st: Station, asset: CrewAsset, engaged: boolean) {
    const p = this.pick;
    const bow = ship.spec.arms === 'bow';
    p.clip = engaged ? 'ready' : 'idle';
    const since = this.time - mem.lastFire;
    if (mem.fireAt < 0) {
      // Between volleys: the next arrow from the quiver, or the long business of loading a matchlock.
      if (bow && since < BOW.tail + BOW_REARM && asset.clips.draw) {
        p.clip = 'draw';
        p.t0 = mem.lastFire + BOW.tail;
        p.fixed = true;
      } else if (!bow && since < GUN_RECOIL + GUN_RELOAD) {
        const front = Math.abs(st.z) > r.layout.edge(st.x) - 1.0;
        p.clip = front && asset.clips.kneel ? 'kneel' : 'reload';
        p.t0 = mem.lastFire + GUN_RECOIL;
        p.fixed = true;
      }
      return;
    }
    const tail = bow ? BOW.tail : GUN_RECOIL;
    const w = smooth((this.time - mem.fireOrder) / 0.3) * (1 - smooth((this.time - (mem.fireAt + tail - 0.3)) / 0.3));
    p.yaw = lerpAngle(st.yaw, mem.fireYaw, w);
    if (this.time < mem.fireAt + tail) {
      const data = bow ? this.bowShot(asset) : this.aimHold(asset);
      if (data) {
        p.clip = bow ? 'shoot' : 'aim';
        p.data = data;
        p.t0 = bow ? mem.fireAt - BOW.frame / FPS : mem.fireOrder;
        p.fixed = true;
        if (!bow) {
          p.weapon = W.aimed;
          // The kick of the shot, and the man settling back into his aim.
          const k = this.time - mem.fireAt;
          if (k > 0) p.lean = -0.16 * Math.exp(-k * 7) * Math.min(1, k * 30);
        }
      }
    }
    if (this.time >= mem.fireAt && !mem.fired) {
      mem.fired = true;
      mem.lastFire = mem.fireAt;
      this.muzzle(ship, mem, st, p.yaw);
    }
    if (this.time > mem.fireAt + tail) mem.fireAt = -1;
  }

  /** The shot leaves a man's weapon: the flash or the arrow starts from where he really stands. */
  private muzzle(ship: Ship, mem: Member, st: Station, yaw: number) {
    const r = this.rosters.get(ship.id)!;
    placement(r, SHOT, mem, st, this.pl);
    const sx = Math.sin(yaw);
    const sz = Math.cos(yaw);
    const reach = mem.fireArms ? 0.8 : 1.2;
    this.views.localToWorld(ship.id, this.pl.x + sx * reach, this.standY(r, st) + (mem.fireArms ? 1.45 : 1.38) * r.grow, this.pl.z + sz * reach, this.p);
    this.dir.set(sx, 0, sz).applyQuaternion(r.q);
    const h = Math.hypot(this.dir.x, this.dir.z) || 1;
    this.boarding.fire(ship, this.battle!, this.p.x, this.p.y, this.p.z, this.dir.x / h, this.dir.z / h, mem.fireArms === 1);
  }

  /**
   * A gun crew works its gun by the stage of its loading: the bore swabbed and the charge rammed home with the
   * rammer, powder and ball fetched from the deck, then the crew stands to while the piece is laid and fired. The
   * second man at a gun is a step behind the first.
   */
  private gunner(ship: Ship, r: Roster, mem: Member, facts: ShipFacts) {
    const p = this.pick;
    const g = ship.guns[r.gunOf[mem.station] ?? -1];
    if (!facts.engaged || !g || g.ammo < 1 - 1e-9) {
      if (facts.engaged && facts.reloading) {
        p.clip = 'haul';
        p.rate = 1.2;
      }
      return;
    }
    const helper = Math.floor(mem.station / 2) % 2 === 1;
    const stage = g.stage < 4 && helper ? (g.stage + 1) % 4 : g.stage;
    if (stage === 0 || stage === 2) {
      p.clip = 'ram';
      p.weapon = W.rammer;
    } else if (stage === 1 || stage === 3) {
      p.clip = 'haul';
      p.rate = 1.1;
    } else p.clip = 'ready';
  }

  /** The captain keeps his flag in hand: he signals with it through a fight, and waves it to rally a broken crew. */
  private officer(mem: Member, facts: ShipFacts) {
    const p = this.pick;
    p.weapon = W.flag;
    if (facts.cheering) {
      p.clip = 'cheer';
      p.weapon = W.sword;
    } else if (facts.routing) p.clip = 'signal';
    else if (facts.engaged) p.clip = frac(this.time / 9 + mem.seed) < 0.55 ? 'command' : 'wave';
    else p.clip = 'idle';
  }

  /** The drum beats while the ship moves or fights, faster as she gathers way, and rolls for the charge. */
  private drummer(facts: ShipFacts) {
    const p = this.pick;
    if (facts.charging || facts.drumming) {
      p.clip = 'drumroll';
      p.rate = 1.25;
    } else if (facts.advance > 0.12 || facts.engaged) {
      p.clip = 'drum';
      p.rate = 0.75 + facts.advance * 0.7;
    }
  }

  /**
   * A man fighting a fire on deck: he lowers the bucket over the side, carries it to the fire, throws it, and runs
   * back for more. Each man has his own patch of fire and his own place in the round.
   */
  private firefighter(ship: Ship, r: Roster, mem: Member, st: Station) {
    const p = this.pick;
    const lay = r.layout;
    const T = 6.5;
    const run = this.time / T + mem.seed;
    const ph = frac(run);
    const side = st.z >= 0 ? 1 : -1;
    const rx = this.pl.x;
    const rz = side * Math.max(0.7, lay.edge(rx) - 0.4);
    const fx = Math.max(lay.x0 + 1, Math.min(lay.x1 - 1, (frac(mem.seed * 7.31) - 0.5) * r.len * 0.45));
    let fz = (frac(mem.seed * 3.17) - 0.5) * lay.edge(fx) * 0.6;
    if (blocked(lay, fx, fz, 0.4)) fz = side * Math.max(0.6, lay.edge(fx) - 1.2);
    p.weapon = W.bucket;
    p.fixed = true;
    const start = (Math.floor(run) - mem.seed) * T;
    if (ph < 0.15) {
      // Over the side for water.
      this.pl.x = rx;
      this.pl.z = rz;
      p.yaw = yawTo(0, side);
      p.clip = 'haul';
      p.t0 = start;
      p.rate = 1.3;
    } else if (ph < 0.45) {
      const k = smooth((ph - 0.15) / 0.3);
      this.pl.x = rx + (fx - rx) * k;
      this.pl.z = rz + (fz - rz) * k;
      p.yaw = yawTo(fx - rx, fz - rz);
      p.clip = 'bucket';
      p.t0 = start;
    } else if (ph < 0.62) {
      this.pl.x = fx;
      this.pl.z = fz;
      p.yaw = yawTo(fx - rx, fz - rz);
      p.clip = 'douse';
      p.t0 = start + 0.45 * T - 0.6;
      p.rate = 1.3;
      // The water goes when the swing comes through, once a round (fireOrder is free: these men fire no volleys).
      const round = Math.floor(run);
      if (ph > 0.53 && mem.fireOrder !== round) {
        mem.fireOrder = round;
        this.douse(ship, r, fx, fz, p.yaw);
      }
    } else {
      const k = smooth((ph - 0.62) / 0.38);
      this.pl.x = fx + (rx - fx) * k;
      this.pl.z = fz + (rz - fz) * k;
      p.yaw = yawTo(rx - fx, rz - fz);
      p.clip = 'run';
      p.t0 = start;
    }
  }

  private douse(ship: Ship, r: Roster, x: number, z: number, yaw: number) {
    if (r.dist > 200 || this.boarding.puffs.room < 12) return;
    const sx = Math.sin(yaw);
    const sz = Math.cos(yaw);
    this.views.localToWorld(ship.id, x + sx * 0.7, r.main, z + sz * 0.7, this.p);
    this.dir.set(sx, 0, sz).applyQuaternion(r.q);
    this.boarding.puffs.douse(this.p.x, this.p.y, this.p.z, this.dir.x, this.dir.z, r.grow);
  }

  private facts(battle: Battle, ship: Ship, r: Roster) {
    const facts = this.shipState;
    const target = battle.get(ship.targetId);
    const enemyNear = target && battle.isActive(target) ? Math.hypot(target.x - ship.x, target.z - ship.z) : Infinity;
    facts.engaged = enemyNear < 700;
    facts.reloading = false;
    for (const g of ship.guns) {
      if (g.stage < 4 && g.ammo >= 1 - 1e-9) {
        facts.reloading = true;
        break;
      }
    }
    facts.cheering = this.boarding.cheering(ship.id);
    facts.advance = Math.min(1, Math.abs(ship.speed) / ship.spec.maxSpeed);
    facts.charging = (ship.stance === 'board' || ship.stance === 'ram') && enemyNear < 260 && facts.advance > 0.3 && !r.boarded;
    facts.routing = ship.moraleState === 'routing';
    facts.burning = ship.fire > 0.04 && !ship.struck;
    facts.drumming = (this.drumUntil.get(ship.id) ?? -1) > this.time;
    return facts;
  }

  private drawCrew(battle: Battle, ship: Ship, r: Roster, view: CrewView, assets: Map<CrewKey, CrewAsset>) {
    const cast = CAST[ship.spec.faction];
    const p = this.pick;
    const facts = this.facts(battle, ship, r);
    this.drawDead(ship, r, assets);
    this.drawDrum(ship, r);
    this.drawSteps(ship, r);
    for (let role = 0; role < ROLES; role += 1) {
      const asset = assets.get(cast[role]!);
      if (!asset) continue;
      const l = asset.lods[r.lod]!;
      const list = r.members[role]!;
      for (let i = 0; i < list.length; i += 1) {
        const mem = list[i]!;
        if (mem.away || mem.gone || (role === OFFICER && this.standIns.has(ship.id))) continue;
        const st = r.stations[role]![mem.station]!;
        const visible = st.deck === 0 ? r.showLow : st.deck === 2 ? r.showCommand : r.showMain;
        if (!visible) continue;
        placement(r, role, mem, st, this.pl);
        const y = this.standY(r, st);
        // Men knocked over the rail leave the deck here: thrown off their feet backwards, over the side.
        if (mem.dying >= 0 && this.time >= mem.dying && mem.fling !== 0) {
          this.views.localToWorld(ship.id, this.pl.x, y + 0.4, this.pl.z, this.p);
          this.dir.set(0, 0, mem.fling).applyQuaternion(r.q);
          this.boarding.fall(cast[role]!, this.p.x, this.p.y, this.p.z, this.dir.x * rnd(1.2, 3.2), rnd(1.8, 4), this.dir.z * rnd(1.2, 3.2), Math.atan2(-this.dir.x, -this.dir.z));
          mem.gone = true;
          continue;
        }
        this.choose(ship, r, role, i, mem, st, asset, view, facts);
        let clip = p.clip;
        let data: Clip | undefined = p.data ?? (p.kneel ? this.boarding.kneelClip(asset) ?? asset.clips.idle : asset.clips[clip]);
        if (!data) {
          clip = asset.clips.ready && p.clip !== 'idle' ? 'ready' : 'idle';
          data = asset.clips[clip];
        }
        if (!data) continue;
        // A clip that follows the ship's state restarts from its first frame when the choice changes.
        if (!p.fixed) {
          if (clip !== mem.clip) {
            mem.clip = clip;
            mem.t0 = this.time - mem.seed * 0.8;
          }
          p.t0 = mem.t0;
        }
        this.views.localToWorld(ship.id, this.pl.x, y, this.pl.z, this.p);
        this.yawQ.setFromAxisAngle(this.up, p.yaw);
        this.q.multiplyQuaternions(r.q, this.yawQ);
        if (p.lean !== 0) {
          this.tilt.setFromAxisAngle(this.side, p.lean);
          this.q.multiply(this.tilt);
        }
        pushCrew(l, this.p.x, this.p.y, this.p.z, p.scale * (st.deck === 0 ? 1 : r.grow), this.q.x, this.q.y, this.q.z, this.q.w, data, p.t0, p.rate, p.weapon, p.dark);
      }
    }
  }

  /** The bodies on this deck, lying as they fell and darkened. */
  private drawDead(ship: Ship, r: Roster, assets: Map<CrewKey, CrewAsset>) {
    if (!r.showMain || ship.struck) return;
    for (const c of r.corpses) {
      const asset = assets.get(c.key);
      const data = asset?.clips[c.clip];
      if (!asset || !data) continue;
      this.views.localToWorld(ship.id, c.x, c.y, c.z, this.p);
      this.yawQ.setFromAxisAngle(this.up, c.yaw);
      this.q.multiplyQuaternions(r.q, this.yawQ);
      pushCrew(asset.lods[r.lod]!, this.p.x, this.p.y, this.p.z, r.grow, this.q.x, this.q.y, this.q.z, this.q.w, data, c.t, 1, NO_WEAPON, 0.6);
    }
  }

  /** The firing steps along both walls, under the front rank of shooters, in lengths that keep clear of cabins. */
  private drawSteps(ship: Ship, r: Roster) {
    if (!r.showMain) return;
    let up = 0;
    for (const st of r.stations[SHOT]!) up = Math.max(up, st.up);
    if (up <= 0) return;
    const lay = r.layout;
    const piece = 3;
    for (let x = lay.x0 + 1 + piece / 2; x < lay.x1 - 1; x += piece) {
      for (let side = -1; side <= 1; side += 2) {
        const z = side * Math.max(0.7, lay.edge(x) - 0.5);
        if (blocked(lay, x, z, 0.2)) continue;
        this.views.localToWorld(ship.id, x, r.main, z, this.p);
        this.gear.step(this.p, r.q, piece, up, 0.9);
      }
    }
  }

  /** The war drum, in front of the drummer's station whether or not he is still there to beat it. */
  private drawDrum(ship: Ship, r: Roster) {
    const st = r.stations[DRUM]![0];
    if (!st) return;
    if (st.deck === 2 ? !r.showCommand : !r.showMain) return;
    const sx = Math.sin(st.yaw);
    const sz = Math.cos(st.yaw);
    const ahead = 0.95 * r.grow;
    this.views.localToWorld(ship.id, st.x + sx * ahead, this.deckY(r, st.deck), st.z + sz * ahead, this.p);
    // The drum's heads face the drummer.
    this.yawQ.setFromAxisAngle(this.up, st.yaw);
    this.q.multiplyQuaternions(r.q, this.yawQ);
    this.gear.put(this.p, this.q, r.grow);
  }
}

const shared = new Map<CrewKey, CrewAsset>();
const loading = new Map<string, Promise<unknown>>();
/** The crews by war: each set downloads the first time a battle has one of its navies. */
const CREW_SETS: { factions: readonly Faction[]; capacities: Partial<Record<CrewKey, number[]>> }[] = [
  {
    factions: ['joseon', 'japan', 'ming'],
    capacities: {
      joseon_soldier: [128, 1200, 2400],
      joseon_marine: [112, 900, 1800],
      joseon_officer: [16, 80, 160],
      japan_ashigaru: [128, 1300, 2600],
      japan_samurai: [112, 1000, 2000],
      japan_officer: [16, 80, 200],
      ming_soldier: [144, 1000, 2000],
      ming_officer: [16, 60, 120],
      rower: [160, 1000, 2400],
    },
  },
  {
    factions: ['england', 'spain'],
    capacities: {
      england_shot: [128, 1000, 2000],
      england_soldier: [96, 700, 1400],
      england_officer: [16, 60, 120],
      england_sailor: [144, 1000, 2000],
      spain_shot: [128, 1000, 2000],
      spain_soldier: [112, 900, 1800],
      spain_officer: [16, 60, 120],
      spain_sailor: [144, 1000, 2000],
    },
  },
  {
    factions: ['holyleague', 'ottoman'],
    capacities: {
      holyleague_shot: [128, 1000, 2000],
      holyleague_soldier: [96, 800, 1600],
      holyleague_officer: [16, 60, 120],
      holyleague_oarsman: [200, 1600, 3200],
      ottoman_archer: [128, 1100, 2200],
      ottoman_janissary: [112, 900, 1800],
      ottoman_officer: [16, 60, 120],
      ottoman_oarsman: [200, 1600, 3200],
    },
  },
  {
    // The Trafalgar crews: a model not baked yet is skipped by loadCrew (that station stands empty), never borrowed.
    factions: ['britain', 'france', 'spain1805'],
    capacities: {
      britain_shot: [96, 700, 1400],
      britain_soldier: [96, 700, 1400],
      britain_officer: [16, 60, 120],
      britain_sailor: [200, 1600, 3200],
      france_shot: [96, 800, 1600],
      france_soldier: [96, 800, 1600],
      france_officer: [16, 60, 120],
      france_sailor: [200, 1600, 3200],
      spain1805_shot: [96, 700, 1400],
      spain1805_soldier: [96, 700, 1400],
      spain1805_officer: [16, 60, 120],
      spain1805_sailor: [200, 1600, 3200],
    },
  },
];

/**
 * The character models load once and are shared by every battle; the 1592 crews always (boarding, the menu), the
 * other wars' when a battle has their navies.
 */
export function crewAssets(factions: readonly Faction[] = []) {
  const sets = CREW_SETS.filter((s, i) => i === 0 || s.factions.some((f) => factions.includes(f)));
  return Promise.all(
    sets.map((s) => {
      const id = s.factions.join();
      let p = loading.get(id);
      if (!p) loading.set(id, (p = loadCrew(s.capacities, shared)));
      return p;
    }),
  ).then(() => shared);
}
