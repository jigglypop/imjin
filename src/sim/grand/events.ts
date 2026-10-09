import type { ShipKind } from '../types';
import { SHIP_SPECS } from '../catalog';
import { REGIONS } from './regions';
import { forkRng, next } from './rng';
import { grantXp, spawnFleet } from './roster';
import type { Commander, Grand, GrandFaction, RegionId, Result } from './types';
import { GRAND_FACTIONS, fail, ok } from './types';
import { josa } from './josa';
import { note, ownedBy } from './world';

/**
 * The scripted turning points of the war (진영 전역의 사건). Each is tied to a date, fires once when its turn begins
 * and gives each navy a card with a short text and two ways to answer. The player picks; the computer navies pick with a
 * generator forked from the campaign seed and the event, so the same war always unfolds the same way and the choice
 * does not disturb any other roll. What a choice does is a plain `Effect` (a purse, a squadron, a commander's rank, a
 * pause on income), kept small: it tilts a war, it does not decide one.
 */

export type Effect = {
  /** Silver added to (or taken from) the treasury. */
  gold?: number;
  /** Added to every ship's hull, crew and supply in the faction's fleets (fractions, capped at full). */
  repair?: number;
  /** Experience for the navy's most senior living commander. */
  xp?: number;
  /** A squadron that joins at `at`, or at the faction's first port when that one has been lost. */
  ships?: { at: RegionId; name: string; kinds: Partial<Record<ShipKind, number>> };
  /** Income multiplied by `mult` for the next `turns` turns. */
  income?: { mult: number; turns: number };
  /** The commander is taken off his fleet until a later event (a flag keeps count). */
  suspend?: string;
  /** The commander returns to the fleet he left, or the strongest one. */
  restore?: string;
};

export type EventChoice = { label: string; effect: Effect };

export type EventCard = {
  title: string;
  text: string;
  /** A file in public/ui/portraits (without extension) shown on the card. */
  portrait?: string;
  choices: [EventChoice, EventChoice];
};

export type GameEvent = {
  id: string;
  /** The turn the card is dealt (see dateOf in economy.ts for its date). */
  turn: number;
  /** The line the war's log carries for every navy. */
  headline: string;
  cards: Partial<Record<GrandFaction, EventCard>>;
  /** Extra condition on a navy's card, e.g. an earlier choice. */
  when?: (g: Grand, f: GrandFaction) => boolean;
};

const YI_SUSPENDED = 'yi_suspended';

