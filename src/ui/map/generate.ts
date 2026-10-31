import { seededRandom, type Random } from '../../engine/random';
import type { Nation } from '../../types';

// PLACEHOLDER map generation. Systems, lanes and who owns what are generated
// on screen from the nation's id and never saved. When the map becomes a real
// feature, this belongs in engine/ and its output in a saved World object.

export const MAP_WIDTH = 2400;
export const MAP_HEIGHT = 1500;
const MARGIN = 40;
/** At most this many systems; the sector's ragged outline usually fits a few less. */
const STAR_COUNT = 380;
/**
 * The sector's outline: a ragged oval, `base` of the way to the map's edges
 * on average, its edge wobbling by up to `wobble` in a few broad waves.
 * Inside, a few `voids` (thinly starred patches) break up the spread.
 */
const SHAPE = { base: 0.82, wobble: 0.16, waves: [2, 3, 5], voids: { count: 3, radius: { min: 110, max: 210 } } };
/** Systems closer than this look cramped and their labels collide. */
const MIN_STAR_DISTANCE = 56;
/** Extra lanes (beyond the ones that keep the map connected) are only this long, so routes stay local. */
const MAX_EXTRA_LANE = 110;
const MAX_LANES_PER_STAR = 4;
/**
 * Most hyperlanes a constellation can have to other constellations. Few
 * exits make each constellation a distinct cluster with a handful of
 * gateways. Only broken when it's the only way to keep the map connected.
 */
const MAX_CONSTELLATION_EXITS = 3;
/** Extra links between constellations (beyond those that keep the map connected) are only this long. */
const MAX_EXTRA_GATEWAY = 160;

const PLAYER_SYSTEMS = 12;
/** Stand-in neighbors so borders have something to meet. Varkesh appears in incidents.json. */
const NEIGHBOUR_NAMES = ['Varkesh Hegemony', 'Ostrel Compact', 'Tamsin Free Worlds', 'Halcyne Directorate', 'Orun Ascendancy', 'Ysolde Concord'];
const NEIGHBOUR_SYSTEMS = { min: 10, max: 22 };

export interface StarSystem {
  /**
   * The survey designation: the constellation's code plus a letter, like
   * "R6-KYM-C". Letters go outwards from the constellation's middle.
   */
  designation: string;
  /** What the map shows: a proper name like "Kessra" inside a nation's space, otherwise the designation. */
  name: string;
  /**
   * The system's stars, biggest first: one for most systems, up to four for
   * a quaternary. The first is the primary, drawn at the system's position.
   */
  stars: StarType[];
  x: number;
  y: number;
  /** Index into GalaxyMap.constellations. */
  constellation: number;
}

/** The whole map is one sector, made up of constellations. */
export interface MapSector {
  name: string;
}

/** A small cluster of neighboring systems. */
export interface MapConstellation {
  /** A survey code, like "R6-KYM". */
  name: string;
  /** Indexes into GalaxyMap.systems, in letter order (-A first). */
  systems: number[];
}

/** A hyperlane joins two systems, stored as indexes into the systems list. */
export type Lane = [a: number, b: number];

export interface MapPower {
  name: string;
  isPlayer: boolean;
}

export interface GalaxyMap {
  systems: StarSystem[];
  lanes: Lane[];
  /** Index 0 is always the player. */
  powers: MapPower[];
  /** For each system, the index of the power that owns it, or null if unclaimed. */
  owners: (number | null)[];
  /** The player's home system. */
  home: number;
  sector: MapSector;
  constellations: MapConstellation[];
}

export function generateMap(nation: Nation): GalaxyMap {
  // Seeding with the nation's id draws the same map on every visit.
  const random = seededRandom(nation.id);
  const shape = sectorShape(nation.id);
  const systems = placeSystems(random, shape);
  // Like the other extras below, star types use their own stream so they
  // don't move any systems.
  const starRandom = seededRandom(`${nation.id}/stars`);
  for (const system of systems) system.stars = systemStars(starRandom);
  // Constellations come first, because lanes are laid out around them.
  // They draw from their own stream, so the main one stays as it was.
  const constellations = groupConstellations(systems, seededRandom(`${nation.id}/constellations`));
  const lanes = connectSystems(systems, constellations);
  const home = Math.floor(random() * systems.length);
  const powers: MapPower[] = [
    // "Union of Kessra": the full title minus its "The", to sit alongside
    // the neighbors' names on the map.
    { name: `${nation.prefix} of ${nation.name}`, isPlayer: true },
    ...NEIGHBOUR_NAMES.map((name) => ({ name, isPlayer: false })),
  ];
  const owners = assignTerritory(systems, lanes, home, powers.length, random);
  const sector = { name: sectorName(random) };
  // Proper names use their own stream too, so naming doesn't move any stars.
  nameSettledSystems(systems, owners, seededRandom(`${nation.id}/names`));
  // Systems the player has claimed join their territory. This comes after
  // naming, so claiming one doesn't rename others.
  for (const i of nation.claimedSystems ?? []) {
    if (owners[i] === null) owners[i] = 0;
  }
  return { systems, lanes, powers, owners, home, sector, constellations };
}

