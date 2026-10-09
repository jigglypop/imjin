import { Group, Quaternion, Vector3, type Camera } from 'three/webgpu';
import type { Battle } from '../sim/battle';
import type { BattleEvent, Ship, Team } from '../sim/types';
import type { ShipViews } from '../ships/ShipViews';
import { DECKS, blocked, layoutFor, mainDeck, type DeckLayout, type DeckPlan } from '../ships/decks';
import { equipment } from '../game/quality';
import { beginCrew, crewTime, endCrew, loadCrew, pushCrew, type Clip, type ClipName, type CrewAsset, type CrewKey } from './crewModels';
import { disposeTree } from '../render/dispose';
import { Boarding, ST_DUEL, placement } from './Boarding';
import { ARMS, CAST, CREW_RANGE, GUN, HAND_ARMS, MELEE, NO_WEAPON, OAR, OFFICER, SHOT, figureScale, frac, lerpAngle, rnd, seeded, smooth, yawTo, type Deck, type Member, type Roster, type Station } from './crewTypes';

const LOD_NEAR = { high: 85, medium: 65, low: 45 }[equipment.tier];
const LOD_MID = { high: 230, medium: 180, low: 140 }[equipment.tier];
const DEATH = 2.6;
/** Fighting men are drawn in greater numbers where the device can take it, so a boarding looks like a crowd. */
const FIGHTERS = { high: 2.2, medium: 1.6, low: 1.15 }[equipment.tier];
/** Frame of the shoot clip at which the shot goes off, and how long it plays on after it, by weapon. */
const FIRE = { gun: { frame: 13, tail: 2.6 }, bow: { frame: 35, tail: 1.7 } };
const FPS = 15;
/** Leading frames of the bow soldiers' shoot clip that hold no pose. */
const SHOOT_SKIP = 11;

function stations(ship: Ship, figures: DeckPlan['figures'], lay: DeckLayout): Station[][] {
  const L = ship.spec.length;
  const rand = seeded(ship.id * 7919 + 13);
  const out: Station[][] = [[], [], [], [], []];
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
    out[OAR]!.push({ x, z, yaw: yawTo(0, side), deck: lowDeck });
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
    out[GUN]!.push({ x, z, yaw: yawTo(0, Math.sign(z)), deck: 1 });
  }
  // Shooters line the rails, where no cabin stands.
  for (let i = 0; i < figures.shot; i += 1) {
    const side = i % 2 === 0 ? 1 : -1;
    let x = x0 + (x1 - x0) * rand();
    for (let t = 0; t < 8 && blocked(lay, x, side * Math.max(0.7, lay.edge(x) - 0.5), 0.2); t += 1) x = x0 + (x1 - x0) * rand();
    out[SHOT]!.push({ x, z: side * Math.max(0.7, lay.edge(x) - 0.5), yaw: yawTo(rand() * 0.6 - 0.3, side), deck: 1 });
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
    out[MELEE]!.push({ x, z, yaw: yawTo(1, (rand() - 0.5) * 0.8), deck: 1 });
  }
  if (lay.command) out[OFFICER]!.push({ x: lay.command.x, z: 0, yaw: yawTo(1, 0), deck: 2 });
  else {
    let x = Math.max(x0, -0.32 * L);
    for (let t = 0; t < 10 && blocked(lay, x, 0, 0.5); t += 1) x -= 1;
    out[OFFICER]!.push({ x: Math.max(lay.x0 + 0.3, x), z: 0, yaw: yawTo(1, 0), deck: 1 });
  }
  return out;
}

type ShipFacts = { reloading: boolean; cheering: boolean };

export type CrewView = { cutaway: number; cut: Set<number>; winner: Team | null };
const NO_VIEW: CrewView = { cutaway: 0, cut: new Set(), winner: null };

/**
 * The crews of the ships near the camera: rowers, gunners, archers or arquebusiers, deck fighters and captains, each
 * a skinned figure at a station on the right deck, animated by what the ship is doing. When ships are grappled the
 * fighters cross on planks and duel on the enemy deck, the dead fall where they stand or over the side, volleys
 * are fired by the men in them, and a beaten crew drops its arms.
 */
