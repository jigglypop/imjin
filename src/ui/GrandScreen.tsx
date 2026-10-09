import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sound } from '../audio/Sound';
import { abandonGrand, autoResolveGrand, chooseGrandEvent, dismissBattle, dismissReplay, dismissReport, endGrandTurn, grandOrders, guideSeen, markGuideSeen, prepareGrandBattle, startGrand, useGrand } from '../campaign/grand';
import type { RegionBattle } from '../sim/grand/bridge';
import type { BuildingKind as SimBuilding, Grand, GrandFaction, RegionId } from '../sim/grand/types';
import type { ShipKind } from '../sim/types';
import { setScreen } from '../state/store';
import { BattlePreview } from './grand/BattlePreview';
import { BattleResult, EventCard, GameOver, GrandMenu, Hub, StatusPanel, TurnSummary } from './grand/Dialogs';
import { FactionPick } from './grand/FactionPick';
import { FleetPanel } from './grand/FleetPanel';
import { GrandMap } from './grand/GrandMap';
import { Guide, type GuideStepView } from './grand/Guide';
import { RegionPanel } from './grand/RegionPanel';
import { TopBar } from './grand/TopBar';
import {
  FACTION_OPTIONS,
  eventView,
  fleetViews,
  logLines,
  moveTargets,
  objectiveView,
  officersFor,
  overView,
  previewView,
  regionViews,
  relationViews,
  replayView,
  resultView,
  routeText,
  saveView,
  scoreViews,
  treasuryView,
  turnReportView,
  turnView,
} from './grand/adapt';
import './grand/grand.css';
import { useMapInsets } from './grand/shared';
import type { FactionId } from './grand/types';
import { josa } from '../sim/grand/josa';
import { REGIONS } from '../sim/grand/regions';
import { atWar } from '../sim/grand/world';

type Stage = 'hub' | 'pick' | 'map';

const toMenu = () => {
  sound.click();
  setScreen('menu');
};

const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The four steps of the first-turn guide; the screen fills in what each one points at. */
const GUIDE_STEPS: Omit<GuideStepView, 'target'>[] = [
  { title: '1. 포구 선택', text: '지도의 포구를 눌러 보세요. 표지의 색은 그 포구를 가진 진영을 뜻합니다. 수비대와 수입, 시설을 확인할 수 있습니다.' },
  { title: '2. 시설 건설', text: '군영(수리, 유지비 면제)이나 선소(함선 건조)를 지어 보세요. 은은 바로 차감되고 몇 턴 뒤에 완공됩니다. 선소가 있으면 함선도 주문할 수 있습니다.' },
  { title: '3. 함대 이동', text: "함대 표지를 눌러 선택하고 '이동'을 누른 뒤, 강조된 포구를 누르세요. 적의 포구를 고르면 공격합니다." },
  { title: '4. 턴 종료', text: "명령을 마쳤다면 '턴 종료'를 누르세요. 한 턴은 석 달입니다. 적 함대의 움직임을 보여 드린 뒤 결과를 알려 드립니다." },
];

/**
 * The faction campaign screen: continue or begin a war, then the strategic map with its panels. The campaign itself
 * lives in the store (campaign/grand.ts); this reads it through the adapters and gives orders through grandOrders.
 * A meeting the player decides to fight is handed to `onBattle`, which opens the 3D battle.
 */
export function GrandScreen({ onBattle }: { onBattle: (battle: RegionBattle) => void }) {
  const [stage, setStage] = useState<Stage>(() => {
    const s = useGrand.getState();
    // Coming back from a battle or an auto-resolve, the player is already in the war.
    if (!s.grand) return 'pick';
    return s.lastBattle || s.reported !== null ? 'map' : 'hub';
  });
  const grand = useGrand((s) => s.grand);

  return (
    <div className="grand">
      {stage === 'hub' && grand ? (
        <Hub
          save={saveView(grand)}
          onContinue={() => setStage('map')}
          onNew={() => {
            abandonGrand();
            setStage('pick');
          }}
          onBack={toMenu}
        />
      ) : stage === 'map' && grand ? (
        <CampaignMap g={grand} onBattle={onBattle} onNew={() => setStage('pick')} />
      ) : (
        <FactionPick
          options={FACTION_OPTIONS}
          onBack={toMenu}
          onPick={(id, level) => {
            sound.click();
            startGrand(id, level);
            setStage('map');
          }}
        />
      )}
    </div>
  );
}

