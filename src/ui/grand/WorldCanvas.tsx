import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { PCFShadowMap, WebGPURenderer, type PerspectiveCamera } from 'three/webgpu';
import { equipment, forceWebGL } from '../../game/quality';
import { tuneWebGLBackend } from '../../render/webglBackend';
import { CampaignWorld } from './campaignWorld';
import type { MapWorld } from './mapWorld';
import { FAR, FOV, NEAR, type CameraState, type ScreenFrame } from './worldCamera';

/** What one frame draws: the camera, the screen it draws to, and whether the next display frame is wanted too (a drag, a glide, a held key). */
export interface WorldView {
  cam: CameraState;
  screen: ScreenFrame;
  more?: boolean;
}

/** What the page can ask of the running world. */
export interface WorldControls {
  /** Draws a frame at the next display frame: the camera or the screen has changed. */
  redraw(): void;
  /** The closed turn's ships along their way: `share` of the sailing done, `time` the replay's clock. */
  setSail(share: number, time: number): void;
}

export interface WorldProps {
  /**
   * Asked at the start of every drawn frame, with the frame's time (ms, the clock of performance.now()) and the canvas
   * size: the camera and the screen to draw. Null draws nothing.
   */
  view: (now: number, size: { width: number; height: number }) => WorldView | null;
  /** What stands on the ground. */
  world?: MapWorld | null;
  /** The ground has loaded: the DEM's metre heights. */
  onReady?: (heights: Float32Array) => void;
  onError?: (error: unknown) => void;
  onControls?: (controls: WorldControls | null) => void;
}

/**
 * At rest the world is drawn about thirty times a second, so the sea, the smoke and the boats keep moving (their motion
 * follows the clock, not the frame count). While the camera moves, every display frame is drawn.
 */
const AMBIENT_MS = 33;
/** The camera r3f makes; `CampaignWorld.frame` sets all of it again for every frame. */
const CAMERA = { fov: (FOV * 180) / Math.PI, near: NEAR, far: FAR };
/** The canvas lies under the map's overlay and never takes the pointer: the map's root handles every gesture. */
const FILL: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' };
const RESIZE = { scroll: false };
/** Nothing casts a shadow. Said outright, because r3f's default picks a shadow map type WebGPURenderer no longer has and warns about. */
const NO_SHADOWS = { enabled: false, type: PCFShadowMap };

type Builder = { getUniformBufferLimit(): number };
type Backend = { isWebGPUBackend?: boolean; createNodeBuilder(object: { isInstancedMesh?: boolean } | null, renderer: unknown): Builder };
type Pipelines = { _releasePipeline(pipeline: object): void; _releaseProgram(program: object): void };

/**
 * Lets the map's batches of one material share their shaders and pipeline, as the battle's WebGL path does
 * (render/webglBackend.ts). three writes a small InstancedMesh's matrices into a uniform array whose name and length are
 * part of the shader, so each batch of camps or ships compiled shaders and a pipeline of its own, and since the map
 * builds new batches whenever the campaign changes, every order recompiled about fifteen: a quarter of a second in the
 * GPU process. Read from vertex attributes, the matrices leave the shader the same for every batch of one material. And
 * three forgets a pipeline and its shaders the moment nothing draws with them, which freeing the old batches before the
 * new ones are drawn always brings about: this renderer keeps them while it lives, a few dozen.
 */
function shareCompiled(renderer: WebGPURenderer) {
  const backend = renderer.backend as unknown as Backend;
  const pipelines = (renderer as unknown as { _pipelines?: Pipelines })._pipelines;
  if (!backend.isWebGPUBackend || !pipelines) return;
  const create = backend.createNodeBuilder.bind(backend);
  backend.createNodeBuilder = (object, r) => {
    const builder = create(object, r);
    if (object?.isInstancedMesh) builder.getUniformBufferLimit = () => 0;
    return builder;
  };
  pipelines._releasePipeline = () => undefined;
  pipelines._releaseProgram = () => undefined;
}

export async function createRenderer(props: { canvas: HTMLCanvasElement | OffscreenCanvas }) {
  const renderer = new WebGPURenderer({ canvas: props.canvas as HTMLCanvasElement, antialias: equipment.select.antialias, powerPreference: 'high-performance', forceWebGL });
  await renderer.init();
  tuneWebGLBackend(renderer);
  shareCompiled(renderer);
  return renderer;
}

