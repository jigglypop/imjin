import { Group, Quaternion, Vector3, type Camera } from 'three/webgpu';
import type { Battle } from '../sim/battle';
import type { BattleEvent, Faction, Ship, Team } from '../sim/types';
import type { ShipViews } from '../ships/ShipViews';
import { waveField } from '../ocean/waves';
import { DECKS, mainDeck, type DeckPlan } from '../ships/decks';
import { beginCrew, crewTime, endCrew, loadCrew, pushCrew, type ClipName, type CrewAsset, type CrewKey } from './crewModels';

/** Who stands at each station, by navy: rowers, gunners, shooters, deck fighters and the captain. */
const CAST: Record<Faction, [CrewKey, CrewKey, CrewKey, CrewKey, CrewKey]> = {
  joseon: ['rower', 'rower', 'joseon_soldier', 'joseon_marine', 'joseon_officer'],
  japan: ['rower', 'rower', 'japan_ashigaru', 'japan_samurai', 'japan_officer'],
  ming: ['rower', 'rower', 'ming_soldier', 'ming_soldier', 'ming_officer'],
};
/** Weapon each station carries. 1 spear, 2 bow, 3 matchlock, 4 sword. */
const ARMS: Record<Faction, number[]> = {
  joseon: [0, 0, 2, 1, 4],
  japan: [0, 0, 3, 4, 4],
  ming: [0, 0, 2, 1, 4],
};

const OAR = 0;
const GUN = 1;
const SHOT = 2;
const MELEE = 3;
const OFFICER = 4;
const LOD_NEAR = 85;
const LOD_MID = 230;
const RANGE = 540;
const DEATH = 2.6;

type Deck = 0 | 1 | 2;
type Station = { x: number; z: number; yaw: number; deck: Deck };
type Member = { station: number; seed: number; clip: ClipName; t0: number; dying: number };
type Roster = { key: string; plan: DeckPlan; main: number; stations: Station[][]; members: Member[][] };
type Boarder = { from: number; to: number; t: number; dur: number; x0: number; y0: number; z0: number; faction: Faction; seed: number };
type Fallen = { x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number; faction: Faction; role: number; age: number };

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/** Faces a figure (modelled facing +z) along a local direction. */
const yawTo = (dx: number, dz: number) => Math.atan2(dx, dz);

function stations(ship: Ship, plan: DeckPlan): Station[][] {
  const L = ship.spec.length;
  const B = ship.spec.beam;
  const rand = seeded(ship.id * 7919 + 13);
  const out: Station[][] = [[], [], [], [], []];
  const lowDeck: Deck = plan.oarDrop > 0 ? 0 : 1;
  // Rowers: a line down each side, facing their oars.
  const perSide = Math.max(1, Math.ceil(plan.figures.oar / 2));
  for (let i = 0; i < plan.figures.oar; i += 1) {
    const side = i % 2 === 0 ? 1 : -1;
    const k = Math.floor(i / 2);
    const x = (-0.36 + (0.7 * (k + 0.5)) / perSide) * L;
    out[OAR]!.push({ x, z: side * B * (plan.oarDrop > 0 ? 0.31 : 0.28), yaw: yawTo(0, side), deck: lowDeck });
  }
  // Gunners stand at the guns of each broadside.
  const sides = [0, 1].map((side) => ship.guns.filter((g) => g.side === side).length);
  for (let i = 0; i < plan.figures.gun; i += 1) {
    const side = i % 2;
    const count = Math.max(1, sides[side]!);
    const slot = Math.floor(i / 2) % count;
    const along = count <= 1 ? 0 : (slot / (count - 1) - 0.5) * L * 0.66;
    const z = (side === 0 ? -1 : 1) * (B * 0.5 - 1.6);
    out[GUN]!.push({ x: along + (Math.floor(i / 2) >= count ? 1.2 : 0), z, yaw: yawTo(0, Math.sign(z)), deck: 1 });
  }
  // Shooters line the rails.
  for (let i = 0; i < plan.figures.shot; i += 1) {
    const side = i % 2 === 0 ? 1 : -1;
    const x = (-0.3 + 0.66 * rand()) * L * (plan.length / 0.66);
    out[SHOT]!.push({ x, z: side * (B * 0.5 * plan.beam - 0.4), yaw: yawTo(rand() * 0.6 - 0.3, side), deck: 1 });
  }
  // Deck fighters hold the middle.
  for (let i = 0; i < plan.figures.melee; i += 1) {
    out[MELEE]!.push({ x: (rand() - 0.5) * L * 0.42, z: (rand() - 0.5) * B * 0.36, yaw: yawTo(1, (rand() - 0.5) * 0.8), deck: 1 });
  }
  if (plan.command) out[OFFICER]!.push({ x: plan.command.x * L, z: 0, yaw: yawTo(1, 0), deck: 2 });
  else out[OFFICER]!.push({ x: -0.32 * L, z: 0, yaw: yawTo(1, 0), deck: 1 });
  return out;
}