function CampaignMap({ g, onBattle, onNew }: { g: Grand; onBattle: (battle: RegionBattle) => void; onNew: () => void }) {
  const lastBattle = useGrand((s) => s.lastBattle);
  const reported = useGrand((s) => s.reported);
  const replay = useGrand((s) => s.replay);
  const me: FactionId = g.player ?? 'joseon';
  const [regionId, setRegionId] = useState<string | null>(null);
  const [fleetId, setFleetId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [status, setStatus] = useState(false);
  const [menu, setMenu] = useState(false);
  const [previewHidden, setPreviewHidden] = useState(false);
  const [overSeen, setOverSeen] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [reduced] = useState(prefersReducedMotion);
  const [guideOn, setGuideOn] = useState(() => g.turn === 1 && g.phase === 'orders' && !guideSeen());
  const [guideStep, setGuideStep] = useState(0);
  const toastTimer = useRef(0);

  // While the closed turn plays back, the map still shows the turn before: its fleets are drawn by the replay, and the
  // ports change colour when the clashes appear.
  const replayMovers = useMemo(() => new Set(replay?.moves.moves.map((m) => m.fleetId)), [replay]);
  const regions = useMemo(() => regionViews(replay && !flipped ? replay.before : g), [g, replay, flipped]);
  const fleets = useMemo(() => {
    const all = fleetViews(replay ? replay.before : g);
    return replay ? all.filter((f) => !replayMovers.has(f.id)) : all;
  }, [g, replay, replayMovers]);
  const replayData = useMemo(() => (replay ? replayView(replay.moves) : null), [replay]);
  useEffect(() => setFlipped(false), [replay]);
  const region = regions.find((r) => r.id === regionId) ?? null;
  const fleet = fleets.find((f) => f.id === fleetId) ?? null;
  const simFleet = g.fleets.find((f) => f.id === fleetId);
  const insets = useMapInsets(!!(region || fleet));
  const targets = useMemo(() => (moving && simFleet ? moveTargets(g, simFleet) : undefined), [moving, simFleet, g]);
  const pending = g.phase === 'battles' ? g.pending[0] : undefined;
  const eventCard = useMemo(() => (g.events.pending ? eventView(g) : null), [g]);
  const turnReport = useMemo(() => (reported !== null ? turnReportView(g, reported) : null), [g, reported]);
  const preview = useMemo(() => (pending ? previewView(g, pending.id) : null), [g, pending]);
  const over = g.phase === 'over' ? overView(g) : null;

  const say = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const flyTo = (id: string) => setFocus((f) => ({ id, nonce: (f?.nonce ?? 0) + 1 }));
  const report = (res: { ok: true; note?: string } | { ok: false; reason: string }, done?: string) => {
    say(res.ok ? (done ?? res.note ?? '명령을 내렸습니다') : res.reason);
    return res.ok;
  };
  /** An order that spends silver on works or ships: a click for it, and the guide's second step is done. */
  const ordered = (res: { ok: true; note?: string } | { ok: false; reason: string }) => {
    const done = report(res);
    if (done) {
      sound.click();
      advanceGuide(1);
    }
    return done;
  };

  const selectRegion = (id: string) => {
    if (moving && fleet) {
      if (targets && !targets.includes(id as RegionId)) {
        say('그곳으로 가는 안전한 항로가 없습니다.');
        return;
      }
      const res = grandOrders.move(fleet.id, id as RegionId);
      if (res.ok) {
        const dest = regions.find((r) => r.id === id)!;
        // Only a region of a faction at war with the player is attacked: an ally's port is simply entered.
        const hostile = dest.owner !== null && atWar(g, me, dest.owner as GrandFaction);
        say(`${fleet.name}: ${hostile ? `${josa(dest.name, '을/를')} 공격합니다` : `${josa(dest.name, '으로/로')} 이동합니다`} (${res.note ?? ''})`);
        sound.campaign('move');
        setMoving(false);
        advanceGuide(2);
      } else say(res.reason);
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
    setMoving(false);
    const place = f.at ?? f.transit?.from;
    setRegionId(place ?? null);
    if (place) flyTo(place);
  };

  const closePanels = () => {
    setRegionId(null);
    setFleetId(null);
    setMoving(false);
  };

  const endTurn = () => {
    if (g.phase === 'battles') {
      setPreviewHidden(false);
      return;
    }
    sound.campaign('endTurn');
    if (guideOn) closeGuide();
    closePanels();
    setToast(null);
    setPreviewHidden(false);
    endGrandTurn();
  };

  const fight = () => {
    if (!pending) return;
    const rb = prepareGrandBattle(pending.id);
    if (rb) {
      sound.campaign('battle');
      onBattle(rb);
    }
  };

  // The first-turn guide: each step moves on when the player does what it asks, or when they press 다음.
  const closeGuide = () => {
    markGuideSeen();
    setGuideOn(false);
  };
  const advanceGuide = (from: number) => setGuideStep((s) => (s === from ? from + 1 : s));
  const nextGuide = () => (guideStep >= GUIDE_STEPS.length - 1 ? closeGuide() : setGuideStep(guideStep + 1));
  useEffect(() => {
    if (guideOn && guideStep === 0 && region && region.owner === me) setGuideStep(1);
  }, [guideOn, guideStep, region, me]);
  const homeName = Object.values(REGIONS).find((r) => r.capitalOf === me)?.name;
  const homeNode = homeName ? `.gm-node[aria-label^="${homeName},"] .gm-node__disc` : undefined;
  const guideTargets = [
    homeNode,
    region && region.owner === me ? '[data-guide="build"]' : homeNode,
    fleet && fleet.faction === me ? (moving ? undefined : '[data-guide="move"]') : '.gm-fleet:not(.gm-fleet--foreign) .gm-fleet__pill',
    '.g-top__end',
  ];
  const guideSteps: GuideStepView[] = GUIDE_STEPS.map((st, i) => ({ ...st, target: guideTargets[i] }));
  const guideHidden = !!(replay || g.events.pending || status || menu || lastBattle || pending || over);

  // Sounds of the campaign's own beats: a finished work, the card of a turning point, the end of a fight or of the war.
  const builtNow = !replay && !g.events.pending && !!turnReport?.news.some((l) => l.tag === 'built');
  useEffect(() => {
    if (builtNow) sound.campaign('built');
  }, [builtNow, reported]);
  useEffect(() => {
    if (eventCard && !replay) sound.campaign('event');
  }, [eventCard?.id, !!replay]);
  useEffect(() => {
    if (lastBattle) sound.campaign(lastBattle.humanSide === null ? 'clash' : lastBattle.humanSide === lastBattle.winner ? 'victory' : 'defeat');
  }, [lastBattle]);
  useEffect(() => {
    if (over && !lastBattle) sound.campaign(over.won ? 'victory' : 'defeat');
  }, [over?.won, g.phase === 'over']);

  const gold = Math.round(g.factions[me].gold);
  const here = region ? fleets.filter((f) => f.at === region.id) : [];
  const mergeWith = fleet && fleet.at ? fleets.filter((f) => f.at === fleet.at && f.faction === fleet.faction && f.id !== fleet.id) : [];

  return (
    <>
      <GrandMap
        regions={regions}
        fleets={fleets}
        me={me}
        selectedRegionId={regionId}
        selectedFleetId={fleetId}
        moveTargets={targets}
        insets={insets}
        focus={focus}
        onSelectRegion={selectRegion}
        onSelectFleet={selectFleet}
        onBackground={() => {
          if (!moving) closePanels();
        }}
        replay={replayData}
        reducedMotion={reduced}
        onReplayPhase={(phase) => phase === 'clash' && setFlipped(true)}
        onReplayBeat={(kind) => sound.campaign(kind)}
        onReplayDone={() => {
          setFlipped(false);
          dismissReplay();
        }}
      />
      <TopBar
        turn={turnView(g)}
        treasury={treasuryView(g)}
        onEndTurn={endTurn}
        onMenu={() => setMenu(true)}
        onStatus={() => setStatus(true)}
        busy={g.phase === 'over' || !!replay || !!g.events.pending}
        endLabel={g.phase === 'battles' ? `전투 ${g.pending.length}건` : '턴 종료'}
      />
      <div className="g-dock">
        {fleet ? (
          <FleetPanel
            key={fleet.id + fleet.ships.length}
            fleet={fleet}
            regionName={regions.find((r) => r.id === fleet.at)?.name ?? ''}
            me={me}
            moving={moving}
            mergeWith={mergeWith}
            officers={fleet.faction === me ? officersFor(g, fleet.id) : []}
            routeText={simFleet ? routeText(g, simFleet) : undefined}
            gold={gold}
            onClose={closePanels}
            onMove={() => setMoving(true)}
            onCancelMove={() => setMoving(false)}
            onStop={(id) => report(grandOrders.stop(id), '명령을 취소했습니다')}
            onMerge={(keep, other) => report(grandOrders.merge(keep, other), '함대를 합쳤습니다')}
            onSplit={(id, ships) => {
              const res = grandOrders.split(id, ships);
              if (res.ok && res.note) setFleetId(res.note);
              report(res, '함대를 나누었습니다');
            }}
            onCommander={(id, cmd) => report(grandOrders.commander(id, cmd), cmd ? '지휘관을 임명했습니다' : '지휘관을 해임했습니다')}
            onRefit={(id) => report(grandOrders.refit(id), '정비를 마쳤습니다')}
            onDisband={(id, ships) => {
              let sold = 0;
              for (const s of ships) {
                const res = grandOrders.disband(id, s);
                if (!res.ok) {
                  say(res.reason);
                  break;
                }
                sold += 1;
              }
              if (sold) say(`함선 ${sold}척을 해체했습니다.`);
              if (!useGrand.getState().grand?.fleets.some((f) => f.id === id)) closePanels();
            }}
          />
        ) : region ? (
          <RegionPanel
            region={region}
            fleets={here}
            me={me}
            onClose={closePanels}
            onBuild={(id, kind) => ordered(grandOrders.build(id as RegionId, kind as SimBuilding))}
            onCancelBuild={(id, kind) => report(grandOrders.cancelBuild(id as RegionId, kind as SimBuilding), '공사를 취소하고 비용을 돌려받았습니다')}
            onRecruit={(id, kind) => ordered(grandOrders.recruit(id as RegionId, kind as ShipKind))}
            onCancelRecruit={(id, item) => report(grandOrders.cancelRecruit(id as RegionId, item), '주문을 취소하고 비용을 돌려받았습니다')}
            onSelectFleet={selectFleet}
          />
        ) : null}
      </div>

      {toast && (
        <div className="g-glass g-toast" role="status">
          {toast}
        </div>
      )}

      {preview && !previewHidden && !lastBattle && !replay && !eventCard && (
        <BattlePreview
          key={pending?.id}
          battle={{ ...preview, notes: [...(preview.notes ?? []), ...(g.pending.length > 1 ? [`이번 턴에 진행할 전투가 ${g.pending.length}건 있습니다.`] : [])] }}
          cancelLabel="나중에"
          onCancel={() => setPreviewHidden(true)}
          onFight={fight}
          onAuto={() => {
            sound.click();
            autoResolveGrand(pending!.id);
          }}
        />
      )}
      {lastBattle && <BattleResult result={resultView(lastBattle)} onClose={dismissBattle} />}
      {!lastBattle && !replay && eventCard && <EventCard event={eventCard} me={me} onChoose={(i) => chooseGrandEvent(i)} />}
      {!lastBattle && !replay && !eventCard && turnReport && !over && g.phase === 'orders' && <TurnSummary report={turnReport} onClose={dismissReport} />}
      {!lastBattle && !replay && over && !overSeen && (
        <GameOver
          over={over}
          me={me}
          onView={() => setOverSeen(true)}
          onNew={() => {
            abandonGrand();
            onNew();
          }}
          onMenu={toMenu}
        />
      )}
      {status && (
        <StatusPanel
          me={me}
          objective={objectiveView(g)}
          scores={scoreViews(g)}
          relations={relationViews(g)}
          log={logLines(g)}
          canOrder={g.phase === 'orders'}
          onAlliance={(other) => report(grandOrders.alliance(me, other))}
          onWar={(other) => report(grandOrders.declareWar(me, other), '동맹을 파기했습니다')}
          onClose={() => setStatus(false)}
        />
      )}
      {guideOn && !guideHidden && <Guide step={guideStep} steps={guideSteps} onNext={nextGuide} onClose={closeGuide} />}
      {menu && (
        <GrandMenu
          onClose={() => setMenu(false)}
          onStatus={() => {
            setMenu(false);
            setStatus(true);
          }}
          onLeave={toMenu}
          onAbandon={() => {
            abandonGrand();
            setMenu(false);
            onNew();
          }}
        />
      )}
    </>
  );
}
