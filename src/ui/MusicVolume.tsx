import { useState } from 'react';
import { sound } from '../audio/Sound';
import { useT } from '../i18n';

/** The music volume, 0-100%, a slim glass slider; dragging it changes the music at once. */
export function MusicVolume({ onChange }: { onChange?: () => void }) {
  const t = useT();
  const [v, setV] = useState(() => Math.round(sound.musicVolume * 100));
  return (
    <label className="music-volume">
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={v}
        aria-label={t('배경음악 볼륨')}
        style={{ '--fill': `${v}%` } as React.CSSProperties}
        onChange={(e) => {
          const next = Number(e.target.value);
          setV(next);
          sound.setMusicVolume(next / 100);
          onChange?.();
        }}
      />
      <span className="music-volume-value">{v}%</span>
    </label>
  );
}
