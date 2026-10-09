import type { WebGPURenderer } from 'three/webgpu';

type Builder = { getUniformBufferLimit(): number };
type Backend = {
  isWebGLBackend?: boolean;
  gl: WebGL2RenderingContext;
  vaoCache: Record<string, WebGLVertexArrayObject>;
  get(attribute: unknown): { id?: number };
  createNodeBuilder(object: { isInstancedMesh?: boolean } | null, renderer: unknown): Builder;
  destroyAttribute(attribute: unknown): void;
  __tuned?: boolean;
};

/**
 * Two corrections to three's WebGL2 backend, which phones run on.
 *
 * Shared programs. three puts the matrices of a small InstancedMesh into a uniform block whose name and array length
 * are written into the shader source ("NodeBuffer_108158 { mat4 buffer108158[25]; }"). Two batches of the same ship
 * model then never produce the same source, so each one compiles and holds its own program: 72 of 180 shader stages in a
 * fleet battle differed in nothing else. A zero uniform limit makes every instanced mesh read its matrices from vertex
 * attributes instead (three's path for meshes too big for a block), whose names depend only on the order of the nodes,
 * so batches that draw the same way share one program.
 *
 * Vertex arrays. The backend caches one vertex array object per combination of attributes and never drops it. A vertex
 * array keeps its buffers alive, so deleting a finished battle's geometry freed nothing on the GPU: the terrain's 10 MB
 * vertex buffer and every ship buffer stayed, battle after battle. They are dropped with the attribute they use.
 */
export function tuneWebGLBackend(renderer: WebGPURenderer) {
  const backend = renderer.backend as unknown as Backend;
  if (!backend.isWebGLBackend || backend.__tuned) return;
  backend.__tuned = true;

  const create = backend.createNodeBuilder.bind(backend);
  backend.createNodeBuilder = (object, r) => {
    const builder = create(object, r);
    if (object?.isInstancedMesh) builder.getUniformBufferLimit = () => 0;
    return builder;
  };

  const destroy = backend.destroyAttribute.bind(backend);
  backend.destroyAttribute = (attribute) => {
    const id = backend.get(attribute).id;
    destroy(attribute);
    if (id === undefined) return;
    for (const key of Object.keys(backend.vaoCache)) {
      if (!key.split(':').includes(String(id))) continue;
      backend.gl.deleteVertexArray(backend.vaoCache[key]!);
      delete backend.vaoCache[key];
    }
  };
}
