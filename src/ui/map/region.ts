import { seededRandom } from '../../engine/random';
import type { Nation } from '../../types';
import { sectorName } from './generate';

// PLACEHOLDER, like the rest of the map. The galactic region around the
// player's sector: a honeycomb of sectors, generated from the nation's id
// and never saved. Only the player's own sector has been charted; the rest
// are names on a grid.

/** Centre to corner of one sector's hexagon, in region units. */
export const SECTOR_RADIUS = 110;
const COLUMNS = 9;
const ROWS = 7;
const MARGIN = 60;
/** The hexagons are pointy-topped: this wide, and rows sit 1.5 radii apart. */
const HEX_WIDTH = Math.sqrt(3) * SECTOR_RADIUS;
/** The player's sector sits in the middle of the grid. */
const HOME = { column: Math.floor(COLUMNS / 2), row: Math.floor(ROWS / 2) };

export const REGION_WIDTH = 2 * MARGIN + HEX_WIDTH * (COLUMNS + 0.5);
export const REGION_HEIGHT = 2 * MARGIN + 2 * SECTOR_RADIUS + 1.5 * SECTOR_RADIUS * (ROWS - 1);

export interface RegionSector {
  name: string;
  /** Centre of its hexagon, in region units. */
  x: number;
  y: number;
  /** How crowded with stars it looks, from 0 to 1. Decoration only. */
  density: number;
}

export interface GalacticRegion {
  name: string;
  sectors: RegionSector[];
  /** Index of the player's sector, the one the star map shows. */
  home: number;
}

/** `homeSector` is the name of the sector the star map shows, so both views agree. */
export function generateRegion(nation: Nation, homeSector: string): GalacticRegion {
  // Its own stream, so the region never moves anything on the star map.
  const random = seededRandom(`${nation.id}/region`);
  const name = sectorName(random);
  const used = new Set([homeSector]);
  const sectors: RegionSector[] = [];
  let home = -1;

  const centre = hexCentre(HOME.column, HOME.row);
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      const { x, y } = hexCentre(column, row);
      const isHome = column === HOME.column && row === HOME.row;
      // A ragged oval rather than a rectangle. The player's sector and the
      // ring around it are always there.
      const dx = (x - centre.x) / (REGION_WIDTH / 2 - MARGIN);
      const dy = (y - centre.y) / (REGION_HEIGHT / 2 - MARGIN);
      const nearHome = Math.hypot(x - centre.x, y - centre.y) <= HEX_WIDTH * 1.05;
      const roll = random();
      if (!nearHome && dx * dx + dy * dy > 0.7 + roll * 0.45) continue;

      let sector = homeSector;
      if (!isHome) {
        do sector = sectorName(random);
        while (used.has(sector));
        used.add(sector);
      }
      if (isHome) home = sectors.length;
      sectors.push({ name: sector, x, y, density: 0.25 + random() * 0.75 });
    }
  }
  return { name, sectors, home };
}

/** Corners of a sector's hexagon, clockwise from the top. */
export function hexCorners(sector: { x: number; y: number }, radius = SECTOR_RADIUS): { x: number; y: number }[] {
  return Array.from({ length: 6 }, (_, k) => {
    const angle = Math.PI / 3 * k - Math.PI / 2;
    return { x: sector.x + radius * Math.cos(angle), y: sector.y + radius * Math.sin(angle) };
  });
}

/** Odd rows shift half a hexagon right, so the rows interlock. */
function hexCentre(column: number, row: number): { x: number; y: number } {
  return {
    x: MARGIN + HEX_WIDTH * (column + 0.5 + (row % 2) * 0.5),
    y: MARGIN + SECTOR_RADIUS + row * 1.5 * SECTOR_RADIUS,
  };
}
