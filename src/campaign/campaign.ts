import { create } from 'zustand';
import { SCENARIOS, type ScenarioId } from '../sim/scenarios';
import type { ShipKind, ShipMods } from '../sim/types';
import type { FleetSpawn } from '../sim/scenarios';
import { t } from '../i18n';
import { flagshipOf, numbered } from '../i18n/names';

export const CAMPAIGN_ORDER: ScenarioId[] = ['okpo', 'sacheon', 'dangpo', 'hansan', 'angolpo', 'busan', 'chilcheon', 'myeongnyang', 'noryang'];

export type SkillKey = 'gunnery' | 'command' | 'seamanship' | 'fire' | 'melee';

export const SKILLS: Record<SkillKey, { label: string; desc: string }> = {
  gunnery: { label: '포술', desc: '장전 속도 +6% · 명중률 +5% (단계당)' },
  command: { label: '통솔', desc: '사기와 백병 방어 +6% (단계당)' },
  seamanship: { label: '항해', desc: '속도 +3% · 선회 +5% (단계당)' },
  fire: { label: '화공', desc: '불붙일 확률 +12% (단계당)' },
  melee: { label: '백병', desc: '백병전 공격 +8% (단계당)' },
};

export type Commander = {
  id: string;
  name: string;
  title: string;
  portrait: string;
  level: number;
  xp: number;
  points: number;
  skills: Record<SkillKey, number>;
  alive: boolean;
};

export type FleetShip = {
  id: string;
  kind: ShipKind;
  name: string;
  hull: number;
  crew: number;
  supply: number;
  kills: number;
};

export type FleetSquad = { id: string; name: string; commanderId: string; ships: FleetShip[] };

export type Resources = { grain: number; powder: number; timber: number; merit: number };

export type BattleRecord = { id: ScenarioId; win: boolean; sunk: number; lost: number; escaped: number };

export type Campaign = {
  version: 1;
  step: number;
  resources: Resources;
  squads: FleetSquad[];
  commanders: Commander[];
  history: BattleRecord[];
  log: string[];
};

const STORAGE_KEY = 'imjin.campaign.v1';

export const LEVEL_XP = [0, 120, 300, 560, 900, 1350, 1900, 2600, 3500];

const zeroSkills = (): Record<SkillKey, number> => ({ gunnery: 0, command: 0, seamanship: 0, fire: 0, melee: 0 });

function commander(id: string, name: string, title: string, portrait: string, level = 1, skills: Partial<Record<SkillKey, number>> = {}): Commander {
  return { id, name, title, portrait, level, xp: LEVEL_XP[level - 1] ?? 0, points: 0, skills: { ...zeroSkills(), ...skills }, alive: true };
}

let shipSeq = 1;
function ships(kind: ShipKind, count: number, prefix: string): FleetShip[] {
  return Array.from({ length: count }, (_, i) => ({ id: `s${shipSeq++}`, kind, name: numbered(prefix, i + 1), hull: 1, crew: 1, supply: 1, kills: 0 }));
}

export function newCampaign(): Campaign {
  shipSeq = 1;
  return {
    version: 1,
    step: 0,
    resources: { grain: 120, powder: 60, timber: 60, merit: 0 },
    commanders: [
      commander('yi', '이순신', '전라좌수사', 'portrait_yi', 2, { gunnery: 1 }),
      commander('jeongun', '정운', '녹도만호', 'portrait_jeongun', 1, { melee: 1 }),
      commander('eo', '어영담', '광양현감', 'portrait_eo', 1, { seamanship: 1 }),
      commander('kwon', '권준', '순천부사', 'portrait_kwon', 1),
      commander('won', '원균', '경상우수사', 'portrait_won', 1),
    ],
    squads: [
      { id: 'q1', name: '전라좌수영 본대', commanderId: 'yi', ships: ships('panokseon', 10, '좌수영') },
      { id: 'q2', name: '중위장', commanderId: 'eo', ships: ships('panokseon', 7, '중위') },
      { id: 'q3', name: '선봉 · 녹도', commanderId: 'jeongun', ships: ships('panokseon', 7, '선봉') },
      { id: 'q4', name: '경상우수영', commanderId: 'won', ships: ships('panokseon', 4, '경상') },
      { id: 'q5', name: '협선대', commanderId: 'kwon', ships: ships('hyeopseon', 15, '협선') },
    ],
    history: [],
    log: [t('1592년 4월, 일본군 15만이 부산에 상륙했습니다. 전라좌수영 함대가 첫 출전을 준비합니다.')],
  };
}

