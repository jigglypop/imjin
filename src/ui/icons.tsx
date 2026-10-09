import type { ReactNode } from 'react';

// Monoline icons for the menus: 1.75 px stroke, round caps and joins, drawn in currentColor on a 24 px grid.
function Icon({ size = 18, children }: { size?: number; children: ReactNode }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {children}
    </svg>
  );
}

type P = { size?: number };

export const ChevronLeft = ({ size }: P) => (
  <Icon size={size}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </Icon>
);

export const ChevronDown = ({ size }: P) => (
  <Icon size={size}>
    <path d="m6 9.5 6 6 6-6" />
  </Icon>
);

export const Check = ({ size }: P) => (
  <Icon size={size}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const Cross = ({ size }: P) => (
  <Icon size={size}>
    <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
  </Icon>
);

export const Plus = ({ size }: P) => (
  <Icon size={size}>
    <path d="M12 5.5v13M5.5 12h13" />
  </Icon>
);

export const Minus = ({ size }: P) => (
  <Icon size={size}>
    <path d="M5.5 12h13" />
  </Icon>
);

export const Sliders = ({ size }: P) => (
  <Icon size={size}>
    <path d="M4 8h9M17 8h3M4 16h3M11 16h9" />
    <circle cx="15" cy="8" r="2" />
    <circle cx="9" cy="16" r="2" />
  </Icon>
);

export const Speaker = ({ size }: P) => (
  <Icon size={size}>
    <path d="M4.5 9.8h3l4.5-3.6v11.6l-4.5-3.6h-3z" />
    <path d="M15.6 9.2a4 4 0 0 1 0 5.6M18 6.8a7.4 7.4 0 0 1 0 10.4" />
  </Icon>
);

export const SpeakerOff = ({ size }: P) => (
  <Icon size={size}>
    <path d="M4.5 9.8h3l4.5-3.6v11.6l-4.5-3.6h-3z" />
    <path d="m16 9.5 4.5 5M20.5 9.5l-4.5 5" />
  </Icon>
);

export const Retry = ({ size }: P) => (
  <Icon size={size}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.3-5.4" />
    <path d="M19.5 4.5v4h-4" />
  </Icon>
);

export const Home = ({ size }: P) => (
  <Icon size={size}>
    <path d="M4.5 11 12 4.5 19.5 11M6.5 9.8V19.5h11V9.8" />
  </Icon>
);

/** An exclamation in a ring, for notices. */
export const Notice = ({ size }: P) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.8v5M12 16.2v.1" />
  </Icon>
);
