// How the Korean ship and squadron names are put together. The names are data (Korean in src/sim and
// src/campaign); src/i18n/en/sim.ts builds the English for every name these produce. This file has no imports so
// the simulation and the server bundle can use it.

/** "좌수영 3호": the third ship of a line. */
export const numbered = (prefix: string, n: number) => `${prefix} ${n}호`;

/** "좌수영 대장선": the flagship of a line. */
export const flagshipOf = (prefix: string) => `${prefix} 대장선`;

/** "사쓰마 5진": the fifth wave of a landing. */
export const echelon = (prefix: string, n: number) => `${prefix} ${n}진`;

/** "판옥선 2함대": the second fleet raised from one kind of ship. */
export const fleetNo = (prefix: string, n: number) => `${prefix} ${n}함대`;
