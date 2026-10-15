import { Group, Vector3, type Camera } from 'three/webgpu';
import type { Battle } from '../../sim/battle';
import type { AmmoType, Ship } from '../../sim/types';
import type { ShipViews } from '../../ships/ShipViews';
import { waveField } from '../../ocean/waves';
import type { ParticleLayer, StreakLayer } from '../ParticleLayer';
import { Piece, type DebrisField } from '../Debris';
import { FlameLayer } from './FlameLayer';
import { burnSites, Site, type BurnSite } from './sites';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Pushes a light for this frame only: position, intensity, reach and colour. */
export type FireLight = (x: number, y: number, z: number, intensity: number, dist: number, r: number, g: number, b: number) => void;

export type ShipFiresOptions = {
  views: ShipViews;
  smoke: ParticleLayer;
  spray: ParticleLayer;
  streaks: StreakLayer;
  debris: DebrisField;
  /** Equipment class: 1 PC, 0.7 tablet, 0.45 phone. Sets the flame pool and how many places a ship burns in. */
  tier: number;
  light: FireLight;
  /** Fire meeting the sea: where, and how much of it (0..1), for the hiss. */
  steam?: (x: number, y: number, z: number, size: number) => void;
};

/** A fire on one ship as drawn: which of its places burn and how hard, and how far the fire has run from where it started. */
type Blaze = {
  sites: BurnSite[];
  heat: Float32Array;
  /** Metres from the nearest place the fire started (a hit, or the side facing a burning neighbour). */
  dist: Float32Array;
  /** The place has gone under the sea: it burns no more. */
  wet: Uint8Array;
  seeds: number[];
  front: number;
  level: number;
  flameAcc: number;
  smokeAcc: number;
  emberAcc: number;
  scraps: number;
  scrapAt: number;
  /** The fire's centre in the world, last frame: its light, and where the wreck burns on when the hull is gone. */
  cx: number;
  cy: number;
  cz: number;
};

/** A burnt-out hull's last fire on the water: flotsam burning low, steam where it went down, the smoke column thinning. */
type Pyre = { x: number; z: number; L: number; heat: number; age: number; flot: number[]; flameAcc: number; smokeAcc: number; steamAcc: number };

/** Seconds a hit is remembered as where a fire that breaks out next started. */
const HIT_MEMORY = 2.5;
const PYRE_LIFE = 55;

/**
 * Burning ships as drawn. The sim decides how hard a ship burns (Ship.fire, 0..1); this decides where on the ship: the
 * fire starts where the hit that lit it struck, runs along the deck and up the bulwarks, the upper works and the
 * rigging as it grows, licks out of the gun ports, and goes out place by place as the hull goes under, hissing. Each
 * burning place stands tongues of flame on the hull (FlameLayer), sends up a column of black-brown smoke lit from
 * below, and throws sparks and embers downwind. When the hull is gone its wreckage burns on the water a while longer.
 */
export class ShipFires {
  readonly group = new Group();
  readonly flames: FlameLayer;
  private readonly blazes = new Map<number, Blaze>();
  private readonly pyres: Pyre[] = [];
  private readonly lastHit = new Map<number, { x: number; y: number; z: number; t: number }>();
  private readonly siteCount: number;
  private keep = 1;
  private readonly p = new Vector3();
  private readonly q = new Vector3();
  private readonly cam = new Vector3();
  private windX = 2.4;
  private windZ = 1.6;

  constructor(private readonly o: ShipFiresOptions) {
    this.flames = new FlameLayer(Math.round(2600 * o.tier));
    this.siteCount = Math.round(30 * Math.max(0.5, o.tier));
    this.group.add(this.flames.sprite);
  }

  setKeep(keep: number) {
    this.keep = keep;
  }

  clear() {
    this.blazes.clear();
    this.pyres.length = 0;
    this.lastHit.clear();
    this.flames.clear();
  }

  /** Ship space of a world point on a ship, from its position, heading and heave (its pitch and roll are small here). */
  private toLocal(ship: Ship, x: number, y: number, z: number, out: Vector3) {
    const c = Math.cos(ship.heading);
    const n = Math.sin(ship.heading);
    const dx = x - ship.x;
    const dz = z - ship.z;
    return out.set(dx * c + dz * n, y - this.o.views.heaveOf(ship.id), -dx * n + dz * c);
  }

