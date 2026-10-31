// Geometry for Stellaris-style borders.
//
// Each claimed system gets a "cell": the part of space closer to it than to
// any other system (a Voronoi cell), cut down to a disc around it so empty
// space far from any star stays unclaimed. Cells of the same owner sit edge
// to edge, so filling them all looks like one territory. The border is drawn
// only along the sides that face something else: open space, an unclaimed
// system, or another nation.

export interface Point {
  x: number;
  y: number;
}

/** Marks a side of a cell that is part of the disc's rim, facing open space. */
const RIM = -1;
/** More sides make the rim rounder. 32 is smooth at this map's size. */
const DISC_SIDES = 32;

/**
 * A corner of a cell. `side` describes the side running from this corner to
 * the next: RIM, or the index of the system whose cell is on the other side.
 */
interface Corner extends Point {
  side: number;
}

export interface Cell {
  system: number;
  corners: Corner[];
}

/** Builds a cell for each system in `claimed`. Unclaimed systems still shape the cells around them. */
export function territoryCells(systems: Point[], claimed: number[], radius: number): Cell[] {
  const cells: Cell[] = [];
  for (const i of claimed) {
    let corners = disc(systems[i], radius);
    systems.forEach((other, j) => {
      // Systems more than two radii away can't reach this disc, so skip them.
      if (j === i || Math.hypot(other.x - systems[i].x, other.y - systems[i].y) >= 2 * radius) return;
      corners = keepCloserTo(corners, systems[i], other, j, radius);
    });
    if (corners.length >= 3) cells.push({ system: i, corners });
  }
  return cells;
}

function disc(center: Point, radius: number): Corner[] {
  return Array.from({ length: DISC_SIDES }, (_, k) => {
    const angle = (k / DISC_SIDES) * Math.PI * 2;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius, side: RIM };
  });
}

/**
 * Cuts away the part of a cell that is closer to `other` than to `own`. The
 * cut runs along the line halfway between the two systems, and the new side
 * it creates is labeled with `otherIndex`, so we know later who is across it.
 * (This is the Sutherland–Hodgman clipping algorithm, for a single line.)
 */
function keepCloserTo(corners: Corner[], own: Point, other: Point, otherIndex: number, radius: number): Corner[] {
  const mid = { x: (own.x + other.x) / 2, y: (own.y + other.y) / 2 };
  const toOwn = { x: own.x - other.x, y: own.y - other.y };
  // Positive on own's side of the halfway line, negative on other's side.
  const side = (p: Point) => (p.x - mid.x) * toOwn.x + (p.y - mid.y) * toOwn.y;

  // Where the halfway line meets the true circle around own. Both systems'
  // circles meet it at these same two points.
  const half = Math.hypot(toOwn.x, toOwn.y) / 2;
  const reach = Math.sqrt(Math.max(0, radius * radius - half * half));
  const along = { x: -toOwn.y / (2 * half), y: toOwn.x / (2 * half) };
  const rimPoints = [1, -1].map((s) => ({ x: mid.x + along.x * reach * s, y: mid.y + along.y * reach * s }));

  const result: Corner[] = [];
  corners.forEach((current, k) => {
    const next = corners[(k + 1) % corners.length];
    const currentIn = side(current) >= 0;
    const nextIn = side(next) >= 0;
    const crossing = (): Point => {
      const t = side(current) / (side(current) - side(next));
      const point = { x: current.x + (next.x - current.x) * t, y: current.y + (next.y - current.y) * t };
      // Each disc is a polygon, not a true circle, so on a rim side the
      // crossing would land slightly differently in each of two neighboring
      // cells, leaving the outlines unable to join. Use the exact point
      // instead, which both cells agree on.
      if (current.side !== RIM) return point;
      return rimPoints.reduce((best, p) => (Math.hypot(p.x - point.x, p.y - point.y) < Math.hypot(best.x - point.x, best.y - point.y) ? p : best));
    };

    if (currentIn) {
      result.push(current);
      // Leaving: from the crossing point onwards, the new side runs along the cut.
      if (!nextIn) result.push({ ...crossing(), side: otherIndex });
    } else if (nextIn) {
      // Re-entering: from the crossing point, the original side continues.
      result.push({ ...crossing(), side: current.side });
    }
  });
  return result;
}

