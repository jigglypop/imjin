/**
 * Versions of the battle depth rules: morale and rout, raking and crossfire, and fire that spreads between hulls. A
 * battle carries the version it was built with. The historical battles, single-player conquest and the campaign's 3D
 * battles use the newest; ranked and online conquest keep the rules their balance was measured with until a season
 * adopts a version, so a ranked result never changes under a player.
 */
export type DepthVersion = 'depth-v1';

export type DepthRules = Readonly<{
  version: DepthVersion;
  /** Ships lose heart, waver, rout and rally; a fleet that breaks gives up the field. */
  morale: boolean;
  /** Shots down the keel line and fire from two quarters hurt more; ships that keep their formation shoot straighter. */
  gunnery: boolean;
  /** Fire jumps between hulls lying close together, more readily downwind. */
  fireSpread: boolean;
}>;

export const DEPTH_V1: DepthRules = Object.freeze({ version: 'depth-v1', morale: true, gunnery: true, fireSpread: true });

const VERSIONS: Record<DepthVersion, DepthRules> = { 'depth-v1': DEPTH_V1 };

/** The rules of a version, or none for a battle built without one. */
export function depthRules(version: DepthVersion | null | undefined): DepthRules | null {
  return version ? VERSIONS[version] ?? null : null;
}
