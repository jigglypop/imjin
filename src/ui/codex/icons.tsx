// The codex's view controls, drawn like the battle HUD's icons: 24 px grid, 1.75 px round strokes in currentColor.
const PATHS = {
  spin: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3 M19.5 4.5v3.7h-3.7',
  pins: 'M12 21s-6-5.4-6-10.5a6 6 0 0 1 12 0C18 15.6 12 21 12 21z M12 8.2v4.6 M9.7 10.5h4.6',
  deck: 'M3 16.5h18 M5 16.5l1.5 3.5h11l1.5-3.5 M12 3.5v13 M12 4.5l6 8H12',
  cut: 'M4 6.5h16 M4 12h16 M4 17.5h16 M8 4v5 M16 9.5v5 M11 15v5',
  compare: 'M4.5 20.5V11 M10.5 20.5V6 M16.5 20.5V3.5 M2.5 20.5h19',
  reset: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3 M4.5 4.5v3.7h3.7',
  look: 'M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13z M15.3 15.3 20.5 20.5',
  anchor: 'M12 7.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M12 7.5v13 M8 11h8 M4.5 14.5c0 3.5 3.4 6 7.5 6s7.5-2.5 7.5-6',
  book: 'M4 5.5c2.7-1.3 5.4-1.3 8 0v14c-2.6-1.3-5.3-1.3-8 0z M12 5.5c2.6-1.3 5.3-1.3 8 0v14c-2.7-1.3-5.4-1.3-8 0',
  close: 'M6 6l12 12 M18 6 6 18',
  prev: 'M14.5 6l-6 6 6 6',
  next: 'M9.5 6l6 6-6 6',
} as const;

export type CodexIconName = keyof typeof PATHS;

export function CodexIcon({ name, size = 18 }: { name: CodexIconName; size?: number }) {
  return (
    <svg className="cx-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
