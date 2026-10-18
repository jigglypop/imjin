import { PointLight, PointLightNode, Vector4, type NodeBuilder, type NodeFrame, type WebGPURenderer } from 'three/webgpu';
import { If, renderGroup, uniform, uniformArray } from 'three/tsl';

export const LIGHT_COUNT = 8;

const pos = Array.from({ length: LIGHT_COUNT }, () => new Vector4());
const col = Array.from({ length: LIGHT_COUNT }, () => new Vector4());

export const pointLights = {
  pos,
  col,
  posNode: uniformArray(pos, 'vec4'),
  colNode: uniformArray(col, 'vec4'),
};

/**
 * The effects' point lights. Every lit surface evaluates each of them per fragment, though most sit at intensity 0;
 * their node wraps the light's whole contribution in a uniform branch so a dark light costs one compare. A dark light
 * adds exactly zero either way, so the picture is the same.
 */
export class FxPointLight extends PointLight {}

class GatedPointLightNode extends PointLightNode {
  private readonly onNode = uniform(0).setGroup(renderGroup);

  update(frame: NodeFrame): undefined {
    super.update(frame);
    this.onNode.value = this.light!.intensity !== 0 ? 1 : 0;
  }

  setup(builder: NodeBuilder): undefined {
    If(this.onNode.greaterThan(0.5), () => {
      super.setup(builder);
    });
  }
}

/** Registers the gated node for {@link FxPointLight} with a renderer (once per renderer). */
export function registerFxLights(renderer: WebGPURenderer) {
  renderer.library.addLight(GatedPointLightNode as unknown as typeof PointLightNode, FxPointLight);
}
