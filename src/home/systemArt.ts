import { seededRandom } from '../engine/random';
import type { StarType } from '../ui/map/generate';
import { diagramStar, lightFrom, moonBody, Paints, planetBody, rockPath } from '../ui/map/bodies';
import {
  BELT_TYPE, hostOrbits, systemBelt, systemPlanets, type Belt, type GalaxyMap, type Planet,
} from '../ui/map/generate';
import { BELT_BAND, DIAGRAM, diagramPlanetSize, diagramStarSize, ORBITS, orbitRadii } from '../ui/map/scale';
import { SHOWCASE, svg } from './sectorArt';

// The homepage's pictures of the system view: real systems from the
// showcase sector, drawn as the game's system diagram draws them (the same
// bodies and random streams, so every planet lies the same way from its
// star as in the game), but still, with moons stopped partway round. Stars
// and planets are drawn BODY_SCALE times bigger than the game's scale, with
// orbits spaced to suit, so their detail shows at a card's size. Only close
// systems, where every planet circles all the stars, which read best as a picture.

/** How much bigger than in the game bodies are drawn here. */
const BODY_SCALE = 2;

/** Each drawing's gradients get ids of their own, so several on one page don't clash. */
let drawings = 0;

/** A showcase system, with what's in it. */
export interface ShowcaseSystem {
  index: number;
  planets: Planet[];
  belt: Belt | null;
}

function contents(index: number, starCount: number): ShowcaseSystem {
  const planets = systemPlanets(SHOWCASE, index, starCount);
  return { index, planets, belt: systemBelt(SHOWCASE, index, planets) };
}

/**
 * Three systems worth showing off, best first: the richest system round an
 * ordinary star (ringed giants, a living world, a belt and moons count for
 * most), the busiest giant star, and the busiest black hole, neutron star or
 * white dwarf. Any kind the sector lacks is skipped.
 */
export function showcaseSystems(map: GalaxyMap): ShowcaseSystem[] {
  const close = map.systems
    .map((system, index) => contents(index, system.stars.length))
    .filter(({ planets }) => planets.length > 0 && planets.every((p) => p.host === null));
  const primary = (s: ShowcaseSystem) => map.systems[s.index].stars[0];
  const best = (pool: ShowcaseSystem[], score: (s: ShowcaseSystem) => number) =>
    pool.reduce<ShowcaseSystem | null>((top, s) => (top === null || score(s) > score(top) ? s : top), null);
  const richness = (s: ShowcaseSystem) => s.planets.length
    + s.planets.reduce((sum, p) => sum + p.moons.length * 0.3, 0)
    + (s.planets.some((p) => p.type.ringed) ? 3 : 0)
    + (s.planets.some((p) => ['Terran', 'Ocean', 'Jungle'].includes(p.type.name)) ? 3 : 0)
    + (s.belt ? 2 : 0);
  const busiest = (s: ShowcaseSystem) => s.planets.length + (s.belt ? 0.5 : 0);
  const picks = [
    best(close.filter((s) => primary(s).eyebrow === 'Main-sequence star'), richness),
    best(close.filter((s) => /giant/i.test(primary(s).eyebrow)), busiest),
    best(close.filter((s) => primary(s).exotic === 'black-hole'), busiest)
      ?? best(close.filter((s) => primary(s).exotic !== undefined), busiest),
  ];
  return picks.filter((s): s is ShowcaseSystem => s !== null);
}