export type CrewView = { cutaway: number; cut: Set<number>; winner: Team | null };

/**
 * The crews of the ships near the camera: rowers, gunners, archers or arquebusiers, deck fighters and captains, each
 * a skinned figure at a station on the right deck, animated by what the ship is doing. Casualties fall where they
 * stand, some go over the side, and boarders leap across when ships grapple.
 */
export class Crew {
  readonly group = new Group();
  private assets: Map<CrewKey, CrewAsset> | null = null;
  private readonly rosters = new Map<number, Roster>();
  private readonly boarders: Boarder[] = [];
  private readonly fallen: Fallen[] = [];
  private readonly boardTimer = new Map<string, number>();
  private time = 0;
  private readonly shipQ = new Quaternion();
  private readonly q = new Quaternion();
  private readonly yawQ = new Quaternion();
  private readonly tilt = new Quaternion();
  private readonly p = new Vector3();
  private readonly e = new Vector3();
  private readonly s = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly side = new Vector3(1, 0, 0);

  constructor(private readonly views: ShipViews) {
    void crewAssets().then((assets) => {
      this.assets = assets;
      for (const a of assets.values()) for (const l of a.lods) this.group.add(l.mesh);
    });
  }

  private deckY(r: Roster, deck: Deck) {
    return deck === 0 ? r.main - r.plan.oarDrop : deck === 2 ? r.main + (r.plan.command?.up ?? 0) : r.main;
  }

  private roster(ship: Ship): Roster {
    let r = this.rosters.get(ship.id);
    const key = this.views.states.get(ship.id)?.key ?? `${ship.spec.kind}#0`;
    if (r && r.key === key) return r;
    const plan = DECKS[ship.spec.kind];
    r = { key, plan, main: mainDeck(key, ship.spec.kind, ship.spec.deck), stations: stations(ship, plan), members: [[], [], [], [], []] };
    this.rosters.set(ship.id, r);
    return r;
  }

  /** Brings the figures at each station in line with the crew left, marking the surplus as falling. */
  private muster(ship: Ship, r: Roster) {
    const figs = r.plan.figures;
    const full = [figs.oar, figs.gun, figs.shot, figs.melee];
    for (let role = 0; role < 5; role += 1) {
      let want: number;
      if (role === OFFICER) want = ship.crew > ship.spec.crew * 0.08 ? 1 : 0;
      else {
        const need = ship.spec.crew * ship.spec.crewPlan[role]!;
        want = need > 0 ? Math.min(r.stations[role]!.length, Math.round((ship.roles[role]! / need) * full[role]!)) : 0;
      }
      const list = r.members[role]!;
      let alive = 0;
      for (const mem of list) if (mem.dying < 0) alive += 1;
      if (alive < want) {
        const used = new Set(list.map((mm) => mm.station));
        for (let i = 0; i < r.stations[role]!.length && alive < want; i += 1) {
          if (used.has(i)) continue;
          list.push({ station: i, seed: Math.random(), clip: 'idle', t0: this.time - Math.random() * 4, dying: -1 });
          alive += 1;
        }
      } else if (alive > want) {
        for (let i = list.length - 1; i >= 0 && alive > want; i -= 1) {
          if (list[i]!.dying >= 0) continue;
          list[i]!.dying = this.time;
          alive -= 1;
        }
      }
      for (let i = list.length - 1; i >= 0; i -= 1) if (list[i]!.dying >= 0 && this.time - list[i]!.dying > DEATH) list.splice(i, 1);
    }
  }

