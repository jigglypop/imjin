/**
 * A clear atmosphere integrated on the CPU for one light direction: Rayleigh and Mie scattering, ozone absorption and
 * the multiple-scattering approximation of Hillaire (2020, "A Scalable and Production Ready Sky and Atmosphere
 * Rendering Technique"). A battle's sun never moves, so the sky is computed once at load, and everything that shows
 * the air reads these same numbers: the background, the reflections and ambient light, the fog colour and the haze in
 * front of the clouds. Plain arithmetic with no three.js, so tests can run it.
 */

export type Rgb = [number, number, number];

/** Metres. The sky is computed for an eye this high above the sea; the camera never goes high enough for it to differ. */
const EYE = 40;
const R_GROUND = 6360e3;
const R_TOP = 6460e3;
const H_ATMOSPHERE = R_TOP - R_GROUND;
const RAYLEIGH: Rgb = [5.802e-6, 13.558e-6, 33.1e-6];
const RAYLEIGH_H = 8000;
const MIE_SCATTER = 3.996e-6;
const MIE_ABSORB = 0.444e-6;
const MIE_H = 1200;
/** Sea salt and spray scatter more strongly forward than the continental dust the usual 0.8 is fitted to. */
const MIE_G = 0.8;
const OZONE: Rgb = [0.65e-6, 1.881e-6, 0.085e-6];
/** Light reaching the top of the air, normalised to green: the sun is a little blue before the air reddens it. */
export const SOLAR: Rgb = [1.474 / 1.8504, 1, 1.91198 / 1.8504];
/** What the sea gives back to the air under it: a few percent, mostly the sky it mirrors. */
const SEA_ALBEDO = 0.06;

const T_W = 128;
const T_H = 48;
const MS_N = 24;
const MS_DIRECTIONS = 64;

export type AtmosphereSpec = {
  /** Unit vector toward the sun (or the moon at night), y up. */
  light: Rgb;
  /**
   * Aerosol load at sea level as a multiple of a clear continental atmosphere's. Sea haze runs from about 8 on a clear
   * day to 40 under a misty overcast; it sets both the whiteness of the horizon and how far one can see.
   */
  haze: number;
  /**
   * Share of the light that reaches the air directly. Under an overcast deck the rest lights the haze from the grey
   * underside of the cloud instead, evenly from above.
   */
  direct?: number;
};

/** Share of the light a thick deck passes downward, diffused, of what it holds back from the direct beam. */
const DECK_TRANSMIT = 0.35;
/**
 * Colour of the light under a deck, luminance one: the sunlight on its top with the clear sky's blue light mixed in,
 * scattered evenly by the droplets. Overcast daylight is cooler than sunlight.
 */
export const DECK_TINT: Rgb = [0.92, 0.99, 1.12];

/** Extinction per metre at sea level for green light: what the scene's fog density should match. */
export function seaLevelExtinction(haze: number) {
  return RAYLEIGH[1] + (MIE_SCATTER + MIE_ABSORB) * haze;
}

/** The aerosol load whose sea-level extinction is `fogDensity` per metre. */
export function hazeForFog(fogDensity: number) {
  return Math.max(0.5, (fogDensity - RAYLEIGH[1]) / (MIE_SCATTER + MIE_ABSORB));
}

const ozoneAt = (h: number) => Math.max(0, 1 - Math.abs(h - 25000) / 15000);

/** Distance along a ray from radius `r` with zenith cosine `mu` to the top of the air. */
function toTop(r: number, mu: number) {
  const disc = r * r * (mu * mu - 1) + R_TOP * R_TOP;
  return Math.max(0, -r * mu + Math.sqrt(Math.max(0, disc)));
}

/** Distance to the sea along the ray, or -1 when it misses. */
function toGround(r: number, mu: number) {
  if (mu >= 0) return -1;
  const disc = r * r * (mu * mu - 1) + R_GROUND * R_GROUND;
  if (disc < 0) return -1;
  return -r * mu - Math.sqrt(disc);
}

export class Atmosphere {
  readonly light: Rgb;
  readonly haze: number;
  private readonly direct: number;
  private readonly diffuse: number = 0;
  /** Transmittance from altitude h toward zenith cosine mu, out of the air. Zero where the sea is in the way. */
  private readonly transmittance = new Float32Array(T_W * T_H * 3);
  /** Hillaire's psi_ms per altitude for this light direction: light scattered more than once, per unit scattering. */
  private readonly multiple = new Float32Array(MS_N * 3);
  private readonly scratch: Rgb = [0, 0, 0];
  private readonly scratchMs: Rgb = [0, 0, 0];