// --- Systems and lanes ---

/**
 * Scatters systems at random, rejecting any spot too close to an existing
 * one. Simple, and it gives an even but natural-looking spread. Stops early
 * if the space fills up, so a too-large STAR_COUNT can't loop forever.
 */
/**
 * How far inside the sector a point is: below 1 is inside, above is out.
 * The outline is an oval whose edge wobbles in a few broad waves, so no two
 * sectors have the same shape; inside its voids the value is pushed up, so
 * fewer stars land there. Drawn from its own stream, so it never moves
 * anything else. The star map's dust follows it too.
 */
export function sectorShape(seed: string): (x: number, y: number) => number {
  const random = seededRandom(`${seed}/shape`);
  const waves = SHAPE.waves.map((k) => ({ k, phase: random() * Math.PI * 2, size: (0.5 + random() * 0.5) / k }));
  const total = waves.reduce((sum, w) => sum + w.size, 0);
  const cx = MAP_WIDTH / 2;
  const cy = MAP_HEIGHT / 2;
  const rx = cx - MARGIN;
  const ry = cy - MARGIN;
  const voids = Array.from({ length: SHAPE.voids.count }, () => ({
    x: cx + (random() - 0.5) * rx * 1.2,
    y: cy + (random() - 0.5) * ry * 1.2,
    r: SHAPE.voids.radius.min + random() * (SHAPE.voids.radius.max - SHAPE.voids.radius.min),
  }));
  return (x, y) => {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    const angle = Math.atan2(dy, dx);
    // The edge's distance from the middle in this direction, never past the map's edge.
    const edge = Math.min(1, SHAPE.base + (SHAPE.wobble / total) * waves.reduce((sum, w) => sum + w.size * Math.sin(w.k * angle + w.phase), 0));
    let depth = Math.hypot(dx, dy) / edge;
    // In a void, count the point as further out, most of all at its middle.
    for (const v of voids) {
      const near = 1 - Math.hypot(x - v.x, y - v.y) / v.r;
      if (near > 0) depth += near * 1.2;
    }
    return depth;
  };
}

function placeSystems(random: Random, shape: (x: number, y: number) => number): StarSystem[] {
  const systems: StarSystem[] = [];
  for (let attempt = 0; attempt < STAR_COUNT * 60 && systems.length < STAR_COUNT; attempt++) {
    const x = MARGIN + random() * (MAP_WIDTH - 2 * MARGIN);
    const y = MARGIN + random() * (MAP_HEIGHT - 2 * MARGIN);
    // A ragged edge: near the outline, a star may or may not make it in.
    if (shape(x, y) > 1 - 0.2 * random()) continue;
    if (systems.every((s) => distance(s, { x, y }) >= MIN_STAR_DISTANCE)) {
      // Constellations, and the names that come from them, are assigned once every system exists.
      // Stars get their spectral class from a stream of their own, in generateMap.
      systems.push({ designation: '', name: '', stars: [], x, y, constellation: -1 });
    }
  }
  return systems;
}

// --- Constellations ---

/** Constellations hold about this many systems each. */
const CONSTELLATION_SIZE = 7;
/** No constellation has fewer systems than this; smaller groups are merged into a neighbor. */
const MIN_CONSTELLATION_SIZE = 4;
const CODE_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
/** Lengths either side of the dash in a code like "M-OEE8" or "J5A-IX", as in EVE Online's null-sec. */
const CODE_SHAPES: [number, number][] = [[1, 4], [2, 3], [3, 2], [4, 1], [2, 4]];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A survey code like "R6-KYM". */
function constellationCode(random: Random): string {
  const part = (length: number) => Array.from({ length }, () => CODE_CHARACTERS[Math.floor(random() * CODE_CHARACTERS.length)]).join('');
  const [before, after] = CODE_SHAPES[Math.floor(random() * CODE_SHAPES.length)];
  return `${part(before)}-${part(after)}`;
}

