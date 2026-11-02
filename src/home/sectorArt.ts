import { generateMap, type GalaxyMap } from '../ui/map/generate';
import { companionOffset, mapStar, Paints } from '../ui/map/bodies';
import type { Nation } from '../types';

// The star-map art on the site's pages (the homepage and the account page):
// a real generated sector's lanes and stars, drawn as the game's sector map
// draws them (bodies.ts). Styled by home.css (.sector-art).

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The site always shows the same sector. Only these fields matter to the map generator. */
export const SHOWCASE = { id: 'starflower-homepage', name: 'Starflower', prefix: 'Union', claimedSystems: [] } as unknown as Nation;

/** Each drawing's gradients get ids of their own, so two on one page don't clash. */
let drawings = 0;

/** The showcase sector the site's art is drawn from. */
export function showcaseMap(): GalaxyMap {
  return generateMap(SHOWCASE);
}

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/** Lanes and stars of a map, inside a viewBox. `lit` systems (and lanes between them) are highlighted. */
export function drawSector(map: GalaxyMap, viewBox: string, lit = new Set<number>(), scale = 1): SVGSVGElement {
  const root = svg('svg', { viewBox, preserveAspectRatio: 'xMidYMid slice', class: 'sector-art' });
  const defs = svg('defs', {});
  const paints = new Paints(defs, `sector-art-${++drawings}`);
  root.append(defs);
  const lanes = svg('g', { class: 'map-lanes' });
  for (const [a, b] of map.lanes) {
    const p = map.systems[a];
    const q = map.systems[b];
    lanes.append(svg('line', {
      x1: p.x.toFixed(1), y1: p.y.toFixed(1), x2: q.x.toFixed(1), y2: q.y.toFixed(1),
      class: lit.has(a) && lit.has(b) ? 'map-lane lit' : 'map-lane',
    }));
  }
  const stars = svg('g', { class: 'map-stars' });
  map.systems.forEach((system, i) => {
    // Each system's stars, as on the game's map: companions just beside the primary.
    const [primary, ...companions] = system.stars;
    const node = svg('g', { class: 'map-star' });
    companions.forEach((companion, k) => {
      const { dx, dy, r } = companionOffset(primary, companion, k);
      node.append(mapStar(paints, companion, system.x + dx * scale, system.y + dy * scale, r * scale));
    });
    node.append(mapStar(paints, primary, system.x, system.y, primary.radius * scale));
    if (lit.has(i)) node.classList.add('lit');
    // A gentle, staggered twinkle on some stars (home.css).
    if (i % 7 === 0) node.style.animationDelay = `${(i % 13) * 0.6}s`;
    if (i % 7 === 0) node.classList.add('twinkle');
    stars.append(node);
  });
  root.append(lanes, stars);
  return root;
}