  handle(events: BattleEvent[], battle: Battle) {
    for (const e of events) {
      if (e.type !== 'casualty' || e.melee) continue;
      const ship = battle.get(e.ship);
      if (!ship || !this.views.states.get(ship.id)?.visible) continue;
      const r = this.rosters.get(ship.id);
      if (!r || Math.random() > 0.45) continue;
      const n = Math.min(2, e.count);
      for (let k = 0; k < n; k += 1) {
        const role = Math.random() < 0.6 ? SHOT : MELEE;
        const st = r.stations[role]![Math.floor(Math.random() * Math.max(1, r.stations[role]!.length))];
        if (!st) continue;
        this.views.localToWorld(ship.id, st.x, this.deckY(r, 1) + 0.5, st.z, this.p);
        const c = Math.cos(ship.heading);
        const sn = Math.sin(ship.heading);
        const out = Math.sign(st.z || 1);
        this.fallen.push({ x: this.p.x, y: this.p.y, z: this.p.z, vx: -sn * out * rnd(1, 3.5), vy: rnd(1.5, 4), vz: c * out * rnd(1, 3.5), spin: 0, faction: ship.spec.faction, role, age: 0 });
      }
    }
    if (this.fallen.length > 160) this.fallen.splice(0, this.fallen.length - 160);
  }

  private clipFor(battle: Battle, ship: Ship, role: number, mem: Member, winner: Team | null, boarding: boolean): { clip: ClipName; rate: number } {
    if (winner && ship.team === winner) return { clip: 'cheer', rate: 1 };
    const target = battle.get(ship.targetId);
    const d = target && battle.isActive(target) ? Math.hypot(target.x - ship.x, target.z - ship.z) : Infinity;
    const engaged = d < 700;
    if (role === OAR) {
      const f = Math.abs(ship.speed) / ship.spec.maxSpeed;
      return f > 0.12 ? { clip: 'row', rate: 0.55 + f * 0.7 } : { clip: 'idle', rate: 1 };
    }
    if (role === GUN) {
      const reloading = ship.guns.some((g) => g.stage < 4 && g.ammo > 0);
      return reloading && engaged ? { clip: 'haul', rate: 1.2 } : { clip: 'idle', rate: 1 };
    }
    if (role === SHOT) {
      if (boarding) return { clip: 'melee', rate: 1 };
      if (d < ship.spec.musketRange * 1.15) return { clip: ship.spec.arms === 'gun' && Math.sin(this.time * 0.4 + mem.seed * 9) > 0.1 ? 'reload' : 'shoot', rate: 0.9 + mem.seed * 0.3 };
      return { clip: engaged ? 'ready' : 'idle', rate: 1 };
    }
    if (role === MELEE) {
      if (boarding) return { clip: mem.seed > 0.5 ? 'melee' : 'thrust', rate: 1 + mem.seed * 0.3 };
      return { clip: engaged ? 'ready' : 'idle', rate: 1 };
    }
    return { clip: engaged ? 'command' : 'idle', rate: 1 };
  }

