import { useCallback, useMemo, useState } from 'react';
import './grand.css';
import { BattlePreview } from './BattlePreview';
import { FactionPick } from './FactionPick';
import { FleetPanel } from './FleetPanel';
import { GrandMap } from './GrandMap';
import { RegionPanel } from './RegionPanel';
import { TopBar } from './TopBar';
import { FACTION_OPTIONS, START_FLEETS, START_TREASURY, makeRegions, queueItem, refreshBuildings } from './mock';
import { SHIP_NAME, useMapInsets } from './shared';
import type { BattlePreviewView, BuildingKind, FactionId, FleetView, RegionView, Resources, TurnView } from './types';

const DATES = ['1592년 5월 상순', '1592년 5월 중순', '1592년 5월 하순', '1592년 6월 상순', '1592년 6월 중순', '1592년 6월 하순'];

function power(f: FleetView) {
  return Math.round(
    f.ships.reduce(
      (a, s) =>
        a + (s.kind === 'geobukseon' ? 160 : s.kind === 'panokseon' ? 100 : s.kind === 'atakebune' ? 85 : 55) * (0.4 + 0.6 * s.hull) * (0.5 + 0.5 * s.crew),
      0,
    ),
  );
}

function previewOf(attackers: FleetView[], target: RegionView, defenders: FleetView[]): BattlePreviewView {
  const a = attackers[0]!;
  const d = defenders[0];
  const aShips = attackers.flatMap((f) => f.ships);
  const dShips = defenders.flatMap((f) => f.ships);
  const battery = target.buildings.find((b) => b.kind === 'battery')?.level ?? 0;
  const aPower = attackers.reduce((s, f) => s + power(f), 0);
  const dPower = Math.round((defenders.reduce((s, f) => s + power(f), 0) + target.garrison * 0.25) * (1 + battery * 0.12));
  const winChance = Math.min(0.97, Math.max(0.03, 0.5 + (aPower - dPower) / (2.4 * (aPower + dPower))));
  const kinds = new Set(aShips.map((s) => SHIP_NAME[s.kind]));
  return {
    regionId: target.id,
    regionName: target.name,
    attacker: {
      faction: a.faction,
      name: attackers.map((f) => f.name).join(' + '),
      ships: aShips.length,
      crew: aShips.length * 130,
      power: aPower,
      bonuses: kinds.has('거북선') ? ['거북선 돌격 +10%'] : [],
    },
    defender: {
      faction: d?.faction ?? target.owner ?? 'japan',
      name: d?.name ?? `${target.name} 수비대`,
      ships: dShips.length,
      crew: dShips.length * 140 + target.garrison,
      power: dPower,
      bonuses: battery ? [`포대 ${battery}단계 +${battery * 12}%`] : [],
    },
    winChance,
    notes: ['좁은 해역: 대형 함선의 기동이 제한됩니다', '남서풍 약함 · 파고 낮음'],
  };
}

