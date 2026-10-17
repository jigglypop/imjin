import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ConquestSetup } from './game/Engine';
import type { RegionBattle } from './sim/grand/bridge';
import { net, useNet } from './net/NetClient';
import { NetBattle } from './net/NetBattle';
import { setFatal, setLoading, setOrigin, setScreen, useUi } from './state/store';
import { SCENARIOS, type ScenarioId } from './sim/scenarios';
import type { Faction } from './sim/types';
import { sound } from './audio/Sound';
import { t, useLang } from './i18n';
import { fleetSpawn, useCampaign } from './campaign/campaign';
import { isIOS, isPhone, isTouchDevice } from './game/device';
import { installTouchGuard } from './game/ios';
import { battleReady, clearLoading, markLoading, recovery, type ResumeLaunch } from './game/recovery';
import { useCompactLayout } from './ui/useCompactLayout';
import { ErrorBoundary, FatalNotice } from './ui/ErrorBoundary';
import { Loading } from './ui/Loading';
import { RecoveryNotice } from './ui/RecoveryNotice';
import { MainMenu, ScreenFrame, SettingsScreen } from './ui/Screens';
import { launchInfo, startScenario, urlLaunch, type Launch, type LaunchBody } from './ui/launch';
import { screenChunks, startRouter } from './router';

// The battle (three.js, engine, HUD) is its own chunk: the menu paints without parsing it. So is each screen below the
// menu (router.ts lists them).
const loadBattle = () => import('./ui/BattleView');
const BattleView = lazy(loadBattle);
const GrandScreen = lazy(() => screenChunks.faction().then((m) => ({ default: m.GrandScreen })));
const HistoryScreen = lazy(() => screenChunks.select().then((m) => ({ default: m.HistoryScreen })));
const ConquestSetupPanel = lazy(() => screenChunks.skirmish().then((m) => ({ default: m.ConquestSetupPanel })));
const OnlinePanel = lazy(() => screenChunks.online().then((m) => ({ default: m.OnlinePanel })));
const CodexScreen = lazy(() => screenChunks.codex().then((m) => ({ default: m.CodexScreen })));
const GeneralsScreen = lazy(() => screenChunks.generals().then((m) => ({ default: m.GeneralsScreen })));

/**
 * Code from a chunk of its own. A screen that draws its own frame shows an empty frame with its title until the code
 * arrives, so the header and the back button are there at once; a panel inside a frame shows nothing meanwhile. If the
 * chunk cannot be fetched that stays, and the back button still works. (An empty fragment rather than null: without a
 * fallback the error boundary reports a fatal battle notice.)
 */
function Chunk({ frame, children }: { frame?: string; children: ReactNode }) {
  const standIn = frame ? <ScreenFrame title={frame} /> : <></>;
  return (
    <ErrorBoundary fallback={standIn}>
      <Suspense fallback={standIn}>{children}</Suspense>
    </ErrorBoundary>
  );
}

let seq = 1;

/** The part of a launch that can be started again after a crash. Multiplayer, campaign and faction battles cannot. */
function resumable(body: LaunchBody): ResumeLaunch | undefined {
  if (body.kind === 'scenario' && !body.remote && !body.campaign) return { kind: 'scenario', id: body.id, faction: body.faction };
  if (body.kind === 'conquest' && !body.remote) return { kind: 'conquest', setup: body.setup };
  return undefined;
}

// A battle that starts loading leaves a marker; reaching ready (the loading screen going away without a fatal notice)
// removes it. If the page is killed in between, the next startup finds the marker (see recovery.ts).
useUi.subscribe((state, previous) => {
  if (state.fatal && !previous.fatal) clearLoading();
  if (previous.loading !== null && state.loading === null) {
    // BattleView clears the loading text just before it reports a failure, so look again once that has been set.
    window.setTimeout(() => {
      if (useUi.getState().fatal) return;
      battleReady();
      sound.allowSamples();
    }, 0);
  }
});
if (isIOS) installTouchGuard();

// The address opens its screen (/campaign, /en/conquest); test hooks (?scenario=, ?conquest=) skip the menu and boot
// straight into the battle, whose loading page names it and shows its picture from the first frame.
const firstLaunch = urlLaunch();
startRouter(!!firstLaunch);
if (firstLaunch) {
  markLoading(resumable(firstLaunch));
  setLoading(t('바다를 준비하는 중'), 0, launchInfo(firstLaunch));
}

