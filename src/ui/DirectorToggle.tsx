import { useEffect, useState } from 'react';
import type { Engine } from '../game/Engine';
import { isTouchDevice } from '../game/device';
import { cameraFeel, FEEL_CHOICES, FEEL_LABEL } from '../camera/feel';
import { useT } from '../i18n';

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
  const t = useT();
  const d = engine.director;
  const keys = !isTouchDevice;
  return (
    <div>
      <div className="settings-label">{t('연출')}</div>
      <div className="chips">
        <button className={`chip ${engine.rts.cinematic ? 'chip--on' : ''}`} onClick={() => d.toggleCinematic()}>
          {t('연출 카메라')}
          {keys && ' (C)'}
        </button>
        <button className={`chip ${engine.cinema.documentary ? 'chip--on' : ''}`} aria-pressed={engine.cinema.documentary} onClick={() => engine.cinema.setDocumentary(!engine.cinema.documentary)}>
          {t('다큐멘터리 모드')}
        </button>
        <button className={`chip ${engine.cinema.intros ? 'chip--on' : ''}`} aria-pressed={engine.cinema.intros} onClick={() => engine.cinema.setIntros(!engine.cinema.intros)}>
          {t('전투 영상')}
        </button>
        {/* Slow motion never runs in a multiplayer battle, so the switch would do nothing there. */}
        {!engine.remote && (
          <button className={`chip ${d.slowMo ? 'chip--on' : ''}`} onClick={() => d.toggleSlowMo()}>
            {t('슬로모션')}
            {keys && ' (V)'}
          </button>
        )}
      </div>
      <div className="settings-label">{t('카메라 흔들림')}</div>
      <div className="chips">
        {FEEL_CHOICES.map((k) => (
          <button key={k} className={`chip ${cameraFeel.get() === k ? 'chip--on' : ''}`} aria-pressed={cameraFeel.get() === k} onClick={() => cameraFeel.set(k)}>
            {t(FEEL_LABEL[k])}
          </button>
        ))}
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
