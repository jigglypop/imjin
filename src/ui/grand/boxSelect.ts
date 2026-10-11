/** A point on the map in the map element's own pixels, the same ones the markers are positioned with. */
export interface Marker {
  id: string;
  x: number;
  y: number;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The rectangle between the pointer's press and its current position, whichever way it was dragged. */
export function boxBetween(ax: number, ay: number, bx: number, by: number): Box {
  return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
}

/** Ids of the markers whose centre lies inside the rectangle (edges count), in the order they were given. */
export function markersInBox(box: Box, markers: readonly Marker[]): string[] {
  return markers.filter((m) => m.x >= box.x0 && m.x <= box.x1 && m.y >= box.y0 && m.y <= box.y1).map((m) => m.id);
}
