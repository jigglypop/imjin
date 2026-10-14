import type { Battle } from './battle';
import type { Faction, Ship, ShipKind, Squadron } from './types';

/**
 * Commander abilities. A named commander can, once in a while, call on something his squadron does better than
 * anyone: Yi Sun-sin's crane wing, a massed volley, a ramming charge. An ability is used like an order (a command,
 * validated the same way on the multiplayer server), lasts some seconds and then has to wait out its cooldown.
 *
 * Every effect is a multiplier on what the ship already does, never a new weapon, and each is capped (BOOST_CAP) so
 * two overlapping abilities cannot make a ship that wins on its own. The commander rides the flagship: when it is lost
 * the squadron loses the ability with it.
 */
export type AbilityId = 'crane_wing' | 'volley' | 'ram' | 'rally' | 'fire_arrows' | 'boarding' | 'ambush' | 'smoke' | 'bulwark' | 'tide';
export const ABILITY_IDS: readonly AbilityId[] = ['crane_wing', 'volley', 'ram', 'rally', 'fire_arrows', 'boarding', 'ambush', 'smoke', 'bulwark', 'tide'];

/**
 * What an ability changes on a ship, as multipliers (1 = no change). The first seven act like Ship.mods; the rest are
 * read where the battle resolves them: `armor` scales the hull damage the ship takes from shot and rams, `evade` the
 * accuracy of whoever fires at it, `ram` the ram damage it deals, `stealth` the range at which it is seen, `douse` how
 * fast its crew puts out fires and `flow` how much a current against its course holds it back.
 */
export type Boost = {
  reload: number; accuracy: number; speed: number; turn: number; fire: number; melee: number; defense: number;
  armor: number; evade: number; ram: number; stealth: number; douse: number; flow: number;
};
const KEYS = ['reload', 'accuracy', 'speed', 'turn', 'fire', 'melee', 'defense', 'armor', 'evade', 'ram', 'stealth', 'douse', 'flow'] as const satisfies readonly (keyof Boost)[];
/** No multiplier goes past these, however many abilities reach the ship. */
const BOOST_CAP = { lo: 0.55, hi: 1.8 };