/** The time of the frame being drawn: the animation frame's own time where there is one, so steps are even. */
function frameTime() {
  const time = typeof document !== 'undefined' ? document.timeline?.currentTime : null;
  return typeof time === 'number' ? time : performance.now();
}

const motionQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

/** Whether the player asks for reduced motion, following the setting while the page is open. */
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => !!motionQuery?.matches);
  useEffect(() => {
    if (!motionQuery) return;
    const sync = () => setReduced(motionQuery.matches);
    motionQuery.addEventListener('change', sync);
    return () => motionQuery.removeEventListener('change', sync);
  }, []);
  return reduced;
}

/** False while the page is in the background. */
function usePageVisible() {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const sync = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  return visible;
}

/**
 * The campaign world inside r3f's scene, drawn by hand in a frame callback (priority 1, so r3f does not draw on its own):
 * the page's `view` decides the camera, the world readies itself for it and the renderer draws, all in the same animation
 * frame in which the page moves its overlay.
 */
export function World({ view, world, onReady, onError, onControls }: WorldProps) {
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const get = useThree((s) => s.get);
  const ref = useRef<CampaignWorld | null>(null);
  const [ready, setReady] = useState(false);
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const props = useRef({ view, onReady, onError, reduced });
  props.current = { view, onReady, onError, reduced };
  const born = useRef(frameTime());

  useEffect(() => {
    // Shaders are compiled away from the frames, for the camera the frames draw with.
    const compile = () => {
      const { gl, camera } = get();
      return (gl as unknown as WebGPURenderer).compileAsync(scene, camera);
    };
    const campaign = new CampaignWorld(scene, () => invalidate(), compile);
    ref.current = campaign;
    let live = true;
    campaign
      .load()
      .then((heights) => {
        if (!live) return;
        setReady(true);
        props.current.onReady?.(heights);
        invalidate();
      })
      .catch((error: unknown) => {
        if (live && !(error instanceof Error && error.name === 'AbortError')) props.current.onError?.(error);
      });
    return () => {
      live = false;
      ref.current = null;
      campaign.dispose();
    };
  }, [scene, invalidate, get]);

  useEffect(() => {
    if (!onControls) return;
    onControls({ redraw: () => invalidate(), setSail: (share, time) => ref.current?.setSail(share, time) });
    return () => onControls(null);
  }, [onControls, invalidate]);

  useEffect(() => {
    if (world) ref.current?.setWorld(world);
  }, [world]);

  // The ambient frames: only while the page is visible, and not for a player who asks for reduced motion (then only changes draw).
  useEffect(() => {
    if (!ready || !visible) return;
    invalidate();
    if (reduced) return;
    const id = setInterval(() => invalidate(), AMBIENT_MS);
    return () => clearInterval(id);
  }, [ready, visible, reduced, invalidate]);

  useFrame((state) => {
    const campaign = ref.current;
    if (!campaign?.ready || (typeof document !== 'undefined' && document.hidden)) return;
    const now = frameTime();
    const v = props.current.view(now, state.size);
    if (!v || v.screen.w < 1 || v.screen.h < 1) return;
    // The ambient clock stands still for a player who asks for reduced motion.
    const clock = props.current.reduced ? 0 : (now - born.current) / 1000;
    campaign.frame(state.camera as PerspectiveCamera, v.cam, v.screen, clock);
    state.gl.render(state.scene, state.camera);
    if (v.more) state.invalidate();
  }, 1);

  return null;
}

export interface WorldCanvasProps extends WorldProps {
  className?: string;
  style?: CSSProperties;
}

/**
 * The campaign's 3D world on its own canvas: an r3f Canvas with a WebGPURenderer that draws only when asked (a change,
 * the ambient frames, or every display frame while the camera moves). No tone mapping, so the colours are the ones the
 * materials give. Leaving the screen unmounts it and r3f frees the renderer it built. Loaded on demand, so phones, which
 * keep the flat image, never load three.js.
 */
function WorldCanvas({ className, style, ...world }: WorldCanvasProps) {
  return (
    <Canvas
      className={className}
      style={style ? { ...FILL, ...style } : FILL}
      gl={createRenderer as never}
      camera={CAMERA}
      dpr={Math.min(window.devicePixelRatio, equipment.tier === 'low' ? 1.25 : 1.5)}
      frameloop="demand"
      resize={RESIZE}
      shadows={NO_SHADOWS}
      flat
    >
      <World {...world} />
    </Canvas>
  );
}

export default memo(WorldCanvas);
