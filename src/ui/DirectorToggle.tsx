import { useEffect, useState } from 'react';
import type { Engine } from '../game/Engine';
import { isTouchDevice } from '../game/device';

/**
 * Switches for the battle director: cinematic camera (C) and kill-cam slow motion (V), plus the name of the shot on
 * screen. The director lives in the engine and changes without React knowing, so this polls it a few times a second.
 */
export function DirectorToggle({ engine }: { engine: Engine }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, []);
  const d = engine.director;
  const cine = engine.rts.cinematic;
  // Slow motion never runs in a multiplayer battle, so the switch would do nothing there.
  const online = !!engine.remote;
  const keys = !isTouchDevice;
  return (
    <div className="director-toggle" style={{ position: 'absolute', left: '50%', top: 112, transform: 'translateX(-50%)', display: 'flex', gap: 6, alignItems: 'center', zIndex: 5, pointerEvents: 'none' }}>
      <button className={`chip ${cine ? 'chip--on' : ''}`} style={{ pointerEvents: 'auto' }} onClick={() => d.toggleCinematic()}>
        연출 카메라{keys && ' (C)'}
      </button>
      {!online && (
        <button className={`chip ${d.slowMo ? 'chip--on' : ''}`} style={{ pointerEvents: 'auto' }} onClick={() => d.toggleSlowMo()}>
          연출 슬로모션{keys && ' (V)'}
        </button>
      )}
      {cine && d.shotName && (
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: 'rgba(255,255,255,0.75)', color: '#1d2433' }}>{d.shotName}</span>
      )}
    </div>
  );
}