/**
 * Splits the systems into small clusters of neighbors. A few systems spread
 * out across the map are picked as centers (each as far as possible from the
 * ones before), and every system joins its nearest center, so each
 * constellation is a compact patch that doesn't overlap the next.
 */
function groupConstellations(systems: StarSystem[], random: Random): MapConstellation[] {
  if (systems.length === 0) return [];
  const centres = [Math.floor(random() * systems.length)];
  // Each system's distance to its nearest center so far, updated as centers
  // are added, so picking the next one is a single pass.
  const gaps = systems.map((s) => distance(s, systems[centres[0]]));
  const count = Math.max(1, Math.round(systems.length / CONSTELLATION_SIZE));
  while (centres.length < count) {
    const next = gaps.reduce((best, gap, i) => (gap > gaps[best] ? i : best), 0);
    centres.push(next);
    systems.forEach((s, i) => (gaps[i] = Math.min(gaps[i], distance(s, systems[next]))));
  }

  const groups = centres.map((): number[] => []);
  systems.forEach((system, i) => {
    const nearest = centres.reduce((best, c, k) => (distance(system, systems[c]) < distance(system, systems[centres[best]]) ? k : best), 0);
    groups[nearest].push(i);
  });
  mergeSmallGroups(groups, systems);

  const codes = new Set<string>();
  return groups.map((group, index) => {
    let code: string;
    do code = constellationCode(random);
    while (codes.has(code));
    codes.add(code);

    // Letter the systems from the middle of the constellation outwards.
    const middle = { x: group.reduce((sum, i) => sum + systems[i].x, 0) / group.length, y: group.reduce((sum, i) => sum + systems[i].y, 0) / group.length };
    const ordered = [...group].sort((a, b) => distance(systems[a], middle) - distance(systems[b], middle));
    ordered.forEach((i, k) => {
      const system = systems[i];
      system.constellation = index;
      // Constellations hold far fewer than 26 systems; numbers are only a fallback.
      system.designation = `${code}-${LETTERS[k] ?? k + 1}`;
      system.name = system.designation;
    });
    return { name: code, systems: ordered };
  });
}

/**
 * Folds any group smaller than MIN_CONSTELLATION_SIZE into the group with
 * the system closest to it, smallest group first, until none are too small.
 * Changes `groups` in place.
 */
function mergeSmallGroups(groups: number[][], systems: StarSystem[]): void {
  for (;;) {
    const small = groups.filter((g) => g.length < MIN_CONSTELLATION_SIZE).sort((a, b) => a.length - b.length)[0];
    if (!small || groups.length < 2) return;
    let into = -1;
    let gap = Infinity;
    groups.forEach((other, k) => {
      if (other === small) return;
      for (const i of small) {
        for (const j of other) {
          const d = distance(systems[i], systems[j]);
          if (d < gap) {
            gap = d;
            into = k;
          }
        }
      }
    });
    groups[into].push(...small);
    groups.splice(groups.indexOf(small), 1);
  }
}

// --- Stars and planets ---

export interface StarType {
  /** Full name, like "Class G" or "Black hole". */
  name: string;
  /** Short name for listing several stars together, like "G" or "BH". */
  short: string;
  /** Relative chance of a star being this type. Cool, small stars are the most common. */
  weight: number;
  /**
   * Size on the map, in map units. Hotter classes are bigger. Every star is
   * at least 3.2, so it outsizes every planet in the system's miniature and
   * diagram, which scale stars up more than planets.
   */
  radius: number;
  colour: string;
  /** Dwarfs and remnants that get their own look (see style.css). */
  exotic?: 'white-dwarf' | 'neutron' | 'black-hole';
  /** What the right-click info calls it, if not just "Star". */
  eyebrow?: string;
  /** Surface temperature, for the right-click info. */
  temperature: string;
  /** A sentence or two for the right-click info. */
  description: string;
}

/**
 * The giants, biggest and rarest last; the spectral classes O to M, hottest
 * to coolest; brown dwarfs; then the stellar remnants.
 */
