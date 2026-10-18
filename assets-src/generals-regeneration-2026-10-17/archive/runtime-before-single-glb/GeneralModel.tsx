import { useEffect, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping, AnimationMixer, Box3, Group, LoopOnce, Matrix4, PerspectiveCamera, Quaternion, Scene, Skeleton, SRGBColorSpace, Vector3, WebGPURenderer,
  type AnimationAction, type AnimationClip, type Bone, type BufferGeometry, type DataTexture, type Material, type Mesh, type Object3D, type SkinnedMesh, type Texture,
} from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { equipment, forceWebGL } from '../../game/quality';
import { useT } from '../../i18n';
import { tuneWebGLBackend } from '../../render/webglBackend';
import { lightStage } from './studio';
import type { WeaponDef } from '../../meta/catalog';

/**
 * The generals' figures in public/models/generals (<file>.glb for close-ups on a desktop, _lod1.glb for phones and
 * tablets). A general is dressed from parts (scripts/generals-parts.mjs, in parts/): his body, which is his head on the
 * shared skeleton with the clips (Meshy's idle, Sword Shout as the command and the right-hand slash), an armor of his
 * faction bound to that skeleton, and his weapon in his right hand. The older figures are whole, one per armor,
 * <general>_<armor>.glb. index.json lists what there is; a general without either keeps his portrait.
 */
