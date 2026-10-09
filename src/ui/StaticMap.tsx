import type { CSSProperties } from 'react';
import { SCENARIO_ORDER, SCENARIOS, type ScenarioId } from '../sim/scenarios';
import { shortTitle, siteUV } from './siteMap';

// Pins close enough that their labels would collide: these put the label on the pin's left.
const LABEL_LEFT = new Set<ScenarioId>(['dangpo']);

/** The select map for phones: one flat image, no 3D renderer. The plane pans so the chosen site sits in the open part of the screen. */
export function StaticMap({ id, onSelect }: { id: ScenarioId; onSelect: (id: ScenarioId) => void }) {
  const at = siteUV(id);
  return (
    <div className="smap">
      <div className="smap-plane" style={{ '--u': at.u, '--v': at.v } as CSSProperties}>
        <img src="/ui/map_south.webp" alt="" decoding="async" />
        {SCENARIO_ORDER.map((sid) => {
          const { u, v } = siteUV(sid);
          return (
            <button
              key={sid}
              className={`marker ${sid === id ? 'marker--on' : ''} ${SCENARIOS[sid].night ? 'marker--night' : ''} ${LABEL_LEFT.has(sid) ? 'marker--left' : ''}`}
              style={{ '--mu': u, '--mv': v } as CSSProperties}
              onClick={() => onSelect(sid)}
            >
              <i />
              <span>{shortTitle(SCENARIOS[sid].title)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
