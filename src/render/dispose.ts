import type { BufferGeometry, Material, Mesh, Object3D, Texture } from 'three/webgpu';

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
