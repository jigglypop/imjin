import { useEffect, useState } from 'react';
import type { Engine } from '../game/Engine';
import { isTouchDevice } from '../game/device';

/** Repaints a few times a second: the director lives in the engine and changes without React knowing. */
function usePoll(ms: number) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

/** Settings rows for the battle director: cinematic camera (C) and kill-cam slow motion (V). */
export function DirectorSettings({ engine }: { engine: Engine }) {
  usePoll(250);
  const d = engine.director;
  const keys = !isTouchDevice;
  return (
    <div>
      <div className="settings-label">연출</div>
      <div className="chips">
        <button className={`chip ${engine.rts.cinematic ? 'chip--on' : ''}`} onClick={() => d.toggleCinematic()}>
          연출 카메라{keys && ' (C)'}
        </button>
        {/* Slow motion never runs in a multiplayer battle, so the switch would do nothing there. */}
        {!engine.remote && (
          <button className={`chip ${d.slowMo ? 'chip--on' : ''}`} onClick={() => d.toggleSlowMo()}>
            슬로모션{keys && ' (V)'}
          </button>
        )}
      </div>
    </div>
  );
}

/** The name of the cinematic camera's current shot, a small label under the top bar while that camera runs. */
export function ShotLabel({ engine }: { engine: Engine }) {
  usePoll(250);
  const d = engine.director;
  if (!engine.rts.cinematic || !d.shotName) return null;
  return <div className="shot-label">{d.shotName}</div>;
}