  /** A shot or fire arrow struck: a fire that breaks out now starts here, and one already burning catches here too. */
  hit(id: number, x: number, y: number, z: number, ammo: AmmoType, battle: Battle) {
    const ship = battle.get(id);
    if (!ship) return;
    this.toLocal(ship, x, y, z, this.p);
    this.lastHit.set(id, { x: this.p.x, y: this.p.y, z: this.p.z, t: battle.time });
    const b = this.blazes.get(id);
    if (b && (ammo === 'fire' || Math.random() < 0.25)) this.seed(b, this.p.x, this.p.y, this.p.z);
  }

  /** A ship catches fire: from the hit that just struck it, from the side facing the burning ship it caught from, or amidships. */
  ignite(id: number, from: number | undefined, battle: Battle) {
    const ship = battle.get(id);
    if (!ship) return;
    const b = this.blazeOf(ship);
    const hit = this.lastHit.get(id);
    const source = from ? battle.get(from) : undefined;
    if (hit && battle.time - hit.t < HIT_MEMORY) this.seed(b, hit.x, hit.y, hit.z);
    else if (source) {
      this.toLocal(ship, source.x, 0, source.z, this.p);
      const side = Math.sign(this.p.z) || 1;
      this.seed(b, Math.max(-0.4, Math.min(0.4, this.p.x / ship.spec.length)) * ship.spec.length, 0, side * ship.spec.beam * 0.5);
    } else this.seed(b, rnd(-0.25, 0.25) * ship.spec.length, 0, rnd(-0.3, 0.3) * ship.spec.beam);
    // The first flare: a gout of flame and sparks where it caught.
    let best = 0;
    for (let i = 1; i < b.sites.length; i += 1) if (b.dist[i]! < b.dist[best]!) best = i;
    const s = b.sites[best]!;
    for (let i = 0; i < 4; i += 1) this.flames.emit({ ship: id, site: best, x: s.x + rnd(-0.8, 0.8), y: s.y, z: s.z + rnd(-0.6, 0.6), leanX: 0, leanZ: 0, height: rnd(2.5, 4.5), width: rnd(1.4, 2.2), life: rnd(0.4, 0.8), heat: 1, rise: 2.5 });
    this.o.views.localToWorld(id, s.x, s.y + 1, s.z, this.p);
    this.sparks(this.p.x, this.p.y, this.p.z, 14, 9);
    this.o.light(this.p.x, this.p.y + 2, this.p.z, 14000, 200, 1, 0.5, 0.18);
  }

  private blazeOf(ship: Ship) {
    let b = this.blazes.get(ship.id);
    if (b) return b;
    const sites = burnSites(ship, this.siteCount);
    b = {
      sites,
      heat: new Float32Array(sites.length),
      dist: new Float32Array(sites.length).fill(1e6),
      wet: new Uint8Array(sites.length),
      seeds: [],
      front: 3,
      level: 0,
      flameAcc: 0,
      smokeAcc: 0,
      emberAcc: 0,
      scraps: 0,
      scrapAt: 0,
      cx: ship.x,
      cy: ship.spec.deck,
      cz: ship.z,
    };
    this.blazes.set(ship.id, b);
    return b;
  }

  /** A new place the fire started: every burning place's distance is from the nearest start. */
  private seed(b: Blaze, x: number, y: number, z: number) {
    if (b.seeds.length >= 18) return;
    b.seeds.push(x, y, z);
    for (let i = 0; i < b.sites.length; i += 1) {
      const s = b.sites[i]!;
      const d = Math.hypot(s.x - x, (s.y - y) * 0.5, s.z - z);
      if (d < b.dist[i]!) b.dist[i] = d;
    }
  }

  /** A fire is drawn on this ship, burning or still dying down. */
  has(id: number) {
    return this.blazes.has(id);
  }