function load(): Campaign | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Campaign;
    if (c.version !== 1) return null;
    for (const sq of c.squads) for (const s of sq.ships) shipSeq = Math.max(shipSeq, Number(s.id.slice(1)) + 1);
    return c;
  } catch {
    return null;
  }
}

function save(c: Campaign | null) {
  try {
    if (c) localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable; campaign stays in memory
  }
}

type CampaignState = { mode: 'free' | 'campaign'; campaign: Campaign | null };

export const useCampaign = create<CampaignState>(() => ({ mode: 'free', campaign: load() }));

function commit(mutate: (c: Campaign) => void) {
  const current = useCampaign.getState().campaign;
  if (!current) return;
  const next = structuredClone(current);
  mutate(next);
  save(next);
  useCampaign.setState({ campaign: next });
}

export function setMode(mode: 'free' | 'campaign') {
  if (mode === 'campaign' && !useCampaign.getState().campaign) {
    const c = newCampaign();
    save(c);
    useCampaign.setState({ campaign: c });
  }
  useCampaign.setState({ mode });
}

export function resetCampaign() {
  const c = newCampaign();
  save(c);
  useCampaign.setState({ campaign: c, mode: 'campaign' });
}

export function currentBattle(c: Campaign) {
  return CAMPAIGN_ORDER[Math.min(c.step, CAMPAIGN_ORDER.length - 1)]!;
}

export function campaignOver(c: Campaign) {
  return c.step >= CAMPAIGN_ORDER.length;
}

const KIND_COST: Record<ShipKind, { hull: number; crew: number; supply: number }> = {
  panokseon: { hull: 1, crew: 1, supply: 1 },
  geobukseon: { hull: 1.2, crew: 0.9, supply: 0.8 },
  hyeopseon: { hull: 0.2, crew: 0.15, supply: 0.1 },
  atakebune: { hull: 1, crew: 1, supply: 1 },
  sekibune: { hull: 0.5, crew: 0.5, supply: 0.4 },
  kobaya: { hull: 0.2, crew: 0.2, supply: 0.1 },
  mingship: { hull: 1, crew: 1, supply: 1 },
  mingsmall: { hull: 0.4, crew: 0.4, supply: 0.3 },
};

export function repairCost(c: Campaign) {
  let timber = 0;
  let grain = 0;
  let powder = 0;
  for (const sq of c.squads)
    for (const s of sq.ships) {
      const k = KIND_COST[s.kind];
      timber += (1 - s.hull) * 30 * k.hull;
      grain += (1 - s.crew) * 24 * k.crew;
      powder += (1 - s.supply) * 14 * k.supply;
    }
  return { timber: Math.ceil(timber), grain: Math.ceil(grain), powder: Math.ceil(powder) };
}

export function repairAll(part: 'hull' | 'crew' | 'supply') {
  commit((c) => {
    const resource = part === 'hull' ? 'timber' : part === 'crew' ? 'grain' : 'powder';
    const rate = part === 'hull' ? 30 : part === 'crew' ? 24 : 14;
    const list = c.squads.flatMap((sq) => sq.ships).sort((a, b) => a[part] - b[part]);
    for (const s of list) {
      const k = KIND_COST[s.kind][part];
      const need = (1 - s[part]) * rate * k;
      if (need <= 0.01) continue;
      const pay = Math.min(need, c.resources[resource]);
      if (pay <= 0) break;
      c.resources[resource] -= pay;
      s[part] = Math.min(1, s[part] + pay / (rate * k));
    }
    c.resources[resource] = Math.floor(c.resources[resource]);
  });
}

export const BUILD: Partial<Record<ShipKind, { timber: number; powder: number; grain: number; unlock: number; label: string }>> = {
  panokseon: { timber: 45, powder: 12, grain: 30, unlock: 0, label: '판옥선' },
  geobukseon: { timber: 60, powder: 18, grain: 30, unlock: 1, label: '거북선' },
  hyeopseon: { timber: 8, powder: 1, grain: 6, unlock: 0, label: '협선' },
};

export function buildShip(kind: ShipKind, squadId: string) {
  commit((c) => {
    const cost = BUILD[kind];
    if (!cost || c.step < cost.unlock) return;
    if (c.resources.timber < cost.timber || c.resources.powder < cost.powder || c.resources.grain < cost.grain) return;
    const sq = c.squads.find((q) => q.id === squadId) ?? c.squads[0];
    if (!sq) return;
    c.resources.timber -= cost.timber;
    c.resources.powder -= cost.powder;
    c.resources.grain -= cost.grain;
    sq.ships.push({ id: `s${shipSeq++}`, kind, name: numbered(cost.label, sq.ships.filter((s) => s.kind === kind).length + 1), hull: 1, crew: 1, supply: 1, kills: 0 });
    c.log.unshift(t('{squad}에 {ship} 한 척을 건조했습니다.', { squad: t(sq.name), ship: t(cost.label) }));
  });
}

