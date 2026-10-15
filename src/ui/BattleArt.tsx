import { useEffect, useState } from 'react';
import type { ScenarioId } from '../sim/scenarios';

const ART = '/ui/art/';

type Layer = { id: ScenarioId; on: boolean };

/**
 * A battle's in-game still behind a card. A new battle's picture fades in over the last one once it has decoded, and
 * the one beneath goes when the fade is over, so switching battles crossfades instead of flashing to the card colour.
 * `sizes` is the width the picture is drawn at, so the browser takes the small file only where it is sharp enough.
 */
export function BattleArt({ id, className = '', sizes = '100vw' }: { id: ScenarioId; className?: string; sizes?: string }) {
  const [layers, setLayers] = useState<Layer[]>([{ id, on: false }]);
  useEffect(() => {
    setLayers((ls) => {
      if (ls.at(-1)!.id === id) return ls;
      // Back to the picture still showing beneath one that has not loaded yet: that one simply stays.
      if (ls.some((l) => l.id === id && l.on)) return [{ id, on: true }];
      return [...ls.filter((l) => l.on).slice(-1), { id, on: false }];
    });
  }, [id]);
  const top = layers.at(-1)!;
  useEffect(() => {
    if (!top.on || layers.length < 2) return;
    const timer = window.setTimeout(() => setLayers((ls) => ls.slice(-1)), 700);
    return () => window.clearTimeout(timer);
  }, [top.on, layers.length]);
  const show = (lid: ScenarioId) => setLayers((ls) => ls.map((l) => (l.id === lid ? { ...l, on: true } : l)));
  return (
    <div className={`battle-art ${className}`} aria-hidden>
      {layers.map((l) => (
        <img
          key={l.id}
          src={`${ART}loading_${l.id}.webp`}
          srcSet={`${ART}loading_${l.id}_sm.webp 800w, ${ART}loading_${l.id}.webp 1600w`}
          sizes={sizes}
          alt=""
          decoding="async"
          className={l.on ? 'on' : ''}
          ref={(img) => {
            // A cached picture can be decoded before React attaches onLoad.
            if (img?.complete && img.naturalWidth > 0 && !l.on) show(l.id);
          }}
          onLoad={() => show(l.id)}
        />
      ))}
    </div>
  );
}