  update(battle: Battle, dt: number, camera: Camera, view: CrewView = { cutaway: 0, cut: new Set(), winner: null }) {
    this.time += dt;
    crewTime.value = this.time;
    const assets = this.assets;
    if (!assets) return;
    beginCrew(assets);
    const cam = camera.position;
    const grappled = new Set<number>();
    for (const s of battle.ships) {
      if (!s.alive || !s.grappledWith) continue;
      grappled.add(s.id);
      grappled.add(s.grappledWith);
    }
    for (const ship of battle.ships) {
      if (!ship.alive) {
        this.rosters.delete(ship.id);
        continue;
      }
      if (ship.sinking > 0.35) continue;
      const v = this.views.states.get(ship.id);
      if (!v || !v.visible) continue;
      const dist = Math.hypot(ship.x - cam.x, ship.z - cam.z, cam.y);
      if (dist > RANGE) continue;
      const r = this.roster(ship);
      this.muster(ship, r);
      const lod = dist < LOD_NEAR ? 0 : dist < LOD_MID ? 1 : 2;
      const cut = view.cut.has(ship.id) ? view.cutaway : 0;
      const lowDeck = r.plan.oarDrop > 0;
      const showMain = cut === 0 ? r.plan.open : cut < 3 || !lowDeck;
      const showLow = !lowDeck ? showMain : cut === 3;
      const showCommand = cut <= 1 && (cut > 0 || r.plan.open);
      v.matrix.decompose(this.e, this.shipQ, this.s);
      const boarding = grappled.has(ship.id);
      const cast = CAST[ship.spec.faction];
      const arms = ARMS[ship.spec.faction];
      for (let role = 0; role < 5; role += 1) {
        const asset = assets.get(cast[role]!);
        if (!asset) continue;
        const l = asset.lods[lod]!;
        for (const mem of r.members[role]!) {
          const st = r.stations[role]![mem.station]!;
          const visible = st.deck === 0 ? showLow : st.deck === 2 ? showCommand : showMain;
          if (!visible) continue;
          let clip: ClipName;
          let rate = 1;
          let t0 = mem.t0;
          if (mem.dying >= 0) {
            clip = asset.clips.die ? 'die' : 'idle';
            t0 = mem.dying;
          } else {
            const want = this.clipFor(battle, ship, role, mem, view.winner, boarding);
            clip = asset.clips[want.clip] ? want.clip : asset.clips.ready && want.clip !== 'idle' ? 'ready' : 'idle';
            rate = want.rate;
            if (clip !== mem.clip) {
              mem.clip = clip;
              mem.t0 = this.time - mem.seed * 0.8;
            }
            t0 = mem.t0;
          }
          const data = asset.clips[clip]!;
          const weapon = role === SHOT && boarding ? (arms[MELEE] === 4 ? 4 : 1) : arms[role]!;
          this.views.localToWorld(ship.id, st.x, this.deckY(r, st.deck), st.z, this.p);
          this.yawQ.setFromAxisAngle(this.up, st.yaw);
          this.q.multiplyQuaternions(this.shipQ, this.yawQ);
          pushCrew(l, this.p.x, this.p.y, this.p.z, 1, this.q.x, this.q.y, this.q.z, this.q.w, data, t0, rate, weapon, mem.dying >= 0 ? Math.min(1, (this.time - mem.dying) / DEATH) * 0.6 : 0);
        }
      }
      // Boarders leap from the grappling ship to the one it holds.
      const foe = ship.grappledWith ? battle.get(ship.grappledWith) : undefined;
      if (foe && foe.alive && dist < RANGE * 0.8) {
        const key = `${ship.id}-${foe.id}`;
        const timer = (this.boardTimer.get(key) ?? 0) - dt;
        if (timer <= 0 && this.boarders.length < 160) {
          const dx = foe.x - ship.x;
          const dz = foe.z - ship.z;
          const c = Math.cos(ship.heading);
          const sn = Math.sin(ship.heading);
          const lz = -dx * sn + dz * c;
          this.views.localToWorld(ship.id, (Math.random() - 0.5) * ship.spec.length * 0.3, r.main, Math.sign(lz || 1) * ship.spec.beam * 0.45, this.p);
          this.boarders.push({ from: ship.id, to: foe.id, t: 0, dur: rnd(0.9, 1.5), x0: this.p.x, y0: this.p.y, z0: this.p.z, faction: ship.spec.faction, seed: Math.random() });
          this.boardTimer.set(key, rnd(0.3, 0.7));
        } else this.boardTimer.set(key, timer);
      }
    }
    this.drawBoarders(battle, dt, assets);
    this.drawFallen(dt, assets);
    endCrew(assets);
  }

