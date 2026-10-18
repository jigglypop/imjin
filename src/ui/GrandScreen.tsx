import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sound } from '../audio/Sound';
import { t, useLang } from '../i18n';
import { abandonGrand, autoResolveGrand, besiegeGrand, chooseGrandEvent, dismissBattle, dismissReplay, dismissReport, dispatchForces, endGrandTurn, grandOrders, guideSeen, markGuideSeen, mergeArrived, mergeFleets, prepareGrandBattle, showGrandTheatre, startGrand, useGrand, withdrawGrand } from '../campaign/grand';
import { factionsOf } from '../sim/grand/theatre';
import { mapTheatreId } from './grand/theatreChoice';
import type { RegionBattle } from '../sim/grand/bridge';
import type { BuildingKind as SimBuilding, Grand, RegionId, Result } from '../sim/grand/types';
import type { ShipKind } from '../sim/types';
import { setScreen } from '../state/store';
import { BattlePreview } from './grand/BattlePreview';
import { BattleResult, EventCard, GameOver, GrandMenu, Hub, StatusPanel, TurnSummary } from './grand/Dialogs';
import { FactionPick } from './grand/FactionPick';
import { FleetPanel } from './grand/FleetPanel';
import { GrandMap } from './grand/GrandMap';
import { CampaignOpening } from './grand/CampaignOpening';
import { CAMPAIGN_OPENINGS, openingSeen } from '../cinema/campaignOpenings';
import { filmsOn } from '../cinema/commanderIntros';
import type { CameraState } from './grand/worldCamera';
import { Guide, type GuideStepView } from './grand/Guide';
import { RegionPanel } from './grand/RegionPanel';
import { TopBar } from './grand/TopBar';
import { Commanders } from './grand/Commanders';
import { TechTree } from './grand/TechTree';
import { commanderCards, pointsWaiting, techTree } from './grand/adaptGrowth';
import {
  eventView,
  factionOptions,
  fleetViews,
  logLines,
  marchRouteView,
  moveTargets,
  objectiveView,
  officersFor,
  overView,
  plannedRoute,
  previewView,
  reachTurns,
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
import { tt, turnsText } from './grand/text';
import type { FactionId } from './grand/types';
import { REGIONS } from '../sim/grand/regions';
import { atWar } from '../sim/grand/world';
import { dispatchTargets } from '../sim/grand/dispatch';
import { FleetOrdersPanel, forceReady } from './grand/FleetOrdersPanel';
import { portClick } from './grand/clickTarget';

type Stage = 'hub' | 'pick' | 'map';

const toMenu = () => {
  sound.click();
  setScreen('menu');
};

const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The four steps of the first-turn guide (Korean source text); the screen fills in what each one points at. */
const GUIDE_STEPS: Omit<GuideStepView, 'target'>[] = [
  { title: '1. 포구 선택', text: '포구를 누르면 수비대·수입·시설이 보입니다. 표지 색은 주인 진영을 뜻합니다.' },
  { title: '2. 시설 건설', text: "군영·선소를 짓고 선소에서 함선을 주문합니다. '자동 건설'이 켜져 있으면 턴 끝에 알아서 짓습니다." },
  { title: '3. 함대 이동', text: "함대를 고르고 강조된 적 포구를 누르면 공격합니다. 우리 포구로는 '이동'을 누른 뒤 고릅니다." },
  { title: '4. 턴 종료', text: "명령을 마치면 '턴 종료'를 누릅니다. 한 턴은 석 달입니다." },
];
/** The third step under the march rules, where a fleet's range and its stops along the way are drawn on the map. */
const MARCH_GUIDE_STEP: Omit<GuideStepView, 'target'> = {
  title: '3. 함대 이동',
  text: "함대를 고르면 닿는 포구에 고리가 생깁니다. 적 포구나 함대를 누르면 공격하고, 우리 포구는 '이동'을 누른 뒤 고릅니다.",
};

/**
 * The faction campaign screen: continue or begin a war, then the strategic map with its panels. The campaign itself
 * lives in the store (campaign/grand.ts); this reads it through the adapters and gives orders through grandOrders.
 * A meeting the player decides to fight is handed to `onBattle`, which opens the 3D battle.
 */
export function GrandScreen({ onBattle }: { onBattle: (battle: RegionBattle) => void }) {
  const lang = useLang();
  const options = useMemo(() => factionOptions(), [lang]);
  const [stage, setStage] = useState<Stage>(() => {
    // The war of the theatre this page's map draws (the chapter in the address: /armada/campaign is the Armada's).
    showGrandTheatre(mapTheatreId());
    const s = useGrand.getState();
    // Coming back from a battle or an auto-resolve, the player is already in the war.
    if (!s.grand) return 'pick';
    return s.lastBattle || s.reported !== null ? 'map' : 'hub';
  });
  const grand = useGrand((s) => s.grand);

  return (
    // Names and sentences wrap between words, never inside them, and a long unbroken word still wraps.
    <div className="grand" style={{ wordBreak: 'keep-all', overflowWrap: 'break-word' }}>
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
          options={options}
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
  // The views below are built with text in the language set now, so they are built again when it changes.
  const lang = useLang();
  const lastBattle = useGrand((s) => s.lastBattle);
  const reported = useGrand((s) => s.reported);
  const replay = useGrand((s) => s.replay);
  const me: FactionId = g.player ?? factionsOf(g)[0]!;
  const [regionId, setRegionId] = useState<string | null>(null);
  const [fleetId, setFleetId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [pickedFleets, setPickedFleets] = useState<Set<string>>(new Set());
  const [pickedPorts, setPickedPorts] = useState<Set<string>>(new Set());
  const [mergeOnArrival, setMergeOnArrival] = useState(false);
  // March rules: a hostile port the selected fleet is sent to is blockaded rather than stormed.
  const [siegeOnArrival, setSiegeOnArrival] = useState(false);
  const arrivalMerge = useGrand((s) => s.arrivalMerge);
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [status, setStatus] = useState(false);
  const [menu, setMenu] = useState(false);
  const [roster, setRoster] = useState(false);
  const [techOpen, setTechOpen] = useState(false);
  const [previewHidden, setPreviewHidden] = useState(false);
  const [overSeen, setOverSeen] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [reduced] = useState(prefersReducedMotion);
  const [guideOn, setGuideOn] = useState(() => g.turn === 1 && g.phase === 'orders' && !guideSeen());
  // The war's opening film, the first time its campaign opens on this device (and from ?opening=1).
  const theatreId = (g.theatre ?? 'imjin') as keyof typeof CAMPAIGN_OPENINGS;
  const opening = CAMPAIGN_OPENINGS[theatreId] ?? null;
  const [filming, setFilming] = useState(() => {
    if (!opening) return false;
    const asked = typeof location !== 'undefined' && new URLSearchParams(location.search).get('opening') === '1';
    if (asked) return true;
    const automated = typeof navigator !== 'undefined' && navigator.webdriver;
    return !automated && filmsOn() && g.turn === 1 && g.phase === 'orders' && !openingSeen(theatreId);
  });
  const filmCam = useRef<((now: number) => CameraState | null) | null>(null);
  const [guideStep, setGuideStep] = useState(0);
  const toastTimer = useRef(0);

  // While the closed turn plays back, the map still shows the turn before: its fleets are drawn by the replay, and the
  // ports change colour when the clashes appear.
  const replayMovers = useMemo(() => new Set(replay?.moves.moves.map((m) => m.fleetId)), [replay]);
  const regions = useMemo(() => regionViews(replay && !flipped ? replay.before : g), [g, replay, flipped, lang]);
  const fleets = useMemo(() => {
    const all = fleetViews(replay ? replay.before : g);
    return replay ? all.filter((f) => !replayMovers.has(f.id)) : all;
  }, [g, replay, replayMovers, lang]);
  const replayData = useMemo(() => (replay ? replayView(replay.moves) : null), [replay]);
  useEffect(() => setFlipped(false), [replay]);
  const region = regions.find((r) => r.id === regionId) ?? null;
  const fleet = fleets.find((f) => f.id === fleetId) ?? null;
  const simFleet = g.fleets.find((f) => f.id === fleetId);
  const insets = useMapInsets(!!(region || fleet || batchOpen));
  const picked = pickedFleets.size + pickedPorts.size;
  // A batch needs no "choose destination" step: whatever is picked lights up the regions all of it can reach.
  const batchTargets = useMemo(() => (batchOpen && picked ? dispatchTargets(g, [...pickedFleets], [...pickedPorts] as RegionId[], me) : undefined), [batchOpen, picked, pickedFleets, pickedPorts, g, me]);
  // A ready fleet of ours that is selected strikes an enemy port with one click: those ports light up without the move mode.
  const reachable = useMemo(() => (!batchOpen && simFleet && simFleet.faction === me ? moveTargets(g, simFleet) : undefined), [batchOpen, simFleet, me, g]);
  const hostilePort = useCallback((id: string) => { const owner = g.regions[id as RegionId]?.owner; return !!owner && atWar(g, me, owner); }, [g, me]);
  // March rules: the turns to every port the fleet can reach, drawn as the coloured range, and its way there turn by turn.
  const reach = useMemo(() => (g.march && reachable && simFleet && !replay ? reachTurns(g, simFleet) : undefined), [g, reachable, simFleet, replay]);
  const route = useMemo(() => (g.march && simFleet && simFleet.faction === me && !batchOpen && !replay ? plannedRoute(g, simFleet) : null), [g, simFleet, me, batchOpen, replay]);
  const routeFor = useCallback((id: string) => (simFleet ? marchRouteView(g, simFleet, id as RegionId, siegeOnArrival) : null), [g, simFleet, siegeOnArrival]);
  // With the range drawn, only the enemy ports within this turn's sailing pulse; the farther ones still take a click.
  const strikes = useMemo(() => (reachable?.length && !moving ? reachable.filter((id) => hostilePort(id) && (!reach || reach[id]! <= 1)) : undefined), [reachable, moving, hostilePort, reach]);
  const targets = useMemo(() => (batchOpen ? batchTargets : moving ? reachable : strikes), [batchOpen, batchTargets, moving, reachable, strikes]);
  const pending = g.phase === 'battles' ? g.pending[0] : undefined;
  const eventCard = useMemo(() => (g.events.pending ? eventView(g) : null), [g, lang]);
  const turnReport = useMemo(() => (reported !== null ? turnReportView(g, reported) : null), [g, reported, lang]);
  const preview = useMemo(() => (pending ? previewView(g, pending.id) : null), [g, pending, lang]);
  const over = g.phase === 'over' ? overView(g) : null;

  const say = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const flyTo = (id: string) => setFocus((f) => ({ id, nonce: (f?.nonce ?? 0) + 1 }));
  const report = (res: Result, done?: string) => {
    say(res.ok ? (done ? t(done) : res.note ? tt(res.note, res.params) : t('명령을 내렸습니다')) : tt(res.reason, res.params));
    return res.ok;
  };
  /** An order that spends silver on works or ships: a click for it, and the guide's second step is done. */
  const ordered = (res: Result) => {
    const done = report(res);
    if (done) {
      sound.click();
      advanceGuide(1);
    }
    return done;
  };

  const selectRegion = (id: string, additive = false) => {
    // An own port is picked, not visited, when Shift/Ctrl/Cmd is held or when the open batch cannot sail there anyway.
    const port = regions.find((r) => r.id === id);
    if (port && port.owner === me && (additive || (batchOpen && !batchTargets?.includes(id as RegionId)))) {
      if (port.garrison > 0 || additive) { pickForces([], [id], true); return; }
    }
    if (batchOpen) {
      if (!picked) { say(t('먼저 출동할 함대나 수비대를 고르세요')); return; }
      if (!batchTargets?.length) { say(t('함께 갈 수 있는 목적지가 없습니다')); return; }
      if (!batchTargets.includes(id as RegionId)) { say(t('그곳으로 가는 안전한 항로가 없습니다')); return; }
      const res = dispatchForces([...pickedFleets], [...pickedPorts] as RegionId[], id as RegionId, mergeOnArrival);
      if (report(res)) { sound.campaign('move'); closePanels(); }
      return;
    }
    if (fleet) {
      const click = portClick({ moving, reachable: reachable ?? (moving ? [] : undefined), hostile: hostilePort(id), port: id });
      if (click === 'blocked') {
        say(t('그곳으로 가는 안전한 항로가 없습니다'));
        return;
      }
      if (click === 'order') {
        const siege = !!g.march && siegeOnArrival && hostilePort(id);
        const res = grandOrders.move(fleet.id, id as RegionId, siege);
        if (res.ok) {
          const dest = regions.find((r) => r.id === id)!;
          // Only a region of a faction at war with the player is attacked: an ally's port is simply entered.
          const turns = turnsText(Number(res.params?.turns) || 1);
          const vars = { fleet: fleet.name, place: dest.name, turns };
          say(siege ? t('{fleet}: {place|을/를} 봉쇄하러 갑니다 ({turns})', vars) : hostilePort(id) ? t('{fleet}: {place|을/를} 공격합니다 ({turns})', vars) : t('{fleet}: {place|으로/로} 이동합니다 ({turns})', vars));
          sound.campaign('move');
          setMoving(false);
          advanceGuide(2);
        } else say(tt(res.reason, res.params));
        return;
      }
    }
    setRegionId(id);
    setFleetId(null);
    flyTo(id);
  };

  const toggleFleet = (id: string) => setPickedFleets((set) => { const next = new Set(set); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const togglePort = (id: string) => setPickedPorts((set) => { const next = new Set(set); next.has(id) ? next.delete(id) : next.add(id); return next; });
  /**
   * Adds fleets and port garrisons to the batch (or takes them out again when `toggle` is set). Anything that cannot
   * sail is left out and said so; the batch opens even when nothing could be added. A drag-select hands its result here,
   * replacing the batch unless it is additive.
   */
  const pickForces = (fleetIds: readonly string[], portIds: readonly string[], toggle = false, replace = false) => {
    const ready = fleetIds.filter((id) => { const f = fleets.find((x) => x.id === id); return f && f.faction === me && forceReady(f); });
    const ports = portIds.filter((id) => regions.some((r) => r.id === id && r.owner === me && r.garrison > 0));
    if (!ready.length && !ports.length) { say(t('출동 가능한 병력이 없습니다')); return; }
    if (fleetIds.length !== 1 && fleetIds.length !== ready.length) say(t('정비 중이거나 항해 중인 함대는 제외했습니다'));
    setBatchOpen(true); setMoving(false); setFleetId(null); setRegionId(null);
    const add = (set: Set<string>, ids: readonly string[]) => {
      const next = new Set(set);
      for (const id of ids) (toggle && next.has(id) ? next.delete(id) : next.add(id));
      return next;
    };
    setPickedFleets((set) => add(replace ? new Set() : set, ready));
    setPickedPorts((set) => add(replace ? new Set() : set, ports));
  };
  const selectFleet = (id: string, additive = false) => {
    const f = fleets.find((x) => x.id === id);
    if (!f) return;
    if (batchOpen || additive) {
      if (f.faction !== me) say(t('우리 진영의 함대만 고를 수 있습니다'));
      else if (f.transit || !f.at) say(t('항해 중인 함대는 고를 수 없습니다'));
      else if (f.rest > 0) say(t('정비 중인 함대는 고를 수 없습니다'));
      else pickForces([id], [], true);
      return;
    }
    // March rules: with a fleet of ours selected, an enemy fleet is chased, into its port or along its lane.
    if (g.march && fleet && fleet.faction === me && fleet.rest === 0 && f.faction !== me && atWar(g, me, f.faction)) {
      const res = grandOrders.intercept(fleet.id, f.id);
      if (res.ok) {
        say(t('{fleet}: {target|을/를} 추격합니다 ({turns})', { fleet: fleet.name, target: f.name, turns: turnsText(Number(res.params?.turns) || 1) }));
        sound.campaign('move');
        setMoving(false);
      } else say(tt(res.reason, res.params));
      return;
    }
    if (id !== fleetId) setSiegeOnArrival(!!f.march?.besieging);
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
    setBatchOpen(false);
    setPickedFleets(new Set()); setPickedPorts(new Set());
  };

  // Esc ends the batch (or a move being aimed), unless a dialog is on top of the map.
  const dialogOpen = status || menu || !!lastBattle || !!replay || !!pending || !!g.events.pending;
  useEffect(() => {
    if (dialogOpen || !(batchOpen || moving)) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closePanels();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Fleets sent with "merge on arrival" join once they lie together in port, as soon as the closed turn has played back.
  useEffect(() => {
    if (replay || g.phase !== 'orders' || g.events.pending) return;
    const n = mergeArrived();
    if (n) say(t('도착한 함대 {n}개를 합쳤습니다', { n }));
  }, [g, replay, arrivalMerge, say]);

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
  const homeId = Object.values(REGIONS).find((r) => r.capitalOf === me)?.id;
  const homeNode = homeId ? `.gm-node[data-region="${homeId}"] .gm-node__disc` : undefined;
  const guideTargets = [
    homeNode,
    region && region.owner === me ? '[data-guide="build"]' : homeNode,
    fleet && fleet.faction === me ? (moving ? undefined : '[data-guide="move"]') : '.gm-fleet:not(.gm-fleet--foreign) .gm-fleet__pill',
    '.g-top__end',
  ];
  const guideSteps: GuideStepView[] = GUIDE_STEPS.map((st, i) => (g.march && i === 2 ? MARCH_GUIDE_STEP : st)).map((st, i) => ({ title: t(st.title), text: t(st.text), target: guideTargets[i] }));
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
      {filming && opening && <CampaignOpening opening={opening} film={filmCam} onDone={() => setFilming(false)} />}
      <GrandMap
        film={filmCam}
        regions={regions}
        fleets={fleets}
        me={me}
        selectedRegionId={regionId}
        selectedFleetId={fleetId}
        selectedFleetIds={batchOpen ? pickedFleets : undefined}
        moveTargets={targets}
        reach={reach}
        route={route}
        routeFor={g.march && reach ? routeFor : undefined}
        insets={insets}
        focus={focus}
        onSelectRegion={selectRegion}
        onSelectFleet={selectFleet}
        onBoxSelect={(fleetIds, portIds, additive) => pickForces(fleetIds, portIds, false, !additive)}
        onBackground={() => {
          // A stray click on the sea must not lose a batch the player took time to pick: it ends with Esc or its own buttons.
          if (!moving && !batchOpen) closePanels();
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
        onCommanders={g.growth ? () => { sound.click(); setRoster(true); } : undefined}
        onTech={g.growth ? () => { sound.click(); setTechOpen(true); } : undefined}
        points={g.growth ? pointsWaiting(g, me) : 0}
        autoWorks={!!g.autoWorks}
        onAutoWorks={g.phase === 'orders' ? (on) => { sound.click(); report(grandOrders.autoWorks(on), on ? '자동 건설을 켰습니다' : '자동 건설을 껐습니다'); } : undefined}
        onBatch={g.phase === 'orders' ? () => { closePanels(); setBatchOpen(true); } : undefined}
        busy={g.phase === 'over' || !!replay || !!g.events.pending}
        endLabel={g.phase === 'battles' ? t('전투 {n}건', { n: g.pending.length }) : t('턴 종료')}
      />
      <div className="g-dock">
        {batchOpen ? <FleetOrdersPanel fleets={fleets.filter((f) => f.faction === me)} ports={regions.filter((p) => p.owner === me && p.garrison > 0)} selectedFleets={pickedFleets} selectedPorts={pickedPorts} mergeOnArrival={mergeOnArrival} noRoute={picked > 0 && !batchTargets?.length} onFleet={toggleFleet} onPort={togglePort} onAll={(all) => {
          setPickedFleets(new Set(all ? fleets.filter((f) => f.faction === me && forceReady(f)).map((f) => f.id) : []));
          setPickedPorts(new Set(all ? regions.filter((p) => p.owner === me && p.garrison > 0).map((p) => p.id) : []));
        }} onMergeOnArrival={setMergeOnArrival} onMergeAll={() => {
          const res = mergeFleets([...pickedFleets]);
          // Merged-away fleets are gone from the store; keep only the survivors picked.
          if (res.ok) setPickedFleets((set) => new Set([...set].filter((id) => useGrand.getState().grand?.fleets.some((f) => f.id === id))));
          report(res);
        }} onClose={closePanels} /> : fleet ? (
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
            onStop={(id) => report(grandOrders.stop(id), '이동 명령을 취소했습니다')}
            onMerge={(keep, other) => report(grandOrders.merge(keep, other), '함대를 합쳤습니다')}
            onSplit={(id, ships) => {
              const res = grandOrders.split(id, ships);
              if (res.ok && res.note) setFleetId(res.note);
              report(res, '함대를 나누었습니다');
            }}
            onCommander={(id, cmd) => report(grandOrders.commander(id, cmd), cmd ? '지휘관을 임명했습니다' : '지휘관을 해임했습니다')}
            onRefit={(id) => report(grandOrders.refit(id), '정비를 마쳤습니다')}
            nameOf={(id) => regions.find((r) => r.id === id)?.name ?? id}
            siegeOnArrival={siegeOnArrival}
            onSiegeOnArrival={(on) => {
              setSiegeOnArrival(on);
              // A fleet already bound for an enemy port changes how it arrives there at once.
              const dest = fleet.march?.dest;
              if (dest?.hostile && fleet.route.length) report(grandOrders.move(fleet.id, dest.id as RegionId, on), on ? '도착하면 봉쇄합니다' : '도착하면 공격합니다');
            }}
            onStance={(id, stance) => {
              sound.click();
              report(grandOrders.stance(id, stance), stance === 'march' ? '강행군으로 바꿨습니다' : '일반 항해로 바꿨습니다');
            }}
            onAssault={(id, on) => report(grandOrders.assault(id, on), on ? '턴을 마치면 포구를 강습합니다' : '봉쇄를 이어 갑니다')}
            onDisband={(id, ships) => {
              let sold = 0;
              for (const s of ships) {
                const res = grandOrders.disband(id, s);
                if (!res.ok) {
                  say(tt(res.reason, res.params));
                  break;
                }
                sold += 1;
              }
              if (sold) say(sold === 1 ? t('함선 1척을 해체했습니다') : t('함선 {n}척을 해체했습니다', { n: sold }));
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
            onCancelBuild={(id, kind) => report(grandOrders.cancelBuild(id as RegionId, kind as SimBuilding), '공사 취소 · 비용 환급')}
            onRecruit={(id, kind) => ordered(grandOrders.recruit(id as RegionId, kind as ShipKind))}
            onCancelRecruit={(id, item) => report(grandOrders.cancelRecruit(id as RegionId, item), '주문 취소 · 비용 환급')}
            onSelectFleet={selectFleet}
            onMergeAll={(ids) => report(mergeFleets(ids))}
            onMobilize={(id) => { const res = grandOrders.mobilize(id as RegionId); if (res.ok && res.note) { setFleetId(res.note); setRegionId(null); } report(res, '수비대가 출동했습니다'); }}
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
          battle={{ ...preview, notes: [...(preview.notes ?? []), ...(g.pending.length > 1 ? [t('이번 턴 전투 {n}건', { n: g.pending.length })] : [])] }}
          cancelLabel={t('나중에')}
          onCancel={() => setPreviewHidden(true)}
          onFight={fight}
          onAuto={() => {
            sound.click();
            autoResolveGrand(pending!.id);
          }}
          onBesiege={() => {
            sound.click();
            report(besiegeGrand(pending!.id), '봉쇄를 시작했습니다');
          }}
          onWithdraw={() => {
            sound.click();
            report(withdrawGrand(pending!.id), '함대가 물러났습니다');
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
      {roster && (
        <Commanders
          me={me}
          cards={commanderCards(g, me)}
          canOrder={g.phase === 'orders'}
          onLearn={(id, skill) => {
            sound.click();
            report(grandOrders.learn(id, skill));
          }}
          onAssign={(fleet, id) => report(grandOrders.commander(fleet, id), id ? '지휘관을 임명했습니다' : '지휘관을 해임했습니다')}
          onClose={() => setRoster(false)}
        />
      )}
      {techOpen && (
        <TechTree
          me={me}
          tree={techTree(g, me)}
          gold={g.factions[me].gold}
          canOrder={g.phase === 'orders'}
          onResearch={(id) => {
            sound.click();
            report(grandOrders.research(id));
          }}
          onCancel={() => report(grandOrders.cancelResearch())}
          onClose={() => setTechOpen(false)}
        />
      )}
      {guideOn && !guideHidden && !filming && <Guide step={guideStep} steps={guideSteps} onNext={nextGuide} onClose={closeGuide} />}
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
