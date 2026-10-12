import { useEffect, useRef } from 'react';
import type { MapScene } from './MapScene';
import type { CameraState } from './worldCamera';

/**
 * The faction pick screen's backdrop: the campaign's own 3D world under a camera that drifts slowly over the south coast,
 * so the first screen of a war is alive rather than a still picture. The sea keeps moving on the scene's timer; the
 * camera swings about 18 degrees and drifts a little, never repeating within a minute. Phones and touch-only tablets do
 * not mount this (the flat image is their backdrop, as it is for the campaign map).
 */
const drift = (now: number): CameraState => {
  const s = now / 1000;
  return {
    u: 0.46 + 0.02 * Math.sin(s * 0.041),
    v: 0.47 + 0.012 * Math.sin(s * 0.029 + 1),
    distance: 0.62 + 0.03 * Math.sin(s * 0.023),
    yaw: 0.2 + 0.32 * Math.sin(s * 0.031),
    pitch: 0.84 + 0.06 * Math.sin(s * 0.047),
  };
};

export function PickBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement!;
    const screen = () => {
      const w = parent.clientWidth, h = parent.clientHeight;
      return { w, h, cx: w / 2, cy: h / 2 };
    };
    let cancelled = false;
    let scene: MapScene | null = null;
    const observer = new ResizeObserver(() => scene?.update(drift(performance.now()), screen()));
    // The world loads on its own, so the screen is usable while the terrain arrives; a failure keeps the flat backdrop.
    void import('./MapScene')
      .then(async ({ MapScene: Scene }) => {
        if (cancelled) return;
        scene = new Scene(canvas);
        scene.update(drift(performance.now()), screen());
        scene.animate(drift);
        observer.observe(parent);
        await scene.init();
      })
      .catch(() => {
        if (!cancelled) canvas.hidden = true;
      });
    return () => {
      cancelled = true;
      observer.disconnect();
      scene?.dispose();
    };
  }, []);
  return <canvas ref={ref} className="g-pick__world" aria-hidden />;
}