export const EVENTS: readonly GameEvent[] = [
  {
    id: 'busan_landing',
    turn: 1,
    headline: '1592년 4월, 왜선 700여 척이 부산포를 덮었다. 임진왜란이 시작되었다.',
    cards: {
      joseon: {
        title: '부산포의 불길',
        text: '왜선 수백 척이 부산포를 덮었다. 경상도 수군은 싸우지 못하고 흩어지는데, 전라좌수영에는 아직 출전 명령이 닿지 않았다. 병사들은 포구에서 기다리고 있다.',
        portrait: 'portrait_yi',
        choices: [
          { label: '의병과 어민을 모아 협선을 늘린다', effect: { ships: { at: 'yeosu', name: '의병 수군', kinds: { hyeopseon: 3 } } } },
          { label: '군량과 화약부터 서둘러 쌓는다', effect: { gold: 250 } },
        ],
      },
      japan: {
        title: '부산포 상륙',
        text: '선봉이 부산포를 눌렀다. 조선 수군은 맞서지 못했다. 나고야의 대본영에서는 후속 선단을 띄울 채비를 하고 있다.',
        portrait: 'portrait_wakisaka',
        choices: [
          { label: '점령한 땅의 곡식을 거두어 군량을 채운다', effect: { income: { mult: 1.05, turns: 3 } } },
          { label: '군자금을 풀어 장수들을 격려한다', effect: { gold: 120, xp: 60 } },
        ],
      },
      ming: {
        title: '조선의 급보',
        text: '조선에서 왜군이 상륙했다는 급보가 올랐다. 조정은 왜군이 압록강을 건너 요동을 노릴까 걱정한다.',
        portrait: 'portrait_chenlin',
        choices: [
          { label: '요동의 수군을 늘려 바다를 지킨다', effect: { ships: { at: 'liaodong', name: '요동 증강대', kinds: { mingsmall: 1 } } } },
          { label: '군비를 아끼고 소식을 기다린다', effect: { gold: 220 } },
        ],
      },
    },
  },
  {
    id: 'ming_aid',
    turn: 4,
    headline: '1593년 1월, 명의 이여송이 압록강을 건너 평양성을 되찾았다.',
    cards: {
      joseon: {
        title: '명의 원군',
        text: '이여송의 명군이 압록강을 건너 평양성의 왜군을 몰아냈다. 명군에게 군량을 대야 하나, 곳간은 넉넉하지 않다.',
        portrait: 'portrait_chenlin',
        choices: [
          { label: '명군을 후히 맞아 지원을 이끌어 낸다', effect: { gold: -80, income: { mult: 1.2, turns: 3 } } },
          { label: '자력으로 수군을 키운다', effect: { gold: 120, xp: 120 } },
        ],
      },
      japan: {
        title: '평양성의 패보',
        text: '평양성을 잃고 병사들이 흔들린다. 남해안으로 물러난 군세를 다잡아야 한다.',
        portrait: 'portrait_kuki',
        choices: [
          { label: '물러난 병력을 남해안 포구에 모은다', effect: { income: { mult: 0.95, turns: 2 }, ships: { at: 'busan', name: '철수 병력', kinds: { sekibune: 1, kobaya: 3 } } } },
          { label: '군기를 다잡고 둔전을 일군다', effect: { gold: 100 } },
        ],
      },
      ming: {
        title: '이여송의 출병',
        text: '명군 4만이 압록강을 건넜다. 수군도 서해를 건너 조선을 도울 차례다.',
        portrait: 'portrait_deng',
        choices: [
          { label: '수군을 증파한다', effect: { gold: -150, ships: { at: 'liaodong', name: '명 증원 수군', kinds: { mingship: 1 } } } },
          { label: '은을 풀어 군량을 대고 장졸을 격려한다', effect: { gold: 100, xp: 100 } },
        ],
      },
    },
  },
  {
    id: 'peace_talks',
    turn: 10,
    headline: '1594년 7월, 명과 일본이 강화를 논하는 가운데 전선은 소강 상태에 빠졌다.',
    cards: {
      joseon: {
        title: '강화 교섭',
        text: '명과 일본이 조선을 빼놓고 강화를 논한다. 전선은 잠잠하나 왜군은 남해안에 눌러앉아 있다.',
        choices: [
          { label: '교섭에 반대하는 상소를 올리고 전의를 다진다', effect: { gold: -50, xp: 100 } },
          { label: '전열을 정비하며 때를 기다린다', effect: { repair: 0.1 } },
        ],
      },
      japan: {
        title: '강화 교섭',
        text: '명과 강화를 논하는 동안 전선이 잠잠하다. 이 틈에 군량을 채울 수 있다.',
        choices: [
          { label: '교섭에 응해 군량을 얻는다', effect: { gold: 200, income: { mult: 0.95, turns: 2 } } },
          { label: '교섭 중에도 군선을 늘린다', effect: { ships: { at: 'nagoya', name: '강화 중 신조', kinds: { sekibune: 2, kobaya: 5 } } } },
        ],
      },
      ming: {
        title: '강화 교섭',
        text: '명이 일본과 마주 앉았다. 교섭이 길어질수록 수군에 은이 샌다.',
        choices: [
          { label: '교섭을 이끌어 군비를 줄인다', effect: { gold: 150 } },
          { label: '수군을 정비한다', effect: { repair: 0.1 } },
        ],
      },
    },
  },
  {
    id: 'reinvasion',
    turn: 20,
    headline: '1597년 1월, 히데요시가 조선 재침을 명했다. 정유재란이 시작되었다.',
    cards: {
      japan: {
        title: '정유재란',
        text: '히데요시가 조선 재침을 명했다. 14만이 다시 바다를 건넌다. 이번에는 남해안을 곧바로 눌러 전라도로 간다.',
        portrait: 'portrait_kato',
        choices: [
          { label: '대선단을 일으킨다', effect: { gold: -400, ships: { at: 'nagoya', name: '재침 대선단', kinds: { atakebune: 3, sekibune: 3, kobaya: 5 } } } },
          { label: '정예만 보내고 군자금을 쌓는다', effect: { gold: 300, xp: 100 } },
        ],
      },
      joseon: {
        title: '왜군의 재침',
        text: '일본군이 다시 바다를 건넌다는 보고가 올랐다. 남해안의 방비를 서둘러야 한다.',
        portrait: 'portrait_yi',
        choices: [
          { label: '수군을 새로 일으킨다', effect: { gold: -150, ships: { at: 'yeosu', name: '재건 수군', kinds: { panokseon: 1, hyeopseon: 2 } } } },
          { label: '남해안 포구의 군량과 화약을 채운다', effect: { gold: 250 } },
        ],
      },
      ming: {
        title: '정유재란',
        text: '일본군이 다시 조선을 쳤다. 명은 원군을 다시 보내야 하는가를 두고 조정이 갈린다.',
        portrait: 'portrait_chenlin',
        choices: [
          { label: '수군을 다시 파견한다', effect: { gold: -400, ships: { at: 'liaodong', name: '명 재파병 수군', kinds: { mingship: 2 } } } },
          { label: '은으로 조선을 지원하고 지켜본다', effect: { gold: 200, xp: 60 } },
        ],
      },
    },
  },
  {
    id: 'yi_arrest',
    turn: 21,
    headline: '1597년 4월, 이순신이 옥에서 풀려나 백의종군의 길에 올랐다.',
    cards: {
      joseon: {
        title: '이순신의 백의종군',
        text: '조정은 이순신의 관직을 거두어 옥에 가두었다가 풀어, 백의종군을 명한다. 수군은 장수 없이 남았다.',
        portrait: 'portrait_yi',
        choices: [
          { label: '조정의 명을 따르고 신임을 얻는다', effect: { gold: 200, suspend: 'yi' } },
          { label: '장수들이 연명으로 구명하고 곁에 둔다', effect: { gold: -100 } },
        ],
      },
    },
  },
  {
    id: 'yi_return',
    turn: 22,
    headline: '1597년 7월, 칠천량에서 조선 수군이 무너졌다. 이순신이 삼도수군통제사로 돌아왔다.',
    when: (g, f) => f === 'joseon' && g.events.flags.includes(YI_SUSPENDED),
    cards: {
      joseon: {
        title: '삼도수군통제사 복귀',
        text: '칠천량에서 원균의 수군이 무너졌다. 조정은 이순신을 다시 삼도수군통제사로 부른다. 남은 판옥선은 열두 척뿐이다.',
        portrait: 'portrait_yi',
        choices: [
          { label: '남은 판옥선을 수습해 수군을 일으킨다', effect: { restore: 'yi', xp: 120, ships: { at: 'myeongnyang', name: '수습한 판옥선', kinds: { panokseon: 2 } } } },
          { label: '피난민과 군량을 모아 전열을 가다듬는다', effect: { restore: 'yi', repair: 0.15, gold: 150 } },
        ],
      },
    },
  },
  {
    id: 'taiko_death',
    turn: 27,
    headline: '1598년 10월, 히데요시의 죽음이 전해져 왜군에 철수령이 내려졌다.',
    cards: {
      japan: {
        title: '히데요시의 죽음',
        text: '도요토미 히데요시가 세상을 떠났다. 조선에 나와 있는 장수들은 싸울 이유를 잃고, 군선은 돌아갈 날만 헤아린다.',
        portrait: 'portrait_konishi',
        choices: [
          { label: '철수를 서두르고 군선을 보존한다', effect: { income: { mult: 0.85, turns: 3 }, repair: 0.15 } },
          { label: '체면을 걸고 끝까지 싸운다', effect: { income: { mult: 0.75, turns: 3 }, xp: 150 } },
        ],
      },
      joseon: {
        title: '왜군의 철수',
        text: '히데요시가 죽자 왜군이 철수를 서두른다. 마지막 추격의 기회지만, 오랜 전쟁에 곳간이 비었다.',
        portrait: 'portrait_yi',
        choices: [
          { label: '퇴로를 막고 전군으로 추격한다', effect: { gold: -100, xp: 200 } },
          { label: '무리하지 않고 포구를 지킨다', effect: { gold: 150 } },
        ],
      },
      ming: {
        title: '왜군의 철수',
        text: '히데요시의 죽음으로 왜군이 물러난다. 명 수군은 추격에 가세할 수도, 전쟁을 마무리할 수도 있다.',
        portrait: 'portrait_chenlin',
        choices: [
          { label: '수군을 앞세워 추격에 가세한다', effect: { xp: 100, repair: 0.1 } },
          { label: '전쟁을 마무리 짓고 은을 아낀다', effect: { gold: 200 } },
        ],
      },
    },
  },
];

