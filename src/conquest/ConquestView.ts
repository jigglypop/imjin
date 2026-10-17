import {
  Box3,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Material,
  type Object3D,
  type PerspectiveCamera,
} from 'three/webgpu';
import { attribute, positionLocal, sin, time, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BUILDINGS, buildingHp, type BuildingKind, type CapturePoint, type Conquest } from '../sim/conquest';
import type { Faction, Team } from '../sim/types';
import { equipment } from '../game/quality';
import { iconSvg } from '../ui/battleIcons';
import { getLang, t } from '../i18n';
import type { Battle } from '../sim/battle';
import { pointVisible } from '../sim/visibility';

/** Footprint widths in metres. */
const SIZE: Record<BuildingKind, number> = { shipyard: 30, battery: 24, magazine: 11, dock: 20, beacon: 17, camp: 24 };
// A camp uses the game's existing tiled barracks/hall model, including its authored low-detail model.
const FILE: Record<BuildingKind, string> = { shipyard: 'shipyard', battery: 'battery', magazine: 'magazine', dock: 'dock', beacon: 'bongsu', camp: 'giwa' };
const NEAR = 650;
const CAP = 256;

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
const FLAG: Record<Faction, Color> = { joseon: new Color('#4f7088'), japan: new Color('#7a564a'), ming: new Color('#a08450'), england: new Color('#9a3a3a'), spain: new Color('#b08a3a'), holyleague: new Color('#3f5f8f'), ottoman: new Color('#3f7a52') };
const NEUTRAL = new Color('#d9dcdf');

type Label = { root: HTMLDivElement; name: HTMLElement; bar: HTMLElement; fill: HTMLElement; works: HTMLElement; last: string };

/**
 * Ports are marked by the holder's banner on shore and a small label with the hold and the works.
 * A picked port gets quiet corners around its coastal standard; the capture radius stays in the simulation.
 */