export const STAR_TYPES: StarType[] = [
  {
    name: 'Red giant', short: 'RG', weight: 4, radius: 6, colour: '#ff8a5c', eyebrow: 'Giant star', temperature: '3,000–5,000 K',
    description: 'An old star swollen to a hundred times its former size as its core runs dry. Its inner worlds have long since been swallowed or scorched.',
  },
  {
    name: 'Supergiant', short: 'SG', weight: 0.6, radius: 7.2, colour: '#ff6f45', eyebrow: 'Giant star', temperature: '3,500–4,500 K',
    description: 'A vast, bloated star that would fill the orbit of a gas giant, shedding its outer layers into space. It will end as a supernova.',
  },
  {
    name: 'Hypergiant', short: 'HG', weight: 0.15, radius: 8.6, colour: '#fff0c8', eyebrow: 'Giant star', temperature: '4,000–35,000 K',
    description: 'Among the largest and brightest stars there are, a million times the Sun\'s light, so unstable it throws off whole shells of itself in great eruptions.',
  },
  {
    name: 'Class O', short: 'O', weight: 2, radius: 5.5, colour: '#9db4ff', temperature: 'Over 30,000 K',
    description: 'A blue giant: rare, blindingly bright and short-lived. Its radiation scours any world that strays close.',
  },
  {
    name: 'Class B', short: 'B', weight: 5, radius: 5, colour: '#b3c6ff', temperature: '10,000–30,000 K',
    description: 'A hot blue-white star, hundreds of times brighter than the Sun. It burns through its fuel in a few hundred million years.',
  },
  {
    name: 'Class A', short: 'A', weight: 8, radius: 4.6, colour: '#dbe4ff', temperature: '7,500–10,000 K',
    description: 'A bright white star, spinning fast. Its planets have to keep their distance to stay cool.',
  },
  {
    name: 'Class F', short: 'F', weight: 12, radius: 4.3, colour: '#fbf8ff', temperature: '6,000–7,500 K',
    description: 'A yellow-white star, a little hotter and brighter than the Sun, with a generous zone where water stays liquid.',
  },
  {
    name: 'Class G', short: 'G', weight: 18, radius: 4, colour: '#fff1c4', temperature: '5,200–6,000 K',
    description: 'A yellow dwarf like the Sun: steady, long-lived and kind to life.',
  },
  {
    name: 'Class K', short: 'K', weight: 25, radius: 3.6, colour: '#ffcf8f', temperature: '3,700–5,200 K',
    description: 'An orange dwarf, cooler and dimmer than the Sun, and stable for tens of billions of years.',
  },
  {
    name: 'Class M', short: 'M', weight: 30, radius: 3.2, colour: '#ff9b6b', temperature: '2,400–3,700 K',
    description: 'A red dwarf, the most common star in the galaxy. Dim and nearly ageless, but given to violent flares.',
  },
  // Brown dwarfs, white dwarfs and neutron stars are smaller in reality than
  // the smallest stars; they're drawn at that size so they still beat any planet.
  {
    name: 'Brown dwarf', short: 'BD', weight: 8, radius: 3.2, colour: '#b4566b', eyebrow: 'Substellar object', temperature: '300–2,400 K',
    description: 'Too small to fuse hydrogen, too big to be a planet: a failed star glowing a dull magenta with the heat left over from its birth.',
  },
  {
    name: 'White dwarf', short: 'WD', weight: 6, radius: 3.2, colour: '#f2f6ff', exotic: 'white-dwarf', eyebrow: 'Stellar remnant', temperature: '8,000–40,000 K',
    description: 'The bare core of a star like the Sun, packed into a ball the size of a planet. It has no fuel left and will cool for billions of years.',
  },
  {
    name: 'Neutron star', short: 'NS', weight: 2, radius: 3.2, colour: '#eaf4ff', exotic: 'neutron', eyebrow: 'Stellar remnant', temperature: 'About 600,000 K',
    description: 'The collapsed core of a dead giant: a city-sized ball of neutrons, spinning many times a second.',
  },
  {
    name: 'Black hole', short: 'BH', weight: 1, radius: 4.2, colour: '#05060a', exotic: 'black-hole', eyebrow: 'Stellar remnant', temperature: 'None it gives off',
    description: 'Collapsed so far that not even light escapes. Matter spiraling in glows white-hot in its accretion disc.',
  },
];

/** How many stars a system has, and how likely each is. Most are single. */
const MULTIPLICITY = [
  { stars: 1, weight: 60 },
  { stars: 2, weight: 28 },
  { stars: 3, weight: 9 },
  { stars: 4, weight: 3 },
];
export const MULTIPLICITY_NAMES = ['Single', 'Binary', 'Trinary', 'Quaternary'];

/**
 * A system's stars, biggest first. A black hole always comes first (it
 * dominates whatever it's paired with); the rest go by size.
 */
function systemStars(random: Random): StarType[] {
  const count = weighted(MULTIPLICITY, random).stars;
  const stars = Array.from({ length: count }, () => weighted(STAR_TYPES, random));
  const rank = (star: StarType) => (star.exotic === 'black-hole' ? Infinity : star.radius);
  return stars.sort((a, b) => rank(b) - rank(a));
}

