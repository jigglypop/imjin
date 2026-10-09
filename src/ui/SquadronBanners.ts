import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { Battle } from '../sim/battle';
import type { Squadron, Team } from '../sim/types';
import type { ShipViews } from '../ships/ShipViews';

type Banner = {
  root: HTMLDivElement;
  bar: HTMLElement;
  count: HTMLElement;
  lastHull: number;
  lastCount: number;
  lastState: string;
  far: boolean;
};

/** Commanders that are a role or a seat, not a person: the squadron's own name says more. */
const ROLE = /(협선장|척후장|돌격장|유격장|왜장|중군|장수|휘하|수군)$|^이름 없는/;

/** What a squadron is called on the water: its commander's name when it is a person's, else the squadron's name. */
export function squadronLabel(sq: Squadron) {
  const first = sq.commander.split(' · ')[0]!;
  if (ROLE.test(first)) return sq.name;
  const words = first.split(' ');
  // Japanese names come surname first; Joseon and Ming titles come before the name.
  return sq.faction === 'japan' ? words[0]! : words[words.length - 1]!;
}

const tmp = new Vector3();

export class SquadronBanners {
  private readonly layer: HTMLDivElement;
  private readonly banners = new Map<number, Banner>();
  onSelect: ((id: number, additive: boolean) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'banners';
    parent.appendChild(this.layer);
  }

  private create(sq: Squadron, own: boolean) {
    const root = document.createElement('div');
    root.className = `sqb sqb--${sq.faction}`;
    const pill = document.createElement('div');
    pill.className = 'sqb-pill';
    const name = document.createElement('span');
    name.className = 'sqb-name';
    name.textContent = squadronLabel(sq);
    const count = document.createElement('b');
    count.className = 'sqb-count';
    const bar = document.createElement('i');
    const barWrap = document.createElement('div');
    barWrap.className = 'sqb-bar';
    barWrap.appendChild(bar);
    pill.append(name, count, barWrap);
    const pole = document.createElement('div');
    pole.className = 'sqb-pole';
    root.append(pill, pole);
    root.title = `${sq.name} · ${sq.commander}`;
    // In a battle between two fleets of the same navy, the rim tells friend from foe.
    root.classList.add(own ? 'sqb--own' : 'sqb--foe');
    root.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.button === 0) this.onSelect?.(sq.id, e.shiftKey);
    });
    this.layer.appendChild(root);
    const banner: Banner = { root, bar, count, lastHull: -1, lastCount: -1, lastState: '', far: false };
    this.banners.set(sq.id, banner);
    return banner;
  }

  update(battle: Battle, views: ShipViews, camera: PerspectiveCamera, width: number, height: number, visible: boolean, team: Team) {
    this.layer.style.display = visible ? '' : 'none';
    if (!visible) return;
    for (const sq of battle.squadrons) {
      let x = 0;
      let z = 0;
      let top = 0;
      let alive = 0;
      let hull = 0;
      let selected = 0;
      let leader = battle.get(sq.leaderId);
      for (const id of sq.shipIds) {
        const s = battle.get(id);
        if (!s || !battle.isActive(s)) continue;
        x += s.x;
        z += s.z;
        top = Math.max(top, s.spec.height);
        hull += s.hull / s.spec.hull;
        alive += 1;
        if (views.selected.has(id)) selected += 1;
      }
      const banner = this.banners.get(sq.id) ?? this.create(sq, sq.team === team);
      if (!alive) {
        if (banner.lastState !== 'dead') {
          banner.root.style.display = 'none';
          banner.lastState = 'dead';
        }
        continue;
      }
      if (!leader || !battle.isActive(leader)) leader = undefined;
      const px = leader ? leader.x : x / alive;
      const pz = leader ? leader.z : z / alive;
      tmp.set(px, (leader ? views.heaveOf(leader.id) : 0) + top + 10, pz);
      const dist = tmp.distanceTo(camera.position);
      tmp.project(camera);
      const onScreen = tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05;
      const state = onScreen ? (selected ? 'sel' : 'on') : 'off';
      if (state !== banner.lastState) {
        banner.root.style.display = onScreen ? '' : 'none';
        banner.root.classList.toggle('sqb--selected', selected > 0);
        banner.lastState = state;
      }
      if (!onScreen) continue;
      const sx = (tmp.x * 0.5 + 0.5) * width;
      const sy = (-tmp.y * 0.5 + 0.5) * height;
      const scale = Math.max(0.7, Math.min(1.08, 900 / Math.max(dist, 1)));
      // A distant fleet shows only its ship count: a name at this size cannot be read and only crowds the others.
      const far = dist > 1500;
      if (far !== banner.far) {
        banner.root.classList.toggle('sqb--far', far);
        banner.far = far;
      }
      banner.root.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
      const h = Math.round((hull / alive) * 100);
      if (h !== banner.lastHull) {
        banner.bar.style.width = `${h}%`;
        banner.lastHull = h;
      }
      if (alive !== banner.lastCount) {
        banner.count.textContent = String(alive);
        banner.lastCount = alive;
      }
    }
  }

  clear() {
    for (const b of this.banners.values()) b.root.remove();
    this.banners.clear();
  }
}
