import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { PerspectiveCamera, WebGPURenderer } from 'three/webgpu';
import { Engine, type EngineOptions } from './game/Engine';
import { SKY_PRESETS, type SkyPresetName } from './render/sky';
import { SEA_STATES, type SeaStateName } from './ocean/waves';
import { setLoading, setScreen, useUi } from './state/store';
import { Hud } from './ui/Hud';
import { BattleSelect } from './ui/BattleSelect';
import { SCENARIOS, type ScenarioId } from './sim/scenarios';
import { playableFactions } from './sim/balance';
import type { Faction } from './sim/types';
import { sound } from './audio/Sound';
import { fleetSpawn, useCampaign } from './campaign/campaign';
import { isTouchDevice } from './game/device';
import { useCompactLayout } from './ui/useCompactLayout';

declare global {
  interface Window {
    __ready?: boolean;
    __engine?: Engine;
    __info?: () => unknown;
  }
}

const params = new URLSearchParams(location.search);
const paramScenario = params.get('scenario') as ScenarioId | null;
const startScenario: ScenarioId = paramScenario && paramScenario in SCENARIOS ? paramScenario : 'hansan';
const paramSide = params.get('side') as Faction | null;

let pendingCampaign: EngineOptions['campaign'];
let pendingFaction: Faction = paramSide && playableFactions(startScenario).includes(paramSide) ? paramSide : 'joseon';

function readOptions(scenario: ScenarioId): EngineOptions {
  const sky = params.get('sky') as SkyPresetName | null;
  const sea = params.get('sea') as SeaStateName | null;
  const cam = params.get('cam')?.split(',').map(Number);
  return {
    scenario,
    sky: sky && sky in SKY_PRESETS ? sky : undefined,
    sea: sea && sea in SEA_STATES ? sea : undefined,
    pose: cam && cam.length === 5 ? { tx: cam[0]!, tz: cam[1]!, yaw: cam[2]!, pitch: cam[3]!, distance: cam[4]! } : undefined,
    warmup: Number(params.get('warm') ?? 0),
    gallery: params.get('gallery') === '1',
    cinematic: params.get('cine') === '1',
    hideLabels: params.get('hud') === '0',
    campaign: pendingCampaign,
    faction: pendingFaction,
    follow: params.get('follow')
      ? { id: Number(params.get('follow')), distance: Number(params.get('dist') ?? 70), pitch: Number(params.get('pitch') ?? 0.12), yaw: Number(params.get('yaw') ?? 2.4) }
      : undefined,
  };
}

async function createRenderer(props: { canvas: HTMLCanvasElement | OffscreenCanvas }) {
  const renderer = new WebGPURenderer({
    canvas: props.canvas as HTMLCanvasElement,
    antialias: false,
    powerPreference: 'high-performance',
    forceWebGL: params.get('webgl') === '1',
  });
  await renderer.init();
  return renderer;
}

function Game({ scenario, onEngine }: { scenario: ScenarioId; onEngine: (e: Engine) => void }) {
  const gl = useThree((s) => s.gl) as unknown as WebGPURenderer;
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const engineRef = useRef<Engine | null>(null);

  useEffect(() => {
    const engine = new Engine(gl, camera, readOptions(scenario));
    engineRef.current = engine;
    window.__engine = engine;
    window.__info = () => engine.info();
    let cancelled = false;
    engine
      .init()
      .then(() => {
        if (cancelled) return;
        setLoading(null);
        onEngine(engine);
        if (params.get('paused') === '1') engine.paused = true;
        let frames = 0;
        const tick = () => {
          frames += 1;
          if (frames > 30) window.__ready = true;
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      })
      .catch((err: unknown) => {
        console.error(err);
        setLoading(`초기화 실패: ${String(err)}`);
      });
    return () => {
      cancelled = true;
      engine.dispose();
    };
  }, [gl, camera, onEngine, scenario]);

  useFrame((_, delta) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.update(delta);
    engine.render();
  }, 1);

  return null;
}

const QUOTES: [string, string][] = [
  ['必死則生 必生則死', '죽고자 하면 살 것이요, 살고자 하면 죽을 것이다'],
  ['勿令妄動 靜重如山', '가벼이 움직이지 말라, 산처럼 무겁고 고요하게 하라'],
  ['今臣戰船 尙有十二', '지금 신에게는 아직 열두 척의 배가 남아 있사옵니다'],
  ['若無湖南 是無國家', '호남이 없으면 나라도 없다'],
  ['戰方急 愼勿言我死', '싸움이 급하니 나의 죽음을 알리지 말라'],
  ['一夫當逕 足懼千夫', '한 사람이 길목을 지키면 천 사람도 두렵게 할 수 있다'],
];

function Loading() {
  const loading = useUi((s) => s.loading);
  const progress = useUi((s) => s.progress);
  const sid = useUi((s) => s.loadingScenario);
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]!);
  if (!loading) return null;
  const info = sid ? SCENARIOS[sid] : null;
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div className="loading">
      <div className="loading-title">{info?.hanja ?? '壬辰海戰'}</div>
      <div className="loading-sub brush">{info?.title ?? '임진 해전'}</div>
      <div className="loading-bar">
        <div className="loading-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="loading-meta">
        <span>{loading}</span>
        <b>{pct}%</b>
      </div>
      <div className="loading-quote">
        <strong>{quote[0]}</strong>
        <span>{quote[1]}</span>
      </div>
    </div>
  );
}

export function App() {
  const screen = useUi((s) => s.screen);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [mounted, setMounted] = useState<ScenarioId | null>(paramScenario ? startScenario : null);
  const hideHud = params.get('hud') === '0';
  const compact = useCompactLayout();

  useEffect(() => {
    if (!paramScenario) setScreen('select');
  }, []);

  const start = (id: ScenarioId, campaignMode: boolean, faction: Faction) => {
    const campaign = useCampaign.getState().campaign;
    pendingCampaign = campaignMode && campaign ? fleetSpawn(campaign) : undefined;
    pendingFaction = pendingCampaign ? 'joseon' : faction;
    if (engine) engine.campaign = pendingCampaign;
    sound.click();
    sound.setMode('battle');
    setScreen('battle');
    if (!mounted) {
      setLoading(`${SCENARIOS[id].title} 준비 중`, 0.01, id);
      setMounted(id);
    } else if (engine) {
      void engine.setScenario(id, pendingFaction);
    }
  };

  // The engine sets the pixel ratio for each quality level, so the canvas only starts at the device ratio.
  // The battle canvas stops drawing while the menu is open, so the menu gets the whole GPU.
  return (
    <div className={`app ${compact ? 'app--compact' : ''} ${isTouchDevice ? 'app--touch' : ''}`}>
      {mounted && (
        <Canvas
          className="viewport"
          gl={createRenderer as never}
          camera={{ fov: 42, near: 0.5, far: 60000, position: [0, 50, 200] }}
          dpr={Math.min(window.devicePixelRatio, Number(params.get('dpr') ?? 2))}
          frameloop={screen === 'battle' ? 'always' : 'never'}
        >
          <Game scenario={mounted} onEngine={setEngine} />
        </Canvas>
      )}
      {mounted && engine && !hideHud && screen === 'battle' && (
        <Hud
          engine={engine}
          onBack={() => {
            engine.paused = true;
            sound.setMode('select');
            setScreen('select');
          }}
        />
      )}
      {screen === 'select' && <BattleSelect initial={engine?.scenarioId ?? startScenario} onStart={start} />}
      {mounted && <Loading />}
    </div>
  );
}
