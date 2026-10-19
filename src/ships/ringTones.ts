import { Color } from 'three/webgpu';

/**
 * Ring strokes on the water, shared by the ship rings and the capture points: the player's side in blue, the foe's
 * in red (the --own and --foe tokens), so friend and foe read at a glance; a point that is being fought over in a
 * muted ochre.
 */
export const RING_OWN = new Color('#5c9ee6');
export const RING_FOE = new Color('#e2685a');
export const RING_WARN = new Color('#c8b88a');
