import { Color, DataTexture, DataUtils, DirectionalLight, EquirectangularReflectionMapping, HemisphereLight, LinearFilter, RGBAFormat, HalfFloatType, type Scene } from 'three/webgpu';

/**
 * The generals' stage light: a dim dome with two softboxes and a rim strip, as an environment the metal and lacquer of
 * the armor reflect, plus a key and a rim light for the shadows' sake. Directions are azimuth from the viewer's side
 * (0 straight at the figure, positive to his left) and elevation, in degrees.
 */
const BOXES = [
  { az: 38, el: 34, w: 46, h: 30, color: [1, 0.9, 0.76], power: 16 },
  { az: -72, el: 8, w: 30, h: 46, color: [0.62, 0.74, 1], power: 4.5 },
  { az: 180, el: 26, w: 70, h: 12, color: [0.7, 0.8, 1], power: 10 },
  { az: -150, el: 40, w: 24, h: 24, color: [1, 0.72, 0.5], power: 4 },
];

function environment() {
  const w = 256;
  const h = 128;
  const data = new Uint16Array(w * h * 4);
  const half = DataUtils.toHalfFloat;
  for (let y = 0; y < h; y++) {
    // Row 0 is the floor: the texture is uploaded unflipped, so v grows upward.
    const el = (y / (h - 1) - 0.5) * 180;
    for (let x = 0; x < w; x++) {
      // The dome's seam sits straight behind the figure; azimuth 0 faces the viewer, who looks down -z.
      const az = (x / w - 0.5) * 360 - 90;
      const t = Math.min(1, Math.max(0, (el + 90) / 180));
      let r = 0.05 + 0.2 * t * t;
      let g = 0.055 + 0.23 * t * t;
      let b = 0.065 + 0.3 * t * t;
      if (el < 0) {
        r = 0.035;
        g = 0.03;
        b = 0.027;
      }
      for (const box of BOXES) {
        const da = ((az - box.az + 540) % 360) - 180;
        const de = el - box.el;
        const edge = (d: number, size: number) => Math.min(1, Math.max(0, (size / 2 - Math.abs(d)) / 4));
        const k = edge(da, box.w) * edge(de, box.h) * box.power;
        r += box.color[0]! * k;
        g += box.color[1]! * k;
        b += box.color[2]! * k;
      }
      const i = (y * w + x) * 4;
      data[i] = half(r);
      data[i + 1] = half(g);
      data[i + 2] = half(b);
      data[i + 3] = half(1);
    }
  }
  const texture = new DataTexture(data, w, h, RGBAFormat, HalfFloatType);
  texture.mapping = EquirectangularReflectionMapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Lights the scene as the generals' stage; the texture it adds is the caller's to dispose. */
export function lightStage(scene: Scene) {
  const env = environment();
  scene.environment = env;
  scene.environmentIntensity = 0.9;
  scene.add(new HemisphereLight(new Color(0xc6d6e8), new Color(0x2a1d14), 0.5));
  const key = new DirectionalLight(new Color(0xfff1dd), 1.7);
  key.position.set(2.2, 3.2, 3);
  const rim = new DirectionalLight(new Color(0x9fb8ff), 1.4);
  rim.position.set(-2.6, 2.2, -3);
  scene.add(key, rim);
  return env;
}