  constructor(spec: AtmosphereSpec) {
    const l = spec.light;
    const n = Math.hypot(l[0], l[1], l[2]) || 1;
    this.light = [l[0] / n, l[1] / n, l[2] / n];
    this.haze = spec.haze;
    this.direct = spec.direct ?? 1;
    this.buildTransmittance();
    this.buildMultiple();
    // The underside of the deck: what the cloud holds back from the beam, passed down evenly as a Lambertian sheet.
    const sea = this.lightAtSea([0, 0, 0]);
    const held = (1 - this.direct) * (0.2126 * sea[0] + 0.7152 * sea[1] + 0.0722 * sea[2]);
    this.diffuse = (held * Math.max(0.05, this.light[1]) * DECK_TRANSMIT) / Math.PI;
  }

  /** Radiance of the underside of the overcast, zero for a clear sky. */
  get deck() {
    return this.diffuse;
  }

  private extinction(h: number, out: Rgb) {
    const ray = Math.exp(-h / RAYLEIGH_H);
    const mie = Math.exp(-h / MIE_H) * this.haze * (MIE_SCATTER + MIE_ABSORB);
    const oz = ozoneAt(h);
    out[0] = RAYLEIGH[0] * ray + mie + OZONE[0] * oz;
    out[1] = RAYLEIGH[1] * ray + mie + OZONE[1] * oz;
    out[2] = RAYLEIGH[2] * ray + mie + OZONE[2] * oz;
    return out;
  }

  private buildTransmittance() {
    const e: Rgb = [0, 0, 0];
    const steps = 30;
    for (let j = 0; j < T_H; j += 1) {
      const v = j / (T_H - 1);
      const h = v * v * H_ATMOSPHERE;
      const r = R_GROUND + h;
      for (let i = 0; i < T_W; i += 1) {
        const mu = (i / (T_W - 1)) * 2 - 1;
        const o = (j * T_W + i) * 3;
        if (toGround(r, mu) > 0) {
          this.transmittance[o] = this.transmittance[o + 1] = this.transmittance[o + 2] = 0;
          continue;
        }
        const len = toTop(r, mu);
        let d0 = 0;
        let d1 = 0;
        let d2 = 0;
        let prev = 0;
        // Steps packed near the start, where the air (and the sea haze above all) is densest.
        for (let s = 0; s < steps; s += 1) {
          const a = (s + 1) / steps;
          const next = len * a * a;
          const dt = next - prev;
          const t = prev + dt * 0.5;
          prev = next;
          const rr = Math.sqrt(r * r + t * t + 2 * r * mu * t);
          this.extinction(rr - R_GROUND, e);
          d0 += e[0] * dt;
          d1 += e[1] * dt;
          d2 += e[2] * dt;
        }
        this.transmittance[o] = Math.exp(-d0);
        this.transmittance[o + 1] = Math.exp(-d1);
        this.transmittance[o + 2] = Math.exp(-d2);
      }
    }
  }

  /** Bilinear lookup of the transmittance table. */
  transmittanceAt(h: number, mu: number, out: Rgb) {
    const v = Math.sqrt(Math.min(1, Math.max(0, h / H_ATMOSPHERE))) * (T_H - 1);
    const u = (Math.min(1, Math.max(-1, mu)) * 0.5 + 0.5) * (T_W - 1);
    const j0 = Math.min(T_H - 2, Math.floor(v));
    const i0 = Math.min(T_W - 2, Math.floor(u));
    const fy = v - j0;
    const fx = u - i0;
    const T = this.transmittance;
    const a = (j0 * T_W + i0) * 3;
    const b = a + 3;
    const c = a + T_W * 3;
    const d = c + 3;
    for (let k = 0; k < 3; k += 1) {
      const top = T[a + k]! + (T[b + k]! - T[a + k]!) * fx;
      const bottom = T[c + k]! + (T[d + k]! - T[c + k]!) * fx;
      out[k] = top + (bottom - top) * fy;
    }
    return out;
  }