  private drawBoarders(battle: Battle, dt: number, assets: Map<CrewKey, CrewAsset>) {
    for (let i = this.boarders.length - 1; i >= 0; i -= 1) {
      const b = this.boarders[i]!;
      b.t += dt;
      const to = battle.get(b.to);
      if (!to || !to.alive || b.t > b.dur) {
        this.boarders.splice(i, 1);
        continue;
      }
      const r = this.rosters.get(to.id);
      this.views.localToWorld(to.id, (b.seed - 0.5) * to.spec.length * 0.3, r ? r.main : to.spec.deck, 0, this.e);
      const k = b.t / b.dur;
      const x = b.x0 + (this.e.x - b.x0) * k;
      const z = b.z0 + (this.e.z - b.z0) * k;
      const y = b.y0 + (this.e.y - b.y0) * k + Math.sin(k * Math.PI) * 2.2;
      const asset = assets.get(CAST[b.faction][MELEE]);
      if (!asset) continue;
      const clip = asset.clips.run ?? asset.clips.idle!;
      this.q.setFromAxisAngle(this.up, yawTo(this.e.x - b.x0, this.e.z - b.z0));
      pushCrew(asset.lods[1]!, x, y, z, 1, this.q.x, this.q.y, this.q.z, this.q.w, clip, b.seed * 3, 1.3, ARMS[b.faction][MELEE]!, 0);
    }
  }

  private drawFallen(dt: number, assets: Map<CrewKey, CrewAsset>) {
    const t = waveField.time;
    for (let i = this.fallen.length - 1; i >= 0; i -= 1) {
      const f = this.fallen[i]!;
      f.age += dt;
      const h = waveField.heightAt(f.x, f.z, t, 8);
      if (f.y > h - 0.2) {
        f.vy -= 9.81 * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.z += f.vz * dt;
        f.spin += dt * 3.2;
      } else {
        f.y = h - 0.9 - Math.max(0, f.age - 4) * 0.3;
        f.spin = 1.45;
      }
      if (f.age > 12) {
        this.fallen.splice(i, 1);
        continue;
      }
      const asset = assets.get(CAST[f.faction][f.role]);
      if (!asset) continue;
      const clip = asset.clips.die ?? asset.clips.idle!;
      this.yawQ.setFromAxisAngle(this.up, Math.atan2(f.vx, f.vz));
      this.tilt.setFromAxisAngle(this.side, Math.min(1.45, f.spin));
      this.q.multiplyQuaternions(this.yawQ, this.tilt);
      pushCrew(asset.lods[1]!, f.x, f.y, f.z, 1, this.q.x, this.q.y, this.q.z, this.q.w, clip, this.time - 10, -1, 0, Math.min(0.8, f.age / 8));
    }
  }
}

let shared: Promise<Map<CrewKey, CrewAsset>> | null = null;

/** The character models load once and are shared by every battle. */
export function crewAssets() {
  shared ??= loadCrew({
    joseon_soldier: [96, 600, 1600],
    joseon_marine: [64, 400, 900],
    joseon_officer: [16, 80, 160],
    japan_ashigaru: [96, 700, 1800],
    japan_samurai: [64, 500, 1200],
    japan_officer: [16, 80, 200],
    ming_soldier: [96, 600, 1400],
    ming_officer: [16, 60, 120],
    rower: [128, 900, 2400],
  });
  return shared;
}