export class Crew {
  readonly group = new Group();
  private assets: Map<CrewKey, CrewAsset> | null = null;
  private readonly rosters = new Map<number, Roster>();
  /** The rosters of ships close enough to draw this frame. */
  private readonly live: Roster[] = [];
  private readonly boarding: Boarding;
  /** When a ship last lost men in a melee, so a death can be told from a death by shot. */
  private readonly meleeAt = new Map<number, number>();
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
  private readonly shipState: ShipFacts = { reloading: false, cheering: false };
  private readonly shotClips = new Map<CrewKey, Clip>();

  constructor(private readonly views: ShipViews) {
    this.boarding = new Boarding(views, this.rosters, this.live);
    this.group.add(this.boarding.group);
    void crewAssets().then((assets) => {
      this.assets = assets;
      for (const a of assets.values()) for (const l of a.lods) this.group.add(l.mesh);
    });
  }

  /** Frees the boarding props and sprites. The skinned crew meshes are cached for the next battle and only leave this group. */
  dispose() {
    disposeTree(this.boarding.group);
    this.group.removeFromParent();
    this.group.clear();
  }

  private deckY(r: Roster, deck: Deck) {
    return deck === 0 ? r.main - r.layout.oarDrop : deck === 2 ? r.main + (r.layout.command?.up ?? 0) : r.main;
  }

  private roster(ship: Ship): Roster {
    let r = this.rosters.get(ship.id);
    const key = this.views.states.get(ship.id)?.key ?? `${ship.spec.kind}#0`;
    if (r && r.key === key) return r;
    const plan = DECKS[ship.spec.kind];
    const figures = { oar: plan.figures.oar, gun: plan.figures.gun, shot: Math.round(plan.figures.shot * FIGHTERS), melee: Math.round(plan.figures.melee * FIGHTERS) };
    const layout = layoutFor(key, ship.spec.kind, ship.spec.length, ship.spec.beam);
    r = {
      key,
      plan,
      main: mainDeck(key, ship.spec.kind, ship.spec.deck),
      stations: stations(ship, figures, layout),
      figures,
      members: [[], [], [], [], []],
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
    };
    this.rosters.set(ship.id, r);
    return r;
  }

  private figureCount(r: Roster, role: number) {
    const f = r.figures;
    return role === OAR ? f.oar : role === GUN ? f.gun : role === SHOT ? f.shot : f.melee;
  }