/** One SVG path covering all the given cells, for filling a territory. */
export function fillPath(cells: Cell[]): string {
  return cells
    .map((cell) => 'M' + cell.corners.map((c) => `${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' L') + ' Z')
    .join(' ');
}

/**
 * Ends of neighboring sides closer than this count as the same corner. They
 * differ only by rounding (keepCloserTo makes rim crossings exact). Keeping
 * this tiny matters: a loose tolerance can merge separate corners in an order-
 * dependent way and leave the outline unable to close.
 */
const JOIN_TOLERANCE = 0.05;
/** The widest gap territoryRings will bridge before giving up on an outline. */
const MAX_GAP = 12;

/**
 * The outline of a territory as closed rings of points, with holes filled in.
 *
 * Holes appear where a territory's discs don't quite meet, or around an
 * unclaimed system it surrounds. A hole is kept only if another nation's
 * system is inside it, so an enclave never gets painted over.
 *
 * Returns null if the sides don't join into closed rings, so the caller can
 * fall back to fillPath and borderPath.
 */
export function territoryRings(cells: Cell[], systems: Point[], owners: (number | null)[], owner: number): Point[][] | null {
  // Merge corners that are really the same point into one numbered vertex,
  // so sides from neighboring cells join up exactly.
  const vertices = new Vertices();

  // The same sides borderPath draws: everything not shared with a cell of the
  // same owner. Each side goes from one vertex to the next, and runs out from
  // its start vertex. Sides too short to matter collapse to a single vertex
  // and are dropped.
  const outgoing = new Map<number, number[]>();
  let sideCount = 0;
  for (const cell of cells) {
    cell.corners.forEach((corner, k) => {
      if (corner.side !== RIM && owners[corner.side] === owner) return;
      const from = vertices.id(corner);
      const to = vertices.id(cell.corners[(k + 1) % cell.corners.length]);
      if (from === to) return;
      outgoing.set(from, [...(outgoing.get(from) ?? []), to]);
      sideCount++;
    });
  }

  // Walk the sides into rings. Around a closed outline every vertex has as
  // many sides leaving as arriving, so a walk always gets back to where it
  // started. Near points where three cells meet, two cells occasionally
  // disagree by a few units about where a side ends, leaving a small gap. The
  // walk jumps such a gap to the nearest loose end (or back to its start).
  const rings: Point[][] = [];
  const remaining = (v: number) => (outgoing.get(v) ?? []).length > 0;
  for (const start of outgoing.keys()) {
    while (remaining(start)) {
      const ring: Point[] = [];
      let at = start;
      do {
        if (!remaining(at)) {
          const from = at;
          const loose = [start, ...[...outgoing.keys()].filter(remaining)];
          const jump = loose.reduce((best, v) => (vertices.gap(from, v) < vertices.gap(from, best) ? v : best));
          if (vertices.gap(from, jump) > MAX_GAP) return null;
          ring.push(vertices.point(from));
          if (jump === start) break;
          at = jump;
        }
        ring.push(vertices.point(at));
        at = outgoing.get(at)!.pop()!;
        if (ring.length > sideCount) return null;
      } while (at !== start);
      rings.push(ring);
    }
  }

  // Outer edges run the same way round as the cells do, and holes run the
  // opposite way, so the sign of a ring's area says which one it is.
  const outward = Math.sign(signedArea(cells[0].corners));
  return rings.filter((ring) =>
    Math.sign(signedArea(ring)) === outward ||
    systems.some((p, i) => owners[i] !== null && owners[i] !== owner && pointInRing(p, ring)),
  );
}

/** One SVG path through every ring. Draw it with fill-rule evenodd so kept holes stay empty. */
export function ringsPath(rings: Point[][]): string {
  return rings.map((ring) => 'M' + ring.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L') + ' Z').join(' ');
}

/** True if the point is inside the ring (ray casting: count the edges a line to the right of it crosses). */
export function pointInRing(p: Point, ring: Point[]): boolean {
  let inside = false;
  ring.forEach((a, k) => {
    const b = ring[(k + 1) % ring.length];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x)) inside = !inside;
  });
  return inside;
}

function signedArea(ring: Point[]): number {
  let area = 0;
  ring.forEach((a, k) => {
    const b = ring[(k + 1) % ring.length];
    area += a.x * b.y - b.x * a.y;
  });
  return area / 2;
}

/**
 * Gives every point an id, with points within JOIN_TOLERANCE of each other
 * sharing one. Points are bucketed into a grid of tolerance-sized squares, so
 * a lookup only checks the nearby squares rather than every point.
 */
class Vertices {
  private points: Point[] = [];
  private grid = new Map<string, number[]>();

  id(p: Point): number {
    const gx = Math.floor(p.x / JOIN_TOLERANCE);
    const gy = Math.floor(p.y / JOIN_TOLERANCE);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const id of this.grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          if (Math.hypot(this.points[id].x - p.x, this.points[id].y - p.y) <= JOIN_TOLERANCE) return id;
        }
      }
    }
    const id = this.points.push({ x: p.x, y: p.y }) - 1;
    const key = `${gx},${gy}`;
    this.grid.set(key, [...(this.grid.get(key) ?? []), id]);
    return id;
  }

  point(id: number): Point {
    return this.points[id];
  }

  gap(a: number, b: number): number {
    return Math.hypot(this.points[a].x - this.points[b].x, this.points[a].y - this.points[b].y);
  }
}

/**
 * An SVG path along the outside edge of a territory: every side that faces
 * open space or a system with a different owner. Sides shared by two cells of
 * the same owner are skipped, so the territory reads as one region.
 */
export function borderPath(cells: Cell[], owners: (number | null)[], owner: number): string {
  const segments: string[] = [];
  for (const cell of cells) {
    cell.corners.forEach((corner, k) => {
      if (corner.side !== RIM && owners[corner.side] === owner) return;
      const next = cell.corners[(k + 1) % cell.corners.length];
      segments.push(`M${corner.x.toFixed(1)} ${corner.y.toFixed(1)} L${next.x.toFixed(1)} ${next.y.toFixed(1)}`);
    });
  }
  return segments.join(' ');
}
