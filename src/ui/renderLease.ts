import { Vector3, Vector4 } from 'three/webgpu';
import { WaveField, waveField } from '../ocean/waves';
import { atmosphere } from '../render/atmosphere';
import { pointLights } from '../render/lights';

/**
 * A scene with a renderer of its own (the menu's battle, the ship codex) shares the module uniforms the battle's
 * materials read: the sun and sky in `atmosphere`, the lantern lights and the wave field ships ride on. It borrows them
 * for one synchronous frame and puts back what was there, so a battle kept in the background finds its own sky and sea.
 * Never across an await.
 */
export class RenderLease {
  private waves = new WaveField();
  private vectors = new Map<string, Vector3>();
  private scalars = new Map<string, number>();
  private positions = pointLights.pos.map(() => new Vector4());
  private colors = pointLights.col.map(() => new Vector4());

  run<T>(apply: () => void, frame: () => T): T {
    this.waves.copyFrom(waveField);
    const version = waveField.version;
    for (const [key, node] of Object.entries(atmosphere)) {
      if (typeof node.value === 'number') this.scalars.set(key, node.value);
      else {
        let saved = this.vectors.get(key);
        if (!saved) {
          saved = new Vector3();
          this.vectors.set(key, saved);
        }
        saved.copy(node.value);
      }
    }
    pointLights.pos.forEach((v, i) => this.positions[i]!.copy(v));
    pointLights.col.forEach((v, i) => this.colors[i]!.copy(v));
    try {
      apply();
      return frame();
    } finally {
      waveField.copyFrom(this.waves);
      waveField.version = version;
      for (const [key, node] of Object.entries(atmosphere)) {
        if (typeof node.value === 'number') node.value = this.scalars.get(key)!;
        else node.value.copy(this.vectors.get(key)!);
      }
      pointLights.pos.forEach((v, i) => v.copy(this.positions[i]!));
      pointLights.col.forEach((v, i) => v.copy(this.colors[i]!));
    }
  }
}
