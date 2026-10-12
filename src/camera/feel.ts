// How strongly the battle camera reacts to gunfire: the shake and the small field-of-view punch. Kept apart from the
// camera and the director so both read one setting, and so the menu and the battle sheet can change it.

export type CameraFeel = 'off' | 'low' | 'full';
export const FEEL_CHOICES: readonly CameraFeel[] = ['off', 'low', 'full'];
export const FEEL_LABEL: Record<CameraFeel, string> = { off: '끔', low: '약하게', full: '강하게' };

const KEY = 'imjin.cameraFeel';
const SHAKE: Record<CameraFeel, number> = { off: 0, low: 0.35, full: 1 };
const PUNCH: Record<CameraFeel, number> = { off: 0, low: 0.5, full: 1 };

function stored(): CameraFeel {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'off' || v === 'low' || v === 'full') return v;
  } catch { /* private mode */ }
  return 'low';
}

let current = stored();

export const cameraFeel = {
  get: (): CameraFeel => current,
  set(value: CameraFeel) {
    current = value;
    try { localStorage.setItem(KEY, value); } catch { /* private mode */ }
  },
  /** Scale of the shake's offsets. */
  shake: () => SHAKE[current],
  /** Scale of the field-of-view punch. */
  punch: () => PUNCH[current],
};
