import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { Battle } from '../sim/battle';
import type { Ship, Team } from '../sim/types';
import type { ShipViews } from '../ships/ShipViews';
import { getLang, t } from '../i18n';
import { tName } from './battleNames';
import { shipObserved } from '../sim/observation';

/**
 * The name over each ship in battle (.claude/skills/ui-design): a small glass pill with the navy's colour dot, the
 * ship's name and a hairline hull bar. Labels fade with distance; when they crowd, the selected ships, the flagships,
 * the squadron leaders and the damaged keep theirs and the rest are hidden.
 */
type Label = { root: HTMLDivElement; name: HTMLElement; bar: HTMLElement; text: string; hull: number; cls: string; shown: boolean; lang: string };
type Spot = { ship: Ship; label: Label; sx: number; sy: number; w: number; prio: number; alpha: number; selected: boolean };

const tmp = new Vector3();
const H = 22;
/** Beyond this a label is drawn only for a selected ship or a flagship. */
const FAR = 2200;

export class ShipLabels {
  private readonly layer: HTMLDivElement;
  private readonly labels = new Map<number, Label>();
  private tools = { top: 0, at: 0, rects: [] as { x0: number; x1: number; y0: number; y1: number }[] };
  onSelect: ((shipId: number, additive: boolean) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'ship-labels';
    parent.appendChild(this.layer);
  }

  private create(ship: Ship) {
    const root = document.createElement('div');
    root.className = `shl f-${ship.spec.faction}`;
    const pill = document.createElement('div');
    pill.className = 'shl-pill';
    const dot = document.createElement('i');
    dot.className = 'shl-dot';
    const name = document.createElement('span');
    name.className = 'shl-name';
    const barWrap = document.createElement('span');
    barWrap.className = 'shl-bar';
    const bar = document.createElement('i');
    barWrap.appendChild(bar);
    pill.append(dot, name, barWrap);
    root.appendChild(pill);
    root.style.display = 'none';
    root.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.button === 0) this.onSelect?.(ship.id, e.shiftKey);
    });
    this.layer.appendChild(root);
    const label: Label = { root, name, bar, text: '', hull: -1, cls: '', shown: false, lang: '' };
    this.labels.set(ship.id, label);
    return label;
  }

  private hide(label: Label) {
    if (!label.shown) return;
    label.root.style.display = 'none';
    label.shown = false;
  }

  update(battle: Battle, views: ShipViews, camera: PerspectiveCamera, width: number, height: number, visible: boolean, team: Team) {
    this.layer.style.display = visible ? '' : 'none';
    if (!visible) return;
    const lang = getLang();
    const now = performance.now();
    if (now - this.tools.at > 500) {
      const r = document.querySelector('.hud .balance')?.getBoundingClientRect();
      // Labels never sit under the HUD's panels: they are placed as if those were labels already.
      const rects = [...document.querySelectorAll('.hud .glass, .touch-bar > *, .hud .cards, .minimap, .dock')]
        .map((el) => el.getBoundingClientRect())
        .filter((b) => b.width > 0 && b.height > 0)
        .map((b) => ({ x0: b.left, x1: b.right, y0: b.top, y1: b.bottom }));
      this.tools = { top: r && r.height > 0 ? r.bottom + 4 : 0, at: now, rects };
    }
    const leaders = new Set(battle.squadrons.map((sq) => sq.leaderId));
    const phone = width < 700;
    const max = phone ? 6 : width < 1500 ? 10 : 14;
    const spots: Spot[] = [];
    const present = new Set<number>();
    for (const ship of battle.ships) {
      present.add(ship.id);
      const label = this.labels.get(ship.id);
      if (!battle.isActive(ship) || !shipObserved(battle, team, ship)) {
        if (label) this.hide(label);
        continue;
      }
      tmp.set(ship.x, views.heaveOf(ship.id) + ship.spec.height + 6, ship.z);
      const dist = tmp.distanceTo(camera.position);
      tmp.project(camera);
      const selected = views.selected.has(ship.id);
      const hull = ship.hull / ship.spec.hull;
      const key = selected || ship.flagship;
      // Only ships worth naming get a label: the selected, the flagships, the squadron leaders, the badly hurt, and
      // any ship the camera is right over. A line of numbered hulls stays unlabelled.
      const worth = key || leaders.has(ship.id) || hull < 0.5 || dist < 420;
      if (!worth || tmp.z >= 1 || Math.abs(tmp.x) > 1 || Math.abs(tmp.y) > 1 || (dist > FAR && !key)) {
        if (label) this.hide(label);
        continue;
      }
      const l = label ?? this.create(ship);
      if (l.lang !== lang || !l.text) {
        l.lang = lang;
        l.text = tName(ship.name) || t(ship.spec.label);
        l.name.textContent = l.text;
      }
      const prio = (selected ? 4000 : 0) + (ship.flagship ? 2000 : 0) + (leaders.has(ship.id) ? 800 : 0) + (hull < 0.5 ? 300 : 0) - dist / 10;
      const alpha = key ? 1 : Math.max(0.35, Math.min(1, 1 - (dist - 700) / (FAR - 700)));
      spots.push({ ship, label: l, sx: (tmp.x * 0.5 + 0.5) * width, sy: (-tmp.y * 0.5 + 0.5) * height, w: l.text.length * (lang === 'ko' ? 11.5 : 6.6) + 30, prio, alpha, selected });
    }
    // A sunk ship leaves the battle's list: its label goes with it.
    for (const [id, l] of this.labels) if (!present.has(id)) this.hide(l);
    spots.sort((a, b) => b.prio - a.prio);
    const placed = [...this.tools.rects];
    let count = 0;
    for (const s of spots) {
      const sx = Math.max(s.w / 2 + 4, Math.min(width - s.w / 2 - 4, s.sx));
      const sy = Math.max(this.tools.top + H, s.sy);
      const box = { x0: sx - s.w / 2 - 3, x1: sx + s.w / 2 + 3, y0: sy - H - 2, y1: sy + 2 };
      const crowded = count >= max || placed.some((p) => p.x0 < box.x1 && box.x0 < p.x1 && p.y0 < box.y1 && box.y0 < p.y1);
      if (crowded && !s.selected) {
        this.hide(s.label);
        continue;
      }
      placed.push(box);
      count += 1;
      const l = s.label;
      const own = s.ship.team === team;
      const hull = Math.round((s.ship.hull / s.ship.spec.hull) * 100);
      const cls = `shl f-${s.ship.spec.faction}${own ? '' : ' shl--foe'}${s.selected ? ' shl--selected' : ''}${s.ship.flagship ? ' shl--flag' : ''}${hull < 35 ? ' shl--low' : ''}`;
      if (cls !== l.cls) {
        l.root.className = cls;
        l.cls = cls;
      }
      if (hull !== l.hull) {
        l.bar.style.width = `${hull}%`;
        l.hull = hull;
      }
      if (!l.shown) {
        l.root.style.display = '';
        l.shown = true;
      }
      l.root.style.opacity = s.alpha.toFixed(2);
      l.root.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  clear() {
    for (const l of this.labels.values()) l.root.remove();
    this.labels.clear();
  }
}
