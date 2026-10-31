import { seededRandom } from '../../engine/random';
import type { Nation } from '../../types';
import { sectorName } from './generate';

// PLACEHOLDER, like the rest of the map. The whole galaxy: a spiral disc cut
// into regions, ring by ring around a core, generated from the nation's id
// and never saved. Only the player's region has been surveyed at all.

export const GALAXY_SIZE = 1700;
export const GALAXY_CENTRE = GALAXY_SIZE / 2;
/** Where each ring of regions starts and ends, from the center out. The first ring's inside is the core. */
const RING_EDGES = [120, 285, 450, 615, 780];
/** Regions in each ring. Outer rings have more, so regions stay roughly the same size. */
const RING_COUNTS = [5, 9, 13, 17];
/** The player's region is in this ring: out in the arms, like the Sun. */
const HOME_RING = 2;
export const CORE_RADIUS = RING_EDGES[0];
export const GALAXY_RADIUS = RING_EDGES[RING_EDGES.length - 1];

export interface GalaxyRegion {
  name: string;
  /** The region's wedge: between two radii and two angles (radians, clockwise from the right), around the galaxy's center. */
  inner: number;
  outer: number;
  start: number;
  end: number;
  /** The middle of the wedge, where its name goes. */
  x: number;
  y: number;
}

export interface Galaxy {
  name: string;
  regions: GalaxyRegion[];
  /** Index of the player's region, the one the region map shows. */
  home: number;
  /** Turns the spiral arms, so every galaxy doesn't look the same. */
  twist: number;
}

/** `homeRegion` is the name of the region the region map shows, so both views agree. */
export function generateGalaxy(nation: Nation, homeRegion: string): Galaxy {
  // Its own stream, so the galaxy never moves anything on the other maps.
  const random = seededRandom(`${nation.id}/galaxy`);
  const name = sectorName(random);
  const used = new Set([homeRegion]);
  const regions: GalaxyRegion[] = [];
  const homeSlot = Math.floor(random() * RING_COUNTS[HOME_RING]);
  let home = -1;

  RING_COUNTS.forEach((count, ring) => {
    const inner = RING_EDGES[ring];
    const outer = RING_EDGES[ring + 1];
    // Each ring is turned a little, so the seams don't line up into spokes.
    const offset = random() * Math.PI * 2;
    for (let k = 0; k < count; k++) {
      const start = offset + (Math.PI * 2 * k) / count;
      const end = offset + (Math.PI * 2 * (k + 1)) / count;
      const isHome = ring === HOME_RING && k === homeSlot;
      let region = homeRegion;
      if (!isHome) {
        do region = sectorName(random);
        while (used.has(region));
        used.add(region);
      }
      if (isHome) home = regions.length;
      const middle = (start + end) / 2;
      const radius = (inner + outer) / 2;
      regions.push({
        name: region, inner, outer, start, end,
        x: GALAXY_CENTRE + Math.cos(middle) * radius,
        y: GALAXY_CENTRE + Math.sin(middle) * radius,
      });
    }
  });
  return { name, regions, home, twist: random() * Math.PI * 2 };
}

/** The region whose wedge holds this point, or null over the core or outside the disc. */
export function regionAt(galaxy: Galaxy, point: { x: number; y: number }): number | null {
  const dx = point.x - GALAXY_CENTRE;
  const dy = point.y - GALAXY_CENTRE;
  const r = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const index = galaxy.regions.findIndex((region) => {
    if (r < region.inner || r >= region.outer) return false;
    // Angles wrap around, so compare how far past the start it is, in one turn.
    const turn = Math.PI * 2;
    const past = (((angle - region.start) % turn) + turn) % turn;
    return past < region.end - region.start;
  });
  return index === -1 ? null : index;
}

/** An SVG path for a region's wedge. */
export function wedgePath(region: GalaxyRegion): string {
  const point = (r: number, a: number) => `${(GALAXY_CENTRE + Math.cos(a) * r).toFixed(1)} ${(GALAXY_CENTRE + Math.sin(a) * r).toFixed(1)}`;
  const large = region.end - region.start > Math.PI ? 1 : 0;
  return [
    `M ${point(region.outer, region.start)}`,
    `A ${region.outer} ${region.outer} 0 ${large} 1 ${point(region.outer, region.end)}`,
    `L ${point(region.inner, region.end)}`,
    `A ${region.inner} ${region.inner} 0 ${large} 0 ${point(region.inner, region.start)}`,
    'Z',
  ].join(' ');
}
