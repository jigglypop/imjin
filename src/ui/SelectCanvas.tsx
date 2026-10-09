import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { PerspectiveCamera, Vector2, WebGPURenderer } from 'three/webgpu';
import { SCENARIO_ORDER, SCENARIOS, type ScenarioId } from '../sim/scenarios';
import type { Faction } from '../sim/types';
import { SelectScene } from '../select/SelectScene';
import { equipment, forceWebGL } from '../game/quality';
import { useT } from '../i18n';
import { shortTitle } from './siteMap';

async function createRenderer(props: { canvas: HTMLCanvasElement | OffscreenCanvas }) {
  const renderer = new WebGPURenderer({ canvas: props.canvas as HTMLCanvasElement, antialias: equipment.select.antialias, powerPreference: 'high-performance', forceWebGL });
  await renderer.init();
  return renderer;
}

function SelectView({ id, look, side, markers }: { id: ScenarioId; look: number; side: Faction; markers: React.MutableRefObject<Map<ScenarioId, HTMLButtonElement>> }) {
  const gl = useThree((s) => s.gl) as unknown as WebGPURenderer;
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const tmp = useRef(new Vector2());
  const sceneRef = useRef<SelectScene | null>(null);

  useEffect(() => {
    const scene = new SelectScene(gl, camera, equipment.select.mapSegments);
    sceneRef.current = scene;
    scene.setForces(id, side);
    void scene.init(id);
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera]);

  useEffect(() => {
    sceneRef.current?.focus(id);
  }, [id, look]);

  useEffect(() => {
    sceneRef.current?.setForces(id, side);
  }, [id, side]);

  useFrame((_, dt) => {
    const scene = sceneRef.current;
    if (!scene?.ready) return;
    scene.update(Math.min(dt, 0.05));
    scene.render();
    for (const sid of SCENARIO_ORDER) {
      const el = markers.current.get(sid);
      if (!el) continue;
      const visible = scene.project(sid, size.width, size.height, tmp.current);
      const { x, y } = tmp.current;
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.opacity = visible ? '1' : '0';
      el.style.pointerEvents = visible ? 'auto' : 'none';
    }
  }, 1);

  return null;
}

/** The 3D war-table map of the south coast, for desktops and tablets. Loaded on demand so the menu does not parse three.js. */
export default function SelectCanvas({ id, look, side, onSelect }: { id: ScenarioId; look: number; side: Faction; onSelect: (id: ScenarioId) => void }) {
  const t = useT();
  const markers = useRef(new Map<ScenarioId, HTMLButtonElement>());
  return (
    <>
      <Canvas className="select-canvas" gl={createRenderer as never} camera={{ fov: 34, near: 0.05, far: 600, position: [0, 40, 40] }} dpr={Math.min(window.devicePixelRatio, equipment.select.dprCap)} frameloop="always">
        <SelectView id={id} look={look} side={side} markers={markers} />
      </Canvas>
      <div className="select-markers">
        {SCENARIO_ORDER.map((sid) => (
          <button
            key={sid}
            ref={(el) => {
              if (el) markers.current.set(sid, el);
              else markers.current.delete(sid);
            }}
            className={`marker ${sid === id ? 'marker--on' : ''} ${SCENARIOS[sid].night ? 'marker--night' : ''}`}
            onClick={() => onSelect(sid)}
          >
            <i />
            <span>{shortTitle(t(SCENARIOS[sid].title))}</span>
          </button>
        ))}
      </div>
    </>
  );
}