export type AbilityDef = {
  id: AbilityId;
  name: string;
  hanja: string;
  desc: string;
  /** Seconds the effect lasts, and seconds from its start until it can be used again. */
  duration: number;
  cooldown: number;
  /** 'squadron': the commander's own ships. A number: every friendly ship within that many metres of the flagship. */
  area: 'squadron' | number;
  effect: Partial<Boost>;
};

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  crane_wing: { id: 'crane_wing', name: '학익진', hanja: '鶴翼陣', desc: '대장의 함대가 진형을 굳게 지키며 포를 한 곳에 모읍니다. 명중과 장전, 선회가 좋아집니다.', duration: 40, cooldown: 150, area: 'squadron', effect: { accuracy: 1.22, reload: 1.1, turn: 1.2 } },
  volley: { id: 'volley', name: '일제 사격', hanja: '一齊射擊', desc: '모든 포를 즉시 장전하고 다음 일제 사격을 정확히 겨눕니다.', duration: 12, cooldown: 120, area: 'squadron', effect: { accuracy: 1.3 } },
  ram: { id: 'ram', name: '충파 돌격', hanja: '衝破突擊', desc: '노를 힘껏 저어 적선에 부딪칩니다. 속도와 충돌 피해가 커집니다.', duration: 20, cooldown: 120, area: 'squadron', effect: { speed: 1.25, turn: 1.1, ram: 1.6 } },
  rally: { id: 'rally', name: '필사즉생', hanja: '必死則生', desc: '죽고자 하면 살 것입니다. 기함 가까이의 함선이 불을 끄고 기운을 되찾아 등선해 오는 적을 막아 냅니다.', duration: 30, cooldown: 180, area: 400, effect: { reload: 1.12, melee: 1.25, defense: 1.4, douse: 2 } },
  fire_arrows: { id: 'fire_arrows', name: '화전', hanja: '火箭', desc: '불화살과 화공으로 명중한 적선에 불을 붙입니다.', duration: 30, cooldown: 150, area: 'squadron', effect: { fire: 1.8 } },
  boarding: { id: 'boarding', name: '등선 육박전', hanja: '登船肉薄戰', desc: '정예 무사를 앞세워 적선에 뛰어듭니다. 백병전이 강해지고 빨리 다가갑니다.', duration: 30, cooldown: 150, area: 'squadron', effect: { melee: 1.35, speed: 1.1 } },
  ambush: { id: 'ambush', name: '기습', hanja: '奇襲', desc: '섬 그늘과 물안개에 숨어 다가가 먼저 칩니다. 적이 늦게 알아보고, 빠르고 정확해집니다.', duration: 30, cooldown: 180, area: 'squadron', effect: { speed: 1.18, accuracy: 1.12, reload: 1.08, stealth: 0.6 } },
  smoke: { id: 'smoke', name: '연막', hanja: '煙幕', desc: '연기를 피워 기함 가까이의 함선을 가립니다. 적의 조준이 크게 흐트러집니다.', duration: 25, cooldown: 160, area: 350, effect: { evade: 0.7 } },
  bulwark: { id: 'bulwark', name: '철벽', hanja: '鐵壁', desc: '방패와 젖은 거적을 둘러 버팁니다. 받는 피해가 줄고 갑판을 잘 지키지만 느려집니다.', duration: 30, cooldown: 150, area: 'squadron', effect: { armor: 0.75, defense: 1.25, speed: 0.9 } },
  tide: { id: 'tide', name: '물때 읽기', hanja: '潮時', desc: '물길을 아는 장수가 조류를 탑니다. 빠르고 잘 돌며, 거스르는 물살에 덜 밀립니다.', duration: 45, cooldown: 150, area: 'squadron', effect: { speed: 1.1, turn: 1.25, flow: 0.4 } },
};

export const isAbility = (v: unknown): v is AbilityId => typeof v === 'string' && Object.hasOwn(ABILITIES, v);

/**
 * The historical commanders' abilities, matched on part of the squadron's commander line ('통제사 이순신'). Where a
 * battle remembers one moment above all, that battle has its own: at Myeongnyang Yi Sun-sin held the strait with one
 * ship by his "those who seek death shall live".
 */
const COMMANDERS: [string, AbilityId, string?][] = [
  ['이순신', 'rally', 'myeongnyang'],
  ['이순신', 'crane_wing'],
  ['원균', 'ram'],
  ['이억기', 'volley'],
  ['이기남', 'ram'],
  ['돌격장', 'ram'],
  ['정운', 'rally'],
  ['어영담', 'tide'],
  ['권준', 'volley'],
  ['안위', 'tide'],
  ['송희립', 'rally'],
  ['이영남', 'ram'],
  ['배설', 'smoke'],
  ['최호', 'bulwark'],
  ['진린', 'volley'],
  ['등자룡', 'boarding'],
  ['명 유격장', 'fire_arrows'],
  ['와키자카 사베에', 'boarding'],
  ['와키자카', 'ambush'],
  ['도도', 'fire_arrows'],
  ['구키', 'bulwark'],
  ['가토', 'boarding'],
  ['시마즈', 'boarding'],
  ['구루시마', 'tide'],
  ['고니시', 'smoke'],
  ['모리 다카마사', 'ambush'],
  ['다치바나', 'volley'],
  ['소 요시토시', 'ambush'],
  ['데라자와', 'bulwark'],
  ['간 미치나가', 'volley'],
];

export function commanderAbility(commander: string, scenario?: string): AbilityId | undefined {
  for (const [name, id, only] of COMMANDERS) if (commander.includes(name) && (!only || only === scenario)) return id;
  return undefined;
}