  /** One frame of a burning ship. `level` is how hard it burns (0..1); `dt` the battle time since the last frame. */
  burn(ship: Ship, level: number, dt: number) {
    const b = this.blazeOf(ship);
    if (!b.seeds.length) this.seed(b, rnd(-0.25, 0.25) * ship.spec.length, 0, rnd(-0.3, 0.3) * ship.spec.beam);
    b.level = level;
    const L = ship.spec.length;
    const views = this.o.views;
    // The fire runs out from where it started, faster the harder it burns, and holds as far as the fire is big.
    const reach = L * (0.08 + 1.2 * level);
    b.front = b.front < reach ? Math.min(reach, b.front + dt * (0.6 + 5 * level)) : Math.max(reach, b.front - dt * 1.5);
    const sinking = ship.sinking > 0;
    views.localToWorld(ship.id, 0, 0, 0, this.p);
    const camDist = this.cam.distanceTo(this.p);
    // Far ships burn in fewer, bigger tongues; from across the bay the fire is a glow and a column of smoke.
    const detail = camDist < 450 ? 1 : camDist < 1300 ? 0.55 : 0.3;
    const grow = 1 + Math.max(0, camDist - 450) / 900;
    const scale = Math.sqrt(L / 40);
    let total = 0;
    let wx = 0;
    let wy = 0;
    let wz = 0;
    const hot: number[] = [];
    for (let i = 0; i < b.sites.length; i += 1) {
      const s = b.sites[i]!;
      if (b.wet[i]) continue;
      if (sinking) {
        views.localToWorld(ship.id, s.x, s.y, s.z, this.q);
        if (this.q.y < waveField.heightAt(this.q.x, this.q.z, waveField.time, 8) + 0.15) {
          b.wet[i] = 1;
          if (b.heat[i]! > 0.12) this.steam(this.q.x, this.q.y + 0.4, this.q.z, b.heat[i]! * scale);
          b.heat[i] = 0;
          continue;
        }
      }
      const edge = smooth(b.front, b.front - 3, b.dist[i]!);
      const target = level > 0.01 && level >= s.from ? edge * (0.4 + 0.6 * level) * smooth(s.from, s.from + 0.2, level + 0.1) : 0;
      const h = b.heat[i]!;
      b.heat[i] = h + (target - h) * Math.min(1, dt * (target > h ? 0.9 : 0.35));
      if (b.heat[i]! < 0.05) continue;
      hot.push(i);
      const k = b.heat[i]!;
      views.localToWorld(ship.id, s.x, s.y, s.z, this.q);
      total += k;
      wx += this.q.x * k;
      wy += this.q.y * k;
      wz += this.q.z * k;
    }
    if (!hot.length) return;
    b.cx = wx / total;
    b.cy = wy / total;
    b.cz = wz / total;
    const room = this.flames.room;
    const k = this.keep;
    const c = Math.cos(ship.heading);
    const n = Math.sin(ship.heading);
    // Flames: a few tongues a second from every burning place, more the harder it burns.
    b.flameAcc = Math.min(40, b.flameAcc + total * 6 * k * detail * Math.min(1, room * 2.5) * dt);
    while (b.flameAcc >= 1) {
      b.flameAcc -= 1;
      const i = hot[Math.floor(Math.random() * hot.length)]!;
      const s = b.sites[i]!;
      const heat = b.heat[i]!;
      const tall = s.kind === Site.Upper || s.kind === Site.Rig ? 1.25 : s.kind === Site.Port ? 0.7 : 1;
      const bed = Math.random() < 0.18;
      const height = (bed ? rnd(1, 1.8) : (1.3 + 4.6 * heat) * rnd(0.65, 1.3)) * s.size * tall * scale * (detail < 1 ? grow * 1.3 : 1);
      const width = bed ? height * rnd(1.2, 1.7) : height * rnd(0.3, 0.46);
      // A gun port's flames billow out of the hull and then rise; the rest lean only with the wind.
      const ox = (s.outX * c - s.outZ * n) * 0.9;
      const oz = (s.outX * n + s.outZ * c) * 0.9;
      this.flames.emit({ ship: ship.id, site: i, x: s.x + rnd(-1, 1), y: s.y, z: s.z + rnd(-0.6, 0.6), leanX: ox, leanZ: oz, height, width, life: bed ? rnd(0.8, 1.4) : rnd(0.5, 1.1), heat: heat * rnd(0.75, 1), alpha: bed ? 0.45 : 0.8, rise: rnd(0.6, 2) });
    }
    // Smoke: a column from the flames' tips, black-brown and lit from below while it is low. A small fire smoulders grey.
    b.smokeAcc = Math.min(8, b.smokeAcc + (2 + 10 * level) * k * dt);
    const sooty = smooth(0.15, 0.5, level);
    while (b.smokeAcc >= 1) {
      b.smokeAcc -= 1;
      const i = hot[Math.floor(Math.random() * hot.length)]!;
      const s = b.sites[i]!;
      views.localToWorld(ship.id, s.x, s.y + 2 + 3 * b.heat[i]!, s.z, this.q);
      const g = 0.27 - 0.2 * sooty;
      this.o.smoke.emit({ x: this.q.x, y: this.q.y, z: this.q.z, vx: rnd(-0.6, 0.6), vy: rnd(4.5, 7.5) * (0.6 + 0.4 * level), vz: rnd(-0.6, 0.6), life: rnd(18, 28), size0: rnd(2, 3) * scale, size1: rnd(12, 20) * (0.55 + 0.6 * level) * scale, alpha: 0.5 + 0.25 * sooty, r: g * 1.12, g: g * 1.0, b: g * 0.88, drag: 0.3, lift: 0.9, wind: 0.85, heat: 0.4 + 0.6 * level, spin: 0.15 });
    }
    // Sparks and embers going up in the heat and drifting off downwind.
    b.emberAcc = Math.min(20, b.emberAcc + (2 + 16 * level) * k * dt);
    const boost = Math.min(4, Math.max(1, camDist / 160));
    while (b.emberAcc >= 1) {
      b.emberAcc -= 1;
      const i = hot[Math.floor(Math.random() * hot.length)]!;
      const s = b.sites[i]!;
      views.localToWorld(ship.id, s.x + rnd(-1, 1), s.y + rnd(0.5, 3), s.z + rnd(-0.8, 0.8), this.q);
      this.o.streaks.emit({ x: this.q.x, y: this.q.y, z: this.q.z, vx: this.windX * rnd(0.3, 0.8) + rnd(-1.5, 1.5), vy: rnd(3, 9), vz: this.windZ * rnd(0.3, 0.8) + rnd(-1.5, 1.5), life: rnd(1.4, 3.4), minLen: 0.12, stretch: 0.045, width: rnd(0.06, 0.11) * boost, r: 1, g: rnd(0.38, 0.62), b: 0.1, alpha: rnd(0.6, 1), gravity: -rnd(0.4, 1.4), drag: 0.9 });
    }
    // Burning sail cloth: once the rigging is alight, scraps of it come down glowing.
    if (level > 0.55 && b.scraps < 7 && b.sites.some((s, i) => s.kind === Site.Rig && b.heat[i]! > 0.4)) {
      b.scrapAt -= dt;
      if (b.scrapAt <= 0) {
        b.scrapAt = rnd(2.5, 6);
        b.scraps += 1;
        const rig = b.sites.filter((s) => s.kind === Site.Rig);
        const s = rig[Math.floor(Math.random() * rig.length)]!;
        views.localToWorld(ship.id, s.x, s.y + rnd(0, 3), s.z, this.q);
        this.o.debris.spawn(Piece.Sail, this.q.x, this.q.y, this.q.z, this.windX * 0.4 + rnd(-1, 1), rnd(0, 1.5), this.windZ * 0.4 + rnd(-1, 1), rnd(1.2, 3), 1, rnd(1, 2.2), rnd(14, 24), 0.6, 1);
        this.sparks(this.q.x, this.q.y, this.q.z, 8, 5);
      }
    }
    // Firelight: one flickering light at the fire's heart, on the water and the hulls around.
    const t = waveField.time + ship.id * 1.37;
    const flicker = 0.78 + 0.12 * Math.sin(t * 9.1) + 0.07 * Math.sin(t * 23.3 + 1.1) + 0.06 * (Math.random() - 0.5);
    this.o.light(b.cx, b.cy + 4 + 2 * level, b.cz, 3500 * level * scale * flicker, 120 + 60 * level, 1, 0.46 + 0.05 * flicker, 0.15);
  }

