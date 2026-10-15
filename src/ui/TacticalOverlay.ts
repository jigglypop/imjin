import { Matrix4 } from 'three/webgpu';
import type { Engine } from '../game/Engine';
import { isTouchDevice } from '../game/device';
import { GUN_SHOTS } from '../sim/catalog';
import type { Ship } from '../sim/types';
import { shipObserved } from '../sim/observation';
import { iconPaths } from './battleIcons';

// The palette of the HUD (styles.css): the ring tones of the two fleets, and the muted status colours.
const OWN = '117, 151, 177';
const FOE = '176, 128, 108';
const WARN = '#c8b88a';
const BAD = '#cf9686';
const GOOD = '#8db59a';
const QUIET = '#9aa4ae';
const INK = '#14181d';
/** Selected ships whose gun arcs are drawn; a phone draws only the one whose details it shows. */
const MAX_ARCS = 12;
const MAX_TARGET_LINES = 40;
const MAX_MARKS = 160;
/** Marks farther than this from the camera are left out: a fleet on the horizon is read from its pill. */
const MARK_RANGE = 5200;
/** Broadside and bow arcs of fire, the cones the battle aims in (Battle.findBroadsideTarget, findBowTarget). */
const BROADSIDE_HALF = 0.75;
const BOW_HALF = 0.35;
const ARC_STEPS = 18;
/** The coloured band runs from this share of a battery's reach out to its edge; the cone's sides are drawn to ARC_CONE of it. */
const ARC_BAND = 0.9;
const ARC_CONE = 0.3;
const RING_STEPS = 64;

/** `solid` marks a crew's state, filled in its colour; the player's own troubles are outlined, a quieter second rank. */
type Mark = { x: number; y: number; scale: number; icons: { name: string; color: string; solid: boolean }[] };
type Point = { x: number; y: number };

/**
 * The battle's tactical reading, drawn on a transparent canvas between the sea and the labels: the gun arcs and reach
 * of the selected ships (brighter where the guns are loaded), the lines to what they are shooting at, and small marks
 * over ships whose crews waver, run or regroup, and over the player's ships that burn or run short of shot. Everything
 * is in screen pixels, so it reads the same at any camera distance and on a phone.
 */
export class TacticalOverlay {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly viewProj = new Matrix4();
  private readonly glyphs = new Map<string, { stroke: Path2D; fill: Path2D }>();
  private readonly marks: Mark[] = [];
  private readonly a: Point = { x: 0, y: 0 };
  private readonly b: Point = { x: 0, y: 0 };
  private width = 0;
  private height = 0;
  private ratio = 1;
  private dirty = false;

  constructor(private readonly engine: Engine, parent: HTMLElement) {
    this.canvas.className = 'tactics';
    this.canvas.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** `arcs` covers the selection's arcs and target lines, `marks` the status marks over the ships. */
  update(arcs: boolean, marks: boolean) {
    const el = this.engine.renderer.domElement;
    const width = el.clientWidth;
    const height = el.clientHeight;
    // Two device pixels per CSS pixel are crisp enough for hairlines and keep a phone's canvas small.
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (width !== this.width || height !== this.height || ratio !== this.ratio) {
      this.width = width;
      this.height = height;
      this.ratio = ratio;
      this.canvas.width = Math.round(width * ratio);
      this.canvas.height = Math.round(height * ratio);
      this.dirty = true;
    }
    const ctx = this.ctx;
    if (this.dirty) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.dirty = false;
    }
    if (!arcs && !marks) return;
    const camera = this.engine.camera;
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let drew = false;
    if (arcs) drew = this.drawSelection() || drew;
    if (marks) drew = this.drawMarks() || drew;
    this.dirty = drew;
  }

  dispose() {
    this.canvas.remove();
  }

  /** World to canvas pixels; false when the point lies behind the camera. */
  private project(x: number, y: number, z: number, out: Point) {
    const e = this.viewProj.elements;
    const w = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
    if (w <= 1e-3) return false;
    out.x = (((e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) / w) * 0.5 + 0.5) * this.width;
    out.y = (-((e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) / w) * 0.5 + 0.5) * this.height;
    return true;
  }

