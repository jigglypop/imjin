import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { ConquestSetup } from './game/Engine';
import { net } from './net/NetClient';
import { NetBattle } from './net/NetBattle';
import { OnlinePanel } from './ui/OnlinePanel';
import { setFatal, setLoading, setOrigin, setScreen, useUi } from './state/store';
import { SCENARIOS, type ScenarioId } from './sim/scenarios';
import type { Faction } from './sim/types';
import { sound } from './audio/Sound';
import { fleetSpawn, useCampaign } from './campaign/campaign';
import { isPhone, isTouchDevice } from './game/device';
import { useCompactLayout } from './ui/useCompactLayout';
import { ConquestSetupPanel } from './ui/ConquestSetup';
import { HistoryScreen } from './ui/HistoryScreen';
import { ErrorBoundary, FatalNotice } from './ui/ErrorBoundary';
import { Loading } from './ui/Loading';
import { FactionScreen, MainMenu, ScreenFrame, SettingsScreen } from './ui/Screens';
import { startScenario, urlLaunch, type Launch, type LaunchBody } from './ui/launch';

// The battle (three.js, engine, HUD) is its own chunk: the menu paints without parsing it.
const loadBattle = () => import('./ui/BattleView');
const BattleView = lazy(loadBattle);

let seq = 1;
// Test hooks (?scenario=, ?conquest=) skip the menu and boot straight into the battle.
const firstLaunch = urlLaunch();
useUi.setState({ screen: firstLaunch ? 'battle' : 'menu' });

export function App() {
  const screen = useUi((s) => s.screen);
  const fatal = useUi((s) => s.fatal);
  const compact = useCompactLayout();
  const [launch, setLaunch] = useState<Launch | null>(firstLaunch);
  const lastScenario = useRef<ScenarioId>(startScenario);

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

  const begin = (next: LaunchBody, text: string, scenario?: ScenarioId) => {
    sound.click();
    sound.setMode('battle');
    setFatal(null);
    setScreen('battle');
    if (!launch) setLoading(text, 0.01, scenario);
    setLaunch({ ...next, seq: ++seq });
  };

  const startConquest = (setup: ConquestSetup, remote?: NetBattle) => {
    setOrigin(remote ? 'online' : 'skirmish');
    begin({ kind: 'conquest', setup, remote }, '쟁탈전 준비 중');
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
      begin({ kind: 'scenario', id, faction: msg.seats[msg.you]!.faction, remote }, `${SCENARIOS[id].title} 준비 중`, id);
    };
    return () => {
      net.onStart = null;
    };
  });

  const startHistory = (id: ScenarioId, campaignMode: boolean, faction: Faction) => {
    const campaign = useCampaign.getState().campaign;
    const spawn = campaignMode && campaign ? fleetSpawn(campaign) : undefined;
    lastScenario.current = id;
    setOrigin('select');
    begin({ kind: 'scenario', id, faction: spawn ? 'joseon' : faction, campaign: spawn }, `${SCENARIOS[id].title} 준비 중`, id);
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
      {screen === 'faction' && <FactionScreen />}
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
