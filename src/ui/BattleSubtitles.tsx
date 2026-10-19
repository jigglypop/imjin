import { useEffect, useReducer } from 'react';
import type { Engine } from '../game/Engine';
import { useT } from '../i18n';
import { tCommander } from './battleNames';
import './battleSubtitles.css';

/**
 * The commander's line at the bottom of the screen during a historical battle (BattleBarks): his name, then the line,
 * in white, fading in and out, like the subtitles of a Total War battle. Nothing else: no box, no portrait.
 */
export function BattleSubtitles({ engine }: { engine: Engine }) {
  const t = useT();
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const timer = window.setInterval(tick, 200);
    return () => window.clearInterval(timer);
  }, []);
  const c = engine.barks.current;
  if (!c) return null;
  return (
    <div className="bark" key={c.at} role="status" aria-live="polite">
      <span className="bark-who">{tCommander(c.line.who)}</span>
      <span className="bark-text">{t(c.line.text)}</span>
    </div>
  );
}