  private drawSelection() {
    const engine = this.engine;
    const b = engine.battle;
    const team = engine.team;
    const own: Ship[] = [];
    let foe: Ship | undefined;
    for (const id of engine.views.selected) {
      const s = b.get(id);
      if (!b.isActive(s) || !shipObserved(b, team, s)) continue;
      if (s.team === team) own.push(s);
      else foe ??= s;
    }
    let drew = false;
    // The first selected ship shows its arcs in full; the rest of the selection only the edge of their reach, which
    // together trace the front a squadron covers. A phone shows the first ship alone.
    if (own[0]) drew = this.drawArcs(own[0], OWN) || drew;
    if (!isTouchDevice) for (const s of own.slice(1, MAX_ARCS)) drew = this.drawReach(s, OWN) || drew;
    if (foe) drew = this.drawArcs(foe, FOE) || drew;
    const lines = own.slice(0, isTouchDevice ? 1 : MAX_TARGET_LINES);
    for (const s of lines) {
      const target = b.get(s.targetId);
      if (!b.isActive(target) || !shipObserved(b, team, target)) continue;
      drew = this.drawTargetLine(s, target, OWN, 0.78, 1.5) || drew;
    }
    const hovered = b.get(engine.views.hovered);
    if (hovered && hovered.team !== team && b.isActive(hovered) && shipObserved(b, team, hovered)) {
      let n = 0;
      for (const s of b.ships) {
        if (s.team !== team || s.targetId !== hovered.id || !b.isActive(s) || n >= MAX_TARGET_LINES) continue;
        n += 1;
        if (!lines.includes(s)) this.drawTargetLine(s, hovered, OWN, 0.34, 1);
      }
      if (n > 0) drew = this.drawFocus(hovered, n) || drew;
    }
    return drew;
  }

  /** Where each of a ship's batteries bears and how far it reaches with the rounds it is loading, and how many guns are loaded. */
  private batteries(s: Ship) {
    const b = this.engine.battle;
    const reach = b.rangeFactor(s);
    const out: { axis: number; half: number; range: number; loaded: number }[] = [];
    for (const side of [0, 1, 2] as const) {
      let range = 0;
      let guns = 0;
      let loaded = 0;
      for (const g of s.guns) {
        if (g.side !== side || g.ammo < 1 - 1e-9) continue;
        guns += 1;
        if (g.stage >= 4) loaded += 1;
        range = Math.max(range, b.gunSpec(s.spec.kind, s.spec.batteries[g.battery]!.gun).range * reach);
      }
      if (!guns) continue;
      const axis = side === 2 ? s.heading : side === 0 ? s.heading - Math.PI / 2 : s.heading + Math.PI / 2;
      out.push({ axis, half: side === 2 ? BOW_HALF : BROADSIDE_HALF, range, loaded: loaded / guns });
    }
    return out;
  }

  /**
   * Traces an arc at `range` into the current path, from one end of the cone to the other or back; false when part of
   * it lies behind the camera.
   */
  private edge(s: Ship, axis: number, half: number, range: number, first: boolean, back = false) {
    const ctx = this.ctx;
    for (let i = 0; i <= ARC_STEPS; i += 1) {
      const k = back ? ARC_STEPS - i : i;
      const ang = axis - half + (2 * half * k) / ARC_STEPS;
      if (!this.project(s.x + Math.cos(ang) * range, 0.4, s.z + Math.sin(ang) * range, this.b)) return false;
      if (i === 0 && first) ctx.moveTo(this.b.x, this.b.y);
      else ctx.lineTo(this.b.x, this.b.y);
    }
    return true;
  }

