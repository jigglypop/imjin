// Monoline icons of the battle HUD: 24 px grid, 1.75 px round strokes in currentColor. Formations are tiny diagrams
// (dots are filled), everything else is drawn as outlines. The same paths feed React (`Icon`) and the DOM labels that
// ConquestView builds by hand (`iconSvg`).

type Parts = { d?: string; dots?: [number, number][]; circles?: [number, number, number][]; rect?: [number, number, number, number, number]; dash?: string };

const ICONS: Record<string, Parts[]> = {
  // Formations: dots, the fleet seen from above with the enemy ahead (up)
  crane: [{ dots: [[4, 7], [5.5, 12.5], [8.5, 16.5], [12, 18], [15.5, 16.5], [18.5, 12.5], [20, 7]] }],
  line: [{ dots: [[3.5, 12], [7.75, 12], [12, 12], [16.25, 12], [20.5, 12]] }],
  column: [{ dots: [[12, 3.5], [12, 7.75], [12, 12], [12, 16.25], [12, 20.5]] }],
  wedge: [{ dots: [[12, 4.5], [9, 10], [15, 10], [6, 15.5], [12, 15.5], [18, 15.5]] }],
  scatter: [{ dots: [[6, 6.5], [15, 5], [19, 11], [10, 12], [5, 17], [14, 18.5], [19.5, 17.5]] }],

  // Gunnery
  portVolley: [{ rect: [10, 3.5, 6, 17, 3] }, { d: 'M7 8H3 M7 12H3 M7 16H3' }],
  starboardVolley: [{ rect: [8, 3.5, 6, 17, 3] }, { d: 'M17 8h4 M17 12h4 M17 16h4' }],
  aim: [{ circles: [[12, 12, 7]] }, { d: 'M12 2.5v4 M12 17.5v4 M2.5 12h4 M17.5 12h4' }, { dots: [[12, 12]] }],
  hold: [{ circles: [[12, 12, 8.5]] }, { d: 'M10 8.5v7 M14 8.5v7' }],
  shot: [{ circles: [[15.5, 12, 5.5]] }, { d: 'M2.5 8.5h6 M2.5 12h4 M2.5 15.5h6' }],
  broadside: [{ rect: [3, 12, 18, 6, 3] }, { d: 'M7 3v5 M12 3v5 M17 3v5' }],

  // Movement
  fast: [{ d: 'M4 6l5 6-5 6 M10 6l5 6-5 6 M16 6l5 6-5 6' }],
  half: [{ d: 'M7 6l5 6-5 6 M13 6l5 6-5 6' }],
  slow: [{ d: 'M10 6l5 6-5 6' }],
  stop: [{ rect: [6, 6, 12, 12, 3] }],
  lantern: [{ d: 'M9.5 3.5h5 M10 21h4 M9 6.5h6' }, { rect: [7, 6.5, 10, 12, 4.5] }, { d: 'M12 6.5v12' }],

  // Stance
  standoff: [{ circles: [[5.5, 18, 2.2], [18.5, 6, 2.2]] }, { d: 'M7.5 16.2L16.5 7.8', dash: '2 3' }],
  close: [{ circles: [[8, 15, 3], [16, 9, 3]] }, { d: 'M10.4 12.8l3.2-1.6' }],
  ram: [{ d: 'M3.5 12h11 M11 7.5l4.5 4.5-4.5 4.5 M20 5.5v13' }],
  board: [{ rect: [2.5, 15, 7, 5, 2] }, { rect: [14.5, 15, 7, 5, 2] }, { d: 'M6 15C6 7 18 7 18 15 M15.2 12.6L18 15.4l2.2-3' }],
  repel: [{ d: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z' }],

  // Touch tools and menu
  box: [{ rect: [4, 5, 16, 14, 2.5], dash: '3 3' }],
  clear: [{ circles: [[12, 12, 8.5]] }, { d: 'M9 9l6 6 M15 9l-6 6' }],
  follow: [{ circles: [[12, 12, 5]] }, { d: 'M12 2.5v4 M12 17.5v4 M2.5 12h4 M17.5 12h4' }],
  deck: [{ d: 'M12 4l9 5-9 5-9-5z M3 13.5l9 5 9-5' }],
  map: [{ d: 'M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z M9 4v13.5 M15 6.5V20' }],
  settings: [{ d: 'M4 7h9 M19 7h1 M4 17h1 M11 17h9' }, { circles: [[16, 7, 2.5], [8, 17, 2.5]] }],
  x: [{ d: 'M6 6l12 12 M18 6L6 18' }],
  chevronDown: [{ d: 'M6 9.5l6 6 6-6' }],
  chevronLeft: [{ d: 'M14.5 6l-6 6 6 6' }],
  chevronRight: [{ d: 'M9.5 6l6 6-6 6' }],
  chevronUp: [{ d: 'M6 14.5l6-6 6 6' }],
  play: [{ d: 'M8 5.5v13l11-6.5z' }],
  pause: [{ d: 'M9 5.5v13 M15 5.5v13' }],
  skip: [{ d: 'M5 6l7 6-7 6 M12 6l7 6-7 6' }],
  flame: [{ d: 'M12 3c.7 3.6 5 5.4 5 10a5 5 0 0 1-10 0c0-2.2 1.2-3.6 2.4-5 .4 1.4 1.1 2.1 2.1 2.2C11 7.8 10.8 5.6 12 3z' }],
  melee: [{ d: 'M5 19L18 6 M14 5.5h4.5V10 M19 19L6 6 M10 5.5H5.5V10 M4.5 17.5l2 2 M19.5 17.5l-2 2' }],

  // Shore works
  shipyard: [{ circles: [[12, 5, 2]] }, { d: 'M12 7v13 M8 11h8 M5 14c0 3.6 3 6 7 6s7-2.4 7-6 M3.8 15.5L5 14l1.5 1.5 M20.2 15.5L19 14l-1.5 1.5' }],
  battery: [{ d: 'M3.5 10h10.5a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2H3.5z M16 9.5l5-2v9l-5-2 M6 19h8' }],
  magazine: [{ d: 'M4 8l8-4 8 4v10l-8 3-8-3z M4 8l8 3.5L20 8 M12 11.5V21' }],
  dock: [{ d: 'M14.5 4.5a4.5 4.5 0 0 0-4.1 6.3L4 17.2 6.8 20l6.4-6.4a4.5 4.5 0 0 0 6.3-4.1l-3 3-2.7-.6-.6-2.7z' }],
  beacon: [{ d: 'M8 21h8 M9.5 21l.7-7h3.6l.7 7 M12 2.5c.6 2.6 4 3.6 4 7a4 4 0 0 1-8 0c0-1.6.9-2.6 1.8-3.7.3 1 .9 1.5 1.7 1.6-.2-1.8-.2-3.4.5-4.9z' }],
  anchor: [{ circles: [[12, 5, 2]] }, { d: 'M12 7v13 M8 11h8 M5 14c0 3.6 3 6 7 6s7-2.4 7-6' }],
};

export type IconName = keyof typeof ICONS;

function parts(name: string) {
  return ICONS[name] ?? [];
}

/** An inline icon sized by `size`, coloured by the text colour. */
export function Icon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg className={`ico${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {parts(name).map((p, i) => (
        <g key={i}>
          {p.d && <path d={p.d} strokeDasharray={p.dash} />}
          {p.rect && <rect x={p.rect[0]} y={p.rect[1]} width={p.rect[2]} height={p.rect[3]} rx={p.rect[4]} strokeDasharray={p.dash} />}
          {p.circles?.map(([cx, cy, r], j) => <circle key={j} cx={cx} cy={cy} r={r} />)}
          {p.dots?.map(([cx, cy], j) => <circle key={j} cx={cx} cy={cy} r={1.65} fill="currentColor" stroke="none" />)}
        </g>
      ))}
    </svg>
  );
}

/** The same icon as markup, for labels built outside React. */
export function iconSvg(name: string, size = 14) {
  const body = parts(name)
    .map((p) => {
      const dash = p.dash ? ` stroke-dasharray="${p.dash}"` : '';
      return [
        p.d ? `<path d="${p.d}"${dash}/>` : '',
        p.rect ? `<rect x="${p.rect[0]}" y="${p.rect[1]}" width="${p.rect[2]}" height="${p.rect[3]}" rx="${p.rect[4]}"${dash}/>` : '',
        ...(p.circles ?? []).map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`),
        ...(p.dots ?? []).map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="1.65" fill="currentColor" stroke="none"/>`),
      ].join('');
    })
    .join('');
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