/** A showcase system drawn like the game's system view, framed round its outermost orbit. */
export function drawSystem(map: GalaxyMap, { index, planets, belt }: ShowcaseSystem): SVGSVGElement {
  const seed = SHOWCASE.id;
  const system = map.systems[index];
  const root = svg('svg', { class: 'system-art', role: 'img' });
  const defs = svg('defs', {});
  const paints = new Paints(defs, `system-art-${++drawings}`);
  const back = svg('g', { class: 'art-orbits' });
  const front = svg('g', {});
  root.append(defs, back, front);

  // The same streams as the game's diagram, used in the same order.
  const random = seededRandom(`${seed}/orbits/${index}`);
  const radius = (star: StarType) => diagramStarSize(star) * BODY_SCALE;
  const planetSize = (planet: Planet) => diagramPlanetSize(planet) * BODY_SCALE;
  const moon = { gap: DIAGRAM.moonGap * BODY_SCALE, step: DIAGRAM.moonStep * BODY_SCALE, radius: DIAGRAM.moonRadius * BODY_SCALE };
  const planetReach = (planet: Planet) => planetSize(planet)
    + (planet.moons.length > 0 ? moon.gap + (planet.moons.length - 1) * moon.step : 0);
  const reachOf = (item: number | 'belt') => (item === 'belt' ? BELT_BAND : planetReach(planets[item]));

  // The stars, huddled in the middle: the primary at (0, 0), companions round it.
  const [primary, ...companions] = system.stars;
  const places = [{ x: 0, y: 0 }];
  companions.forEach((star, k) => {
    const angle = -Math.PI / 4 + (k * Math.PI * 2) / companions.length;
    const distance = radius(primary) + radius(star) + 18;
    places.push({ x: Math.cos(angle) * distance, y: Math.sin(angle) * distance });
  });
  const starReach = Math.max(...system.stars.map((star, k) => Math.hypot(places[k].x, places[k].y) + radius(star)));
  if (companions.length > 0) back.append(svg('circle', { cx: 0, cy: 0, r: Math.hypot(places[1].x, places[1].y).toFixed(1), class: 'art-orbit art-companion-orbit' }));
  system.stars.forEach((star, k) => {
    const r = radius(star);
    back.append(svg('circle', { cx: places[k].x.toFixed(1), cy: places[k].y.toFixed(1), r: (r + Math.min(r * 2.2, 90)).toFixed(1), fill: paints.halo(star) }));
    front.append(diagramStar(paints, star, places[k].x, places[k].y, r, `star-${k}`, seededRandom(`${seed}/surface/${index}/star-${k}`)));
  });

  const orbits = hostOrbits(planets, belt, null);
  const radii = orbitRadii(orbits.map(reachOf), starReach, radius(primary), ORBITS.outer);
  const outer = radii[radii.length - 1] + reachOf(orbits[orbits.length - 1]);

  orbits.forEach((item, j) => {
    const orbit = radii[j];
    if (item === 'belt') {
      // The belt's rocks, from the same stream as the game's.
      const rocks = seededRandom(`${seed}/belt-rocks/${index}`);
      const band = svg('g', {});
      const count = Math.round((orbit * Math.PI * 2) / 7);
      for (let n = 0; n < count; n++) {
        const angle = rocks() * Math.PI * 2;
        const spread = (rocks() + rocks() - 1) * BELT_BAND;
        const x = Math.cos(angle) * (orbit + spread);
        const y = Math.sin(angle) * (orbit + spread);
        const shade = 0.55 + rocks() * 0.45;
        const colour = rocks() < 0.3 ? '#b5a48c' : BELT_TYPE.colour;
        band.append(svg('path', { d: rockPath(x, y, 0.8 + rocks() * 1.7, rocks), fill: colour, 'fill-opacity': shade.toFixed(2) }));
      }
      front.prepend(band);
      return;
    }
    const planet = planets[item];
    back.append(svg('circle', { cx: 0, cy: 0, r: orbit.toFixed(1), class: 'art-orbit' }));
    const angle = random() * Math.PI * 2;
    const x = Math.cos(angle) * orbit;
    const y = Math.sin(angle) * orbit;
    const r = planetSize(planet);
    // Moons stopped where their own stream starts them in the game.
    planet.moons.forEach((type, m) => {
      const ring = r + moon.gap + m * moon.step;
      const a = random() * Math.PI * 2;
      back.append(svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: ring.toFixed(1), class: 'art-orbit art-moon-orbit' }));
      front.append(moonBody(paints, type, x + Math.cos(a) * ring, y + Math.sin(a) * ring, moon.radius));
    });
    front.append(planetBody(paints, planet.type, x, y, r, `planet-${item}`, seededRandom(`${seed}/surface/${index}/${item}`), lightFrom(x, y, 0, 0)));
  });

  // Frame the outermost orbit, with a little room round it. (No names in
  // the picture: the card's caption says what the system is.)
  const frame = outer * 1.06;
  root.setAttribute('viewBox', `${(-frame).toFixed(0)} ${(-frame).toFixed(0)} ${(2 * frame).toFixed(0)} ${(2 * frame).toFixed(0)}`);
  root.setAttribute('aria-label', `The ${system.name} system: ${system.stars.map((s) => s.name).join(' and ')}, with ${planets.length} planet${planets.length === 1 ? '' : 's'}${belt ? ' and an asteroid belt' : ''}.`);
  return root;
}