let listing: Promise<ReadonlySet<string>> | null = null;
function listModels() {
  listing ??= fetch(`${import.meta.env.BASE_URL}models/generals/index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<string[]>) : []))
    .then((names) => new Set(names))
    .catch(() => new Set<string>());
  return listing;
}

/** The figures there are, or null while their list is on its way. */
export function useGeneralModels() {
  const [models, setModels] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    let live = true;
    void listModels().then((m) => live && setModels(m));
    return () => {
      live = false;
    };
  }, []);
  return models;
}

/**
 * The files that make a general in an armor, the body (or the whole older figure) first; null if there are none. An
 * armor must have its own model: the poster keeps the correct portrait when that outfit has not been made in 3D.
 */
export function figureFor(models: ReadonlySet<string>, general: string, armor: string) {
  if (models.has(`parts/v2/body_${general}`) && models.has(`parts/v2/armor_${armor}`)) {
    return [`parts/v2/body_${general}`, `parts/v2/armor_${armor}`, `parts/v2/helmet_${armor}`].filter(f => models.has(f));
  }
  if (models.has(`parts/body_${general}`) && models.has(`parts/armor_${armor}`)) {
    return [`parts/body_${general}`, `parts/armor_${armor}`, 'parts/weapon_hwando'].filter((f) => models.has(f));
  }
  return models.has(`${general}_${armor}`) ? [`${general}_${armor}`] : null;
}

/** Puts an armor part on a body: its skinned meshes follow the body's joints of the same names. */
function dressIn(body: Object3D, armor: Object3D) {
  const skinned = body.getObjectByProperty('isSkinnedMesh', true) as SkinnedMesh | undefined;
  if (!skinned) throw new Error('The body has no skeleton.');
  const parts: SkinnedMesh[] = [];
  armor.traverse((o) => (o as SkinnedMesh).isSkinnedMesh && parts.push(o as SkinnedMesh));
  if (!parts.length) throw new Error('The armor has no skeleton.');
  const replaced = new Set<Skeleton>();
  body.updateMatrixWorld(true);
  armor.updateMatrixWorld(true);
  // Validate every mesh before moving any of them; a mismatch must leave ownership intact for cleanup.
  const bindings = parts.map((part) => {
    const bones = part.skeleton.bones.map((b) => {
      const joint = body.getObjectByName(b.name) as Bone | undefined;
      if (!joint?.isBone) throw new Error(`The body has no ${b.name} joint.`);
      return joint;
    });
    return { part, bones, original: part.skeleton };
  });
  for (const { part, bones, original } of bindings) {
    // Multi-material GLBs can put quantization's decode transform on a parent
    // group. Preserve that frame when moving each mesh onto the wearer.
    skinned.parent!.attach(part);
    part.bind(new Skeleton(bones, original.boneInverses), part.bindMatrix);
    replaced.add(original);
  }
  for (const skeleton of replaced) skeleton.dispose();
  // The old armature and any unused meshes remain in this scene after its clothing has moved to the body.
  free(armor, body);
}

/**
 * A weapon part in the right fist. Meshy's sword motions are made with the blade continuing the forearm out of the
 * fist, so in the bind pose it lies along the hand; the part is modelled lying along X, the point to -X.
 */
function grip(body: Object3D, weapon: Object3D) {
  // Tripo's joint names, or Meshy's on the older figures.
  const hand = body.getObjectByName('R_Hand') ?? body.getObjectByName('RightHand');
  const fore = body.getObjectByName('R_Forearm') ?? body.getObjectByName('RightForeArm');
  if (!hand || !fore) {
    free(weapon);
    return;
  }
  body.updateMatrixWorld(true);
  const at = hand.getWorldPosition(new Vector3());
  const along = at.clone().sub(fore.getWorldPosition(new Vector3())).normalize();
  const box = new Box3().setFromObject(weapon);
  const length = box.max.x - box.min.x || 1;
  // A hwando is 95 cm from pommel to point; its grip's middle is 9 cm from the pommel, in the fist 8 cm past the wrist.
  // The body is already normalized to 1.8 stage units. attach() preserves this world-space sword size.
  const k = 0.95 / length;
  const held = new Group();
  weapon.position.set(-(box.max.x - 0.09 * length), -(box.min.y + box.max.y) / 2, -(box.min.z + box.max.z) / 2);
  held.add(weapon);
  held.scale.setScalar(k);
  held.quaternion.setFromUnitVectors(new Vector3(-1, 0, 0), along);
  held.position.copy(at).addScaledVector(along, 0.08);
  hand.attach(held);
}

/** New weapon files use metres, +Y along the blade/shaft and a grip at their origin. */
function holdWeapon(body: Object3D, weapon: Object3D, definition: WeaponDef) {
  const left = definition.kind === 'bow';
  const hand = body.getObjectByName(left ? 'L_Hand' : 'R_Hand') ?? body.getObjectByName(left ? 'LeftHand' : 'RightHand');
  const fore = body.getObjectByName(left ? 'L_Forearm' : 'R_Forearm') ?? body.getObjectByName(left ? 'LeftForeArm' : 'RightForeArm');
  if (!hand || !fore) throw new Error('The selected weapon has no hand socket.');
  body.updateMatrixWorld(true);
  const wrist = hand.getWorldPosition(new Vector3());
  const along = wrist.clone().sub(fore.getWorldPosition(new Vector3())).normalize();
  const socket = body.getObjectByName(left ? 'socket_grip_left' : 'socket_grip_right');
  if (socket) {
    const held = new Group();
    held.name = `held_${definition.id}`;
    held.add(weapon);
    held.position.copy(socket.getWorldPosition(new Vector3()));
    if (definition.kind === 'sword') held.quaternion.copy(socket.getWorldQuaternion(new Quaternion()));
    // Align a resting polearm/bow upright; an angled forearm would otherwise point a long shaft through the helmet.
    socket.attach(held);
    return;
  }
  const y = definition.kind === 'sword' ? along : new Vector3(0, 1, 0);
  const z = new Vector3(0, 0, 1).addScaledVector(y, -y.z).normalize();
  if (z.lengthSq() < 0.01) z.set(1, 0, 0);
  const x = y.clone().cross(z).normalize();
  const held = new Group();
  held.name = `held_${definition.id}`;
  held.add(weapon);
  held.position.copy(wrist).addScaledVector(along, 0.065);
  held.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
  // attach() cancels the character normalization scale: a two-metre spear remains two metres.
  hand.attach(held);
}

const modelUrl = (file: string) => `${import.meta.env.BASE_URL}models/generals/${file}${equipment.tier === 'high' ? '' : '_lod1'}.glb`;

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

/**
 * The camera, a little below his chest as a poster frames a hero, between the whole figure and his face: the wheel or a
 * pinch moves it along that path, the close button jumps to the face.
 */
const VIEWS = { full: { y: 0.8, z: 5.2, look: 0.95 }, close: { y: 1.52, z: 1.5, look: 1.5 } };
const along = (k: number) => ({
  y: VIEWS.full.y + (VIEWS.close.y - VIEWS.full.y) * k,
  z: VIEWS.full.z + (VIEWS.close.z - VIEWS.full.z) * k,
  look: VIEWS.full.look + (VIEWS.close.look - VIEWS.full.look) * k,
});

function resources(root: Object3D) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  const skeletons = new Set<Skeleton>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    for (const m of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) materials.add(m);
    const skinned = o as SkinnedMesh;
    if (skinned.isSkinnedMesh) skeletons.add(skinned.skeleton);
  });
  for (const m of materials) for (const v of Object.values(m)) if (v && typeof v === 'object' && 'isTexture' in v) textures.add(v as Texture);
  return { geometries, materials, textures, skeletons };
}

/** Dispose only resources that have no remaining owner in the dressed figure. */
function free(root: Object3D, retained?: Object3D) {
  const owned = resources(root);
  const keep = retained ? resources(retained) : null;
  const retainedImages = new Set(keep ? [...keep.textures].map((texture) => texture.source.data) : []);
  const closed = new Set<object>();
  for (const texture of owned.textures) if (!keep?.textures.has(texture)) {
    texture.dispose();
    const bitmap = texture.source.data as { close?: () => void } | null;
    if (bitmap && typeof bitmap.close === 'function' && !closed.has(bitmap) && !retainedImages.has(bitmap)) {
      bitmap.close();
      closed.add(bitmap);
    }
  }
  for (const material of owned.materials) if (!keep?.materials.has(material)) material.dispose();
  for (const geometry of owned.geometries) if (!keep?.geometries.has(geometry)) geometry.dispose();
  for (const skeleton of owned.skeletons) if (!keep?.skeletons.has(skeleton)) skeleton.dispose();
}

export type Move = 'command' | 'slash';
function movementClips(clips: readonly AnimationClip[]) {
  const find = (name: string) => clips.find((c) => c.name.toLowerCase().includes(name));
  const moves = new Map<Move, AnimationClip>();
  const command = find('command') ?? find('shout');
  const slash = find('triple_combo') ?? find('combo') ?? find('slash');
  if (command) moves.set('command', command);
  if (slash) moves.set('slash', slash);
  return { idle: find('idle'), moves };
}
type FigureView = 'front' | 'side' | 'back';
type Figure = { root: Object3D; mixer: AnimationMixer; idle: AnimationAction | null; moves: Map<Move, AnimationAction>; playing: AnimationAction | null };
type StageState = 'loading' | 'ready' | 'failed';

/**
 * A dark stage with one general standing on it, turning slowly about straight on; dragging turns him, the wheel or a
 * pinch brings the camera in to his face and back. Showing another figure (he changed his armor) keeps the turn and swaps him in once the new one has
 * loaded. The stage owns its renderer and frees it, the figures and their textures when it closes.
 */
class FigureStage {
  readonly canvas = document.createElement('canvas');
  private readonly renderer: WebGPURenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(28, 1, 0.05, 50);
  private readonly turn = new Group();
  private readonly environment: DataTexture;
  private readonly started: Promise<void>;
  private readonly observer: ResizeObserver;
  private figure: Figure | null = null;
  private wanted = '';
  private zoom = 0;
  private clock = 0;
  private readonly pinch = new Map<number, number>();
  private spread = 0;
  private view = { ...VIEWS.full };
  private drag: { x: number; turn: number } | null = null;
  private rotating = true;
  private raf = 0;
  private last = 0;
  private disposed = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly onState: (s: StageState) => void,
    private readonly onZoom: (close: boolean) => void,
    private readonly onMoves: (moves: Move[]) => void,
    private readonly onTurn: (rotating: boolean, view: FigureView | null) => void,
  ) {
    this.canvas.className = 'gen-model__canvas';
    host.appendChild(this.canvas);
    this.renderer = new WebGPURenderer({ canvas: this.canvas, antialias: true, alpha: true, forceWebGL });
    this.scene.add(this.turn);
    this.environment = lightStage(this.scene);
    this.placeCamera();
    this.turn.rotation.y = -0.45;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.canvas.addEventListener('pointerdown', this.down);
    this.canvas.addEventListener('pointermove', this.move);
    this.canvas.addEventListener('pointerup', this.up);
    this.canvas.addEventListener('pointercancel', this.up);
    this.canvas.addEventListener('wheel', this.wheel, { passive: false });
    this.started = this.renderer.init().then(() => {
      if (this.disposed) return;
      tuneWebGLBackend(this.renderer);
      this.renderer.toneMapping = ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.15;
      this.renderer.outputColorSpace = SRGBColorSpace;
      this.resize();
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    });
  }

  private placeCamera() {
    this.camera.position.set(0, this.view.y, this.view.z);
    this.camera.lookAt(0, this.view.look, 0);
  }

  /** Head and shoulders or the whole figure; the camera glides there. */
  setClose(close: boolean) {
    this.zoom = close ? 1 : 0;
    this.onZoom(close);
  }

  /** Hold a repeatable angle so the outfit can be inspected, including its back. */
  setView(view: FigureView) {
    this.rotating = false;
    this.turn.rotation.y = { front: 0, side: Math.PI / 2, back: Math.PI }[view];
    this.onTurn(false, view);
  }

  setRotation(rotating: boolean) {
    this.rotating = rotating;
    this.onTurn(rotating, null);
  }

  private zoomBy(d: number) {
    this.zoom = Math.min(1, Math.max(0, this.zoom + d));
    this.onZoom(this.zoom > 0.5);
  }

  private readonly wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoomBy(-e.deltaY * 0.0012);
  };

  async show(figureFiles: string[], weapon?: WeaponDef) {
    const files = weapon ? [...figureFiles.filter((f) => !f.includes('/weapon_')), `parts/weapon_${weapon.id}`] : figureFiles;
    const name = files.join('+');
    this.wanted = name;
    this.onState('loading');
    this.onMoves([]);
    let loaded: Object3D[] = [];
    try {
      await this.started;
      if (this.disposed) return;
      const results = await Promise.allSettled(files.map((f) => loader.loadAsync(modelUrl(f))));
      loaded = results.flatMap((r) => r.status === 'fulfilled' ? [r.value.scene] : []);
      const models = results.map((r) => {
        if (r.status === 'rejected') throw r.reason;
        return r.value;
      });
      const [main, ...parts] = models;
      if (this.disposed || this.wanted !== name) return [main!, ...parts].forEach((g) => free(g.scene));
      const gltf = main!;
      const root = gltf.scene;
      for (const [i, part] of parts.entries()) {
        if (!files[i + 1]!.includes('/weapon_') && !files[i + 1]!.includes('/helmet_')) dressIn(root, part.scene);
      }
      // Provider frames differ. Old Tripo bodies face +X; new Meshy bodies face +Z.
      if (root.getObjectByName('R_Hand') && root.userData.frontAxis !== '+Z') root.rotation.y = -Math.PI / 2;
      root.updateMatrixWorld(true);
      // Feet on the floor, centred, 1.8 units tall.
      const box = new Box3().setFromObject(root);
      const k = 1.8 / (box.max.y - box.min.y || 1);
      const centre = box.getCenter(new Vector3());
      root.scale.multiplyScalar(k);
      root.position.set(-centre.x * k, -box.min.y * k, -centre.z * k);
      for (const [i, part] of parts.entries()) if (files[i + 1]!.includes('/helmet_')) {
        const socket = root.getObjectByName('socket_helmet_brow');
        if (!socket) throw new Error('The helmet has no fitted head socket.');
        socket.add(part.scene);
      }
      for (const [i, part] of parts.entries()) if (files[i + 1]!.includes('/weapon_')) {
        if (!weapon) grip(root, part.scene);
        else if (weapon.kind === 'sword') holdWeapon(root, part.scene, weapon);
      }
      // The clips swing his arms and the sword well outside the bind pose's bounds.
      root.traverse((o) => (o.frustumCulled = false));
      const mixer = new AnimationMixer(root);
      const clips = movementClips(gltf.animations);
      const idleClip = clips.idle;
      const idle = idleClip ? mixer.clipAction(idleClip) : null;
      idle?.play();
      // He turns about his head as he stands in his idle, so close up his face stays in the middle of the stage.
      mixer.update(0);
      // Upright polearms and bows are aligned in the resting pose rather than the T-pose.
      if (weapon && weapon.kind !== 'sword') for (const [i, part] of parts.entries()) {
        if (files[i + 1]!.includes('/weapon_')) holdWeapon(root, part.scene, weapon);
      }
      const head = root.getObjectByName('Head');
      if (head) {
        root.updateMatrixWorld(true);
        const at = head.getWorldPosition(new Vector3());
        root.position.x -= at.x;
        root.position.z -= at.z;
      }
      const moves = new Map<Move, AnimationAction>();
      for (const [move, c] of clips.moves) {
        if (!weapon || weapon.kind === 'sword' || move === 'command') moves.set(move, mixer.clipAction(c).setLoop(LoopOnce, 1));
      }
      const figure: Figure = { root, mixer, idle, moves, playing: null };
      // After a move he settles back into his stance.
      mixer.addEventListener('finished', (e) => {
        if (e.action !== figure.playing || !figure.idle) return;
        figure.idle.reset().play().crossFadeFrom(e.action, 0.18, false);
        figure.playing = null;
      });
      if (this.figure) {
        this.turn.remove(this.figure.root);
        this.figure.mixer.stopAllAction();
        free(this.figure.root);
      }
      this.figure = figure;
      this.turn.add(root);
      loaded = [];
      this.onMoves([...moves.keys()]);
      this.onState('ready');
    } catch {
      for (const root of loaded) free(root);
      if (!this.disposed && this.wanted === name) {
        if (this.figure) {
          this.turn.remove(this.figure.root);
          this.figure.mixer.stopAllAction();
          free(this.figure.root);
          this.figure = null;
        }
        this.onState('failed');
      }
    }
  }

  /** One of his moves, once, out of his stance; he faces the viewer for it. */
  play(move: Move) {
    const f = this.figure;
    const next = f?.moves.get(move);
    if (!f || !next) return;
    const from = f.playing ?? f.idle;
    next.reset();
    next.clampWhenFinished = true;
    next.play();
    if (from && from !== next) next.crossFadeFrom(from, 0.18, false);
    f.playing = next;
  }

  stand() {
    const figure = this.figure;
    if (!figure?.idle) return;
    const previous = figure.playing;
    figure.idle.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (previous) figure.idle.crossFadeFrom(previous, 0.18, false);
    figure.playing = null;
  }

  private resize() {
    if (this.disposed) return;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, equipment.select.dprCap));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private readonly frame = (now: number) => {
    if (this.disposed) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt;
    const goal = along(this.zoom);
    const glide = 1 - Math.exp(-dt * 5);
    this.view.y += (goal.y - this.view.y) * glide;
    this.view.z += (goal.z - this.view.z) * glide;
    this.view.look += (goal.look - this.view.look) * glide;
    this.placeCamera();
    // He turns slowly about straight on, a quarter each way, never showing his back unless dragged round.
    const turn = this.turn.rotation;
    if (this.rotating && this.figure?.playing && !this.drag) {
      const face = Math.round(turn.y / (Math.PI * 2)) * Math.PI * 2 - 0.35;
      turn.y += (face - turn.y) * Math.min(1, dt * 4);
    } else if (this.rotating && !this.drag) {
      const face = Math.round(turn.y / (Math.PI * 2)) * Math.PI * 2 + Math.sin(this.clock / 4) * (0.6 - this.zoom * 0.3);
      turn.y += (face - turn.y) * Math.min(1, dt * 1.5);
    }
    this.figure?.mixer.update(dt);
    void this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  private readonly down = (e: PointerEvent) => {
    this.setRotation(false);
    this.pinch.set(e.pointerId, e.clientX);
    this.drag = { x: e.clientX, turn: this.turn.rotation.y };
    this.canvas.setPointerCapture(e.pointerId);
  };

  private readonly move = (e: PointerEvent) => {
    if (this.pinch.has(e.pointerId)) this.pinch.set(e.pointerId, e.clientX);
    if (this.pinch.size === 2) {
      // Two fingers: their spread zooms, and neither turns him.
      const [a, b] = [...this.pinch.values()];
      const spread = Math.abs(a! - b!);
      if (this.spread) this.zoomBy((spread - this.spread) * 0.004);
      this.spread = spread;
      return;
    }
    const d = this.drag;
    if (!d) return;
    this.turn.rotation.y = d.turn + (e.clientX - d.x) * 0.01;
  };

  private readonly up = (e: PointerEvent) => {
    this.pinch.delete(e.pointerId);
    this.spread = 0;
    this.drag = null;
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.canvas.removeEventListener('pointerdown', this.down);
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerup', this.up);
    this.canvas.removeEventListener('pointercancel', this.up);
    this.canvas.removeEventListener('wheel', this.wheel);
    if (this.figure) {
      this.figure.mixer.stopAllAction();
      free(this.figure.root);
      this.figure = null;
    }
    this.environment.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

const MOVES: { move: Move; label: string }[] = [
  { move: 'command', label: '지휘' },
  { move: 'slash', label: '검술' },
];
const INSPECTION_VIEWS: { view: FigureView; label: string }[] = [
  { view: 'front', label: '정면' },
  { view: 'side', label: '측면' },
  { view: 'back', label: '후면' },
];

/**
 * A general's figure on its stage, made of `files` (figureFor), null until it is known which. The close button takes the
 * camera to his face.
 */
export function GeneralModel({ files, weapon }: { files: string[] | null; weapon?: WeaponDef }) {
  const t = useT();
  const host = useRef<HTMLDivElement | null>(null);
  const stage = useRef<FigureStage | null>(null);
  const [state, setState] = useState<StageState>('loading');
  const [close, setClose] = useState(false);
  const [moves, setMoves] = useState<Move[]>([]);
  const [rotating, setRotating] = useState(true);
  const [inspection, setInspection] = useState<FigureView | null>(null);
  useEffect(() => {
    const s = new FigureStage(host.current!, setState, setClose, setMoves, (auto, view) => {
      setRotating(auto);
      setInspection(view);
    });
    stage.current = s;
    return () => {
      s.dispose();
      stage.current = null;
    };
  }, []);
  const key = `${files?.join('+') ?? ''}:${weapon?.id ?? ''}`;
  useEffect(() => {
    if (files) void stage.current?.show(files, weapon);
    // The files are compared by what they name, not by the array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div className={`gen-model gen-model--${state}`} ref={host}>
      {state === 'loading' && <span className="gen-model__wait" aria-hidden="true" />}
      {state === 'failed' && <p className="gen-model__error" role="status">{t('모델을 불러오지 못했습니다.')}</p>}
      <button className="gen-model__move gen-model__zoom" disabled={state !== 'ready'} aria-pressed={close} onClick={() => stage.current?.setClose(!close)}>
        {t(close ? '전신' : '근접')}
      </button>
      <div className="gen-model__views" role="group" aria-label={t('모델 보기')}>
        {INSPECTION_VIEWS.map(({ view, label }) => (
          <button key={view} className="gen-model__move gen-model__view" disabled={state !== 'ready'} aria-pressed={inspection === view && !rotating} onClick={() => stage.current?.setView(view)}>
            {t(label)}
          </button>
        ))}
        <button className="gen-model__move gen-model__rotate" disabled={state !== 'ready'} aria-pressed={rotating} onClick={() => stage.current?.setRotation(!rotating)}>
          {t(rotating ? '회전 멈춤' : '자동 회전')}
        </button>
      </div>
      <div className="gen-model__moves">
        <button className="gen-model__move" disabled={state !== 'ready'} onClick={() => stage.current?.stand()}>
          {t('서있기')}
        </button>
        {MOVES.filter((m) => moves.includes(m.move)).map((m) => (
          <button key={m.move} className="gen-model__move" disabled={state !== 'ready'} onClick={() => stage.current?.play(m.move)}>
            {t(m.label)}
          </button>
        ))}
      </div>
    </div>
  );
}