export interface PlanetType {
  name: string;
  /** Relative chance of a planet being this type. */
  weight: number;
  /**
   * Base size, scaled up or down by the system's miniature and diagram.
   * Always well below the smallest star's, so the star is always the
   * biggest body in its system.
   */
  radius: number;
  colour: string;
  /** Drawn with a ring. */
  ringed?: boolean;
  /** How many moons a planet of this type can have, both ends included. Big planets hold on to more. */
  moons: { min: number; max: number };
  /** A sentence or two for the right-click info. */
  description: string;
}

export const PLANET_TYPES: PlanetType[] = [
  {
    name: 'Barren', weight: 25, radius: 2.4, colour: '#8a8178', moons: { min: 0, max: 1 },
    description: 'Airless rock, cratered and silent. Poor for living on, rich for mining.',
  },
  {
    name: 'Gas giant', weight: 18, radius: 4.8, colour: '#c99a5b', ringed: true, moons: { min: 1, max: 5 },
    description: 'A vast ball of hydrogen and helium with no surface to stand on. Its moons are often worth more than it is.',
  },
  {
    name: 'Ice', weight: 15, radius: 2.8, colour: '#bfe3f2', moons: { min: 0, max: 2 },
    description: 'Frozen through, under thin, bitter air. Water is everywhere, if you can melt it.',
  },
  {
    name: 'Desert', weight: 10, radius: 2.8, colour: '#d9b26a', moons: { min: 0, max: 2 },
    description: 'Dry and dusty, its water locked away underground or in the polar caps.',
  },
  {
    name: 'Toxic', weight: 8, radius: 2.8, colour: '#9fbf4a', moons: { min: 0, max: 1 },
    description: 'A thick, poisonous atmosphere traps the heat under crushing clouds.',
  },
  {
    name: 'Volcanic', weight: 8, radius: 2.6, colour: '#d2603f', moons: { min: 0, max: 1 },
    description: 'Young and restless, its surface remade again and again by lava and ash.',
  },
  {
    name: 'Ocean', weight: 6, radius: 3.2, colour: '#3f8fd2', moons: { min: 0, max: 2 },
    description: 'Water from pole to pole, with islands few and far between.',
  },
  {
    name: 'Jungle', weight: 4, radius: 3.2, colour: '#3fa65f', moons: { min: 0, max: 2 },
    description: 'Hot, wet and overgrown. Life thrives here, not all of it friendly.',
  },
  {
    name: 'Terran', weight: 4, radius: 3.2, colour: '#5fb3a1', moons: { min: 0, max: 2 },
    description: 'Temperate, with breathable air and open water: as close to a second home as it gets.',
  },
];
const PLANETS_PER_SYSTEM = { min: 1, max: 6 };

export interface MoonType {
  name: string;
  weight: number;
  colour: string;
}

export const MOON_TYPES: MoonType[] = [
  { name: 'Rocky moon', weight: 3, colour: '#9a948c' },
  { name: 'Icy moon', weight: 2, colour: '#d2e8f2' },
  { name: 'Volcanic moon', weight: 1, colour: '#d98a5a' },
];

export interface Planet {
  type: PlanetType;
  moons: MoonType[];
  /**
   * The star it orbits, as an index into its system's stars, or null if it
   * circles all of them together. In a close system every planet circles
   * all the stars; in a wide one, each planet has a star of its own.
   */
  host: number | null;
}

/** How likely a system with more than one star is to be wide, its stars far enough apart to each keep their own planets. */
const WIDE_SYSTEM_CHANCE = 0.5;

/** Picks an item at random, so an item with weight 3 is three times as likely as one with weight 1. */
function weighted<T extends { weight: number }>(items: T[], random: Random): T {
  let roll = random() * items.reduce((sum, item) => sum + item.weight, 0);
  return items.find((item) => (roll -= item.weight) < 0) ?? items[items.length - 1];
}

/**
 * A system's planets, innermost first. Each system draws from its own
 * random stream, so its planets never change and nothing else on the map
 * depends on them. Generated when asked for, since only a focused system
 * shows its planets.
 */