const byId = new Map(EVENTS.map((e) => [e.id, e]));

export const eventById = (id: string): GameEvent | undefined => byId.get(id);

/** The card a faction is dealt for an event, or undefined when the event does not concern it. */
export function cardFor(g: Grand, ev: GameEvent, f: GrandFaction): EventCard | undefined {
  if (!g.factions[f].alive) return undefined;
  const card = ev.cards[f];
  return card && (!ev.when || ev.when(g, f)) ? card : undefined;
}

/** The card waiting for the player, if one is. */
export function pendingCard(g: Grand): { event: GameEvent; card: EventCard } | null {
  if (!g.events.pending || !g.player) return null;
  const event = byId.get(g.events.pending);
  const card = event && cardFor(g, event, g.player);
  return event && card ? { event, card } : null;
}

// --- What a choice does ----------------------------------------------------------------------------------------

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function seniorCommander(g: Grand, f: GrandFaction): Commander | undefined {
  return g.factions[f].commanders.filter((c) => c.alive).sort((a, b) => b.level - a.level || b.xp - a.xp)[0];
}

/** The place a squadron arrives: the named port if the faction still holds it, else its first. */
function portFor(g: Grand, f: GrandFaction, at: RegionId): RegionId | undefined {
  return g.regions[at].owner === f ? at : ownedBy(g, f)[0];
}

