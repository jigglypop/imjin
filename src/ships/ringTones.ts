import { Color } from 'three/webgpu';

/**
 * Ring strokes on the water, shared by the ship rings and the capture points: the player's navy in slate, the foe's
 * in umber, a point that is being fought over in a muted ochre. Quiet on purpose, so a selection reads without a
 * saturated colour on the sea.
 */
export const RING_OWN = new Color('#7597b1');
export const RING_FOE = new Color('#b0806c');
export const RING_WARN = new Color('#c8b88a');
