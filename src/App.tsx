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

function Loading() {
  const loading = useUi((s) => s.loading);
  if (!loading) return null;
  return (
    <div className="loading">
      <div className="loading-title">壬辰海戰</div>
      <div className="loading-sub brush">임진 해전</div>
      <div className="loading-text">{loading}</div>
    </div>
  );
}

export function App() {
  const screen = useUi((s) => s.screen);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [mounted, setMounted] = useState<ScenarioId | null>(paramScenario ? startScenario : null);
  const hideHud = params.get('hud') === '0';

  useEffect(() => {
    if (!paramScenario) setScreen('select');
  }, []);

  const start = (id: ScenarioId) => {
    setScreen('battle');
    if (!mounted) {
      setLoading(`${SCENARIOS[id].title} 준비 중`);
      setMounted(id);
    } else if (engine) {
      void engine.setScenario(id);
    }
  };

  return (
    <div className="app">
      {mounted && (
        <Canvas
          className="viewport"
          gl={createRenderer as never}
          camera={{ fov: 42, near: 0.5, far: 60000, position: [0, 50, 200] }}
          dpr={Math.min(window.devicePixelRatio, Number(params.get('dpr') ?? 1.5))}
          frameloop="always"
        >
          <Game scenario={mounted} onEngine={setEngine} />
        </Canvas>
      )}
      {mounted && engine && !hideHud && screen === 'battle' && (
        <Hud
          engine={engine}
          onBack={() => {
            engine.paused = true;
            setScreen('select');
          }}
        />
      )}
      {screen === 'select' && <BattleSelect initial={engine?.scenarioId ?? startScenario} onStart={start} />}
      {mounted && <Loading />}
    </div>
  );
}