export class ConquestView {
  readonly group = new Group();
  private readonly selectionMarker: Mesh;
  private readonly batches = new Map<BuildingKind, { near: InstancedMesh; far: InstancedMesh }>();
  private disposed = false;
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
    this.selectionMarker = this.makeSelectionMarker();
    this.group.add(this.selectionMarker);
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
    if (this.disposed) return;
    await Promise.all(
      (Object.keys(BUILDINGS) as BuildingKind[]).map(async (kind) => {
        // Phones skip the 1024 px near model. The low level is a quarter of the size and reads the same on a phone screen.
        const [full, far] = await Promise.all([equipment.ships.skipLod0 ? null : loadModel(kind, ''), loadModel(kind, '_lod1')]);
        const near = full ?? far ?? (await loadModel(kind, ''));
        if (this.disposed || !near) return;
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

  private makeSelectionMarker() {
    const vertices: number[] = [];
    const half = 8, arm = 3.5, width = 0.4;
    const strip = (x0: number, z0: number, x1: number, z1: number) => {
      vertices.push(x0, 0, z0, x1, 0, z1, x1, 0, z0, x0, 0, z0, x0, 0, z1, x1, 0, z1);
    };
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      const edgeX = x * half, edgeZ = z * half;
      strip(Math.min(edgeX, edgeX - x * arm), Math.min(edgeZ, edgeZ - z * width), Math.max(edgeX, edgeX - x * arm), Math.max(edgeZ, edgeZ - z * width));
      strip(Math.min(edgeX, edgeX - x * width), Math.min(edgeZ, edgeZ - z * arm), Math.max(edgeX, edgeX - x * width), Math.max(edgeZ, edgeZ - z * arm));
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    geometry.computeBoundingSphere();
    const material = new MeshBasicNodeMaterial({ color: 0xd5cebb, transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide });
    const mesh = new Mesh(geometry, material);
    mesh.visible = false;
    return mesh;
  }

  private addLabel(p: CapturePoint): Label {
    const root = document.createElement('div');
    root.className = 'cpoint';
    const pill = document.createElement('div');
    pill.className = 'cpoint-pill';
    const name = document.createElement('span');
    name.className = 'cpoint-name';
    name.textContent = t(p.name);
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

  update(camera: PerspectiveCamera, width: number, height: number, playerTeam: Team, selected: number, showLabels: boolean, battle?: Battle) {
    const c = this.conquest;
    let flags = 0;
    const counts = new Map<InstancedMesh, number>();
    const cam = camera.position;
    this.selectionMarker.visible = false;
    c.points.forEach((p) => {
      const observed = !battle || c.teamOfPoint(p) === playerTeam || pointVisible(battle, playerTeam, p.x, p.z);
      // Shore works.
      p.buildings.forEach((bd, slot) => {
        if (!bd || !observed) return;
        const batch = this.batches.get(bd.kind);
        if (!batch) return;
        const spot = p.slots[slot]!;
        const d = Math.hypot(spot.x - cam.x, spot.z - cam.z, cam.y - spot.y);
        const mesh = d < NEAR ? batch.near : batch.far;
        const n = counts.get(mesh) ?? 0;
        if (n >= CAP) return;
        const grow = bd.progress >= 1 ? 1 : 0.12 + bd.progress * 0.88;
        const ruin = bd.hp / buildingHp(bd.kind, bd.level);
        const upgrading = bd.upgradeTotal > 0 ? 1 - bd.upgradeLeft / bd.upgradeTotal : 0;
        const extent = 1 + (bd.level - 1) * 0.07 + upgrading * 0.07;
        this.q.setFromAxisAngle(this.up, Math.PI / 2 - spot.rot);
        this.p.set(spot.x, this.heightAt(spot.x, spot.z) - (1 - grow) * 2 - (ruin < 0.35 ? 0.6 : 0), spot.z);
        this.s.set(extent, grow * extent, extent);
        this.m.compose(this.p, this.q, this.s).multiply(mesh.userData.base as Matrix4);
        mesh.setMatrixAt(n, this.m);
        counts.set(mesh, n + 1);
        // Completed levels are marked by pennants beside the work; a raised pale pennant marks current construction.
        if (bd.level > 1 || bd.upgradeLeft > 0) {
          const owner = p.owner >= 0 ? c.player(p.owner) : undefined;
          const total = bd.level + (bd.upgradeLeft > 0 ? 1 : 0);
          for (let pennant = 0; pennant < total && flags < CAP; pennant += 1) {
            const across = (pennant - (total - 1) / 2) * 3.6;
            const fx = spot.x - Math.cos(spot.rot) * 10 + Math.cos(spot.rot + Math.PI / 2) * across;
            const fz = spot.z - Math.sin(spot.rot) * 10 + Math.sin(spot.rot + Math.PI / 2) * across;
            const inWork = pennant >= bd.level;
            this.q.setFromAxisAngle(this.up, -spot.rot);
            this.p.set(fx, this.heightAt(fx, fz), fz);
            this.s.set(0.6, inWork ? 0.6 + upgrading * 0.3 : 0.85, 0.6);
            this.m.compose(this.p, this.q, this.s);
            this.poles.setMatrixAt(flags, this.m);
            this.cloths.setMatrixAt(flags, this.m);
            const col = inWork || !owner ? NEUTRAL : FLAG[owner.faction];
            this.clothColor.setXYZ(flags, col.r, col.g, col.b);
            flags += 1;
          }
        }
      });
      // Banner of the holder beside the first plot.
      const spot = p.slots[0];
      if (spot && flags < CAP) {
        const fx = spot.x - Math.cos(spot.rot) * 4 + Math.cos(spot.rot + Math.PI / 2) * 14;
        const fz = spot.z - Math.sin(spot.rot) * 4 + Math.sin(spot.rot + Math.PI / 2) * 14;
        if (selected === p.id) {
          this.selectionMarker.position.set(fx, this.heightAt(fx, fz) + 0.25, fz);
          this.selectionMarker.rotation.y = -spot.rot;
          this.selectionMarker.visible = true;
        }
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
        // Most kinds of works stand nowhere, or only at the other range: those are not drawn at all.
        mesh.visible = mesh.count > 0;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this.poles.count = flags;
    this.cloths.count = flags;
    this.poles.visible = flags > 0;
    this.cloths.visible = flags > 0;
    this.poles.instanceMatrix.needsUpdate = true;
    this.cloths.instanceMatrix.needsUpdate = true;
    this.clothColor.needsUpdate = true;
    this.updateLabels(camera, width, height, playerTeam, selected, showLabels, battle);
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
  private updateLabels(camera: PerspectiveCamera, width: number, height: number, playerTeam: Team, selected: number, show: boolean, battle?: Battle) {
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
      const scale = on ? Math.max(0.95, Math.min(1.05, 1600 / Math.max(dist, 1))) : 0.85;
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
      const observed = !battle || holder === playerTeam || pointVisible(battle, playerTeam, p.x, p.z);
      const works = observed ? p.buildings.map((bd) => (bd ? `${bd.kind}:${bd.level}:${bd.progress < 1 ? '*' : ''}:${Math.ceil(bd.upgradeLeft)}` : '')).join(',') : '?';
      const key = `${getLang()}|${edge}|${side}|${p.contested}|${selected === p.id}|${works}|${p.queue.length}|${Math.round(Math.abs(p.hold) * 20)}`;
      if (key === label.last) continue;
      label.last = key;
      label.name.replaceChildren(t(p.name), ...(p.home >= 0 ? [Object.assign(document.createElement('small'), { className: 'cpoint-tag', textContent: t('본거지') })] : []));
      label.root.className = `cpoint cpoint--${side}${p.contested ? ' cpoint--contested' : ''}${selected === p.id ? ' cpoint--selected' : ''}${p.home >= 0 ? ' cpoint--home' : ''}${edge ? ' cpoint--edge' : ''}`;
      label.fill.style.width = `${Math.round(Math.abs(p.hold) * 100)}%`;
      label.fill.className = p.hold === 0 ? '' : (p.hold > 0 ? 'joseon' : 'japan') === playerTeam ? 'own' : 'foe';
      label.works.innerHTML =
        observed ? p.buildings.map((bd) => (bd ? `<span class="${bd.progress < 1 || bd.upgradeLeft > 0 ? 'cpoint-wip' : ''}" title="${t(BUILDINGS[bd.kind].label)}${bd.level > 1 ? ` ${bd.level}` : ''}">${iconSvg(bd.kind, 13)}${bd.level > 1 ? `<small>${bd.level}</small>` : ''}${bd.upgradeLeft > 0 ? '↑' : ''}</span>` : '')).join('') + (p.queue.length ? '<em>' + t('함선 {n}', { n: p.queue.length }) + '</em>' : '') : '<em>' + t('미정찰') + '</em>';
    }
  }

  /** Frees the marker, banners and instance buffers. The building models stay cached for the next battle. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.onSelect = null;
    this.layer.remove();
    for (const mesh of [this.selectionMarker, this.poles, this.cloths]) {
      mesh.geometry.dispose();
      (mesh.material as Material).dispose();
    }
    for (const batch of this.batches.values()) {
      batch.near.dispose();
      batch.far.dispose();
    }
    this.batches.clear();
    this.group.removeFromParent();
    this.group.clear();
  }
}
