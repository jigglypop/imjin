import {
  Box3,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Vector3,
  type Material,
  type Object3D,
  type PerspectiveCamera,
} from 'three/webgpu';
import { abs, atan, attribute, float, fract, mix, positionLocal, sin, step, time, uniform, uv, vec3, vec4 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BUILDINGS, type BuildingKind, type CapturePoint, type Conquest } from '../sim/conquest';
import type { Faction, Team } from '../sim/types';
import { equipment } from '../game/quality';
import { iconSvg } from '../ui/battleIcons';

/** Footprint widths in metres. */
const SIZE: Record<BuildingKind, number> = { shipyard: 30, battery: 24, magazine: 11, dock: 20, beacon: 17 };
const FILE: Record<BuildingKind, string> = { shipyard: 'shipyard', battery: 'battery', magazine: 'magazine', dock: 'dock', beacon: 'bongsu' };
const NEAR = 650;
const CAP = 64;

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

type Model = { geometry: BufferGeometry; material: Material; base: Matrix4 };

// Shared by every battle of the page.
const models = new Map<string, Promise<Model | null>>();

function loadModel(kind: BuildingKind, suffix: string) {
  const key = FILE[kind] + suffix;
  let model = models.get(key);
  if (!model) {
    model = fetchModel(kind, suffix);
    models.set(key, model);
  }
  return model;
}

async function fetchModel(kind: BuildingKind, suffix: string): Promise<Model | null> {
  try {
    const gltf = await loader.loadAsync(`/models/env/${FILE[kind]}${suffix}.glb`);
    let mesh: Mesh | null = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o: Object3D) => {
      if (!mesh && (o as Mesh).isMesh) mesh = o as Mesh;
    });
    if (!mesh) return null;
    const m = mesh as Mesh;
    const geometry = m.geometry.clone().applyMatrix4(m.matrixWorld);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox as Box3;
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const scale = SIZE[kind] / Math.max(size.x, size.z);
    const base = new Matrix4().makeScale(scale, scale, scale).multiply(new Matrix4().makeTranslation(-center.x, -box.min.y - size.y * 0.03, -center.z));
    return { geometry, material: m.material as Material, base };
  } catch {
    return null;
  }
}

/** Fetches every shore-works model into the cache, ahead of the conquest view that will draw them. */
export async function preloadWorks() {
  await Promise.all((Object.keys(BUILDINGS) as BuildingKind[]).map((kind) => Promise.all([equipment.ships.skipLod0 ? null : loadModel(kind, ''), loadModel(kind, '_lod1')])));
}

/** Banner colours by navy: the faction tones of the HUD (styles.css), a little lifted so cloth reads in daylight. */
const FLAG: Record<Faction, Color> = { joseon: new Color('#4f7088'), japan: new Color('#7a564a'), ming: new Color('#a08450') };
const NEUTRAL = new Color('#d9dcdf');
/** Ring strokes: the player's navy in slate, the foe's in umber, a point nobody holds in grey. */
const RING_OWN = new Color('#7597b1');
const RING_FOE = new Color('#b0806c');
const RING_WARN = new Color('#d1b274');

type Label = { root: HTMLDivElement; name: HTMLElement; bar: HTMLElement; fill: HTMLElement; works: HTMLElement; last: string };

/**
 * The capture points of a conquest battle: a thin ring on the water that fills as a point changes hands, the shore
 * works on land, a banner in the holder's colours, and a small glass label with the name, the hold and the works.
 */
