import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { memo, useEffect, useRef, type CSSProperties } from 'react';
import { WebGPURenderer, type PerspectiveCamera } from 'three/webgpu';
import { Engine } from '../../game/Engine';
import { METRES_PER_U, METRES_PER_V, ORIGIN_U, ORIGIN_V, type TheatreSetup } from '../../game/theatre';
import { equipment, forceWebGL } from '../../game/quality';
import { loadDem } from '../../select/terrain';
import { setLoading } from '../../state/store';
import { MAP, demMeta } from './mapTheatre';
import { eyeOf, FOV, frameU, frameV, worldX, worldZ } from './worldCamera';
import type { WorldCanvasProps } from './WorldCanvas';
import { theatreListeners, theatreNow } from './portView';

// The campaign map's 3D drawn by the battle engine itself (game/theatre.ts): the same terrain pipeline, ocean, sky,
// ships and light as a battle, with the campaign's ports and fleets on it. The strategic map keeps everything else (its
// camera, gestures, markers, panels and orders): every frame its camera is turned into the engine's.

const FILL: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' };

/** A frame-unit point of the strategic map's world (x east, y up, z south) in the theatre's metres. */
const toWorld = (x: number, y: number, z: number) => ({
  x: (frameU(x) - ORIGIN_U) * METRES_PER_U,
  y: y * METRES_PER_U,
  z: (frameV(z) - ORIGIN_V) * METRES_PER_V,
});

async function createRenderer(props: { canvas: HTMLCanvasElement | OffscreenCanvas }) {
  const renderer = new WebGPURenderer({ canvas: props.canvas as HTMLCanvasElement, antialias: false, powerPreference: 'high-performance', forceWebGL });
  await renderer.init();
  return renderer;
}

function Theatre({ view, onReady, onError, onControls }: WorldCanvasProps) {
  const gl = useThree((s) => s.gl) as unknown as WebGPURenderer;
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const engine = useRef<Engine | null>(null);
  const props = useRef({ view, onReady, onError });
  props.current = { view, onReady, onError };

  useEffect(() => {
    const first = theatreNow();
    if (!first) return;
    const e = new Engine(gl, camera, { scenario: 'hansan', theatre: first, hideLabels: true });
    let live = true;
    const follow = (s: TheatreSetup) => e.updateTheatre(s);
    // The strategic map places its markers on the DEM's heights: they come with the ground.
    Promise.all([e.init(), loadDem(new AbortController().signal, { texture: false, url: MAP.dem, size: demMeta })])
      .then(([, dem]) => {
        if (!live) return;
        setLoading(null);
        engine.current = e;
        window.__engine = e;
        theatreListeners.add(follow);
        const now = theatreNow();
        if (now && now !== e.theatre) e.updateTheatre(now);
        props.current.onReady?.(dem.heights);
      })
      .catch((err: unknown) => {
        setLoading(null);
        if (live && !(err instanceof Error && err.name === 'AbortError')) props.current.onError?.(err);
      });
    return () => {
      live = false;
      theatreListeners.delete(follow);
      engine.current = null;
      e.dispose();
    };
  }, [gl, camera]);

  useEffect(() => {
    if (!onControls) return;
    onControls({ redraw: () => undefined, setSail: () => undefined, busy: () => !engine.current?.ready });
    return () => onControls(null);
  }, [onControls]);

  useFrame((state, delta) => {
    const e = engine.current;
    if (!e?.ready) return;
    const v = props.current.view(performance.now(), state.size);
    if (v && v.screen.w >= 1 && v.screen.h >= 1) {
      const cam = v.cam;
      const eye = eyeOf(cam);
      const p = toWorld(eye[0], eye[1], eye[2]);
      const t = toWorld(worldX(cam.u), 0, worldZ(cam.v));
      camera.fov = (FOV * 180) / Math.PI;
      camera.near = Math.max(1, 0.02 * p.y);
      camera.far = 80000;
      camera.position.set(p.x, p.y, p.z);
      camera.up.set(0, 1, 0);
      camera.lookAt(t.x, t.y, t.z);
      camera.aspect = v.screen.w / v.screen.h;
      camera.setViewOffset(v.screen.w, v.screen.h, v.screen.w / 2 - v.screen.cx, v.screen.h / 2 - v.screen.cy, v.screen.w, v.screen.h);
      camera.updateProjectionMatrix();
    }
    e.update(delta);
    e.render();
  }, 1);

  return null;
}

/** The campaign map's 3D on the battle engine. Same props as WorldCanvas, which it stands in for. */
function TheatreCanvas({ className, style, ...world }: WorldCanvasProps) {
  return (
    <Canvas
      className={className}
      style={style ? { ...FILL, ...style } : FILL}
      gl={createRenderer as never}
      camera={{ fov: (FOV * 180) / Math.PI, near: 1, far: 80000 }}
      dpr={Math.min(window.devicePixelRatio, equipment.tier === 'low' ? 1.25 : 1.5)}
      frameloop="always"
    >
      <Theatre {...world} />
    </Canvas>
  );
}

export default memo(TheatreCanvas);
