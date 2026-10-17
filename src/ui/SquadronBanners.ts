import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { Battle } from '../sim/battle';
import type { Squadron, Team } from '../sim/types';
import type { ShipViews } from '../ships/ShipViews';
import { getLang, t } from '../i18n';
import { tCommander, tName, tShips } from './battleNames';
import { shipObserved } from '../sim/observation';
import { iconSvg } from './battleIcons';

type Banner = {
  root: HTMLDivElement;
  name: HTMLElement;
  bar: HTMLElement;
  count: HTMLElement;
  nerve: HTMLElement;
  lastHull: number;
  /** The nerve mark now shown: running, wavering or none (the battle depth rules). */
  lastNerve: string;
  lastCount: number;
  lastState: string;
  /** Text now shown in the name and count, so the DOM is touched only when it changes. */
  lastName: string;
  lastCountText: string;
  lastSelected: boolean;
  far: boolean;
  lang: string;
  /** Width of the pill with only its own squadron in it, remembered while it is hidden inside a merged one. */
  ownWidth: number;
  /** Squadrons this pill stands for when it has absorbed its neighbours; just its own otherwise. */
  group: number[];
};

/** Where a squadron's pill would sit this frame, before overlapping ones are merged. */
type Spot = { sq: Squadron; banner: Banner; sx: number; sy: number; scale: number; alive: number; hull: number; selected: number; far: boolean; wavering: number; routing: number };

/** Commanders that are a role or a seat, not a person: the squadron's own name says more. */
const ROLE = /(협선장|척후장|돌격장|유격장|왜장|중군|장수|휘하|수군|본대|별동대|동맹군)$|^이름 없는/;

/** What a squadron is called on the water: its commander's name when it is a person's, else the squadron's name. */
export function squadronLabel(sq: Squadron) {
  if (getLang() === 'en') return tName(sq.name);
  const first = sq.commander.split(' · ')[0]!;
  if (ROLE.test(first)) return sq.name;
  const words = first.split(' ');
  // Japanese names come surname first; Joseon and Ming titles come before the name; English and Spanish names end in
  // the surname, but a Spanish noble is known by his title's place (메디나 시도니아 공작 -> 메디나 시도니아).
  if (sq.faction === 'japan') return words[0]!;
  if (sq.faction === 'spain' && words.length > 1 && /^(공작|후작|백작)$/.test(words[words.length - 1]!)) return words.slice(0, -1).join(' ');
  return words[words.length - 1]!;
}

const tmp = new Vector3();
/** Pills whose boxes touch on screen read as one stack, so they are drawn as a single pill for the group. */
const MERGE_GAP = 4;
/** Height of a pill at scale 1, used before one has been measured. */
const PILL_H = 24;

