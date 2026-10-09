import { DynamicDrawUsage, type BufferGeometry, type Material, type Mesh, type Object3D, type Texture } from 'three/webgpu';

/**
 * Detaches the memory behind a typed array. A typed array's storage is freed when the collector gets round to the
 * array, which on a phone can be several battles later; transferring the buffer frees it now. The array reads as empty
 * afterwards, so only call this on data that nothing will read again.
 */
export function freeArray(array: ArrayBufferView | null | undefined) {
  const buffer = array?.buffer;
  // Only an array that is its buffer's whole content: a view into a shared file buffer would take its neighbours with it.
  if (!array || !(buffer instanceof ArrayBuffer) || buffer.byteLength === 0 || array.byteOffset !== 0 || array.byteLength !== buffer.byteLength) return;
  try {
    structuredClone(buffer, { transfer: [buffer] });
  } catch {
    // Browsers without buffer transfer leave it to the collector.
  }
}

const noop = () => undefined;

type Uploads = { get(attribute: unknown): { version?: number } };

/**
 * Frees the CPU copy of a mesh's vertex and index data once every attribute has been uploaded: the GPU holds its own,
 * and a fleet's or the terrain's copies were 60 to 100 MB of typed arrays the page never read again. A pass that reads
 * only some of the attributes (the shadow pass draws first) does not count, so this waits until a draw has created all
 * of them. Meshes that share a geometry can all call this; the first to see it complete wins and the rest find the data
 * gone. Never use it on geometry that is rebuilt from its own arrays later or read on the CPU.
 */
export function freeAfterDraw(mesh: Mesh) {
  mesh.onAfterRender = (renderer) => {
    const uploads = (renderer as unknown as { _attributes?: Uploads })._attributes;
    const geometry = mesh.geometry;
    const attributes = [...Object.values(geometry.attributes), ...(geometry.index ? [geometry.index] : [])];
    if (!uploads || attributes.some((a) => uploads.get(a).version === undefined)) return;
    mesh.onAfterRender = noop;
    for (const attribute of attributes) {
      // An interleaved attribute is a view on a buffer that holds the data (and the usage) for all of its attributes.
      const owner = 'isInterleavedBufferAttribute' in attribute ? attribute.data : attribute;
      if (owner.usage !== DynamicDrawUsage) freeArray(owner.array);
    }
  };
}

/**
 * Frees the GPU buffers and programs behind a scene graph that is being thrown away. Textures are left alone unless
 * `textures` is set: the ones loaded through module-level caches (terrain ground, character skins) outlive any one battle.
 */
export function disposeTree(root: Object3D, textures = false) {
  const seenGeometry = new Set<BufferGeometry>();
  const seenMaterial = new Set<Material>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh && !(o as { isPoints?: boolean }).isPoints && !(o as { isLine?: boolean }).isLine) return;
    if (mesh.geometry && !seenGeometry.has(mesh.geometry)) {
      seenGeometry.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      if (!m || seenMaterial.has(m)) continue;
      seenMaterial.add(m);
      if (textures) disposeTextures(m);
      m.dispose();
    }
  });
  root.removeFromParent();
}

function disposeTextures(material: Material) {
  for (const value of Object.values(material)) {
    if (value && (value as Texture).isTexture) (value as Texture).dispose();
  }
}