export function systemPlanets(nation: Nation, system: number, starCount: number): Planet[] {
  const random = seededRandom(`${nation.id}/planets/${system}`);
  const count = PLANETS_PER_SYSTEM.min + Math.floor(random() * (PLANETS_PER_SYSTEM.max - PLANETS_PER_SYSTEM.min + 1));
  const types = Array.from({ length: count }, () => weighted(PLANET_TYPES, random));
  // Moons have a stream of their own, so adding them didn't change any planets.
  const moonRandom = seededRandom(`${nation.id}/moons/${system}`);
  // Which star each planet circles has a stream of its own too. The
  // primary, being the biggest, holds on to twice as many as a companion.
  const hostRandom = seededRandom(`${nation.id}/hosts/${system}`);
  const wide = starCount > 1 && hostRandom() < WIDE_SYSTEM_CHANCE;
  const hostWeights = Array.from({ length: starCount }, (_, k) => ({ k, weight: k === 0 ? 2 : 1 }));
  return types.map((type) => {
    const moons = type.moons.min + Math.floor(moonRandom() * (type.moons.max - type.moons.min + 1));
    const host = wide ? weighted(hostWeights, hostRandom).k : null;
    return { type, moons: Array.from({ length: moons }, () => weighted(MOON_TYPES, moonRandom)), host };
  });
}

// --- Proper names ---

const NAME_STARTS = ['Kes', 'Vel', 'Tor', 'Ar', 'Is', 'Ren', 'Mor', 'Sar', 'Ul', 'Zan', 'Cor', 'Dra', 'Ne', 'Ty', 'Ob', 'Hal', 'Qir', 'Lys'];
const NAME_MIDDLES = ['a', 'e', 'o', 'i', 'an', 'el', 'ar', 'is'];
const NAME_ENDS = ['sra', 'ion', 'eth', 'ara', 'os', 'en', 'ix', 'una', 'or', 'ia', 'as', 'yn', 'ek', 'ul', 'ane', 'is'];

/**
 * Systems inside a nation's space are settled, so they have proper names
 * like "Kessra", "Velion" or "Toranix" rather than survey designations.
 * Unclaimed systems keep their designations. Names are unique.
 */
function nameSettledSystems(systems: StarSystem[], owners: (number | null)[], random: Random): void {
  const pick = (list: string[]) => list[Math.floor(random() * list.length)];
  const used = new Set<string>();
  systems.forEach((system, i) => {
    if (owners[i] === null) return;
    let name: string;
    do {
      // About half get a middle syllable, since two syllables alone run out at a few hundred.
      const middle = random() < 0.5 ? pick(NAME_MIDDLES) : '';
      name = pick(NAME_STARTS) + middle + pick(NAME_ENDS);
      // Skip pile-ups like "Neeek" or "Draiuna" that a middle syllable can make.
    } while (used.has(name) || /[aeiouy]{3}|(.)\1\1/i.test(name));
    used.add(name);
    system.name = name;
  });
}

// --- Sector ---

const SECTOR_SYLLABLES = ['syn', 'ue', 'fe', 'eol', 'prou', 'pru', 'euq', 'hyp', 'io', 'bla', 'eo', 'dri', 'aae', 'phr', 'oea', 'col', 'gru', 'thu', 'oob', 'ae', 'wre', 'gie', 'scaa', 'ploi', 'mynoa', 'kyl', 'ix'];

/** One or two capitalized words like "Synuefe" or "Eol Prou". */
export function sectorName(random: Random): string {
  const word = () => {
    const syllables = 1 + Math.floor(random() * 2);
    const text = Array.from({ length: syllables }, () => SECTOR_SYLLABLES[Math.floor(random() * SECTOR_SYLLABLES.length)]).join('');
    return text[0].toUpperCase() + text.slice(1);
  };
  return random() < 0.5 ? word() : `${word()} ${word()}`;
}

/**
 * Lanes are laid out in two layers, so constellations read as clusters:
 *
 * Inside each constellation, a minimum spanning tree (the shortest set of
 * lanes joining all its systems) plus a few extra short lanes for alternate
 * routes. Every constellation is therefore connected by its own lanes.
 *
 * Between constellations, "gateway" lanes: for each pair of neighboring
 * constellations, the lane between their two closest systems. The shortest
 * of these that keep the whole map connected go in first, then a few more,
 * each constellation taking at most MAX_CONSTELLATION_EXITS.
 *
 * A lane that would cross an existing one is skipped, because crossing
 * lanes read as junctions that aren't there.
 */
function connectSystems(systems: StarSystem[], constellations: MapConstellation[]): Lane[] {
  const lanes: Lane[] = [];
  const laneCount = systems.map(() => 0);
  const crossesAny = (lane: Lane) => lanes.some((other) => lanesCross(lane, other, systems));
  const add = (lane: Lane) => {
    lanes.push(lane);
    laneCount[lane[0]]++;
    laneCount[lane[1]]++;
  };

  for (const constellation of constellations) {
    for (const lane of spanningTree(constellation.systems, systems)) add(lane);
  }
  addExtraLanes(constellations, systems, lanes, laneCount, crossesAny, add);
  addGateways(constellations, systems, laneCount, crossesAny, add);
  return lanes;
}