export function applyEffect(g: Grand, f: GrandFaction, e: Effect): void {
  const st = g.factions[f];
  if (e.gold) st.gold = Math.max(0, st.gold + e.gold);
  if (e.repair) {
    for (const fl of g.fleets) {
      if (fl.faction !== f) continue;
      for (const u of fl.ships) {
        u.hull = clamp01(u.hull + e.repair);
        u.crew = clamp01(u.crew + e.repair);
        u.supply = clamp01(u.supply + e.repair);
      }
    }
  }
  if (e.xp) {
    const cmd = seniorCommander(g, f);
    if (cmd) grantXp(g, f, cmd, e.xp);
  }
  if (e.ships) {
    const at = portFor(g, f, e.ships.at);
    if (at) spawnFleet(g, f, at, e.ships.name, e.ships.kinds, null);
  }
  if (e.income) g.events.mods.push({ faction: f, mult: e.income.mult, left: e.income.turns });
  if (e.suspend) {
    const fleet = g.fleets.find((fl) => fl.commanderId === e.suspend);
    if (fleet) fleet.commanderId = null;
    if (!g.events.flags.includes(YI_SUSPENDED)) g.events.flags.push(YI_SUSPENDED);
    if (!g.events.flags.includes(`suspended:${e.suspend}`)) g.events.flags.push(`suspended:${e.suspend}`);
  }
  if (e.restore) {
    g.events.flags = g.events.flags.filter((x) => x !== `suspended:${e.restore}`);
    const cmd = st.commanders.find((c) => c.id === e.restore && c.alive);
    const held = g.fleets.some((fl) => fl.commanderId === e.restore);
    if (cmd && !held) {
      // He takes the strongest fleet that has no commander, so the fleet he left (or its successor) gets him back.
      const fleet = g.fleets.filter((fl) => fl.faction === f && !fl.commanderId).sort((a, b) => b.ships.length - a.ships.length)[0];
      if (fleet) fleet.commanderId = cmd.id;
    }
    g.events.flags = g.events.flags.filter((x) => x !== YI_SUSPENDED);
  }
}