  private buildMultiple() {
    const e: Rgb = [0, 0, 0];
    const ts: Rgb = [0, 0, 0];
    const L = this.light;
    const isotropic = 1 / (4 * Math.PI);
    const steps = 20;
    // Directions spread evenly over the sphere (a Fibonacci lattice).
    const dirs: number[] = [];
    for (let k = 0; k < MS_DIRECTIONS; k += 1) {
      const y = 1 - ((k + 0.5) / MS_DIRECTIONS) * 2;
      const rad = Math.sqrt(1 - y * y);
      const phi = k * Math.PI * (3 - Math.sqrt(5));
      dirs.push(Math.cos(phi) * rad, y, Math.sin(phi) * rad);
    }
    for (let j = 0; j < MS_N; j += 1) {
      const v = j / (MS_N - 1);
      // A point exactly on the sea would find the sea at distance zero and march through the planet.
      const h = Math.max(1, v * v * 30000);
      const r = R_GROUND + h;
      let l0 = 0;
      let l1 = 0;
      let l2 = 0;
      let f0 = 0;
      let f1 = 0;
      let f2 = 0;
      for (let k = 0; k < MS_DIRECTIONS; k += 1) {
        const dx = dirs[k * 3]!;
        const dy = dirs[k * 3 + 1]!;
        const dz = dirs[k * 3 + 2]!;
        const ground = toGround(r, dy);
        const len = ground > 0 ? ground : toTop(r, dy);
        const dt = len / steps;
        let T0 = 1;
        let T1 = 1;
        let T2 = 1;
        for (let s = 0; s < steps; s += 1) {
          const t = (s + 0.5) * dt;
          const px = dx * t;
          const py = r + dy * t;
          const pz = dz * t;
          const pr = Math.sqrt(px * px + py * py + pz * pz);
          const ph = pr - R_GROUND;
          this.extinction(ph, e);
          const scatterR = Math.exp(-ph / RAYLEIGH_H);
          const scatterM = Math.exp(-ph / MIE_H) * this.haze * MIE_SCATTER;
          const sR = RAYLEIGH[0] * scatterR + scatterM;
          const sG = RAYLEIGH[1] * scatterR + scatterM;
          const sB = RAYLEIGH[2] * scatterR + scatterM;
          const muS = (px * L[0] + py * L[1] + pz * L[2]) / pr;
          this.transmittanceAt(ph, muS, ts);
          const s0 = Math.exp(-e[0] * dt);
          const s1 = Math.exp(-e[1] * dt);
          const s2 = Math.exp(-e[2] * dt);
          // Energy-conserving step: the light scattered within a step is attenuated by the step itself.
          const k0 = T0 * (1 - s0) / Math.max(e[0], 1e-12);
          const k1 = T1 * (1 - s1) / Math.max(e[1], 1e-12);
          const k2 = T2 * (1 - s2) / Math.max(e[2], 1e-12);
          l0 += k0 * sR * ts[0] * isotropic;
          l1 += k1 * sG * ts[1] * isotropic;
          l2 += k2 * sB * ts[2] * isotropic;
          f0 += k0 * sR * isotropic;
          f1 += k1 * sG * isotropic;
          f2 += k2 * sB * isotropic;
          T0 *= s0;
          T1 *= s1;
          T2 *= s2;
        }
        if (ground > 0) {
          // The sea under the point, lit by the sun through the air above it.
          const gx = dx * ground;
          const gy = r + dy * ground;
          const gz = dz * ground;
          const gr = Math.sqrt(gx * gx + gy * gy + gz * gz);
          const muG = (gx * L[0] + gy * L[1] + gz * L[2]) / gr;
          this.transmittanceAt(0, muG, ts);
          const lit = Math.max(0, muG) * SEA_ALBEDO / Math.PI;
          l0 += T0 * ts[0] * lit;
          l1 += T1 * ts[1] * lit;
          l2 += T2 * ts[2] * lit;
        }
      }
      // Averaging over the lattice is the integral over the sphere with the isotropic phase function.
      const o = j * 3;
      l0 /= MS_DIRECTIONS;
      l1 /= MS_DIRECTIONS;
      l2 /= MS_DIRECTIONS;
      f0 /= MS_DIRECTIONS;
      f1 /= MS_DIRECTIONS;
      f2 /= MS_DIRECTIONS;
      // Every further order is the previous one times f: a geometric series.
      this.multiple[o] = l0 / (1 - f0);
      this.multiple[o + 1] = l1 / (1 - f1);
      this.multiple[o + 2] = l2 / (1 - f2);
    }
  }

  private multipleAt(h: number, out: Rgb) {
    const v = Math.sqrt(Math.min(1, Math.max(0, h / 30000))) * (MS_N - 1);
    const j0 = Math.min(MS_N - 2, Math.floor(v));
    const f = v - j0;
    const M = this.multiple;
    for (let k = 0; k < 3; k += 1) out[k] = M[j0 * 3 + k]! + (M[(j0 + 1) * 3 + k]! - M[j0 * 3 + k]!) * f;
    return out;
  }