/**
 * A conquest squadron has no named commander, so each navy's squadrons get what that navy was known for, by the kind
 * of ship they sail: the Joseon gun line its crane wing and the turtle ships their charge, the Japanese heavy ships
 * their screens, the fighting ships their boarders and the boats their surprise, the Ming junks their massed guns and
 * fire weapons. Tenders, scouts and supply boats have none.
 */
const NAVY: Record<Faction, Partial<Record<ShipKind, AbilityId>>> = {
  joseon: { panokseon: 'crane_wing', geobukseon: 'ram', byeongnyangseon: 'volley' },
  japan: { atakebune: 'bulwark', daeantaek: 'bulwark', sekibune: 'boarding', sogantaek: 'boarding', kobaya: 'ambush', daegwanseon: 'ambush' },
  ming: { mingship: 'volley', gwangseon: 'volley', mingsmall: 'fire_arrows', haechangseon: 'fire_arrows', hoseon: 'smoke' },
};

export function navyAbility(faction: Faction, kind: ShipKind): AbilityId | undefined {
  return NAVY[faction][kind];
}

/** Multiplier `key` of the ship's active abilities, 1 without any. */
export function boostOf(s: Ship, key: keyof Boost): number {
  return s.boost ? s.boost[key] : 1;
}

/** The ship the commander sails in: the flagship, or in a squadron without one its first ship still fighting. */
export function abilityAnchor(b: Battle, sq: Squadron): Ship | undefined {
  const leader = b.get(sq.leaderId);
  if (leader?.flagship) return b.isActive(leader) ? leader : undefined;
  if (b.isActive(leader)) return leader;
  for (const id of sq.shipIds) {
    const s = b.get(id);
    if (b.isActive(s)) return s;
  }
  return undefined;
}

/** Whether the squadron can use its ability now. */
export function abilityReady(b: Battle, sq: Squadron): boolean {
  return !!sq.ability && b.abilities && b.time >= (sq.abilityReady ?? 0) && !!abilityAnchor(b, sq);
}

/** Ships an ability used now would reach. */
export function abilityTargets(b: Battle, sq: Squadron, anchor: Ship): Ship[] {
  const def = ABILITIES[sq.ability!];
  if (def.area === 'squadron') return sq.shipIds.map((id) => b.get(id)).filter((s): s is Ship => b.isActive(s));
  const out: Ship[] = [];
  b.near(anchor.x, anchor.z, def.area, (s) => {
    if (s.team === anchor.team && b.isActive(s)) out.push(s);
  });
  return out;
}

/** Starts the ability. Returns false when it is not ready or the commander is gone. */
export function useAbility(b: Battle, sq: Squadron): boolean {
  if (!abilityReady(b, sq)) return false;
  const def = ABILITIES[sq.ability!];
  const anchor = abilityAnchor(b, sq)!;
  sq.abilityUntil = b.time + def.duration;
  sq.abilityReady = b.time + def.cooldown;
  // The instant parts: guns loaded at once for the volley, fires beaten down for the rally.
  for (const s of abilityTargets(b, sq, anchor)) {
    if (def.id === 'volley') for (const g of s.guns) if (g.ammo >= 1 && g.stage < 4) { g.stage = 4; g.t = 0; }
    if (def.id === 'rally') s.fire *= 0.5;
  }
  b.events.push({ type: 'ability', squadron: sq.id, ability: def.id, ship: anchor.id, x: anchor.x, z: anchor.z, until: sq.abilityUntil, ready: sq.abilityReady });
  return true;
}

const boosted = new WeakMap<Battle, Set<Ship>>();

/**
 * Puts the effects of every running ability on the ships they reach, for this step. Area abilities follow the
 * flagship, so a ship that sails out of the smoke loses its cover.
 */