export function spendSkill(commanderId: string, skill: SkillKey) {
  commit((c) => {
    const cmd = c.commanders.find((x) => x.id === commanderId);
    if (!cmd || cmd.points <= 0 || cmd.skills[skill] >= 5) return;
    cmd.points -= 1;
    cmd.skills[skill] += 1;
  });
}

export function modsFor(cmd: Commander | undefined, veteran: number): ShipMods {
  const s = cmd?.skills ?? zeroSkills();
  const lvl = cmd ? cmd.level - 1 : 0;
  return {
    reload: 1 + s.gunnery * 0.06 + lvl * 0.01 + veteran * 0.01,
    accuracy: 1 + s.gunnery * 0.05 + veteran * 0.01,
    speed: 1 + s.seamanship * 0.03,
    turn: 1 + s.seamanship * 0.05,
    fire: 1 + s.fire * 0.12,
    melee: 1 + s.melee * 0.08 + lvl * 0.01,
    defense: 1 + s.command * 0.06 + lvl * 0.01,
  };
}

export type ShipOutcome = { campaignId: string; alive: boolean; hull: number; crew: number; supply: number; kills: number };
export type BattleOutcome = { id: ScenarioId; win: boolean; enemySunk: number; enemyEscaped: number; ships: ShipOutcome[] };

export type Report = { win: boolean; lost: number; sunk: number; loot: Resources; levelUps: string[]; xp: { name: string; gained: number; level: number }[]; events: string[] };

const EVENTS: Partial<Record<ScenarioId, (c: Campaign) => string[]>> = {
  okpo: (c) => {
    const sq = c.squads.find((q) => q.commanderId === 'yi');
    sq?.ships.push({ id: `s${shipSeq++}`, kind: 'geobukseon', name: numbered('거북선', 1), hull: 1, crew: 1, supply: 1, kills: 0 });
    return [t('나대용이 건조를 맡은 거북선이 완성되어 함대에 합류했습니다.')];
  },
  dangpo: (c) => {
    if (!c.commanders.some((x) => x.id === 'eokgi')) c.commanders.push(commander('eokgi', '이억기', '전라우수사', 'portrait_eokgi', 2, { command: 1 }));
    c.squads.push({ id: `q${c.squads.length + 1}`, name: '전라우수영', commanderId: 'eokgi', ships: ships('panokseon', 25, '우수영') });
    return [t('전라우수사 이억기가 판옥선 25척을 이끌고 합류했습니다.')];
  },
  hansan: (c) => {
    c.resources.timber += 40;
    c.resources.powder += 30;
    return [t('조정에서 목재와 화약을 보냈습니다. 거북선을 더 건조할 수 있습니다.')];
  },
  busan: (c) => {
    const jeong = c.commanders.find((x) => x.id === 'jeongun');
    if (jeong && jeong.alive) {
      jeong.alive = false;
      const sq = c.squads.find((q) => q.commanderId === 'jeongun');
      if (sq) sq.commanderId = 'yi';
      return [t('부산포에서 선봉장 정운이 적탄에 전사했습니다. 그의 함대는 이순신이 직접 지휘합니다.'), t('1597년, 이순신은 모함을 받아 한양으로 압송되고 원균이 통제사가 되었습니다.')];
    }
    return [t('1597년, 이순신이 압송되고 원균이 통제사가 되었습니다.')];
  },
  chilcheon: (c) => {
    const survivors = c.squads.flatMap((q) => q.ships).filter((s) => s.kind === 'panokseon');
    const keep = Math.max(12, Math.min(survivors.length, 40));
    const kept = survivors.slice(0, keep);
    c.squads = [{ id: 'q1', name: '통제사 본대', commanderId: 'yi', ships: kept.length ? kept : ships('panokseon', 12, '판옥선') }];
    c.squads[0]!.ships.push({ id: `s${shipSeq++}`, kind: 'panokseon', name: flagshipOf('통제사'), hull: 1, crew: 1, supply: 1, kills: 0 });
    const won = c.commanders.find((x) => x.id === 'won');
    if (won) won.alive = false;
    return [t('칠천량의 패전 뒤 백의종군하던 이순신이 다시 통제사가 되었습니다. 남은 배는 {n}척입니다.', { n: c.squads[0]!.ships.length })];
  },
  myeongnyang: (c) => {
    c.resources.timber += 120;
    c.resources.grain += 120;
    c.resources.powder += 60;
    c.squads[0]!.ships.push(...ships('panokseon', 20, '신조 판옥선'));
    return [t('고금도에서 수군을 재건했습니다. 판옥선 20척을 새로 지었고, 명의 진린 함대가 합류합니다.')];
  },
};