  /**
   * Radiance of the clear sky toward the unit direction (dx, dy, dz) seen from just above the sea, per unit of light at
   * the top of the air, written to `out`. Directions below the horizon see the far sea through the air: only the light
   * scattered on the way, which is what the horizon haze is made of.
   */
  radiance(dx: number, dy: number, dz: number, out: Rgb) {
    const L = this.light;
    const r = R_GROUND + EYE;
    const ground = toGround(r, dy);
    const len = ground > 0 ? ground : toTop(r, dy);
    // Rays that skim the horizon cross a thousand kilometres of air: they get more steps, packed near the eye.
    const steps = dy < 0.18 ? 32 : 16;
    const cosT = dx * L[0] + dy * L[1] + dz * L[2];
    const phaseR = (3 / (16 * Math.PI)) * (1 + cosT * cosT);
    const g2 = MIE_G * MIE_G;
    const phaseM = (3 / (8 * Math.PI)) * ((1 - g2) * (1 + cosT * cosT)) / ((2 + g2) * Math.pow(1 + g2 - 2 * MIE_G * cosT, 1.5));
    const ts = this.scratch;
    const ms = this.scratchMs;
    const mieS = this.haze * MIE_SCATTER;
    const mieE = this.haze * (MIE_SCATTER + MIE_ABSORB);
    const direct = this.direct;
    // Isotropic light from a sky-wide source above: half of it is scattered toward any one direction.
    const fill = this.diffuse * 0.5;
    const fillR = (fill * DECK_TINT[0]) / SOLAR[0];
    const fillG = fill * DECK_TINT[1];
    const fillB = (fill * DECK_TINT[2]) / SOLAR[2];
    let T0 = 1;
    let T1 = 1;
    let T2 = 1;
    let l0 = 0;
    let l1 = 0;
    let l2 = 0;
    let prev = 0;
    for (let s = 0; s < steps; s += 1) {
      const a = (s + 1) / steps;
      const next = len * a * a;
      const dt = next - prev;
      const t = prev + dt * 0.5;
      prev = next;
      const px = dx * t;
      const py = r + dy * t;
      const pz = dz * t;
      const pr = Math.sqrt(px * px + py * py + pz * pz);
      const h = pr - R_GROUND;
      const ray = Math.exp(-h / RAYLEIGH_H);
      const aer = Math.exp(-h / MIE_H);
      const oz = ozoneAt(h);
      const e0 = RAYLEIGH[0] * ray + mieE * aer + OZONE[0] * oz;
      const e1 = RAYLEIGH[1] * ray + mieE * aer + OZONE[1] * oz;
      const e2 = RAYLEIGH[2] * ray + mieE * aer + OZONE[2] * oz;
      const mie = mieS * aer;
      const muS = (px * L[0] + py * L[1] + pz * L[2]) / pr;
      this.transmittanceAt(h, muS, ts);
      this.multipleAt(h, ms);
      const s0 = Math.exp(-e0 * dt);
      const s1 = Math.exp(-e1 * dt);
      const s2 = Math.exp(-e2 * dt);
      const in0 = ((RAYLEIGH[0] * ray * phaseR + mie * phaseM) * ts[0] + (RAYLEIGH[0] * ray + mie) * ms[0]) * direct + (RAYLEIGH[0] * ray + mie) * fillR;
      const in1 = ((RAYLEIGH[1] * ray * phaseR + mie * phaseM) * ts[1] + (RAYLEIGH[1] * ray + mie) * ms[1]) * direct + (RAYLEIGH[1] * ray + mie) * fillG;
      const in2 = ((RAYLEIGH[2] * ray * phaseR + mie * phaseM) * ts[2] + (RAYLEIGH[2] * ray + mie) * ms[2]) * direct + (RAYLEIGH[2] * ray + mie) * fillB;
      l0 += (T0 * in0 * (1 - s0)) / e0;
      l1 += (T1 * in1 * (1 - s1)) / e1;
      l2 += (T2 * in2 * (1 - s2)) / e2;
      T0 *= s0;
      T1 *= s1;
      T2 *= s2;
    }
    out[0] = l0 * SOLAR[0];
    out[1] = l1 * SOLAR[1];
    out[2] = l2 * SOLAR[2];
    return out;
  }

  /** Light from the sun (or moon) reaching the sea, per unit at the top of the air, as an irradiance across its beam. */
  lightAtSea(out: Rgb) {
    return this.lightAt(EYE, out);
  }

  /** The same at `height` metres: above the sea haze the beam is whiter. */
  lightAt(height: number, out: Rgb) {
    this.transmittanceAt(height, this.light[1], out);
    out[0] *= SOLAR[0];
    out[1] *= SOLAR[1];
    out[2] *= SOLAR[2];
    return out;
  }
}