  /** Brings the figures at each station in line with the crew left. The men who fall are picked where the fight is. */
  private muster(ship: Ship, r: Roster) {
    const held = r.hold || ship.struck;
    for (let role = 0; role < 5; role += 1) {
      let want: number;
      if (role === OFFICER) want = ship.crew > ship.spec.crew * 0.08 ? 1 : 0;
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
          });
          alive += 1;
        }
      } else if (alive > want) {
        let k = 0;
        while (alive > want) {
          const victim = this.victim(r, role, list);
          if (!victim) break;
          this.kill(ship, r, role, victim, k);
          alive -= 1;
          k += 1;
        }
      }
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const m = list[i]!;
        if (m.gone || (m.dying >= 0 && this.time - m.dying > DEATH)) list.splice(i, 1);
      }
    }
  }

  /** The man who falls next: the ones in the thick of a fight go before those standing back. */
  private victim(r: Roster, role: number, list: Member[]) {
    let best: Member | null = null;
    let bs = -1;
    for (const m of list) {
      if (m.dying >= 0 || m.gone) continue;
      const fighting = role === MELEE || role === SHOT;
      const score = (m.away ? 4 : m.duel ? 3 : r.boarded && fighting ? 2 : 1) + frac(m.seed * 97) * 0.9;
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
    if (role === OAR) return;
    if (mem.away) {
      mem.fling = Math.random() < 0.55 ? 1 : 0;
      return;
    }
    const st = r.stations[role]![mem.station]!;
    const melee = r.boarded || this.time - (this.meleeAt.get(ship.id) ?? -99) < 3;
    // Men at the rail are knocked over it; the blow throws them toward the side they stand on.
    if (Math.abs(st.z) > r.layout.edge(st.x) * 0.7 && Math.random() < (melee ? 0.55 : 0.35)) mem.fling = st.z >= 0 ? 1 : -1;
  }

  handle(events: BattleEvent[], battle: Battle) {
    for (const e of events) {
      if (e.type === 'casualty') {
        if (e.melee) this.meleeAt.set(e.ship, this.time);
      } else if (e.type === 'musket') this.volley(e, battle);
      else if (e.type === 'board') this.boarding.noteBoard(e.a, e.b);
      else if (e.type === 'struck') this.boarding.noteStruck(e.ship, (e as { by?: number }).by, battle);
    }
  }

  /** Orders the shooters on the facing side to fire in a ragged volley. */
  private volley(e: Extract<BattleEvent, { type: 'musket' }>, battle: Battle) {
    const ship = battle.get(e.ship);
    const r = ship ? this.rosters.get(ship.id) : undefined;
    if (!ship || !r || r.live < this.frame - 2 || r.engage > 0.4 || ship.struck) return;
    const c = Math.cos(ship.heading);
    const sn = Math.sin(ship.heading);
    const lx = e.dx * c + e.dz * sn;
    const lz = -e.dx * sn + e.dz * c;
    const side = lz >= 0 ? 1 : -1;
    let left = e.count;
    const list = r.members[SHOT]!;
    for (let pass = 0; pass < 2 && left > 0; pass += 1) {
      for (const m of list) {
        if (left <= 0) break;
        if (m.dying >= 0 || m.gone || m.away || m.duel || m.fireAt >= 0) continue;
        const st = r.stations[SHOT]![m.station]!;
        if (pass === 0 && st.z >= 0 !== side > 0) continue;
        m.fireOrder = this.time;
        m.fireAt = this.time + rnd(0.05, 0.55);
        m.fireYaw = yawTo(lx, lz) + rnd(-0.06, 0.06);
        m.fireArms = e.arms === 'bow' ? 1 : 0;
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
    this.frame += 1;
    this.battle = battle;
    beginCrew(assets);
    this.live.length = 0;
    const cam = camera.position;
    for (const ship of battle.ships) {
      if (!ship.alive) {
        this.rosters.delete(ship.id);
        this.meleeAt.delete(ship.id);
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
  }

  /** What a man at his post is doing, given what the ship is doing. */
  private choose(ship: Ship, r: Roster, role: number, mem: Member, st: Station, asset: CrewAsset, view: CrewView, enemyNear: number, facts: ShipFacts) {
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
    const engaged = enemyNear < 700;
    if (mem.dying >= 0) {
      p.fixed = true;
      if (this.time < mem.dying) {
        p.clip = 'hit';
        p.t0 = mem.hurt;
        p.rate = 1.5;
      } else {
        p.clip = 'die';
        p.t0 = mem.dying;
        p.dark = Math.min(1, (this.time - mem.dying) / DEATH) * 0.6;
      }
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
    } else if (role === GUN) {
      if (engaged && facts.reloading) {
        p.clip = 'haul';
        p.rate = 1.2;
      }
    } else if (role === OFFICER) {
      if (facts.cheering) p.clip = 'cheer';
      else p.clip = engaged ? 'command' : 'idle';
    } else if (r.boarded) {
      p.clip = role === MELEE && mem.seed <= 0.5 && asset.clips.thrust ? 'thrust' : 'melee';
      p.rate = 1 + mem.seed * 0.3;
      if (role === SHOT) p.weapon = HAND_ARMS[faction][SHOT]!;
    } else if (facts.cheering) {
      p.clip = 'cheer';
    } else if (role === SHOT) this.shooter(ship, mem, st, asset, engaged);
    else p.clip = engaged ? 'ready' : 'idle';
  }

  /** The shoot clip as a single pass. The soldiers' bake has junk frames either end of the draw, which are skipped. */
  private shotClip(asset: CrewAsset, bow: boolean) {
    const shoot = asset.clips.shoot;
    if (!shoot) return null;
    let c = this.shotClips.get(asset.key);
    if (!c) {
      c = bow ? { start: shoot.start + SHOOT_SKIP, frames: shoot.frames - 15, loop: false } : { start: shoot.start, frames: shoot.frames, loop: false };
      this.shotClips.set(asset.key, c);
    }
    return c;
  }

  /** A shooter waits until his order comes, then faces the enemy and fires on cue, the shot landing on the clip's release. */
  private shooter(ship: Ship, mem: Member, st: Station, asset: CrewAsset, engaged: boolean) {
    const p = this.pick;
    const bow = ship.spec.arms === 'bow';
    p.clip = engaged ? 'ready' : 'idle';
    if (mem.fireAt < 0) return;
    const fire = bow ? FIRE.bow : FIRE.gun;
    const w = smooth((this.time - mem.fireOrder) / 0.3) * (1 - smooth((this.time - (mem.fireAt + fire.tail - 0.5)) / 0.5));
    p.yaw = lerpAngle(st.yaw, mem.fireYaw, w);
    const data = this.time < mem.fireAt + fire.tail ? this.shotClip(asset, bow) : null;
    if (data) {
      p.clip = 'shoot';
      p.data = data;
      p.t0 = mem.fireAt - fire.frame / FPS;
      p.fixed = true;
    }
    if (this.time >= mem.fireAt && !mem.fired) {
      mem.fired = true;
      mem.lastFire = mem.fireAt;
      this.muzzle(ship, mem, st, p.yaw);
    }
    if (this.time > mem.fireAt + fire.tail) mem.fireAt = -1;
  }

  /** The shot leaves a man's weapon: the flash or the arrow starts from where he really stands. */
  private muzzle(ship: Ship, mem: Member, st: Station, yaw: number) {
    const r = this.rosters.get(ship.id)!;
    placement(r, SHOT, mem, st, this.pl);
    const sx = Math.sin(yaw);
    const sz = Math.cos(yaw);
    this.views.localToWorld(ship.id, this.pl.x + sx * 0.8, r.main + (mem.fireArms ? 1.45 : 1.15), this.pl.z + sz * 0.8, this.p);
    this.dir.set(sx, 0, sz).applyQuaternion(r.q);
    const h = Math.hypot(this.dir.x, this.dir.z) || 1;
    this.boarding.fire(ship, this.battle!, this.p.x, this.p.y, this.p.z, this.dir.x / h, this.dir.z / h, mem.fireArms === 1);
  }

  private drawCrew(battle: Battle, ship: Ship, r: Roster, view: CrewView, assets: Map<CrewKey, CrewAsset>) {
    const cast = CAST[ship.spec.faction];
    const target = battle.get(ship.targetId);
    const enemyNear = target && battle.isActive(target) ? Math.hypot(target.x - ship.x, target.z - ship.z) : Infinity;
    const p = this.pick;
    const facts = this.shipState;
    facts.reloading = false;
    for (const g of ship.guns) {
      if (g.stage < 4 && g.ammo > 0) {
        facts.reloading = true;
        break;
      }
    }
    facts.cheering = this.boarding.cheering(ship.id);
    for (let role = 0; role < 5; role += 1) {
      const asset = assets.get(cast[role]!);
      if (!asset) continue;
      const l = asset.lods[r.lod]!;
      const list = r.members[role]!;
      for (let i = 0; i < list.length; i += 1) {
        const mem = list[i]!;
        if (mem.away || mem.gone) continue;
        const st = r.stations[role]![mem.station]!;
        const visible = st.deck === 0 ? r.showLow : st.deck === 2 ? r.showCommand : r.showMain;
        if (!visible) continue;
        placement(r, role, mem, st, this.pl);
        const y = this.deckY(r, st.deck);
        // Men knocked over the rail leave the deck here and fall.
        if (mem.dying >= 0 && this.time >= mem.dying && mem.fling !== 0) {
          this.views.localToWorld(ship.id, this.pl.x, y + 0.4, this.pl.z, this.p);
          this.dir.set(0, 0, mem.fling).applyQuaternion(r.q);
          this.boarding.fall(cast[role]!, this.p.x, this.p.y, this.p.z, this.dir.x * rnd(1.2, 3.2), rnd(1.8, 4), this.dir.z * rnd(1.2, 3.2));
          mem.gone = true;
          continue;
        }
        this.choose(ship, r, role, mem, st, asset, view, enemyNear, facts);
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
}

let shared: Promise<Map<CrewKey, CrewAsset>> | null = null;

/** The character models load once and are shared by every battle. */
export function crewAssets() {
  shared ??= loadCrew({
    joseon_soldier: [128, 1200, 2400],
    joseon_marine: [96, 900, 1800],
    joseon_officer: [16, 80, 160],
    japan_ashigaru: [128, 1300, 2600],
    japan_samurai: [96, 1000, 2000],
    japan_officer: [16, 80, 200],
    ming_soldier: [128, 1000, 2000],
    ming_officer: [16, 60, 120],
    rower: [128, 900, 2400],
  });
  return shared;
}
