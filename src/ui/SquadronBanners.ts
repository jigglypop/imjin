import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { Battle } from '../sim/battle';
import type { Squadron } from '../sim/types';
import type { ShipViews } from '../ships/ShipViews';

type Banner = {
  root: HTMLDivElement;
  bar: HTMLElement;
  count: HTMLElement;
  lastHull: number;
  lastCount: number;
  lastState: string;
};

const MARKS: [string, string][] = [
  ['이순신', '李'],
  ['이억기', '李'],
  ['이기남', '龜'],
  ['원균', '元'],
  ['정운', '鄭'],
  ['안위', '安'],
  ['협선', '挾'],
  ['와키자카', '脇'],
  ['와타나베', '渡'],
  ['마나베', '眞'],
  ['도도', '藤'],
  ['구루시마', '來'],
  ['가토', '加'],
  ['간 ', '菅'],
  ['모리', '毛'],
];

export function squadronMark(sq: Squadron) {
  for (const [key, mark] of MARKS) if (sq.commander.includes(key) || sq.name.includes(key)) return mark;
  return sq.team === 'joseon' ? '朝' : '倭';
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

  private create(sq: Squadron) {
    const root = document.createElement('div');
    root.className = `sqb sqb--${sq.team}`;
    const flag = document.createElement('div');
    flag.className = 'sqb-flag';
    const mark = document.createElement('span');
    mark.className = 'sqb-mark';
    mark.textContent = squadronMark(sq);
    flag.appendChild(mark);
    const bar = document.createElement('i');
    const barWrap = document.createElement('div');
    barWrap.className = 'sqb-bar';
    barWrap.appendChild(bar);
    const count = document.createElement('div');
    count.className = 'sqb-count';
    const pole = document.createElement('div');
    pole.className = 'sqb-pole';
    root.append(flag, barWrap, count, pole);
    root.title = `${sq.name} · ${sq.commander}`;
    root.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.button === 0) this.onSelect?.(sq.id, e.shiftKey);
    });
    this.layer.appendChild(root);
    const banner: Banner = { root, bar, count, lastHull: -1, lastCount: -1, lastState: '' };
    this.banners.set(sq.id, banner);
    return banner;
  }

  update(battle: Battle, views: ShipViews, camera: PerspectiveCamera, width: number, height: number, visible: boolean) {
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
      const banner = this.banners.get(sq.id) ?? this.create(sq);
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
      const scale = Math.max(0.62, Math.min(1.08, 900 / Math.max(dist, 1)));
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
