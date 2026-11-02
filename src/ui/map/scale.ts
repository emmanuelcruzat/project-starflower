import type { Planet, StarType } from './generate';

// The system diagram's scale: how big stars and planets are drawn, and how
// their orbits are spaced. Shared by the game's system view (galaxyMap.ts)
// and the site's system art (src/home/systemArt.ts), so they match.

/**
 * Sizes in a system's diagram, in diagram units: true to life, but
 * squeezed. A body `size` Suns across is drawn `sun * size ** power`
 * across, so a hypergiant still dwarfs a red dwarf, a brown dwarf is the
 * size of a gas giant and a white dwarf no bigger than an Earth, while the
 * planets stay big enough to see. Neutron stars and black holes are far
 * too small for any scale, so they're drawn at `minStar` and `minBlackHole`
 * (whose accretion disc spreads well past that). Moons circle their planet
 * `moonGap` past its edge, each `moonStep` further out.
 */
export const DIAGRAM = { sun: 24, power: 0.28, minStar: 5, minBlackHole: 8, moonGap: 9, moonStep: 7, moonRadius: 2.4 };
/** Earth's radius, in Suns. */
const EARTH_IN_SUNS = 0.00917;
/**
 * How planets' orbits are spaced, in diagram units. The first lies
 * `firstGap` past the stars, scaled up for bigger, brighter stars (whose
 * worlds orbit further out) and down for dim ones. Each orbit after is
 * `ratio` times further out than the last, as real orbits roughly are, but
 * never so close that its moons and name touch its neighbor's. If that
 * runs past `outer` (`wideOuter` for each star of a wide system), the gaps
 * close up to fit.
 */
export const ORBITS = { firstGap: 70, ratio: 1.7, outer: 560, wideOuter: 330, clearance: 12 };

/** A star's size in the diagram. */
export function diagramStarSize(star: StarType): number {
  const floor = star.exotic === 'black-hole' ? DIAGRAM.minBlackHole : DIAGRAM.minStar;
  return Math.max(floor, DIAGRAM.sun * star.size ** DIAGRAM.power);
}

/** A planet's size in the diagram, on the same scale as its star. */
export function diagramPlanetSize(planet: Planet): number {
  return DIAGRAM.sun * (planet.type.size * EARTH_IN_SUNS) ** DIAGRAM.power;
}

/**
 * The radius of each orbit, innermost first, round stars reaching `core`
 * from their middle, the biggest of them `starSize` across. `reach` is how
 * far each orbit's body (moons and all) spreads either side of it.
 */
export function orbitRadii(reach: number[], core: number, starSize: number, outer: number): number[] {
  if (reach.length === 0) return [];
  // Brightness grows with size, and with it how far out worlds can stay cool.
  const first = core + ORBITS.firstGap * Math.sqrt(starSize / DIAGRAM.sun);
  const spaced = (ratio: number) => {
    const orbits = [first];
    for (let j = 1; j < reach.length; j++) {
      const previous = orbits[j - 1];
      orbits.push(Math.max(previous * ratio, previous + reach[j - 1] + reach[j] + ORBITS.clearance));
    }
    return orbits;
  };
  // Round a giant, the first orbit alone may be most of the way out: leave
  // the rest at least a little room each.
  const end = Math.max(outer, first + 50 * (reach.length - 1));
  const orbits = spaced(ORBITS.ratio);
  if (orbits[orbits.length - 1] <= end) return orbits;
  // Too wide: find the gentlest ratio that fits, so the gaps still widen outwards.
  let [low, high] = [1, ORBITS.ratio];
  for (let n = 0; n < 20; n++) {
    const mid = (low + high) / 2;
    if (spaced(mid)[reach.length - 1] <= end) low = mid;
    else high = mid;
  }
  const fitted = spaced(low);
  const last = fitted[fitted.length - 1];
  if (last <= end) return fitted;
  // Even evenly spaced, their moons need more room than there is: squeeze the gaps.
  const squeeze = (end - first) / (last - first);
  return fitted.map((orbit) => first + (orbit - first) * squeeze);
}

/** How far an asteroid belt's rocks scatter either side of its orbit, in diagram units. */
export const BELT_BAND = 14;
