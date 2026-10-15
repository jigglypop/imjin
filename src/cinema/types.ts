import type { Battle } from '../sim/battle';
import type { Ship, Team } from '../sim/types';

/** The colour a name card or a fleet label wears: the Ming fleet sails on the Joseon team but under its own flag. */
export type Side = 'joseon' | 'japan' | 'ming';

/**
 * The language cutscenes are written in. A scene is a list of shots played one after another and, on its own clock,
 * captions and sound cues. Every camera position is relative to something in the running battle (a ship, a fleet, the
 * line between two fleets, the moon), so the same script frames the real ships wherever the battle has put them.
 */

/** What a scene's subjects are looked up from. `event` is the ship of the sim event that started an in-battle beat. */
export type SceneContext = { battle: Battle; team: Team; event: number };

/** Picks the ship or ships a shot is about; undefined when they are gone, and the shot then holds its last frame. */
export type Pick = (ctx: SceneContext) => Ship | Ship[] | undefined;

/**
 * Metres in a subject's frame: forward along its heading, up from its deck (a fleet's: from the water), right to its
 * starboard. A fleet's frame is its mean heading; `toward` turns it to face another subject.
 */
export type V3 = readonly [forward: number, up: number, right: number];
export type Range = number | readonly [from: number, to: number];

export type Target = {
  pick: Pick;
  /** The frame's forward: the subject's own heading, the bearing to another subject, or the bearing of the moon (the sun by day). */
  frame?: 'heading' | 'moon' | { toward: Pick };
};

export type Ease = 'linear' | 'inOut' | 'out' | 'in';

/**
 * Camera around a subject: yaw 0 is in front of it, pi/2 at its starboard; pitch up from the water; distance in metres.
 * `offset` moves the point it circles within the subject's frame, e.g. toward the enemy to hold both fleets.
 */
export type Orbit = { type: 'orbit'; at: Target; yaw: Range; pitch: Range; dist: Range; lift?: Range; offset?: V3 };
/** Camera moving in a straight line between two offsets of a subject's frame, looking at a third (or at another subject). */
export type Track = { type: 'track'; at: Target; from: V3; to: V3; look: V3; lookAt?: Target };

export type Shot = {
  dur: number;
  cam: Orbit | Track;
  ease?: Ease;
  /** Vertical field of view in degrees; a long lens is a small number. */
  fov?: Range;
  /** Extra tilt of the view, radians upward: a low camera looking up at a pavilion or at the moon. */
  tilt?: Range;
  /** Dutch angle, radians. */
  roll?: Range;
  /** Battle time per real second during this shot (1 = real time); a full cutscene ignores the speed setting. */
  slow?: number;
  /** Depth of field: how wide the lens is open, 0 for none; the focus follows the subject. */
  aperture?: number;
};

export type Caption = { at: number; dur: number } & (
  | { kind: 'stamp'; when: string; where: string }
  | { kind: 'title'; title: string; hanja?: string; sub?: string; eyebrow?: string }
  | { kind: 'doc'; head: string; hanja?: string; body: string; tag?: string; source?: string }
  | { kind: 'line'; who: string; role?: string; portrait: string; text: string; hanja?: string; source?: string }
  | { kind: 'card'; who: string; hanja?: string; role: string; portrait: string; side: Side }
  | { kind: 'label'; target: Target; text: string; sub?: string; side: Side }
  | { kind: 'quote'; text: string; hanja: string; source: string }
);

export type CaptionKind = Caption['kind'];

export type Cue = {
  at: number;
} & (
  | { kind: 'drums'; count: number }
  /** How far the guns and the sea are pushed down under the music, 0..1 (1 = silence but the bed). */
  | { kind: 'hush'; depth: number }
  /** Changes the sky, under a black frame. */
  | { kind: 'sky'; name: 'night' | 'sunset' | 'day' | 'afternoon' | 'overcast' }
);

export type Scene = {
  id: string;
  shots: Shot[];
  captions: Caption[];
  cues?: Cue[];
  /** Seconds of black at the start and end of the scene. */
  fadeIn?: number;
  fadeOut?: number;
  /** Black over these spans of the scene's clock, e.g. under a quote card or while the sky changes. */
  black?: readonly (readonly [from: number, to: number])[];
};
