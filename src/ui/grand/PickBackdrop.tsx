import { Suspense, lazy, useCallback, useState } from 'react';
import { ErrorBoundary } from '../ErrorBoundary';
import type { WorldView } from './WorldCanvas';
import type { CameraState } from './worldCamera';

const WorldCanvas = lazy(() => import('./WorldCanvas'));

/**
 * The faction pick screen's backdrop: the campaign's own 3D world under a camera that drifts slowly over the south coast,
 * so the first screen of a war is alive rather than a still picture. It is drawn at the world's ambient rate (about thirty
 * frames a second); the camera swings about 18 degrees and drifts a little, never repeating within a minute. Phones and
 * touch-only tablets do not mount this (the flat image is their backdrop, as it is for the campaign map).
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

const view = (now: number, size: { width: number; height: number }): WorldView => ({
  cam: drift(now),
  screen: { w: size.width, h: size.height, cx: size.width / 2, cy: size.height / 2 },
});

export function PickBackdrop() {
  // The world loads on its own, so the screen is usable while the terrain arrives; a failure keeps the still backdrop.
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => setFailed(true), []);
  if (failed) return null;
  return (
    <ErrorBoundary fallback={<></>}>
      <Suspense fallback={null}>
        <WorldCanvas className="g-pick__world" view={view} onError={onError} />
      </Suspense>
    </ErrorBoundary>
  );
}
