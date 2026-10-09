import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { ConquestSetup } from './game/Engine';
import type { RegionBattle } from './sim/grand/bridge';
import { net, useNet } from './net/NetClient';
import { NetBattle } from './net/NetBattle';
import { OnlinePanel } from './ui/OnlinePanel';
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
import { ConquestSetupPanel } from './ui/ConquestSetup';
import { HistoryScreen } from './ui/HistoryScreen';
import { ErrorBoundary, FatalNotice } from './ui/ErrorBoundary';
import { Loading } from './ui/Loading';
import { RecoveryNotice } from './ui/RecoveryNotice';
import { MainMenu, ScreenFrame, SettingsScreen } from './ui/Screens';
import { startScenario, urlLaunch, type Launch, type LaunchBody } from './ui/launch';
import { GrandScreen } from './ui/GrandScreen';

// The battle (three.js, engine, HUD) is its own chunk: the menu paints without parsing it.
const loadBattle = () => import('./ui/BattleView');
const BattleView = lazy(loadBattle);

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

// Test hooks (?scenario=, ?conquest=) skip the menu and boot straight into the battle.
const firstLaunch = urlLaunch();
useUi.setState({ screen: firstLaunch ? 'battle' : 'menu' });
if (firstLaunch) markLoading(resumable(firstLaunch));

export function App() {
  const lang = useLang();
  const screen = useUi((s) => s.screen);
  const fatal = useUi((s) => s.fatal);
  const compact = useCompactLayout();
  const [launch, setLaunch] = useState<Launch | null>(firstLaunch);
  const lastScenario = useRef<ScenarioId>(startScenario);
  const [notice, setNotice] = useState(recovery.step > 0);

  // The page title, the description and the home-screen name follow the language.
  useEffect(() => {
    document.title = t('임진 해전');
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('1592, 조선 수군의 바다. 3D 해전 전략 게임.'));
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', t('임진 해전'));
  }, [lang]);

  // Fetch the battle chunk in the background once a screen that can start a battle opens.
  // The menu itself stays light, and phones wait until a mode is chosen.
  useEffect(() => {
    if (screen === 'menu' || screen === 'battle' || screen === 'settings') return;
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
    const { room, quick } = useNet.getState();
    if (quick) net.send({ t: 'quickCancel' });
    if (room) net.send({ t: 'leave' });
  }, [screen]);

  const begin = (next: LaunchBody, text: string, scenario?: ScenarioId) => {
    sound.click();
    sound.setMode('battle');
    markLoading(resumable(next));
    setNotice(false);
    setFatal(null);
    setScreen('battle');
    if (!launch) setLoading(text, 0.01, scenario);
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
      const remote = new NetBattle(msg.seed, msg.you);
      if (msg.battle.kind === 'conquest') {
        startConquest({ map: msg.battle.map, seats: msg.seats, you: msg.you, seed: msg.seed }, remote);
        return;
      }
      const id = msg.battle.id;
      setOrigin('online');
      begin({ kind: 'scenario', id, faction: msg.seats[msg.you]!.faction, remote }, t('{name} 준비 중', { name: t(SCENARIOS[id].title) }), id);
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
    begin({ kind: 'scenario', id, faction: spawn ? 'joseon' : faction, campaign: spawn }, t('{name} 준비 중', { name: t(SCENARIOS[id].title) }), id);
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
      {screen === 'select' && <HistoryScreen initial={lastScenario.current} onStart={startHistory} />}
      {screen === 'faction' && <GrandScreen onBattle={startGrandBattle} />}
      {screen === 'skirmish' && (
        <ScreenFrame title="쟁탈전">
          <ConquestSetupPanel onStart={startConquest} />
        </ScreenFrame>
      )}
      {screen === 'online' && (
        <ScreenFrame title="온라인 대전">
          <OnlinePanel />
        </ScreenFrame>
      )}
      {screen === 'settings' && <SettingsScreen />}
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