export function applyAbilities(b: Battle) {
  let set = boosted.get(b);
  if (!set) boosted.set(b, (set = new Set()));
  for (const s of set) s.boost = undefined;
  set.clear();
  for (const sq of b.squadrons) {
    if (!sq.ability || !(b.time < (sq.abilityUntil ?? 0))) continue;
    const anchor = abilityAnchor(b, sq);
    if (!anchor) {
      sq.abilityUntil = b.time;
      continue;
    }
    const effect = ABILITIES[sq.ability].effect;
    for (const s of abilityTargets(b, sq, anchor)) {
      const boost = (s.boost ??= { reload: 1, accuracy: 1, speed: 1, turn: 1, fire: 1, melee: 1, defense: 1, armor: 1, evade: 1, ram: 1, stealth: 1, douse: 1, flow: 1 });
      for (const k of KEYS) {
        const m = effect[k];
        if (m !== undefined) boost[k] = Math.min(BOOST_CAP.hi, Math.max(BOOST_CAP.lo, boost[k] * m));
      }
      set.add(s);
    }
  }
}

/** How often the computer weighs its commanders' abilities, in seconds. */
const THINK = 1;
const thoughtAt = new WeakMap<Battle, number>();

/**
 * The computer's commanders use their abilities when they pay off: a gunnery buff once the enemy is in range, a charge
 * or boarders when the enemy is close, the rally when the deck is held or burning, the screens when outnumbered or
 * hurt, the ambush and the tide while closing in.
 */
export function thinkAbilities(b: Battle) {
  const last = thoughtAt.get(b) ?? -Infinity;
  if (b.time - last < THINK) return;
  thoughtAt.set(b, b.time);
  for (const sq of b.squadrons) {
    if (!abilityReady(b, sq)) continue;
    const anchor = abilityAnchor(b, sq)!;
    if (!b.isAi(anchor)) continue;
    if (wants(b, sq, anchor)) useAbility(b, sq);
  }
}

function wants(b: Battle, sq: Squadron, anchor: Ship): boolean {
  const ships = sq.shipIds.map((id) => b.get(id)).filter((s): s is Ship => b.isActive(s));
  let near = Infinity;
  let foes = 0;
  let friends = 0;
  for (const s of ships) {
    b.near(s.x, s.z, 800, (o) => {
      if (o.team === s.team || !b.isActive(o)) return;
      const d = Math.sqrt((o.x - s.x) ** 2 + (o.z - s.z) ** 2);
      if (b.canSee(o, d, s.team)) near = Math.min(near, d);
    });
  }
  b.near(anchor.x, anchor.z, 700, (o) => {
    if (!b.isActive(o)) return;
    if (o.team === anchor.team) friends += 1;
    else if (b.canSee(o, Math.sqrt((o.x - anchor.x) ** 2 + (o.z - anchor.z) ** 2), anchor.team)) foes += 1;
  });
  const outnumbered = foes > friends * 1.4;
  const hull = ships.reduce((a, s) => a + s.hull / s.spec.hull, 0) / Math.max(1, ships.length);
  const held = ships.some((s) => s.grappledWith || b.boardedBy(s.id) > 0);
  switch (sq.ability!) {
    case 'crane_wing':
    case 'fire_arrows':
      return near < 380;
    case 'volley': {
      // Worth most when the guns are still being served: a ship that is already loaded gains only the aim.
      let loading = 0;
      let all = 0;
      for (const s of ships) for (const g of s.guns) if (g.ammo >= 1) { all += 1; if (g.stage < 4) loading += 1; }
      return near < 340 && all > 0 && loading / all > 0.35;
    }
    case 'ram':
      return near < 240;
    case 'boarding':
      return near < 200 || ships.some((s) => s.grappledWith);
    case 'rally':
      return held || ships.some((s) => s.fire > 0.3) || (near < 400 && (outnumbered || hull < 0.6));
    case 'smoke':
    case 'bulwark':
      return near < 400 && (outnumbered || hull < 0.7);
    case 'ambush':
      return near < 700 && near > 250;
    case 'tide':
      return near < 800;
  }
}