  /** Steam bursting off where burning timber meets the sea: white, fast and short-lived, with a hiss. */
  private steam(x: number, y: number, z: number, size: number) {
    const count = Math.max(2, Math.round((3 + 6 * size) * this.keep));
    for (let i = 0; i < count; i += 1) this.o.smoke.emit({ x: x + rnd(-1, 1), y: y + rnd(0, 0.6), z: z + rnd(-1, 1), vx: rnd(-1.2, 1.2), vy: rnd(3, 7), vz: rnd(-1.2, 1.2), life: rnd(4, 8), size0: rnd(1.2, 2.2), size1: rnd(7, 13) * (0.6 + 0.4 * size), alpha: 0.55, r: 0.9, g: 0.91, b: 0.92, drag: 0.9, lift: 0.7, wind: 0.8 });
    for (let i = 0; i < 4; i += 1) this.o.spray.emit({ x, y, z, vx: rnd(-1, 1), vy: rnd(1.5, 4), vz: rnd(-1, 1), life: rnd(0.8, 1.5), size0: 0.6, size1: rnd(1.5, 2.5), alpha: 0.6, r: 0.95, g: 0.97, b: 1, drag: 1, lift: -6, wind: 0.2 });
    this.o.steam?.(x, y, z, Math.min(1, size));
  }

