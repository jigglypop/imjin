// Device classification, read once at startup. Drives quality defaults and touch UI.

const ua = navigator.userAgent;
const coarse = matchMedia('(any-pointer: coarse)').matches;
const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;

/** iPhone, iPad and iPod, and iPadOS Safari, which reports itself as a Mac. Every browser on iOS runs WebKit. */
export const isIOS = /iPhone|iPad|iPod/i.test(ua) || iPadOS;

/** A touch screen is present: phones, tablets, touch laptops. */
export const isTouchDevice = coarse || iPadOS || /Android|iPhone|iPad|iPod|Mobile/i.test(ua);

/** Touch-only device with no mouse or trackpad: phones and most tablets. Touch laptops keep their mouse-class quality. */
export const isTouchOnly = isTouchDevice && !matchMedia('(any-pointer: fine)').matches;

/** Phone-sized touch device: the short side of the screen is under 600 CSS px. */
export const isPhone = isTouchDevice && Math.min(screen.width, screen.height) < 600;

/** Chromium reports device memory in GB (capped at 8). Other browsers leave it undefined. */
export const deviceMemoryGB: number | undefined = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