  /**
   * A ship's broadside and bow arcs: a band of colour along the edge of each battery's reach, brighter the more of its
   * guns are loaded, the cone's two sides drawn a short way out from the hull, and a dashed ring at the farthest reach.
   * The water in between stays clear, so a squadron's arcs do not wash over the battle.
   */
  private drawArcs(s: Ship, tone: string) {
    const ctx = this.ctx;
    let max = 0;
    let drew = false;
    for (const arc of this.batteries(s)) {
      max = Math.max(max, arc.range);
      ctx.beginPath();
      if (!this.edge(s, arc.axis, arc.half, arc.range, true) || !this.edge(s, arc.axis, arc.half, arc.range * ARC_BAND, false, true)) continue;
      ctx.closePath();
      ctx.fillStyle = `rgba(${tone}, ${(0.16 + 0.12 * arc.loaded).toFixed(3)})`;
      ctx.fill();
      ctx.beginPath();
      this.edge(s, arc.axis, arc.half, arc.range, true);
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(${tone}, ${(0.55 + 0.4 * arc.loaded).toFixed(3)})`;
      ctx.stroke();
      ctx.beginPath();
      for (const side of [-1, 1]) {
        const ang = arc.axis + side * arc.half;
        if (!this.project(s.x + Math.cos(ang) * s.spec.length * 0.6, 0.4, s.z + Math.sin(ang) * s.spec.length * 0.6, this.a)) continue;
        if (!this.project(s.x + Math.cos(ang) * arc.range * ARC_CONE, 0.4, s.z + Math.sin(ang) * arc.range * ARC_CONE, this.b)) continue;
        ctx.moveTo(this.a.x, this.a.y);
        ctx.lineTo(this.b.x, this.b.y);
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${tone}, 0.4)`;
      ctx.stroke();
      drew = true;
    }
    if (max > 0) {
      ctx.beginPath();
      let ok = true;
      for (let i = 0; i <= RING_STEPS && ok; i += 1) {
        const ang = (i / RING_STEPS) * Math.PI * 2;
        ok = this.project(s.x + Math.cos(ang) * max, 0.4, s.z + Math.sin(ang) * max, this.b);
        if (i === 0) ctx.moveTo(this.b.x, this.b.y);
        else ctx.lineTo(this.b.x, this.b.y);
      }
      if (ok) {
        ctx.setLineDash([3, 6]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(${tone}, 0.34)`;
        ctx.stroke();
        ctx.setLineDash([]);
        drew = true;
      }
    }
    return drew;
  }

  /** Only the outer edges of a ship's arcs: the rest of a selection, whose edges together draw its front. */
  private drawReach(s: Ship, tone: string) {
    const ctx = this.ctx;
    let drew = false;
    for (const arc of this.batteries(s)) {
      ctx.beginPath();
      if (!this.edge(s, arc.axis, arc.half, arc.range, true)) continue;
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = `rgba(${tone}, ${(0.32 + 0.3 * arc.loaded).toFixed(3)})`;
      ctx.stroke();
      drew = true;
    }
    return drew;
  }

  /** A dashed line from a ship to its target, ending in a small chevron short of the target. */
  private drawTargetLine(s: Ship, target: Ship, tone: string, alpha: number, width: number) {
    if (!this.project(s.x, 2, s.z, this.a) || !this.project(target.x, 2, target.z, this.b)) return false;
    const ctx = this.ctx;
    const dx = this.b.x - this.a.x;
    const dy = this.b.y - this.a.y;
    const len = Math.hypot(dx, dy);
    if (len < 18) return false;
    const ux = dx / len;
    const uy = dy / len;
    const end = Math.max(0, len - 12);
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = width;
    ctx.strokeStyle = `rgba(${tone}, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(this.a.x + ux * 8, this.a.y + uy * 8);
    ctx.lineTo(this.a.x + ux * end, this.a.y + uy * end);
    ctx.stroke();
    ctx.setLineDash([]);
    const tipX = this.a.x + ux * end;
    const tipY = this.a.y + uy * end;
    ctx.beginPath();
    ctx.moveTo(tipX - ux * 6 - uy * 4, tipY - uy * 6 + ux * 4);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(tipX - ux * 6 + uy * 4, tipY - uy * 6 - ux * 4);
    ctx.stroke();
    return true;
  }

  /** How many of the player's ships are shooting at the enemy under the pointer. */
  private drawFocus(target: Ship, n: number) {
    if (!this.project(target.x, target.spec.height + 6, target.z, this.a)) return false;
    const ctx = this.ctx;
    const text = `×${n}`;
    ctx.font = '600 12px Pretendard, system-ui, sans-serif';
    const w = ctx.measureText(text).width + 12;
    const x = this.a.x + 14;
    const y = this.a.y - 10;
    ctx.fillStyle = 'rgba(14, 16, 20, 0.82)';
    ctx.beginPath();
    ctx.roundRect(x, y - 9, w, 18, 9);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${OWN}, 0.7)`;
    ctx.stroke();
    ctx.fillStyle = '#f1f3f5';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 6, y + 0.5);
    return true;
  }

  /** Marks over ships in trouble: every observed crew that wavers, runs or regroups, and the player's ships afire or short of shot. */
  private drawMarks() {
    const engine = this.engine;
    const b = engine.battle;
    const team = engine.team;
    const cam = engine.camera.position;
    const depth = !!b.morale;
    this.marks.length = 0;
    for (const s of b.ships) {
      if (!b.isActive(s) || !shipObserved(b, team, s)) continue;
      const icons: Mark['icons'] = [];
      if (depth) {
        if (s.moraleState === 'routing') icons.push({ name: 'rout', color: BAD, solid: true });
        else if (s.moraleState === 'wavering') icons.push({ name: 'waver', color: WARN, solid: true });
        else if (s.moraleState === 'rallying') icons.push({ name: 'drum', color: GOOD, solid: true });
      }
      if (s.team === team) {
        if (s.fire > 0.25) icons.push({ name: 'flame', color: BAD, solid: false });
        if (s.guns.length && lowOnShot(s)) icons.push({ name: 'shot', color: QUIET, solid: false });
      }
      if (!icons.length) continue;
      const dist = Math.hypot(s.x - cam.x, s.spec.height - cam.y, s.z - cam.z);
      if (dist > MARK_RANGE) continue;
      const top = engine.views.heaveOf(s.id) + s.spec.height * 0.9 + 3;
      if (!this.project(s.x, top, s.z, this.a)) continue;
      if (this.a.x < -20 || this.a.x > this.width + 20 || this.a.y < -20 || this.a.y > this.height + 20) continue;
      // Marks shrink only a little with distance: they are what the battle is read by from far away.
      this.marks.push({ x: this.a.x, y: this.a.y, scale: Math.max(0.9, Math.min(1.1, 1100 / Math.max(1, dist))), icons });
    }
    if (!this.marks.length) return false;
    // The closest first, when there are too many to draw: they are the ones the player is looking at.
    if (this.marks.length > MAX_MARKS) this.marks.sort((p, q) => q.scale - p.scale).length = MAX_MARKS;
    const size = isTouchDevice ? 26 : 22;
    const ctx = this.ctx;
    for (const m of this.marks) {
      const d = size * m.scale;
      const step = d + 3;
      const lift = 7 * m.scale;
      // A short staff from the mast top to the mark ties it to its ship in a crowd.
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x, m.y - lift);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(241, 243, 245, 0.45)';
      ctx.stroke();
      let x = m.x - ((m.icons.length - 1) * step) / 2;
      for (const icon of m.icons) {
        this.badge(x, m.y - lift - d / 2, icon.solid ? d : d * 0.86, icon.name, icon.color, icon.solid);
        x += step;
      }
    }
    return true;
  }

  /**
   * A round badge. Solid: a disc in the status colour with a dark rim and a dark icon, which holds up against foam and
   * smoke. Otherwise dark glass with a hairline and the icon in the status colour.
   */
  private badge(x: number, y: number, d: number, name: string, color: string, solid: boolean) {
    const ctx = this.ctx;
    let glyph = this.glyphs.get(name);
    if (!glyph) {
      glyph = iconPaths(name);
      this.glyphs.set(name, glyph);
    }
    ctx.beginPath();
    ctx.arc(x, y, d / 2, 0, Math.PI * 2);
    ctx.fillStyle = solid ? color : 'rgba(14, 16, 20, 0.82)';
    ctx.fill();
    ctx.lineWidth = solid ? 1.5 : 1.2;
    ctx.strokeStyle = solid ? 'rgba(10, 12, 16, 0.85)' : color;
    ctx.stroke();
    const k = (d * 0.62) / 24;
    const ink = solid ? INK : color;
    ctx.save();
    ctx.translate(x - 12 * k, y - 12 * k);
    ctx.scale(k, k);
    ctx.lineWidth = solid ? 2.6 : 2.2;
    ctx.strokeStyle = ink;
    ctx.stroke(glyph.stroke);
    ctx.fillStyle = ink;
    ctx.fill(glyph.fill);
    ctx.restore();
  }
}

/** A ship whose guns hold under a fifth of a full load of rounds between them. */
function lowOnShot(s: Ship) {
  let have = 0;
  let full = 0;
  for (const g of s.guns) {
    have += g.ammo;
    full += GUN_SHOTS[s.spec.batteries[g.battery]!.gun];
  }
  return full > 0 && have / full < 0.2;
}