/** The effect as a short Korean line for the card's buttons. */
export function describeEffect(e: Effect): string {
  const parts: string[] = [];
  if (e.gold) parts.push(`은 ${e.gold > 0 ? '+' : '−'}${Math.abs(e.gold)}냥`);
  if (e.ships) {
    const names = (Object.entries(e.ships.kinds) as [ShipKind, number][]).map(([k, n]) => `${SHIP_SPECS[k].label} ${n}척`).join(' · ');
    parts.push(`${names} 합류 (${REGIONS[e.ships.at].name})`);
  }
  if (e.xp) parts.push(`장수 경험 +${e.xp}`);
  if (e.repair) parts.push(`함대 회복 +${Math.round(e.repair * 100)}%`);
  if (e.income) parts.push(`수입 ${e.income.mult >= 1 ? '+' : '−'}${Math.round(Math.abs(e.income.mult - 1) * 100)}% (${e.income.turns}턴)`);
  if (e.suspend) parts.push('이순신이 지휘에서 물러남');
  if (e.restore) parts.push('이순신이 지휘로 복귀');
  return parts.join(' · ');
}

function resolve(g: Grand, ev: GameEvent, f: GrandFaction, index: number) {
  const card = cardFor(g, ev, f);
  if (!card) return;
  applyEffect(g, f, card.choices[index]!.effect);
  if (f === g.player) note(g, `${card.title} — ${card.choices[index]!.label}`, 'info');
}

/**
 * Deals the cards of the turn that has just begun. A navy the computer plays answers at once; the player's card waits
 * in `events.pending` until `chooseEvent` answers it.
 */
export function fireEvents(g: Grand): void {
  const ev = EVENTS.find((e) => e.turn === g.turn && g.events.done[e.id] === undefined);
  if (!ev) return;
  // A card the player left unanswered gets its first answer rather than blocking the next.
  if (g.events.pending) chooseEvent(g, 0);
  g.events.done[ev.id] = -2;
  note(g, ev.headline, 'info', 'event');
  const index = EVENTS.indexOf(ev);
  for (const f of GRAND_FACTIONS) {
    if (!cardFor(g, ev, f)) continue;
    if (f === g.player) {
      g.events.pending = ev.id;
      g.events.done[ev.id] = -1;
    } else resolve(g, ev, f, Math.floor(next(forkRng(g.seed, 9100 + index, GRAND_FACTIONS.indexOf(f))) * 2));
  }
}

/** The player's answer to the card that waits. */
export function chooseEvent(g: Grand, index: number): Result {
  const shown = pendingCard(g);
  if (!shown || !g.player) {
    g.events.pending = null;
    return fail('답할 사건이 없다');
  }
  const choice = shown.card.choices[index];
  if (!choice) return fail('그런 선택은 없다');
  resolve(g, shown.event, g.player, index);
  g.events.done[shown.event.id] = index;
  g.events.pending = null;
  return ok(`${josa(shown.card.title, '을/를')} 마무리했다`);
}
