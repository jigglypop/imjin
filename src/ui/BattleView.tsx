import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { PerspectiveCamera, WebGPURenderer } from 'three/webgpu';
import { Engine, type EngineOptions } from '../game/Engine';
import { net } from '../net/NetClient';
import { SKY_PRESETS, type SkyPresetName } from '../render/sky';
import { SEA_STATES, type SeaStateName } from '../ocean/waves';
import { sound } from '../audio/Sound';
import { setFatal, setLoading, setScreen, useUi } from '../state/store';
import { Hud } from './Hud';
import { hideHud, params, startScenario, type Launch } from './launch';

declare global {
  interface Window {
    __ready?: boolean;
    __engine?: Engine;
    __info?: () => unknown;
  }
}

function readOptions(launch: Launch): EngineOptions {
  const sky = params.get('sky') as SkyPresetName | null;
  const sea = params.get('sea') as SeaStateName | null;
  const cam = params.get('cam')?.split(',').map(Number);
  const scenario = launch.kind === 'scenario' ? launch.id : startScenario;
  return {
    scenario,
    sky: sky && sky in SKY_PRESETS ? sky : undefined,
    sea: sea && sea in SEA_STATES ? sea : undefined,
    pose: cam && cam.length === 5 ? { tx: cam[0]!, tz: cam[1]!, yaw: cam[2]!, pitch: cam[3]!, distance: cam[4]! } : undefined,
    warmup: Number(params.get('warm') ?? 0),
    gallery: params.get('gallery') === '1',
    cinematic: params.get('cine') === '1',
    hideLabels: params.get('hud') === '0',
    campaign: launch.kind === 'scenario' ? launch.campaign : undefined,
    faction: launch.kind === 'scenario' ? (launch.campaign ? 'joseon' : launch.faction) : 'joseon',
    conquest: launch.kind === 'conquest' ? launch.setup : undefined,
    remote: launch.remote,
    follow: params.get('follow')
      ? { id: Number(params.get('follow')), distance: Number(params.get('dist') ?? 70), pitch: Number(params.get('pitch') ?? 0.12), yaw: Number(params.get('yaw') ?? 2.4) }
      : undefined,
  };
}

async function createRenderer(props: { canvas: HTMLCanvasElement | OffscreenCanvas }) {
  try {
    const renderer = new WebGPURenderer({
      canvas: props.canvas as HTMLCanvasElement,
      antialias: false,
      powerPreference: 'high-performance',
      forceWebGL: params.get('webgl') === '1',
    });
    await renderer.init();
    return renderer;
  } catch (err) {
    // The error boundary above the canvas shows the Korean notice with the low-quality retry link.
    setLoading(null);
    throw err;
  }
}

function Game({ launch, onEngine }: { launch: Launch; onEngine: (e: Engine) => void }) {
  const gl = useThree((s) => s.gl) as unknown as WebGPURenderer;
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const engineRef = useRef<Engine | null>(null);
  // The first battle's options are read once; later battles go through engine.setScenario / setConquest.
  const first = useRef(launch);

  useEffect(() => {
    const engine = new Engine(gl, camera, readOptions(first.current));
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
        setLoading(null);
        setFatal(`초기화 실패: ${String(err)}`);
      });
    return () => {
      cancelled = true;
      engine.dispose();
    };
  }, [gl, camera, onEngine]);

  useFrame((_, delta) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.update(delta);
    engine.render();
  }, 1);

  return null;
}

/** The battle: 3D canvas, engine and HUD. Lazy-loaded so the menu paints without parsing three.js. */
export default function BattleView({ launch }: { launch: Launch }) {
  const screen = useUi((s) => s.screen);
  const origin = useUi((s) => s.origin);
  const [engine, setEngine] = useState<Engine | null>(null);
  const applied = useRef(launch.seq);

  // Battles after the first reuse the running engine.
  useEffect(() => {
    if (!engine || applied.current === launch.seq) return;
    applied.current = launch.seq;
    if (launch.kind === 'conquest') {
      engine.campaign = undefined;
      void engine.setConquest(launch.setup, launch.remote ?? null);
    } else {
      engine.campaign = launch.campaign;
      void engine.setScenario(launch.id, launch.campaign ? 'joseon' : launch.faction, launch.remote ?? null);
    }
  }, [engine, launch]);

  const back = () => {
    if (!engine) return;
    if (engine.remote) {
      net.send({ t: 'leave' });
      engine.leaveRemote();
    }
    engine.paused = true;
    sound.setMode('select');
    setScreen(origin);
  };

  // The engine sets the pixel ratio for each quality level, so the canvas only starts at the device ratio.
  // The canvas stops drawing while a menu is open, so the menu gets the whole GPU.
  return (
    <>
      <Canvas
        className="viewport"
        gl={createRenderer as never}
        camera={{ fov: 42, near: 0.5, far: 60000, position: [0, 50, 200] }}
        dpr={Math.min(window.devicePixelRatio, Number(params.get('dpr') ?? 2))}
        frameloop={screen === 'battle' ? 'always' : 'never'}
      >
        <Game launch={launch} onEngine={setEngine} />
      </Canvas>
      {engine && !hideHud && screen === 'battle' && <Hud engine={engine} onBack={back} />}
    </>
  );
}