export function applyOutcome(o: BattleOutcome): Report {
  const report: Report = { win: o.win, lost: 0, sunk: o.enemySunk, loot: { grain: 0, powder: 0, timber: 0, merit: 0 }, levelUps: [], xp: [], events: [] };
  commit((c) => {
    const byId = new Map(o.ships.map((s) => [s.campaignId, s]));
    const xpBy = new Map<string, number>();
    for (const sq of c.squads) {
      const before = sq.ships.length;
      let kills = 0;
      sq.ships = sq.ships.filter((s) => {
        const r = byId.get(s.id);
        if (!r) return true;
        kills += r.kills;
        s.kills += r.kills;
        if (!r.alive) return false;
        s.hull = r.hull;
        s.crew = r.crew;
        s.supply = r.supply;
        return true;
      });
      report.lost += before - sq.ships.length;
      xpBy.set(sq.commanderId, (xpBy.get(sq.commanderId) ?? 0) + 60 + kills * 35 + (o.win ? 90 : 0));
    }
    for (const cmd of c.commanders) {
      const gained = xpBy.get(cmd.id);
      if (!gained || !cmd.alive) continue;
      cmd.xp += gained;
      let ups = 0;
      while (cmd.level < LEVEL_XP.length && cmd.xp >= LEVEL_XP[cmd.level]!) {
        cmd.level += 1;
        cmd.points += 1;
        ups += 1;
      }
      report.xp.push({ name: cmd.name, gained, level: cmd.level });
      if (ups) report.levelUps.push(t('{name} {level}레벨 (기술 점수 +{n})', { name: t(cmd.name), level: cmd.level, n: ups }));
    }
    const loot = {
      grain: Math.round(o.enemySunk * 3 + (o.win ? 40 : 10)),
      powder: Math.round(o.enemySunk * 1.2 + (o.win ? 20 : 5)),
      timber: Math.round(o.enemySunk * 1.5 + (o.win ? 25 : 5)),
      merit: o.win ? 100 + o.enemySunk * 5 : o.enemySunk * 2,
    };
    c.resources.grain += loot.grain;
    c.resources.powder += loot.powder;
    c.resources.timber += loot.timber;
    c.resources.merit += loot.merit;
    report.loot = loot;
    c.squads = c.squads.filter((q) => q.ships.length > 0);
    c.history.push({ id: o.id, win: o.win, sunk: o.enemySunk, lost: report.lost, escaped: o.enemyEscaped });
    const historicalLoss = o.id === 'chilcheon';
    if (o.win || historicalLoss) {
      const events = EVENTS[o.id]?.(c) ?? [];
      report.events.push(...events);
      c.log.unshift(...events);
      c.step += 1;
    } else {
      report.events.push(t('패전했습니다. 함대를 정비한 뒤 다시 싸울 수 있습니다.'));
    }
    c.log.unshift(t('{title}: {result} · 적 함선 {sunk}척 격파 · 아군 손실 {lost}척', { title: t(SCENARIOS[o.id].title), result: o.win ? t('승리') : t('패배'), sunk: o.enemySunk, lost: report.lost }));
  });
  return report;
}

export function fleetSpawn(c: Campaign): FleetSpawn {
  const battle = currentBattle(c);
  const lead = (id: string) => (battle === 'chilcheon' && id === 'yi' ? 'won' : id);
  let flagDone = false;
  return {
    squads: c.squads.map((sq) => {
      const cmd = c.commanders.find((x) => x.id === lead(sq.commanderId)) ?? c.commanders.find((x) => x.alive);
      return {
        name: sq.name,
        commander: cmd ? `${cmd.title} ${cmd.name}` : '장수',
        portrait: cmd?.portrait ?? 'portrait_admiral',
        ships: sq.ships.map((s) => {
          const flagship = !flagDone && s.kind === 'panokseon' && (cmd?.id === 'yi' || (battle === 'chilcheon' && cmd?.id === 'won'));
          if (flagship) flagDone = true;
          return { kind: s.kind, name: flagship ? flagshipOf(cmd?.name ?? '') : s.name, hull: s.hull, crew: s.crew, supply: s.supply, campaignId: s.id, mods: modsFor(cmd, Math.min(10, s.kills)), flagship };
        }),
      };
    }),
  };
}
