/**
 * A commander's portrait (public/ui/portraits, made by scripts/generate-commander-portraits.mjs). `small` is the 192 px
 * cut for avatars and cards up to about 96 px on screen; the full one is 768 px.
 */
export const portraitUrl = (name: string, small = false) => `${import.meta.env.BASE_URL}ui/portraits/${name}${small ? '_sm' : ''}.webp`;