const BEARINGS = 40;
const BEARING_POWER = 1.6;
const bearingAt = (b: number) => Math.pow(b / (BEARINGS - 1), BEARING_POWER) * Math.PI;

/** Rows of a sky view: v runs 0 (straight down) to 1 (zenith) with sqrt spacing, so most rows sit near the horizon. */
export function skyViewElevation(v: number) {
  const s = v * 2 - 1;
  return Math.sign(s) * s * s * (Math.PI / 2);
}

export function skyViewV(elevation: number) {
  const s = Math.sqrt(Math.min(1, Math.abs(elevation) / (Math.PI / 2)));
  return 0.5 + 0.5 * Math.sign(elevation) * s;
}

/**
 * The sky's radiance over all directions as a width x height RGBA table (azimuth across, sqrt-spaced elevation down to
 * up). Only the upper half is integrated, mirrored about the light's vertical plane; rows below the horizon repeat the
 * horizon, which is what lies past the edge of the sea. Azimuth 0 is +x, increasing toward +z.
 */
export function buildSkyView(atmosphere: Atmosphere, width: number, height: number) {
  const out = new Float32Array(width * height * 4);
  const L = atmosphere.light;
  const lightAz = Math.atan2(L[2], L[0]);
  const c: Rgb = [0, 0, 0];
  const half = height / 2;
  // The sky is symmetric about the light's vertical plane: integrate bearings from the light (0) to opposite it (pi)
  // once, then read every column from them. Bearings crowd toward the light, where the haze's glow changes fastest.
  const bearings = BEARINGS;
  const table = new Float32Array(bearings * half * 3);
  for (let b = 0; b < bearings; b += 1) {
    const a = lightAz + bearingAt(b);
    for (let y = half; y < height; y += 1) {
      const el = skyViewElevation((y + 0.5) / height);
      const ca = Math.cos(el);
      atmosphere.radiance(ca * Math.cos(a), Math.sin(el), ca * Math.sin(a), c);
      const o = ((y - half) * bearings + b) * 3;
      table[o] = c[0];
      table[o + 1] = c[1];
      table[o + 2] = c[2];
    }
  }
  for (let x = 0; x < width; x += 1) {
    const az = ((x + 0.5) / width - 0.5) * Math.PI * 2;
    const rel = Math.abs(Math.atan2(Math.sin(az - lightAz), Math.cos(az - lightAz)));
    const f = Math.pow(rel / Math.PI, 1 / BEARING_POWER) * (bearings - 1);
    const b0 = Math.min(bearings - 2, Math.floor(f));
    const w = f - b0;
    for (let y = 0; y < height; y += 1) {
      const row = Math.max(y, half) - half;
      const i0 = (row * bearings + b0) * 3;
      const o = (y * width + x) * 4;
      out[o] = table[i0]! + (table[i0 + 3]! - table[i0]!) * w;
      out[o + 1] = table[i0 + 1]! + (table[i0 + 4]! - table[i0 + 1]!) * w;
      out[o + 2] = table[i0 + 2]! + (table[i0 + 5]! - table[i0 + 2]!) * w;
      out[o + 3] = 1;
    }
  }
  return out;
}

/** Bilinear lookup in a sky view built by buildSkyView, for the unit direction (dx, dy, dz). */
export function sampleSkyView(view: Float32Array, width: number, height: number, dx: number, dy: number, dz: number, out: Rgb) {
  const u = (Math.atan2(dz, dx) / (Math.PI * 2) + 0.5) * width - 0.5;
  const v = skyViewV(Math.asin(Math.max(-1, Math.min(1, dy)))) * height - 0.5;
  const x0 = Math.floor(u);
  const fx = u - x0;
  const y0 = Math.max(0, Math.min(height - 2, Math.floor(v)));
  const fy = Math.max(0, Math.min(1, v - y0));
  const xa = ((x0 % width) + width) % width;
  const xb = (xa + 1) % width;
  for (let k = 0; k < 3; k += 1) {
    const a = view[(y0 * width + xa) * 4 + k]!;
    const b = view[(y0 * width + xb) * 4 + k]!;
    const cc = view[((y0 + 1) * width + xa) * 4 + k]!;
    const d = view[((y0 + 1) * width + xb) * 4 + k]!;
    const top = a + (b - a) * fx;
    const bottom = cc + (d - cc) * fx;
    out[k] = top + (bottom - top) * fy;
  }
  return out;
}