/** Faction campaign screens on mock data, reachable with ?granddemo=1. `gs` presets a state for screenshots: pick, map, region, fleet, battle. */
export function GrandDemo() {
  const params = new URLSearchParams(location.search);
  const preset = params.get('gs') ?? 'pick';
  const [me, setMe] = useState<FactionId>('joseon');
  const [stage, setStage] = useState<'pick' | 'map'>(preset === 'pick' ? 'pick' : 'map');
  const [regions, setRegions] = useState<RegionView[]>(() => makeRegions());
  const [fleets, setFleets] = useState<FleetView[]>(START_FLEETS);
  const [stock, setStock] = useState<Resources>(START_TREASURY.stock);
  const [turn, setTurn] = useState(1);
  const [regionId, setRegionId] = useState<string | null>(preset === 'region' ? 'yeosu' : preset === 'fleet' || preset === 'battle' ? 'hansan' : null);
  const [fleetId, setFleetId] = useState<string | null>(preset === 'fleet' || preset === 'battle' ? 'f-left' : null);
  const [moving, setMoving] = useState(preset === 'battle');
  const [battle, setBattle] = useState<BattlePreviewView | null>(() => {
    if (preset !== 'battle') return null;
    const rs = makeRegions();
    const target = rs.find((r) => r.id === 'okpo')!;
    return previewOf(
      START_FLEETS.filter((f) => f.at === 'hansan'),
      target,
      START_FLEETS.filter((f) => f.at === 'okpo'),
    );
  });
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const view = useMemo(() => regions.map((r) => refreshBuildings(r, stock, me)), [regions, stock, me]);
  const region = view.find((r) => r.id === regionId) ?? null;
  const fleet = fleets.find((f) => f.id === fleetId) ?? null;
  const insets = useMapInsets(!!(region || fleet));
  const moveTargets = useMemo(() => (moving && fleet ? view.find((r) => r.id === fleet.at)?.adj : undefined), [moving, fleet, view]);

  const say = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 2200);
  }, []);

  const turnView: TurnView = { turn, date: DATES[Math.min(DATES.length - 1, turn - 1)]!, faction: me };
  const flyTo = (id: string) => setFocus((f) => ({ id, nonce: (f?.nonce ?? 0) + 1 }));

  const selectRegion = (id: string) => {
    if (moving && fleet) {
      const target = view.find((r) => r.id === id)!;
      if (!moveTargets?.includes(id)) return;
      const enemy = target.owner !== me && target.owner !== null;
      const enemyFleets = fleets.filter((f) => f.at === id && f.faction !== me);
      if (enemy || enemyFleets.length) {
        const mates = fleets.filter((f) => f.at === fleet.at && f.faction === me);
        setBattle(previewOf(mates.includes(fleet) ? [fleet, ...mates.filter((f) => f !== fleet && !f.moveTo)] : [fleet], target, enemyFleets));
        return;
      }
      setFleets((fs) => fs.map((f) => (f.id === fleet.id ? { ...f, moveTo: id } : f)));
      setMoving(false);
      say(`${fleet.name}: ${target.name}으로 이동 명령`);
      return;
    }
    setRegionId(id);
    setFleetId(null);
    flyTo(id);
  };

  const selectFleet = (id: string) => {
    const f = fleets.find((x) => x.id === id);
    if (!f) return;
    setFleetId(id);
    setRegionId(f.at);
    setMoving(false);
    flyTo(f.at);
  };

  const build = (rid: string, kind: BuildingKind) => {
    const r = view.find((x) => x.id === rid)!;
    const b = r.buildings.find((x) => x.kind === kind)!;
    setStock((s) => {
      const next = { ...s };
      for (const [k, v] of Object.entries(b.cost) as [keyof Resources, number][]) next[k] -= v;
      return next;
    });
    setRegions((rs) => rs.map((x) => (x.id === rid ? { ...x, queue: [...x.queue, queueItem(kind, b.level + 1, b.turns)] } : x)));
  };

  const cancelBuild = (rid: string, qid: string) => {
    const r = regions.find((x) => x.id === rid)!;
    const item = r.queue.find((q) => q.id === qid);
    setRegions((rs) => rs.map((x) => (x.id === rid ? { ...x, queue: x.queue.filter((q) => q.id !== qid) } : x)));
    if (item) say('건설을 취소했습니다. 자원의 절반을 돌려받습니다.');
  };

  const endTurn = () => {
    setTurn((t) => t + 1);
    setStock((s) => ({
      gold: s.gold + START_TREASURY.income.gold,
      wood: s.wood + START_TREASURY.income.wood,
      powder: s.powder + START_TREASURY.income.powder,
      food: s.food + START_TREASURY.income.food,
    }));
    setRegions((rs) =>
      rs.map((r) => {
        if (!r.queue.length) return r;
        const buildings = r.buildings.map((b) => {
          const done = r.queue.find((q) => q.kind === b.kind && q.turnsLeft <= 1);
          return done ? { ...b, level: done.toLevel } : b;
        });
        return { ...r, buildings, queue: r.queue.filter((q) => q.turnsLeft > 1).map((q) => ({ ...q, turnsLeft: q.turnsLeft - 1 })) };
      }),
    );
    setFleets((fs) =>
      fs.map((f) => {
        if (!f.moveTo) return f;
        const dest = regions.find((r) => r.id === f.moveTo);
        const hostile = dest && dest.owner !== f.faction && dest.owner !== null;
        return hostile ? f : { ...f, at: f.moveTo, moveTo: undefined };
      }),
    );
    setMoving(false);
  };

  const merge = (aId: string, bId: string) => {
    setFleets((fs) => {
      const a = fs.find((f) => f.id === aId)!;
      const b = fs.find((f) => f.id === bId)!;
      return fs.filter((f) => f.id !== bId).map((f) => (f.id === aId ? { ...f, ships: [...a.ships, ...b.ships] } : f));
    });
    say('함대를 합쳤습니다.');
  };

  const split = (id: string, shipIds: string[]) => {
    setFleets((fs) => {
      const a = fs.find((f) => f.id === id)!;
      const moved = a.ships.filter((s) => shipIds.includes(s.id));
      const rest = a.ships.filter((s) => !shipIds.includes(s.id));
      const child: FleetView = { id: `${id}-${fs.length}`, faction: a.faction, name: `${a.name} 분견대`, at: a.at, ships: moved };
      return [...fs.map((f) => (f.id === id ? { ...f, ships: rest } : f)), child];
    });
    say('분견대를 편성했습니다.');
  };

  if (stage === 'pick') {
    return (
      <div className="grand">
        <FactionPick
          options={FACTION_OPTIONS}
          initial={me}
          onPick={(id) => {
            setMe(id);
            setStage('map');
          }}
        />
      </div>
    );
  }

  const here = region ? fleets.filter((f) => f.at === region.id) : [];
  const mergeWith = fleet ? fleets.filter((f) => f.at === fleet.at && f.faction === fleet.faction && f.id !== fleet.id) : [];

  return (
    <div className="grand">
      <GrandMap
        regions={view}
        fleets={fleets}
        me={me}
        selectedRegionId={regionId}
        selectedFleetId={fleetId}
        moveTargets={moveTargets}
        insets={insets}
        focus={focus}
        onSelectRegion={selectRegion}
        onSelectFleet={selectFleet}
        onBackground={() => {
          if (moving) return;
          setRegionId(null);
          setFleetId(null);
        }}
      />
      <TopBar turn={turnView} treasury={{ stock, income: START_TREASURY.income }} onEndTurn={endTurn} onMenu={() => setStage('pick')} />
      <div className="g-dock">
        {fleet ? (
          <FleetPanel
            key={fleet.id + fleet.ships.length}
            fleet={fleet}
            regionName={view.find((r) => r.id === fleet.at)?.name ?? ''}
            me={me}
            moving={moving}
            mergeWith={mergeWith}
            onClose={() => {
              setFleetId(null);
              setMoving(false);
            }}
            onMove={() => setMoving(true)}
            onCancelMove={() => setMoving(false)}
            onMerge={merge}
            onSplit={split}
          />
        ) : region ? (
          <RegionPanel
            region={region}
            fleets={here}
            me={me}
            onClose={() => setRegionId(null)}
            onBuild={build}
            onCancelBuild={cancelBuild}
            onSelectFleet={selectFleet}
          />
        ) : null}
      </div>
      {battle && (
        <BattlePreview
          battle={battle}
          onCancel={() => setBattle(null)}
          onFight={() => {
            setBattle(null);
            setMoving(false);
            say('전투 개시: 3D 해전 화면으로 이동합니다 (데모)');
          }}
          onAuto={() => {
            setBattle(null);
            setMoving(false);
            say(`자동 전투 결과: ${battle.winChance > 0.5 ? '승리' : '패배'} (데모)`);
          }}
        />
      )}
      {toast && (
        <div className="g-glass g-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
