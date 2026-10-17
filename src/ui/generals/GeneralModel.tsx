import { useEffect, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping, AnimationMixer, Box3, Group, LoopOnce, Matrix4, PerspectiveCamera, Quaternion, Scene, SRGBColorSpace, Vector3, WebGPURenderer,
  type AnimationAction, type Bone, type DirectionalLight, type AnimationClip, type BufferGeometry, type DataTexture, type Material, type Mesh, type Object3D, type Skeleton, type SkinnedMesh, type Texture,
} from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { equipment, forceWebGL } from '../../game/quality';
import { useT } from '../../i18n';
import { tuneWebGLBackend } from '../../render/webglBackend';
import { lightStage } from './studio';
import type { WeaponDef } from '../../meta/catalog';
import { idleBlade } from './idleBlade';
import { introLength, markIntroduced, type IntroView } from '../../cinema/commanderIntros';
import { FilmCaptions, useFilmClock } from '../CommanderFilm';

/**
 * One armored representative character, with its own skeleton and motions, plus one replaceable weapon.
 * The index lists available files; each has a desktop GLB, a tablet _lod1 GLB and a phone _lod2 GLB.
 */
let listing: Promise<ReadonlySet<string>> | null = null;
/** Dev server only: `?review=a,b` shows packed figures that are not in the index yet, for the check before they go live. */
function reviewFiles(): string[] {
  if (!import.meta.env.DEV || typeof location === 'undefined') return [];
  return (new URLSearchParams(location.search).get('review') ?? '').split(',').filter((f) => /^[a-zA-Z0-9_-]+$/.test(f));
}
export function listModels() {
  listing ??= fetch(`${import.meta.env.BASE_URL}models/generals/index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<string[]>) : []))
    .then((names) => new Set([...names, ...reviewFiles()]))
    .catch(() => new Set<string>(reviewFiles()));
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

/** New weapon files use metres, +Y along the blade/shaft and a grip at their origin. */
export function holdWeapon(body: Object3D, weapon: Object3D, definition: WeaponDef) {
  const left = definition.kind === 'bow';
  body.updateMatrixWorld(true);
  const socket = body.getObjectByName(left ? 'socket_grip_left' : 'socket_grip_right');
  if (socket) {
    const held = new Group();
    held.name = `held_${definition.id}`;
    held.add(weapon);
    held.position.copy(socket.getWorldPosition(new Vector3()));
    // The socket's +X runs from the wrist toward the closed fingers and its +Y leaves the thumb side; sword files carry
    // their edge on -X, so a half turn about the blade puts the edge on the fingers' side (toward the target, the spine
    // toward the thumb), as a sabre is really held.
    if (definition.kind === 'sword') held.quaternion.copy(socket.getWorldQuaternion(new Quaternion())).multiply(EDGE_TO_FINGERS);
    else if (body.parent) held.quaternion.copy(body.parent.getWorldQuaternion(new Quaternion()));
    // Align a resting polearm/bow upright; an angled forearm would otherwise point a long shaft through the helmet.
    socket.attach(held);
    // A bow is held through the fist along the knuckle line (the socket's +Y): upright beside the body while standing,
    // and in the shot it follows the knuckle line so the bow stands vertical in the extended left hand (aimBow).
    if (left) held.userData.rest = held.quaternion.clone();
    if (definition.kind === 'sword') {
      held.userData.grip = held.quaternion.clone();
      // The files put their origin near the pommel; the fist belongs on the hilt just under the guard (owner 2026-10-17).
      weapon.position.y -= swordGripShift(weapon);
    }
    return held;
  }
  const handName = left ? 'LeftHand' : 'RightHand';
  const hand = body.getObjectByName(handName) ?? body.getObjectByName(left ? 'L_Hand' : 'R_Hand');
  if (!hand) throw new Error('The selected weapon has no hand socket.');
  // The grip is set in the bind pose (the T-pose every figure is rigged in), whatever frame is playing now: there the
  // fist is palm down, so the weapon leaves it forward, tilted down along the arm, and follows the hand from then on.
  let skinned: SkinnedMesh | undefined;
  body.traverse((o) => {
    if (!skinned && (o as SkinnedMesh).isSkinnedMesh && (o as SkinnedMesh).skeleton.bones.includes(hand as Bone)) skinned = o as SkinnedMesh;
  });
  if (!skinned) throw new Error('The selected weapon has no skinned hand.');
  const bones = skinned.skeleton.bones;
  // At rest a bone's world matrix is meshWorld · bindMatrix⁻¹ · boneInverse⁻¹ (the skin then leaves every vertex in place).
  const bindOf = (bone: Object3D) => skinned!.matrixWorld.clone().multiply(skinned!.bindMatrixInverse).multiply(skinned!.skeleton.boneInverses[bones.indexOf(bone as Bone)]!.clone().invert());
  const handBind = bindOf(hand);
  const wrist = new Vector3().setFromMatrixPosition(handBind);
  const fore = hand.parent && bones.includes(hand.parent as Bone) ? new Vector3().setFromMatrixPosition(bindOf(hand.parent)) : wrist.clone().add(new Vector3(left ? -1 : 1, 0, 0));
  const along = wrist.clone().sub(fore).normalize();
  const forward = new Vector3(0, 0, 1).transformDirection(skinned.matrixWorld);
  forward.addScaledVector(along, -forward.dot(along)).normalize();
  const tilt = (GRIP_TILT[definition.kind] * Math.PI) / 180;
  const y = forward.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(along, Math.sin(tilt)).normalize();
  const x = along.clone().cross(y).normalize();
  const z = x.clone().cross(y).normalize();
  const heldBind = new Matrix4().makeBasis(x, y, z).setPosition(wrist.clone().addScaledVector(along, GRIP_REACH));
  const held = new Group();
  held.name = `held_${definition.id}`;
  held.add(weapon);
  // In the hand's frame: its bind pose undone, so the weapon keeps its metres whatever the figure's scale.
  handBind.invert().multiply(heldBind).decompose(held.position, held.quaternion, held.scale);
  hand.add(held);
  return held;
}

/** A half turn about the blade (+Y): the file's edge side (-X) onto the socket's finger side (+X). */
const EDGE_TO_FINGERS = new Quaternion(0, 1, 0, 0);

/** How far the weapon leaves the fist from straight forward toward the line of the arm, degrees, per kind. */
const GRIP_TILT: Record<WeaponDef['kind'], number> = { sword: 35, spear: 0, bow: 0 };
/** From the wrist joint to the middle of the closed fist, metres. */
const GRIP_REACH = 0.075;

/** A base is one complete GLB, never an outfit assembled from character parts. */
function singleModelFile(files: string[]) {
  if (files.length !== 1 || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(files[0]!)) {
    throw new Error('Exactly one model file is required.');
  }
  return files[0]!;
}

/** Preserve the authored hierarchy and animation transforms inside a normalized stage wrapper. */
function normalizeFigure(asset: Object3D) {
  const root = new Group();
  root.name = 'representative_figure';
  const front = asset.userData.frontAxis ?? '+Z';
  const angles: Record<string, number> = { '+Z': 0, '-Z': Math.PI, '+X': -Math.PI / 2, '-X': Math.PI / 2 };
  if (!(front in angles)) throw new Error('Unsupported model front axis.');
  root.rotation.y = angles[front]!;
  root.add(asset);
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  const height = box.max.y - box.min.y;
  if (box.isEmpty() || !Number.isFinite(height) || height <= 0 || ![...box.min, ...box.max].every(Number.isFinite)) {
    throw new Error('The model has no finite geometry.');
  }
  const k = 1.8 / height;
  const centre = box.getCenter(new Vector3());
  root.scale.setScalar(k);
  root.position.set(-centre.x * k, -box.min.y * k, -centre.z * k);
  // Animated arms and weapons can leave the bounds of the exported bind pose.
  root.traverse((o) => (o.frustumCulled = false));
  root.updateMatrixWorld(true);
  return root;
}

/** Each figure ships three levels, picked by the equipment tier: high (PC) LOD0, medium (tablet) _lod1, low (phone) _lod2. */
const LOD_SUFFIX = { high: '', medium: '_lod1', low: '_lod2' } as const;
/** Weapons come in two levels: the desktop file and _lod1 for tablets and phones. */
export const weaponUrl = (id: string) => `${import.meta.env.BASE_URL}models/generals/parts/weapon_${id}${equipment.tier === 'high' ? '' : '_lod1'}.glb`;
export const modelUrl = (file: string) => `${import.meta.env.BASE_URL}models/generals/${file}${LOD_SUFFIX[equipment.tier]}.glb`;

export const loader = new GLTFLoader();
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

/** Dispose only resources that have no remaining owner in the current figure. */
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
type Motion = 'stand' | Move;
type WeaponKind = WeaponDef['kind'];
/**
 * The clips for one weapon kind: `idle_<kind>`, `command_<kind>`, `attack_<kind>` (Meshy library actions packed per
 * kind), else the sword set, else the older single set (idle / command / slash) of figures packed before the kinds.
 */
function movementClips(clips: readonly AnimationClip[], kind: WeaponKind = 'sword') {
  const exact = (name: string) => clips.find((c) => c.name.toLowerCase() === name);
  const find = (...names: string[]) => {
    for (const name of names) {
      const hit = exact(name);
      if (hit) return hit;
    }
    return clips.find((c) => names.some((name) => c.name.toLowerCase().includes(name)));
  };
  const moves = new Map<Move, AnimationClip>();
  const command = exact(`command_${kind}`) ?? exact('command_sword') ?? find('command', 'shout');
  const slash = exact(`attack_${kind}`) ?? exact('attack_sword') ?? find('slash', 'triple_combo', 'combo');
  if (command) moves.set('command', command);
  if (slash) moves.set('slash', slash);
  return { idle: exact(`idle_${kind}`) ?? exact('idle_sword') ?? find('idle'), moves };
}
type FigureView = 'front' | 'side' | 'back';
export type Figure = {
  root: Object3D;
  asset: Object3D;
  mixer: AnimationMixer;
  idle: AnimationAction | null;
  moves: Map<Move, AnimationAction>;
  playing: AnimationAction | null;
  weapon: Object3D | null;
  clips: readonly AnimationClip[];
  kind: WeaponKind;
  finished: (event: { action: AnimationAction }) => void;
};

export function createFigure(asset: Object3D, animations: readonly AnimationClip[], kind: WeaponKind): Figure {
  const root = normalizeFigure(asset);
  const mixer = new AnimationMixer(asset);
  const figure: Figure = { root, asset, mixer, idle: null, moves: new Map(), playing: null, weapon: null, clips: animations, kind, finished: () => {} };
  figure.finished = (event) => {
    if (event.action === figure.playing && figure.idle) standFigure(figure);
  };
  mixer.addEventListener('finished', figure.finished);
  armFigure(figure, kind);
  return figure;
}

/** Switches the figure to the motion set of a weapon kind and stands it in that set's idle. */
function armFigure(figure: Figure, kind: WeaponKind) {
  const clips = movementClips(figure.clips, kind);
  const idle = clips.idle ? figure.mixer.clipAction(clips.idle) : null;
  figure.kind = kind;
  // Files packed with one set (or a kind that shares the current clips) keep whatever is playing.
  const same = figure.idle === idle && [...clips.moves].every(([move, clip]) => figure.moves.get(move)?.getClip() === clip) && figure.moves.size === clips.moves.size;
  if (same && (figure.idle || figure.moves.size)) return;
  figure.mixer.stopAllAction();
  figure.idle = idle;
  figure.moves = new Map();
  for (const [move, clip] of clips.moves) figure.moves.set(move, figure.mixer.clipAction(clip).setLoop(LoopOnce, 1));
  figure.playing = null;
  idle?.reset().play();
  figure.mixer.update(0);
}

const GRIP = new Quaternion();
/** Blends a held bow from its upright rest to the socket's knuckle line by the weight of the shot (attack_bow). */
export function aimBow(figure: Figure) {
  const held = figure.weapon, rest = held?.userData.rest as Quaternion | undefined;
  if (!held || !rest || figure.kind !== 'bow') return;
  const shot = figure.moves.get('slash');
  const w = shot?.isRunning() ? shot.getEffectiveWeight() : 0;
  held.quaternion.slerpQuaternions(rest, GRIP, w);
}

/** Metres to slide a sword down its +Y so the fist centre sits FIST below the guard (the widest slice of the lower half). */
const FIST = 0.055;
export function swordGripShift(weapon: Object3D) {
  weapon.updateMatrixWorld(true);
  const inv = new Matrix4().copy(weapon.matrixWorld).invert(), v = new Vector3(), pts: Vector3[] = [];
  weapon.traverse((o) => {
    const g = (o as Mesh).geometry as BufferGeometry | undefined, pos = g?.getAttribute('position');
    if (!(o as Mesh).isMesh || !pos) return;
    const m = new Matrix4().multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < pos.count; i++) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(m).clone());
  });
  if (!pts.length) return 0;
  let lo = Infinity, hi = -Infinity; for (const p of pts) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); }
  const bins = 60, wide = new Array<number>(bins).fill(0), step = (hi - lo) / bins;
  for (const p of pts) { const b = Math.min(bins - 1, Math.floor((p.y - lo) / step)); wide[b] = Math.max(wide[b]!, Math.hypot(p.x, p.z)); }
  let g = 0; for (let b = 0; b < bins / 2; b++) if (wide[b]! > wide[g]!) g = b;
  const guard = lo + (g + 0.5) * step;
  return Math.max(0, guard - FIST);
}

const tmpA = new Vector3(), tmpB = new Vector3(), tmpQ = new Quaternion(), tmpM = new Matrix4(), idleQ = new Quaternion();
/** While the figure stands, a held sword hangs outside the legs (idleBlade); in a move it is gripped as the fist holds it. */
export function hangSword(figure: Figure) {
  const held = figure.weapon, grip = held?.userData.grip as Quaternion | undefined;
  const socket = held?.parent, hips = figure.root.getObjectByName('Hips');
  if (!held || !grip || !socket || !hips || figure.kind !== 'sword') return;
  const w = figure.idle?.isRunning() ? figure.idle.getEffectiveWeight() : 0;
  if (w <= 0) { held.quaternion.copy(grip); return; }
  figure.root.updateMatrixWorld(true);
  const hand = figure.root.worldToLocal(socket.getWorldPosition(tmpA)).toArray();
  const hip = figure.root.worldToLocal(hips.getWorldPosition(tmpB)).toArray();
  const { dir, edge } = idleBlade(hand, hip);
  const x = new Vector3(...edge), y = new Vector3(...dir), z = new Vector3().crossVectors(x, y);
  idleQ.setFromRotationMatrix(tmpM.makeBasis(x, y, z)).premultiply(figure.root.getWorldQuaternion(tmpQ));
  idleQ.premultiply(socket.getWorldQuaternion(tmpQ).invert());
  held.quaternion.slerpQuaternions(grip, idleQ, Math.min(1, w));
}

export function playFigure(figure: Figure, move: Move) {
  const next = figure.moves.get(move);
  if (!next) return false;
  const from = figure.playing ?? figure.idle;
  next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1);
  next.clampWhenFinished = true;
  next.play();
  if (from && from !== next) next.crossFadeFrom(from, 0.18, false);
  figure.playing = next;
  return true;
}

export function standFigure(figure: Figure) {
  if (!figure.idle) return false;
  const previous = figure.playing;
  figure.idle.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
  if (previous) figure.idle.crossFadeFrom(previous, 0.18, false);
  figure.playing = null;
  return true;
}

export function releaseFigure(figure: Figure, retained?: Object3D) {
  figure.mixer.removeEventListener('finished', figure.finished);
  figure.mixer.stopAllAction();
  figure.mixer.uncacheRoot(figure.asset);
  free(figure.root, retained);
}

const availableMotions = (figure: Figure): Motion[] => [...(figure.idle ? ['stand' as const] : []), ...figure.moves.keys()];
type StageState = 'loading' | 'ready' | 'failed';
type WeaponState = StageState | 'none';

/**
 * A dark stage with one general standing on it, turning slowly about straight on; dragging turns him, the wheel or a
 * pinch brings the camera in to his face and back. Weapon changes keep the complete character and its current motion.
 * The stage owns its renderer and frees it, the figure and its textures when it closes.
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
  private request = 0;
  private weaponRequest = 0;
  private weaponDefinition: WeaponDef | undefined;
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
  /** A commander's opening is playing: its start (performance.now) and length in seconds; the camera follows its path. */
  private film: { start: number; length: number } | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly onState: (s: StageState) => void,
    private readonly onZoom: (close: boolean) => void,
    private readonly onMoves: (moves: Motion[]) => void,
    private readonly onTurn: (rotating: boolean, view: FigureView | null) => void,
    private readonly onWeaponState: (s: WeaponState) => void,
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
    // Initialization may fail before a model is requested, including during an unmount.
    void this.started.catch(() => { if (!this.disposed) this.onState('failed'); });
  }

  private placeCamera() {
    this.camera.position.set(0, this.view.y, this.view.z);
    this.camera.lookAt(0, this.view.look, 0);
  }

  /**
   * His opening (CommanderFilm.tsx): from low and wide, the whole figure in haze at the right of the frame, a slow
   * push-in to his face; the key light drops and the rim comes up. Null hands the camera back.
   */
  setFilm(length: number | null) {
    this.film = length === null ? null : { start: performance.now(), length };
    this.scene.traverse((o) => {
      const l = o as DirectionalLight;
      if (!l.isDirectionalLight) return;
      l.userData.base ??= l.intensity;
      const rim = l.position.z < 0;
      l.intensity = length === null ? (l.userData.base as number) : (l.userData.base as number) * (rim ? 2.6 : 0.75);
    });
    if (length === null) this.placeCamera();
  }

  private filmCamera(now: number) {
    const f = this.film!;
    const s = Math.min(1, Math.max(0, (now - f.start) / 1000 / f.length));
    const k = s * s * (3 - 2 * s);
    const lerp = (a: number, b: number) => a + (b - a) * k;
    // Upright screens keep him in the middle; wide ones leave the left for his name.
    const wide = Math.min(1, Math.max(0, this.camera.aspect - 0.8));
    this.camera.position.set(lerp(-1.1, 0.42), lerp(0.45, 1.66), lerp(6.2, 1.55));
    this.camera.lookAt(lerp(-0.9, -0.22) * wide, lerp(1.0, 1.58), 0);
    this.turn.rotation.y = lerp(-0.42, -0.2);
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

  private clearFigure() {
    if (!this.figure) return;
    this.turn.remove(this.figure.root);
    releaseFigure(this.figure);
    this.figure = null;
  }

  async show(files: string[] | null) {
    if (this.disposed) return;
    const request = ++this.request;
    ++this.weaponRequest;
    this.clearFigure();
    this.onState('loading');
    this.onMoves([]);
    this.onWeaponState('none');
    if (files === null) return;
    let loaded: Object3D | null = null;
    try {
      const file = singleModelFile(files);
      await this.started;
      if (this.disposed || this.request !== request) return;
      const gltf = await loader.loadAsync(modelUrl(file));
      loaded = gltf.scene;
      // Armour as separate rigid pieces (pilot 2026-10-17): a `piece_<part>` node under a bone names its piece file in
      // its extras; the piece hangs there unskinned, like the weapon. Swapping armour = swapping these files.
      const mounts: Object3D[] = [];
      loaded.traverse((o) => { if (typeof o.userData.piece === 'string' && /^[\w/-]+$/.test(o.userData.piece)) mounts.push(o); });
      for (const mount of mounts) {
        const piece = (await loader.loadAsync(`${import.meta.env.BASE_URL}models/generals/${mount.userData.piece}.glb`)).scene;
        piece.traverse((o) => (o.frustumCulled = false));
        mount.add(piece);
      }
      if (this.disposed || this.request !== request) {
        free(loaded, this.figure?.root);
        return;
      }
      const figure = createFigure(loaded, gltf.animations, this.weaponDefinition?.kind ?? 'sword');
      this.figure = figure;
      this.turn.add(figure.root);
      loaded = null;
      this.onMoves(availableMotions(figure));
      this.onState('ready');
      await this.loadWeapon();
    } catch {
      if (loaded) free(loaded, this.figure?.root);
      if (!this.disposed && this.request === request) {
        this.clearFigure();
        this.onMoves([]);
        this.onState('failed');
      }
    }
  }

  /** The selected weapon is the only separate model; replacing it keeps the body and mixer. */
  async setWeapon(definition?: WeaponDef) {
    if (this.disposed) return;
    this.weaponDefinition = definition;
    await this.loadWeapon();
  }

  private async loadWeapon() {
    const request = ++this.weaponRequest;
    const figure = this.figure;
    if (figure?.weapon) {
      const old = figure.weapon;
      old.removeFromParent();
      figure.weapon = null;
      free(old, figure.root);
    }
    const definition = this.weaponDefinition;
    if (figure) armFigure(figure, definition?.kind ?? 'sword');
    if (!figure || !definition) {
      this.onWeaponState('none');
      return;
    }
    this.onWeaponState('loading');
    let loaded: Object3D | null = null;
    try {
      if (!/^[a-zA-Z0-9_-]+$/.test(definition.id)) throw new Error('Invalid weapon file.');
      const gltf = await loader.loadAsync(weaponUrl(definition.id));
      loaded = gltf.scene;
      if (this.disposed || this.weaponRequest !== request || this.figure !== figure) {
        free(loaded, this.figure?.root);
        return;
      }
      loaded.traverse((o) => (o.frustumCulled = false));
      figure.weapon = holdWeapon(figure.root, loaded, definition);
      loaded = null;
      this.onWeaponState('ready');
    } catch {
      if (loaded) free(loaded, this.figure?.root);
      if (!this.disposed && this.weaponRequest === request && this.figure === figure) this.onWeaponState('failed');
    }
  }

  /** An authored move, once, followed by the authored standing motion when available. */
  play(move: Move) {
    if (this.figure) playFigure(this.figure, move);
  }

  stand() {
    if (this.figure) standFigure(this.figure);
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
    if (this.film) this.filmCamera(now);
    else this.placeCamera();
    // He turns slowly about straight on, a quarter each way, never showing his back unless dragged round.
    const turn = this.turn.rotation;
    if (this.film) {
      // The film holds his turn.
    } else if (this.rotating && this.figure?.playing && !this.drag) {
      const face = Math.round(turn.y / (Math.PI * 2)) * Math.PI * 2 - 0.35;
      turn.y += (face - turn.y) * Math.min(1, dt * 4);
    } else if (this.rotating && !this.drag) {
      const face = Math.round(turn.y / (Math.PI * 2)) * Math.PI * 2 + Math.sin(this.clock / 4) * (0.6 - this.zoom * 0.3);
      turn.y += (face - turn.y) * Math.min(1, dt * 1.5);
    }
    this.figure?.mixer.update(dt);
    if (this.figure) { aimBow(this.figure); hangSword(this.figure); }
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
    if (this.disposed) return;
    this.disposed = true;
    ++this.request;
    ++this.weaponRequest;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.canvas.removeEventListener('pointerdown', this.down);
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerup', this.up);
    this.canvas.removeEventListener('pointercancel', this.up);
    this.canvas.removeEventListener('wheel', this.wheel);
    this.clearFigure();
    this.environment.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

const MOVES: { move: Motion; label: string }[] = [
  { move: 'stand', label: '서있기' },
  { move: 'command', label: '지휘' },
  { move: 'slash', label: '검술' },
];
/** The attack button names the art of the weapon in hand. */
const ATTACK_LABEL: Record<WeaponKind, string> = { sword: '검술', spear: '창술', bow: '궁술' };
const INSPECTION_VIEWS: { view: FigureView; label: string }[] = [
  { view: 'front', label: '정면' },
  { view: 'side', label: '측면' },
  { view: 'back', label: '후면' },
];

/**
 * One complete character file, null while its availability is unknown, and an optional replaceable weapon.
 */
/** His opening over the stage: the stage's camera follows the film while it runs. */
function StageFilm({ intro, stage, onDone }: { intro: IntroView; stage: FigureStage | null; onDone: () => void }) {
  const length = introLength(intro);
  const t = useFilmClock(length, onDone);
  useEffect(() => {
    markIntroduced(intro.id);
    stage?.setFilm(length);
    return () => stage?.setFilm(null);
  }, [intro.id, stage, length]);
  return <FilmCaptions intro={intro} t={t} onSkip={onDone} />;
}

export function GeneralModel({ files, weapon, film, onFilmEnd }: { files: string[] | null; weapon?: WeaponDef; film?: IntroView | null; onFilmEnd?: () => void }) {
  const t = useT();
  const host = useRef<HTMLDivElement | null>(null);
  const stage = useRef<FigureStage | null>(null);
  const [state, setState] = useState<StageState>('loading');
  const [close, setClose] = useState(false);
  const [moves, setMoves] = useState<Motion[]>([]);
  const [weaponState, setWeaponState] = useState<WeaponState>('none');
  const [rotating, setRotating] = useState(true);
  const [inspection, setInspection] = useState<FigureView | null>(null);
  useEffect(() => {
    const s = new FigureStage(host.current!, setState, setClose, setMoves, (auto, view) => {
      setRotating(auto);
      setInspection(view);
    }, setWeaponState);
    stage.current = s;
    return () => {
      s.dispose();
      stage.current = null;
    };
  }, []);
  const key = files === null ? null : JSON.stringify(files);
  useEffect(() => {
    void stage.current?.show(files);
    // The files are compared by what they name, not by the array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    void stage.current?.setWeapon(weapon);
    // Weapon identity is stable in the catalog; a selection never reloads the complete character.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weapon?.id]);
  return (
    <div className={`gen-model gen-model--${state}${film ? ' gen-model--film' : ''}`} ref={host}>
      {film && <StageFilm intro={film} stage={stage.current} onDone={() => onFilmEnd?.()} />}
      {state === 'loading' && <span className="gen-model__wait" aria-hidden="true" />}
      {state === 'failed' && <p className="gen-model__error" role="status">{t('모델을 불러오지 못했습니다.')}</p>}
      {state === 'ready' && weaponState === 'loading' && <p className="gen-model__weapon-status" role="status">{t('무기를 불러오는 중입니다.')}</p>}
      {state === 'ready' && weaponState === 'failed' && <p className="gen-model__weapon-status" role="status">{t('무기를 불러오지 못했습니다.')}</p>}
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
        {MOVES.filter((m) => moves.includes(m.move)).map((m) => (
          <button key={m.move} className="gen-model__move" disabled={state !== 'ready'} onClick={() => m.move === 'stand' ? stage.current?.stand() : stage.current?.play(m.move)}>
            {t(m.move === 'slash' ? ATTACK_LABEL[weapon?.kind ?? 'sword'] : m.label)}
          </button>
        ))}
      </div>
    </div>
  );
}