export class ConquestView {
  readonly group = new Group();
  private readonly rings: Mesh[] = [];
  private readonly ringState: { color: ReturnType<typeof uniform>; hold: ReturnType<typeof uniform>; capture: ReturnType<typeof uniform>; selected: ReturnType<typeof uniform>; contested: ReturnType<typeof uniform> }[] = [];
  private readonly batches = new Map<BuildingKind, { near: InstancedMesh; far: InstancedMesh }>();
  private readonly poles: InstancedMesh;
  private readonly cloths: InstancedMesh;
  private readonly clothColor: InstancedBufferAttribute;
  private readonly layer: HTMLDivElement;
  private readonly labels: Label[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly tmp = new Vector3();
  private bar = { left: 0, right: 0, bottom: 0 };
  private barAt = -1e9;
  onSelect: ((point: number) => void) | null = null;

  constructor(
    private readonly conquest: Conquest,
    private readonly heightAt: (x: number, z: number) => number,
    parent: HTMLElement,
  ) {
    for (const p of conquest.points) this.addRing(p);
    const poleGeo = new CylinderGeometry(0.18, 0.24, 14, 6);
    poleGeo.translate(0, 7, 0);
    this.poles = new InstancedMesh(poleGeo, new MeshStandardNodeMaterial({ color: 0x3a2a1c, roughness: 0.9 }), CAP);
    const clothGeo = new PlaneGeometry(4.2, 6.4, 8, 6);
    clothGeo.translate(2.1, 10.6, 0);
    this.clothColor = new InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    const cloth = new MeshStandardNodeMaterial({ side: DoubleSide, roughness: 0.85 });
    // A banner in the wind: the free edge ripples more than the edge at the pole.
    const along = positionLocal.x.div(4.2).clamp(0, 1);
    const wave = sin(positionLocal.x.mul(1.6).sub(time.mul(5))).mul(along).mul(0.35);
    cloth.positionNode = positionLocal.add(vec3(0, sin(positionLocal.x.mul(0.9).sub(time.mul(3.1))).mul(along).mul(0.15), wave));
    cloth.colorNode = attribute('clothColor', 'vec3');
    clothGeo.setAttribute('clothColor', this.clothColor);
    this.cloths = new InstancedMesh(clothGeo, cloth, CAP);
    for (const mesh of [this.poles, this.cloths]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      this.group.add(mesh);
    }
    this.layer = document.createElement('div');
    this.layer.className = 'cpoints';
    parent.appendChild(this.layer);
    for (const p of conquest.points) this.labels.push(this.addLabel(p));
  }

  async load() {
    await Promise.all(
      (Object.keys(BUILDINGS) as BuildingKind[]).map(async (kind) => {
        // Phones skip the 1024 px near model. The low level is a quarter of the size and reads the same on a phone screen.
        const [full, far] = await Promise.all([equipment.ships.skipLod0 ? null : loadModel(kind, ''), loadModel(kind, '_lod1')]);
        const near = full ?? far ?? (await loadModel(kind, ''));
        if (!near) return;
        const farModel = far ?? near;
        const a = new InstancedMesh(near.geometry, near.material, CAP);
        const b = new InstancedMesh(farModel.geometry, farModel.material, CAP);
        a.userData.base = near.base;
        b.userData.base = farModel.base;
        for (const mesh of [a, b]) {
          mesh.count = 0;
          mesh.frustumCulled = false;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.group.add(mesh);
        }
        this.batches.set(kind, { near: a, far: b });
      }),
    );
  }

  private addRing(p: CapturePoint) {
    const geo = new RingGeometry(0.986, 1, 192, 1);
    geo.rotateX(-Math.PI / 2);
    const color = uniform(new Color(1, 1, 1));
    const capture = uniform(new Color(1, 1, 1));
    const hold = uniform(0);
    const selected = uniform(0);
    const contested = uniform(0);
    const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    // The ring fills clockwise in the capturing side's tone as the hold moves away from the holder.
    const c = uv().sub(0.5);
    const angle = fract(atan(c.y, c.x).div(Math.PI * 2).add(0.25));
    const filled = step(angle, abs(hold));
    const base = mix(color, capture, filled);
    const pulse = sin(time.mul(7)).mul(0.5).add(0.5);
    const rgb = mix(base, vec3(RING_WARN.r, RING_WARN.g, RING_WARN.b), contested.mul(pulse).mul(0.7));
    mat.colorNode = vec4(rgb, 1);
    mat.opacityNode = float(0.6).add(selected.mul(0.3)).add(contested.mul(pulse).mul(0.15));
    mat.fog = false;
    const mesh = new Mesh(geo, mat);
    mesh.scale.setScalar(p.r);
    mesh.position.set(p.x, 1.4, p.z);
    mesh.renderOrder = 3;
    this.group.add(mesh);
    this.rings.push(mesh);
    this.ringState.push({ color, hold, capture, selected, contested });
  }

  private addLabel(p: CapturePoint): Label {
    const root = document.createElement('div');
    root.className = 'cpoint';
    const pill = document.createElement('div');
    pill.className = 'cpoint-pill';
    const name = document.createElement('span');
    name.className = 'cpoint-name';
    name.textContent = p.name;
    const works = document.createElement('span');
    works.className = 'cpoint-works';
    const bar = document.createElement('div');
    bar.className = 'cpoint-bar';
    const fill = document.createElement('i');
    bar.appendChild(fill);
    pill.append(name, works, bar);
    root.appendChild(pill);
    root.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.button === 0) this.onSelect?.(p.id);
    });
    this.layer.appendChild(root);
    return { root, name, bar, fill, works, last: '' };
  }

  private teamColor(team: Team | null, playerTeam: Team) {
    if (!team) return NEUTRAL;
    return team === playerTeam ? RING_OWN : RING_FOE;
  }

  update(camera: PerspectiveCamera, width: number, height: number, playerTeam: Team, selected: number, showLabels: boolean) {
    const c = this.conquest;
    let flags = 0;
    const counts = new Map<InstancedMesh, number>();
    const cam = camera.position;
    c.points.forEach((p, i) => {
      const st = this.ringState[i]!;
      // Neutral ring, filled clockwise by how far the side the hold favours has got.
      const towards: Team | null = p.hold > 0 ? 'joseon' : p.hold < 0 ? 'japan' : null;
      (st.color.value as Color).copy(NEUTRAL);
      (st.capture.value as Color).copy(this.teamColor(towards, playerTeam));
      st.hold.value = Math.abs(p.hold);
      st.selected.value = selected === p.id ? 1 : 0;
      st.contested.value = p.contested ? 1 : 0;
      // Shore works.
      p.buildings.forEach((bd, slot) => {
        if (!bd) return;
        const batch = this.batches.get(bd.kind);
        if (!batch) return;
        const spot = p.slots[slot]!;
        const d = Math.hypot(spot.x - cam.x, spot.z - cam.z, cam.y - spot.y);
        const mesh = d < NEAR ? batch.near : batch.far;
        const n = counts.get(mesh) ?? 0;
        if (n >= CAP) return;
        const grow = bd.progress >= 1 ? 1 : 0.12 + bd.progress * 0.88;
        const ruin = bd.hp / BUILDINGS[bd.kind].hp;
        this.q.setFromAxisAngle(this.up, Math.PI / 2 - spot.rot);
        this.p.set(spot.x, this.heightAt(spot.x, spot.z) - (1 - grow) * 2 - (ruin < 0.35 ? 0.6 : 0), spot.z);
        this.s.set(1, grow, 1);
        this.m.compose(this.p, this.q, this.s).multiply(mesh.userData.base as Matrix4);
        mesh.setMatrixAt(n, this.m);
        counts.set(mesh, n + 1);
      });
      // Banner of the holder beside the first plot.
      const spot = p.slots[0];
      if (spot && flags < CAP) {
        const fx = spot.x - Math.cos(spot.rot) * 4 + Math.cos(spot.rot + Math.PI / 2) * 14;
        const fz = spot.z - Math.sin(spot.rot) * 4 + Math.sin(spot.rot + Math.PI / 2) * 14;
        this.q.setFromAxisAngle(this.up, -spot.rot);
        this.p.set(fx, this.heightAt(fx, fz) - 0.3, fz);
        this.s.set(1, 1, 1);
        this.m.compose(this.p, this.q, this.s);
        this.poles.setMatrixAt(flags, this.m);
        this.cloths.setMatrixAt(flags, this.m);
        const owner = p.owner >= 0 ? c.player(p.owner) : undefined;
        const col = owner ? FLAG[owner.faction] : NEUTRAL;
        this.clothColor.setXYZ(flags, col.r, col.g, col.b);
        flags += 1;
      }
    });
    for (const batch of this.batches.values()) {
      for (const mesh of [batch.near, batch.far]) {
        mesh.count = counts.get(mesh) ?? 0;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this.poles.count = flags;
    this.cloths.count = flags;
    this.poles.instanceMatrix.needsUpdate = true;
    this.cloths.instanceMatrix.needsUpdate = true;
    this.clothColor.needsUpdate = true;
    this.updateLabels(camera, width, height, playerTeam, selected, showLabels);
  }

  /** Bottom edge of the score panel and the span it covers, so labels never sit under it. Re-measured twice a second. */
  private barBox() {
    const now = performance.now();
    if (now - this.barAt > 500) {
      this.barAt = now;
      const el = document.querySelector('.balance');
      const r = el?.getBoundingClientRect();
      this.bar = r && r.height > 0 ? { left: r.left - 8, right: r.right + 8, bottom: r.bottom + 6 } : { left: 0, right: 0, bottom: 0 };
    }
    return this.bar;
  }

  /**
   * Labels are placed by priority (selected, own home, contested, enemy home, rich points, near ones): each takes its
   * spot over the point, slides up out of the way of the labels already placed and out from under the top bar, and
   * fades with distance. A point that cannot be placed without covering a higher-priority one is hidden.
   */
  private updateLabels(camera: PerspectiveCamera, width: number, height: number, playerTeam: Team, selected: number, show: boolean) {
    this.layer.style.display = show ? '' : 'none';
    if (!show) return;
    const c = this.conquest;
    const bar = this.barBox();
    const cands: { label: Label; p: CapturePoint; sx: number; sy: number; dist: number; scale: number; rank: number; edge: boolean }[] = [];
    c.points.forEach((p, i) => {
      const label = this.labels[i]!;
      // The picked point is described by its own panel; a label behind that glass would only show through as ghost text.
      if (selected === p.id) {
        label.root.style.display = 'none';
        return;
      }
      this.tmp.set(p.x, 26, p.z);
      const dist = this.tmp.distanceTo(camera.position);
      this.tmp.project(camera);
      const on = this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.1 && Math.abs(this.tmp.y) < 1.1;
      const own = p.home >= 0 && c.teamOfPoint(p) === playerTeam;
      if (!on && !own) {
        label.root.style.display = 'none';
        return;
      }
      let nx = this.tmp.x;
      let ny = this.tmp.y;
      // The player's own home port is never lost: off screen (even behind the camera) its label pins to the edge
      // the port lies toward.
      if (!on) {
        if (this.tmp.z > 1) {
          nx = -nx;
          ny = -ny;
        }
        const far = Math.max(Math.abs(nx), Math.abs(ny), 1e-3);
        // The bottom edge stops above the minimap and the command panels.
        nx = (nx / far) * 0.93;
        ny = Math.max(-0.5, (ny / far) * 0.9);
      }
      const sx = (nx * 0.5 + 0.5) * width;
      const sy = (-ny * 0.5 + 0.5) * height;
      const scale = on ? Math.max(0.7, Math.min(1.05, 1600 / Math.max(dist, 1))) : 0.85;
      const rank = (selected === p.id ? 1e6 : 0) + (own ? 5e5 : 0) + (p.contested ? 3e5 : 0) + (p.home >= 0 ? 2e5 : 0) + p.value * 1e4 - dist;
      cands.push({ label, p, sx, sy, dist, scale, rank, edge: !on });
    });
    cands.sort((a, b) => b.rank - a.rank);
    const placed: { l: number; r: number; t: number; b: number }[] = [];
    for (const { label, p, sx, sy, dist, scale, rank, edge } of cands) {
      const w = (label.root.offsetWidth || 80) * scale;
      const h = (label.root.offsetHeight || 44) * scale;
      const l = Math.max(4, Math.min(width - w - 4, sx - w / 2));
      const underBar = l + w > bar.left && l < bar.right;
      const minTop = underBar ? bar.bottom : 6;
      let top = Math.max(minTop, sy - h);
      // Slide up past a label already there; below the bar there is no up, so slide down instead.
      let step = 0;
      const hit = () => placed.find((o) => l < o.r + 4 && l + w > o.l - 4 && top < o.b + 3 && top + h > o.t - 3);
      let o = hit();
      while (o && step < 6) {
        top = o.t - h - 3 >= minTop ? o.t - h - 3 : o.b + 3;
        o = hit();
        step += 1;
      }
      if (o || top > height - 70) {
        label.root.style.display = 'none';
        continue;
      }
      placed.push({ l, r: l + w, t: top, b: top + h });
      // Far points fade out, the ones that matter stay.
      const fade = rank >= 2e5 ? 1 : Math.max(0.35, Math.min(1, 1 - (dist - 2600) / 3000));
      label.root.style.display = '';
      label.root.style.opacity = fade.toFixed(2);
      label.root.style.transform = `translate(${l.toFixed(1)}px, ${top.toFixed(1)}px) scale(${scale.toFixed(3)})`;
      const holder = c.teamOfPoint(p);
      const side = holder ? (holder === playerTeam ? 'own' : 'foe') : 'none';
      const works = p.buildings.map((bd) => (bd ? `${bd.kind}${bd.progress < 1 ? '*' : ''}` : '')).join(',');
      const key = `${edge}|${side}|${p.contested}|${selected === p.id}|${works}|${p.queue.length}|${Math.round(Math.abs(p.hold) * 20)}`;
      if (key === label.last) continue;
      label.last = key;
      label.root.className = `cpoint cpoint--${side}${p.contested ? ' cpoint--contested' : ''}${selected === p.id ? ' cpoint--selected' : ''}${p.home >= 0 ? ' cpoint--home' : ''}${edge ? ' cpoint--edge' : ''}`;
      label.fill.style.width = `${Math.round(Math.abs(p.hold) * 100)}%`;
      label.fill.className = p.hold === 0 ? '' : (p.hold > 0 ? 'joseon' : 'japan') === playerTeam ? 'own' : 'foe';
      label.works.innerHTML =
        p.buildings.map((bd) => (bd ? `<span class="${bd.progress < 1 ? 'cpoint-wip' : ''}">${iconSvg(bd.kind, 13)}</span>` : '')).join('') + (p.queue.length ? `<em>함선 ${p.queue.length}</em>` : '');
    }
  }

  /** Frees the rings, banners and instance buffers. The building models stay cached for the next battle. */
  dispose() {
    this.layer.remove();
    for (const mesh of [...this.rings, this.poles, this.cloths]) {
      mesh.geometry.dispose();
      (mesh.material as Material).dispose();
    }
    for (const batch of this.batches.values()) {
      batch.near.dispose();
      batch.far.dispose();
    }
    this.group.removeFromParent();
  }
}