  private sparks(x: number, y: number, z: number, count: number, speed: number) {
    const boost = Math.min(4, Math.max(1, this.cam.distanceTo(this.q.set(x, y, z)) / 160));
    for (let i = 0; i < Math.max(2, Math.round(count * this.keep)); i += 1) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(0.3, 1) * speed;
      this.o.streaks.emit({ x, y, z, vx: Math.cos(a) * sp * 0.6, vy: rnd(0.5, 1.4) * speed, vz: Math.sin(a) * sp * 0.6, life: rnd(0.8, 2), minLen: 0.15, stretch: 0.05, width: 0.09 * boost, r: 1, g: rnd(0.45, 0.7), b: 0.15, gravity: 3, drag: 0.6 });
    }
  }

  /** The hull is gone. If it was burning, its wreckage burns on where it went down and the smoke thins out over a minute. */
  removed(id: number, battle: Battle) {
    const b = this.blazes.get(id);
    this.blazes.delete(id);
    this.lastHit.delete(id);
    this.flames.clear(id);
    const ship = battle.get(id);
    if (!b || !ship || b.level < 0.12) return;
    const L = ship.spec.length;
    const flot: number[] = [];
    const c = Math.cos(ship.heading);
    const n = Math.sin(ship.heading);
    for (let i = 0; i < Math.max(3, Math.round(7 * this.o.tier)); i += 1) {
      const along = rnd(-0.4, 0.4) * L;
      const across = rnd(-0.6, 0.6) * ship.spec.beam;
      flot.push(ship.x + c * along - n * across, ship.z + n * along + c * across, rnd(0.5, 1));
    }
    this.pyres.push({ x: ship.x, z: ship.z, L, heat: b.level, age: 0, flot, flameAcc: 0, smokeAcc: 0, steamAcc: 0 });
    const h = waveField.heightAt(ship.x, ship.z);
    for (let i = 0; i < 4; i += 1) this.steam(ship.x + rnd(-0.3, 0.3) * L * c, h + 0.3, ship.z + rnd(-0.3, 0.3) * L * n, 1);
    // Burning timbers thrown up by the plunge, still alight on the water.
    for (let i = 0; i < Math.round(6 * this.o.tier) + 2; i += 1) {
      const along = rnd(-0.4, 0.4) * L;
      this.o.debris.spawn(i % 3 ? Piece.Plank : Piece.Beam, ship.x + c * along, h, ship.z + n * along, rnd(-3, 3), rnd(3, 8), rnd(-3, 3), rnd(1.6, 4), 1, 1, rnd(26, 40), 0.7, 1);
    }
  }

  update(dt: number, windX: number, windZ: number, camera: Camera) {
    this.windX = windX;
    this.windZ = windZ;
    this.cam.copy(camera.position);
    for (let i = this.pyres.length - 1; i >= 0; i -= 1) {
      const p = this.pyres[i]!;
      p.age += dt;
      if (p.age > PYRE_LIFE) {
        this.pyres.splice(i, 1);
        continue;
      }
      if (dt > 0) this.pyre(p, dt);
    }
    // Flames live in seconds on screen: at high battle speeds a frame spans seconds and they would only flicker.
    const vt = Math.min(dt, 0.1);
    this.flames.update(vt, windX, windZ, this.anchor);
    for (const [id, b] of this.blazes) if (b.level <= 0 && b.heat.every((h) => h < 0.05)) this.blazes.delete(id);
  }

  private readonly anchor = (ship: number, site: number, x: number, y: number, z: number, out: Vector3) => {
    const b = this.blazes.get(ship);
    if (b?.wet[site] || !this.o.views.worldOf(ship)) return false;
    this.o.views.localToWorld(ship, x, y, z, out);
    return true;
  };

  private pyre(p: Pyre, dt: number) {
    const fade = p.heat * (1 - smooth(4, 30, p.age));
    const drift = 0.04;
    const h = waveField.heightAt(p.x, p.z, waveField.time, 8);
    for (let j = 0; j < p.flot.length; j += 3) {
      p.flot[j] = p.flot[j]! + this.windX * drift * dt;
      p.flot[j + 1] = p.flot[j + 1]! + this.windZ * drift * dt;
    }
    if (fade > 0.03) {
      p.flameAcc = Math.min(20, p.flameAcc + (p.flot.length / 3) * 3.5 * fade * this.keep * dt);
      while (p.flameAcc >= 1) {
        p.flameAcc -= 1;
        const j = Math.floor(Math.random() * (p.flot.length / 3)) * 3;
        const size = p.flot[j + 2]!;
        const height = rnd(0.9, 2.6) * size * (0.4 + 0.6 * fade);
        this.flames.emit({ ship: 0, site: 0, x: p.flot[j]! + rnd(-1.2, 1.2), y: h + 0.05, z: p.flot[j + 1]! + rnd(-1.2, 1.2), leanX: 0, leanZ: 0, height, width: height * rnd(0.6, 0.9), life: rnd(0.5, 1), heat: 0.5 + 0.4 * fade, rise: 0.8 });
      }
      const t = waveField.time + p.x;
      this.o.light(p.x, h + 2, p.z, 4000 * fade * (0.85 + 0.15 * Math.sin(t * 8.7)), 120, 1, 0.45, 0.15);
    }
    // The column keeps rising off the wreck and thins: lighter, sparser, greyer as the fire dies.
    const left = 1 - p.age / PYRE_LIFE;
    p.smokeAcc = Math.min(6, p.smokeAcc + (0.6 + 4 * p.heat) * left * left * this.keep * dt);
    while (p.smokeAcc >= 1) {
      p.smokeAcc -= 1;
      const j = Math.floor(Math.random() * (p.flot.length / 3)) * 3;
      const g = 0.1 + 0.22 * (1 - left);
      this.o.smoke.emit({ x: p.flot[j]!, y: h + 1.5, z: p.flot[j + 1]!, vx: rnd(-0.5, 0.5), vy: rnd(3, 5.5) * (0.5 + 0.5 * left), vz: rnd(-0.5, 0.5), life: rnd(18, 28), size0: rnd(2, 3), size1: rnd(14, 24) * Math.sqrt(p.L / 40) * (0.5 + 0.5 * left), alpha: 0.35 + 0.4 * left * p.heat, r: g * 1.1, g, b: g * 0.9, drag: 0.3, lift: 0.8, wind: 0.85, heat: 0.6 * fade });
    }
    // Steam off the spot where the hull went under, for the first seconds.
    if (p.age < 6) {
      p.steamAcc += (6 - p.age) * 1.2 * this.keep * dt;
      while (p.steamAcc >= 1) {
        p.steamAcc -= 1;
        this.o.smoke.emit({ x: p.x + rnd(-0.3, 0.3) * p.L, y: h + 0.3, z: p.z + rnd(-0.3, 0.3) * p.L, vx: rnd(-1, 1), vy: rnd(2, 5), vz: rnd(-1, 1), life: rnd(5, 9), size0: rnd(1.5, 2.5), size1: rnd(8, 14), alpha: 0.45, r: 0.88, g: 0.89, b: 0.9, drag: 0.9, lift: 0.6, wind: 0.9 });
      }
    }
  }

  stats() {
    let sites = 0;
    for (const b of this.blazes.values()) for (const h of b.heat) if (h >= 0.05) sites += 1;
    return { ships: this.blazes.size, sites, flames: this.flames.count, pyres: this.pyres.length };
  }
}