export function App() {
  // A language switch redraws every screen, including parts that call t() directly.
  useLang();
  const screen = useUi((s) => s.screen);
  const fatal = useUi((s) => s.fatal);
  const compact = useCompactLayout();
  const [launch, setLaunch] = useState<Launch | null>(firstLaunch);
  const lastScenario = useRef<ScenarioId>(startScenario);
  const [notice, setNotice] = useState(recovery.step > 0);

  // Fetch the battle chunk in the background once a screen that can start a battle opens.
  // The menu itself stays light, and phones wait until a mode is chosen.
  useEffect(() => {
    if (screen === 'menu' || screen === 'battle' || screen === 'settings' || screen === 'codex' || screen === 'generals') return;
    void loadBattle();
  }, [screen]);
  useEffect(() => {
    if (isPhone) return;
    const id = window.setTimeout(() => void loadBattle(), 2500);
    return () => window.clearTimeout(id);
  }, []);

  // Walking away from the online screen gives up the queue and the seat; otherwise the match would start mid-menu.
  const lastScreen = useRef(screen);
  useEffect(() => {
    const from = lastScreen.current;
    lastScreen.current = screen;
    if (from !== 'online' || screen === 'online' || screen === 'battle') return;
    const { room, quick, rankedQueue } = useNet.getState();
    if (quick) net.send({ t: 'quickCancel' });
    if (rankedQueue) net.rankedCancel();
    if (room || quick || rankedQueue) net.send({ t: 'leave' });
  }, [screen]);

  const begin = (next: LaunchBody, text: string) => {
    sound.click();
    sound.setMode('battle');
    markLoading(resumable(next));
    setNotice(false);
    setFatal(null);
    setScreen('battle');
    // The loading page shows the new battle at once, also when the engine of an earlier battle is still mounted.
    setLoading(text, 0.01, launchInfo(next));
    setLaunch({ ...next, seq: ++seq });
  };

  const startConquest = (setup: ConquestSetup, remote?: NetBattle) => {
    setOrigin(remote ? 'online' : 'skirmish');
    begin({ kind: 'conquest', setup, remote }, t('쟁탈전 준비 중'));
  };

  // The server says when a multiplayer battle starts; the engine then draws the server's battle: a conquest map, or
  // a historical scenario fought as a duel.
  useEffect(() => {
    net.onStart = (msg) => {
      // A battle resumed after a reload never opened the online screen: its chunk also mounts the overlay that shows
      // the connection and the end of the battle.
      void screenChunks.online();
      const remote = new NetBattle(msg.seed, msg.you);
      if (msg.battle.kind === 'conquest') {
        startConquest({ map: msg.battle.map, seats: msg.seats, you: msg.you, seed: msg.seed, ranked: !!msg.ranked }, remote);
        return;
      }
      const id = msg.battle.id;
      setOrigin('online');
      begin({ kind: 'scenario', id, faction: msg.seats[msg.you]!.faction, remote }, t('{name} 준비 중', { name: t(SCENARIOS[id].title) }));
    };
    return () => {
      net.onStart = null;
    };
  });

  const startGrandBattle = (battle: RegionBattle) => {
    setOrigin('faction');
    begin({ kind: 'grand', battle }, t('{name} 해전 준비 중', { name: t(battle.regionName) }));
  };

  const startHistory = (id: ScenarioId, campaignMode: boolean, faction: Faction) => {
    const campaign = useCampaign.getState().campaign;
    const spawn = campaignMode && campaign ? fleetSpawn(campaign) : undefined;
    lastScenario.current = id;
    setOrigin('select');
    begin({ kind: 'scenario', id, faction: spawn ? 'joseon' : faction, campaign: spawn }, t('{name} 준비 중', { name: t(SCENARIOS[id].title) }));
  };

  const resume = recovery.resume;
  const resumeBattle = () => {
    if (resume?.kind === 'scenario') startHistory(resume.id, false, resume.faction);
    else if (resume?.kind === 'conquest') startConquest(resume.setup);
  };

  return (
    <div className={`app ${compact ? 'app--compact' : ''} ${isTouchDevice ? 'app--touch' : ''}`}>
      {launch && (
        <ErrorBoundary>
          <Suspense fallback={null}>
            <BattleView launch={launch} />
          </Suspense>
        </ErrorBoundary>
      )}
      {screen === 'menu' && <MainMenu />}
      {screen === 'select' && (
        <Chunk frame="역사 전투">
          <HistoryScreen initial={lastScenario.current} onStart={startHistory} />
        </Chunk>
      )}
      {screen === 'faction' && (
        <Chunk frame="캠페인">
          <GrandScreen onBattle={startGrandBattle} />
        </Chunk>
      )}
      {screen === 'skirmish' && (
        <ScreenFrame title="쟁탈전">
          <Chunk>
            <ConquestSetupPanel onStart={startConquest} />
          </Chunk>
        </ScreenFrame>
      )}
      {screen === 'online' && (
        <ScreenFrame title="온라인 대전">
          <Chunk>
            <OnlinePanel />
          </Chunk>
        </ScreenFrame>
      )}
      {screen === 'settings' && <SettingsScreen />}
      {screen === 'codex' && (
        <Chunk frame="함선 도감">
          <CodexScreen />
        </Chunk>
      )}
      {screen === 'generals' && (
        <Chunk frame="장수">
          <GeneralsScreen />
        </Chunk>
      )}
      {launch && <Loading />}
      {notice && <RecoveryNotice onResume={resume ? resumeBattle : undefined} onClose={() => setNotice(false)} />}
      {fatal && (
        <FatalNotice
          message={fatal}
          onMenu={() => {
            // Drop the failed battle (boundary state, canvas, engine) so the next start mounts a fresh BattleView.
            setLaunch(null);
            setLoading(null);
            setFatal(null);
            setScreen('menu');
          }}
        />
      )}
    </div>
  );
}