export class SquadronBanners {
  private readonly layer: HTMLDivElement;
  private readonly banners = new Map<number, Banner>();
  private tools = { left: 0, right: Infinity, top: 0, dockTop: 0, dockBottom: 0, at: 0 };
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
    const count = document.createElement('b');
    count.className = 'sqb-count';
    const nerve = document.createElement('span');
    nerve.className = 'sqb-nerve';
    nerve.hidden = true;
    const bar = document.createElement('i');
    const barWrap = document.createElement('div');
    barWrap.className = 'sqb-bar';
    barWrap.appendChild(bar);
    pill.append(name, nerve, count, barWrap);
    const pole = document.createElement('div');
    pole.className = 'sqb-pole';
    root.append(pill, pole);
    // In a battle between two fleets of the same navy, the rim tells friend from foe.
    root.classList.add(own ? 'sqb--own' : 'sqb--foe');
    const banner: Banner = { root, name, bar, count, nerve, lastNerve: '', lastHull: -1, lastCount: -1, lastState: '', lastName: '', lastCountText: '', lastSelected: false, far: false, lang: '', ownWidth: 90, group: [sq.id] };
    root.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      // A merged pill selects everything it stands for.
      banner.group.forEach((id, i) => this.onSelect?.(id, e.shiftKey || i > 0));
    });
    this.layer.appendChild(root);
    this.banners.set(sq.id, banner);
    return banner;
  }

  /** The side dock and score panel, which pills stay clear of. Re-measured twice a second. */
  private safeArea(width: number) {
    const now = performance.now();
    if (now - this.tools.at > 500) {
      const rect = (sel: string) => {
        const r = document.querySelector(sel)?.getBoundingClientRect();
        return r && r.width > 0 && r.height > 0 ? r : null;
      };
      const touch = rect('.touch-bar');
      const balance = rect('.hud .balance');
      const onLeft = touch && touch.left < width / 2;
      this.tools = { left: onLeft ? touch.right + 6 : 0, right: touch && !onLeft ? touch.left - 6 : width, top: balance ? balance.bottom + 4 : 0, dockTop: touch?.top ?? 0, dockBottom: touch?.bottom ?? 0, at: now };
    }
    return this.tools;
  }

  update(battle: Battle, views: ShipViews, camera: PerspectiveCamera, width: number, height: number, visible: boolean, team: Team) {
    this.layer.style.display = visible ? '' : 'none';
    if (!visible) return;
    const lang = getLang();
    const safe = this.safeArea(width);
    const spots: Spot[] = [];
    for (const sq of battle.squadrons) {
      let x = 0;
      let z = 0;
      let top = 0;
      let alive = 0;
      let hull = 0;
      let selected = 0;
      let wavering = 0;
      let routing = 0;
      let leader = battle.get(sq.leaderId);
      for (const id of sq.shipIds) {
        const s = battle.get(id);
        if (!s || !battle.isActive(s) || !shipObserved(battle, team, s)) continue;
        x += s.x;
        z += s.z;
        top = Math.max(top, s.spec.height);
        hull += s.hull / s.spec.hull;
        alive += 1;
        if (s.moraleState === 'wavering') wavering += 1;
        else if (s.moraleState === 'routing') routing += 1;
        if (views.selected.has(id)) selected += 1;
      }
      const banner = this.banners.get(sq.id) ?? this.create(sq, sq.team === team);
      banner.group = [sq.id];
      if (!alive) {
        if (banner.lastState !== 'dead') {
          banner.root.style.display = 'none';
          banner.lastState = 'dead';
        }
        continue;
      }
      if (!leader || !battle.isActive(leader) || !shipObserved(battle, team, leader)) leader = undefined;
      const px = leader ? leader.x : x / alive;
      const pz = leader ? leader.z : z / alive;
      tmp.set(px, (leader ? views.heaveOf(leader.id) : 0) + top + 10, pz);
      const dist = tmp.distanceTo(camera.position);
      tmp.project(camera);
      const onScreen = tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05;
      if (!onScreen) {
        if (banner.lastState !== 'off') {
          banner.root.style.display = 'none';
          banner.lastState = 'off';
        }
        continue;
      }
      banner.lastState = 'on';
      if (banner.lang !== lang) {
        banner.lang = lang;
        banner.lastName = '';
        banner.root.title = `${tName(sq.name)} · ${tCommander(sq.commander)}`;
      }
      const scale = Math.max(0.7, Math.min(1.08, 900 / Math.max(dist, 1)));
      // A distant fleet shows only its ship count: a name at this size cannot be read and only crowds the others.
      const far = dist > 1500;
      spots.push({ sq, banner, sx: (tmp.x * 0.5 + 0.5) * width, sy: (-tmp.y * 0.5 + 0.5) * height, scale, alive, hull: hull / alive, selected, far, wavering, routing });
    }

    // Overlapping pills of one side collapse into the one with the most ships (the selected one first).
    const parent = spots.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    const box = (s: Spot) => ({ w: s.banner.ownWidth * s.scale, h: (s.banner.root.firstElementChild as HTMLElement | null)?.offsetHeight || PILL_H });
    for (let i = 0; i < spots.length; i += 1) {
      const a = spots[i]!;
      const ba = box(a);
      for (let j = i + 1; j < spots.length; j += 1) {
        const b = spots[j]!;
        if (a.sq.team !== b.sq.team) continue;
        const bb = box(b);
        const hh = (ba.h * a.scale + bb.h * b.scale) / 2 + MERGE_GAP;
        if (Math.abs(a.sx - b.sx) < (ba.w + bb.w) / 2 + MERGE_GAP && Math.abs(a.sy - b.sy) < hh) parent[find(j)] = find(i);
      }
    }
    const clusters = new Map<number, Spot[]>();
    spots.forEach((s, i) => {
      const root = find(i);
      clusters.set(root, [...(clusters.get(root) ?? []), s]);
    });

    for (const members of clusters.values()) {
      const lead = members.reduce((best, s) => (s.selected > 0 !== best.selected > 0 ? (s.selected > 0 ? s : best) : s.alive > best.alive ? s : best));
      const merged = members.length > 1;
      for (const s of members) {
        if (s === lead) continue;
        if (s.banner.root.style.display !== 'none') s.banner.root.style.display = 'none';
        s.banner.lastState = 'merged';
        s.banner.lastName = '';
      }
      const { banner } = lead;
      const total = members.reduce((a, s) => a + s.alive, 0);
      const selected = members.some((s) => s.selected > 0);
      const hull = Math.round((members.reduce((a, s) => a + s.hull * s.alive, 0) / total) * 100);
      banner.group = members.map((s) => s.sq.id);
      banner.root.style.display = '';
      if (selected !== banner.lastSelected) {
        banner.root.classList.toggle('sqb--selected', selected);
        banner.lastSelected = selected;
      }
      let resized = false;
      if (lead.far !== banner.far) {
        banner.root.classList.toggle('sqb--far', lead.far);
        banner.far = lead.far;
        resized = true;
      }
      const name = merged ? t('{n}개 부대', { n: members.length }) : squadronLabel(lead.sq);
      if (name !== banner.lastName) {
        banner.name.textContent = name;
        banner.lastName = name;
        resized = true;
        if (merged) banner.root.title = members.map((s) => tName(s.sq.name)).join(', ');
        else banner.root.title = `${tName(lead.sq.name)} · ${tCommander(lead.sq.commander)}`;
      }
      const countText = merged ? tShips(total) : String(total);
      if (countText !== banner.lastCountText) {
        banner.count.textContent = countText;
        banner.lastCountText = countText;
        resized = true;
      }
      // A third of the pill's ships running marks it red, a third shaken marks it amber (the battle depth rules).
      const routing = members.reduce((a, s) => a + s.routing, 0);
      const shaken = routing + members.reduce((a, s) => a + s.wavering, 0);
      const nerve = routing * 3 >= total ? 'rout' : shaken * 3 >= total ? 'waver' : '';
      if (nerve !== banner.lastNerve) {
        banner.lastNerve = nerve;
        banner.nerve.hidden = !nerve;
        banner.nerve.className = `sqb-nerve${nerve ? ` sqb-nerve--${nerve}` : ''}`;
        banner.nerve.innerHTML = nerve ? iconSvg(nerve, 12) : '';
        resized = true;
      }
      if (resized && !merged) banner.ownWidth = Math.max(44, banner.root.offsetWidth);
      if (hull !== banner.lastHull) {
        banner.bar.style.width = `${hull}%`;
        banner.lastHull = hull;
      }
      // Keep the pill on screen and out from under the tool column and the score panel.
      const w = Math.max(banner.root.offsetWidth, 44) * lead.scale;
      const h = (PILL_H + 12) * lead.scale;
      let sx = Math.max(w / 2 + 4, Math.min(width - w / 2 - 4, lead.sx));
      let sy = Math.max(safe.top + h, lead.sy);
      if (sy > safe.dockTop && sy - h < safe.dockBottom) {
        if (w + 8 <= safe.right - safe.left) sx = Math.max(safe.left + w / 2 + 4, Math.min(safe.right - w / 2 - 4, sx));
        else sy = Math.max(sy, safe.dockBottom + h + 4);
      }
      banner.root.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%) scale(${lead.scale.toFixed(3)})`;
    }
  }

  clear() {
    for (const b of this.banners.values()) b.root.remove();
    this.banners.clear();
  }
}