/**
 * Prim's algorithm on just these systems: grow a tree from the first,
 * always adding the shortest lane that reaches a system not yet in it. (A
 * tree built this way never crosses itself.) For each system outside the
 * tree, remember its closest system inside it, so each step is one scan.
 */
function spanningTree(members: number[], systems: StarSystem[]): Lane[] {
  const lanes: Lane[] = [];
  if (members.length < 2) return lanes;
  const inTree = new Set([members[0]]);
  const closest = new Map(members.map((i) => [i, { length: distance(systems[i], systems[members[0]]), from: members[0] }]));
  while (inTree.size < members.length) {
    let next = -1;
    for (const i of members) {
      if (!inTree.has(i) && (next < 0 || closest.get(i)!.length < closest.get(next)!.length)) next = i;
    }
    lanes.push([closest.get(next)!.from, next]);
    inTree.add(next);
    for (const i of members) {
      const length = distance(systems[i], systems[next]);
      if (!inTree.has(i) && length < closest.get(i)!.length) closest.set(i, { length, from: next });
    }
  }
  return lanes;
}

/** A few extra short lanes inside each constellation, so there are alternate routes instead of a single branching path. */
function addExtraLanes(
  constellations: MapConstellation[], systems: StarSystem[], lanes: Lane[], laneCount: number[],
  crossesAny: (lane: Lane) => boolean, add: (lane: Lane) => void,
): void {
  const hasLane = (i: number, j: number) => lanes.some(([a, b]) => (a === i && b === j) || (a === j && b === i));
  for (const { systems: members } of constellations) {
    for (const i of members) {
      const nearest = members
        .filter((j) => j !== i)
        .map((j) => ({ j, length: distance(systems[i], systems[j]) }))
        .sort((p, q) => p.length - q.length)
        .slice(0, 3);
      for (const { j, length } of nearest) {
        if (length > MAX_EXTRA_LANE || hasLane(i, j)) continue;
        if (laneCount[i] >= MAX_LANES_PER_STAR || laneCount[j] >= MAX_LANES_PER_STAR) continue;
        if (crossesAny([i, j])) continue;
        add([i, j]);
      }
    }
  }
}

/**
 * Links constellations to each other. Candidates are the shortest lane
 * between each pair of constellations; nearby pairs only, since a long
 * gateway would cut across others. Three passes over them, shortest first:
 * 1. Lanes that join two parts of the map not yet connected, within the exit cap.
 * 2. The same, ignoring the cap, in the rare case the cap left the map split.
 * 3. Extra short gateways within the cap, for alternate routes.
 */
function addGateways(
  constellations: MapConstellation[], systems: StarSystem[], laneCount: number[],
  crossesAny: (lane: Lane) => boolean, add: (lane: Lane) => void,
): void {
  const candidates: { a: number; b: number; lane: Lane; length: number }[] = [];
  for (let a = 0; a < constellations.length; a++) {
    for (let b = a + 1; b < constellations.length; b++) {
      let best: { lane: Lane; length: number } | null = null;
      for (const i of constellations[a].systems) {
        for (const j of constellations[b].systems) {
          const length = distance(systems[i], systems[j]);
          if (!best || length < best.length) best = { lane: [i, j], length };
        }
      }
      // Pairs further apart than this are never neighbors worth linking.
      if (best && best.length < MAX_EXTRA_GATEWAY * 2) candidates.push({ a, b, ...best });
    }
  }
  candidates.sort((p, q) => p.length - q.length);

  // Union-find over constellations: which ones are already connected.
  const parent = constellations.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const exits = constellations.map(() => 0);
  const used = new Set<(typeof candidates)[number]>();
  const link = (candidate: (typeof candidates)[number]) => {
    add(candidate.lane);
    used.add(candidate);
    exits[candidate.a]++;
    exits[candidate.b]++;
    parent[root(candidate.a)] = root(candidate.b);
  };
  const underCap = ({ a, b }: (typeof candidates)[number]) => exits[a] < MAX_CONSTELLATION_EXITS && exits[b] < MAX_CONSTELLATION_EXITS;

  for (const respectCap of [true, false]) {
    for (const candidate of candidates) {
      if (root(candidate.a) === root(candidate.b) || (respectCap && !underCap(candidate))) continue;
      if (!crossesAny(candidate.lane)) link(candidate);
    }
  }
  for (const candidate of candidates) {
    if (used.has(candidate) || candidate.length > MAX_EXTRA_GATEWAY || !underCap(candidate)) continue;
    const [i, j] = candidate.lane;
    if (laneCount[i] >= MAX_LANES_PER_STAR || laneCount[j] >= MAX_LANES_PER_STAR) continue;
    if (!crossesAny(candidate.lane)) link(candidate);
  }
}

export function distance(p: { x: number; y: number }, q: { x: number; y: number }): number {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

/** True if two lanes cross. Lanes that merely share a system don't count. */
function lanesCross(first: Lane, second: Lane, systems: StarSystem[]): boolean {
  if (first.some((i) => second.includes(i))) return false;
  const [p1, p2] = first.map((i) => systems[i]);
  const [p3, p4] = second.map((i) => systems[i]);
  // Which side of line p→q is point r on? The lanes cross when each one's
  // endpoints sit on opposite sides of the other.
  const side = (p: StarSystem, q: StarSystem, r: StarSystem) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(p1, p2, p3) !== side(p1, p2, p4) && side(p3, p4, p1) !== side(p3, p4, p2);
}

// --- Territory ---

/**
 * Gives each power a starting system, then lets them all expand along
 * hyperlanes one system per round, like spilled ink, until each reaches its
 * size. Taking turns keeps any one power from swallowing the map. Expanding
 * along lanes (not just by distance) keeps every territory in one connected
 * piece. Whatever is left over is unclaimed frontier.
 */
function assignTerritory(systems: StarSystem[], lanes: Lane[], home: number, powerCount: number, random: Random): (number | null)[] {
  const owners: (number | null)[] = systems.map(() => null);
  const neighbours = systems.map((_, i) => lanes.flatMap(([a, b]) => (a === i ? [b] : b === i ? [a] : [])));

  // Capitals: the player's home, then each neighbor as far as possible from
  // every capital so far, so powers start spread out.
  const capitals = [home];
  while (capitals.length < powerCount) {
    let best = -1;
    let bestGap = -1;
    systems.forEach((system, i) => {
      if (capitals.includes(i)) return;
      const gap = Math.min(...capitals.map((c) => distance(system, systems[c])));
      if (gap > bestGap) {
        bestGap = gap;
        best = i;
      }
    });
    capitals.push(best);
  }
  capitals.forEach((system, power) => (owners[system] = power));

  const targets = capitals.map((_, power) =>
    power === 0 ? PLAYER_SYSTEMS : NEIGHBOUR_SYSTEMS.min + Math.floor(random() * (NEIGHBOUR_SYSTEMS.max - NEIGHBOUR_SYSTEMS.min + 1)),
  );
  const sizes = capitals.map(() => 1);

  let grew = true;
  while (grew) {
    grew = false;
    for (let power = 0; power < powerCount; power++) {
      if (sizes[power] >= targets[power]) continue;
      // Of the unclaimed systems next to this power's territory, take the one
      // closest to its capital, which keeps territories compact.
      let pick = -1;
      let pickDistance = Infinity;
      owners.forEach((owner, i) => {
        if (owner !== power) return;
        for (const n of neighbours[i]) {
          const d = distance(systems[n], systems[capitals[power]]);
          if (owners[n] === null && d < pickDistance) {
            pick = n;
            pickDistance = d;
          }
        }
      });
      if (pick >= 0) {
        owners[pick] = power;
        sizes[power]++;
        grew = true;
      }
    }
  }
  return owners;
}

// --- Naming bodies ---

/** Planets are numbered outwards from their star, astronomer-style: I, II, III... */
export function roman(n: number): string {
  return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n - 1] ?? String(n);
}

/** Stars in a system are lettered, the primary being A. */
export function starLetter(k: number): string {
  return String.fromCharCode(65 + k);
}

/**
 * Each planet's name. Planets around the whole system are numbered outwards
 * after it ("Kessra II"); in a wide system, each star's planets are numbered
 * after that star ("Kessra B II").
 */
export function planetNames(system: StarSystem, planets: Planet[]): string[] {
  const counts = new Map<number | null, number>();
  return planets.map((planet) => {
    const n = (counts.get(planet.host) ?? 0) + 1;
    counts.set(planet.host, n);
    return planet.host === null ? `${system.name} ${roman(n)}` : `${system.name} ${starLetter(planet.host)} ${roman(n)}`;
  });
}

/** "Class G", or for several stars "Binary · G + M". */
export function describeStars(stars: StarType[]): string {
  if (stars.length === 1) return stars[0].name;
  return `${MULTIPLICITY_NAMES[stars.length - 1]} · ${stars.map((s) => s.short).join(' + ')}`;
}

