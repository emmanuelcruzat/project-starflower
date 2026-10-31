import { fullName, nationTitles } from '../engine/titles';
import type { GameContent, Nation } from '../types';
import { el, formatPopulation } from './dom';
import {
  describeStars, generateMap, planetNames, systemPlanets, type GalaxyMap, type Planet,
} from './map/generate';
import { generateRegion } from './map/region';

// An encyclopedia-style article about the nation, for the overview: an
// infobox, a few paragraphs written from its stats and situation, its
// capital system and its colonized worlds. Everything is worked out from
// the nation as it is now, so the article keeps up as the nation changes.
//
// PLACEHOLDER: colonization isn't a game mechanic yet. Until it is, a world
// counts as colonized if it's habitable (see HABITABLE) and in one of the
// nation's systems on the galactic map.

/** Planet types people can live on, most comfortable first. The capital is the best of them in the home system. */
const HABITABLE = ['Terran', 'Ocean', 'Jungle', 'Desert', 'Ice'];
/** How many recent events the History section lists. */
const RECENT_EVENTS = 4;

interface World {
  name: string;
  type: string;
  system: string;
  /** The system's index on the map, for keeping each system's worlds together. */
  systemIndex: number;
  moons: number;
  capital: boolean;
}

/** The nation's colonized worlds, capital first. A home system with nowhere habitable still has its capital, on its first planet. */
function colonizedWorlds(nation: Nation, map: GalaxyMap): World[] {
  const worlds: World[] = [];
  map.systems.forEach((system, index) => {
    if (map.owners[index] !== 0) return;
    const planets = systemPlanets(nation, index, system.stars.length);
    const names = planetNames(system, planets);
    const isHome = index === map.home;
    const capital = isHome ? capitalPlanet(planets) : -1;
    planets.forEach((planet, k) => {
      if (k !== capital && !HABITABLE.includes(planet.type.name)) return;
      worlds.push({ name: names[k], type: planet.type.name, system: system.name, systemIndex: index, moons: planet.moons.length, capital: k === capital });
    });
  });
  // The capital first, then system by system, each system's worlds by name ("Renyn A I" before "Renyn B I").
  return worlds.sort((a, b) => Number(b.capital) - Number(a.capital) || a.systemIndex - b.systemIndex || a.name.localeCompare(b.name));
}

/** The home system's most habitable planet, or its first if none are. */
function capitalPlanet(planets: Planet[]): number {
  let best = 0;
  let bestRank = Infinity;
  planets.forEach((planet, k) => {
    const rank = HABITABLE.indexOf(planet.type.name);
    if (rank !== -1 && rank < bestRank) [best, bestRank] = [k, rank];
  });
  return best;
}

/** A word for how a 0-100 stat compares. */
function grade(value: number): string {
  if (value < 20) return 'weak';
  if (value < 40) return 'modest';
  if (value < 60) return 'solid';
  if (value < 80) return 'strong';
  return 'exceptional';
}

/** "A, B and C". */
function listOf(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "a" or "an", for the word that follows. */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

export function nationArticle(nation: Nation, content: GameContent): HTMLElement {
  const map = generateMap(nation);
  const region = generateRegion(nation, map.sector.name);
  const government = content.governments.find((g) => g.id === nation.governmentId);
  const governmentName = government?.name ?? nation.governmentId;
  const titles = nationTitles(nation, content);
  const name = fullName(nation);
  const short = `${nation.prefix} of ${nation.name}`;
  const home = map.systems[map.home];
  const homePlanets = systemPlanets(nation, map.home, home.stars.length);
  const homeNames = planetNames(home, homePlanets);
  const capital = capitalPlanet(homePlanets);
  const capitalName = homeNames[capital] ?? home.name;
  const worlds = colonizedWorlds(nation, map);
  const territory = map.owners.filter((o) => o === 0).length;
  const neighbors = map.powers.filter((p) => !p.isPlayer).map((p) => `the ${p.name}`);
  const founded = new Date(nation.foundedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const { stats } = nation;

  const root = el('article', 'panel nation-article');
  root.append(el('p', 'article-source', 'From the Galactic Encyclopedia'), el('h2', 'article-title', name));

  // The infobox floats beside the opening paragraphs, like an encyclopedia's.
  const infobox = el('aside', 'article-infobox');
  infobox.append(el('p', 'infobox-title', short));
  const facts = el('dl', 'infobox-facts');
  const fact = (label: string, value: string) => facts.append(el('dt', '', label), el('dd', '', value));
  fact('Capital', `${capitalName} (${home.name} system)`);
  fact('Location', `${map.sector.name} Sector, ${region.name} Region`);
  fact('Government', governmentName);
  fact('Population', formatPopulation(stats.population));
  fact('Territory', `${territory} star system${territory === 1 ? '' : 's'}`);
  fact('Colonized worlds', String(worlds.length));
  fact('Standing', `${titles.power.name} power`);
  fact('Founded', founded);
  infobox.append(facts);
  root.append(infobox);

  // The opening: what and where it is, then how it's governed, then how it stands.
  const governmentWord = governmentName.toLowerCase();
  const cohesionNote = titles.cohesion.description;
  root.append(
    el('p', 'article-lead', `The ${short} is ${article(governmentWord)} ${governmentWord} in the ${map.sector.name} Sector of the ${region.name} Region. `
      + `It governs ${territory} star system${territory === 1 ? '' : 's'} and ${formatPopulation(stats.population)} people from its capital, ${capitalName}, `
      + `in the ${home.name} system.`),
    el('p', '', government ? government.description : ''),
    el('p', '', `Reckoned ${article(titles.power.name)} ${titles.power.name.toLowerCase()} power among its neighbors, the ${short} has ${article(grade(stats.economy))} ${grade(stats.economy)} economy, `
      + `${grade(stats.technology)} technology and ${article(titles.military.name)} ${titles.military.name.toLowerCase()} military. `
      + `Its people enjoy ${grade(stats.liberties)} liberties, and the nation's cohesion is ${titles.cohesion.name.toLowerCase()}`
      + (cohesionNote ? `: ${cohesionNote.charAt(0).toLowerCase()}${cohesionNote.slice(1)}` : '.')),
  );
  if (neighbors.length > 0) {
    root.append(el('p', '', `It shares the ${map.sector.name} Sector with ${listOf(neighbors)}.`));
  }

  // History: the founding, then the latest notable events from the log.
  root.append(el('h3', 'article-heading', 'History'));
  root.append(el('p', '', `The ${short} was founded on ${founded}.`));
  const events = nation.log.slice(0, RECENT_EVENTS);
  if (events.length > 0) {
    root.append(el('p', '', 'Recent events:'));
    const list = el('ul', 'article-list');
    for (const entry of events) {
      const when = new Date(entry.at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      const item = el('li');
      item.append(el('span', 'muted', `${when}: `), entry.title);
      list.append(item);
    }
    root.append(list);
  }

  // The capital system: its stars, then every planet, the capital marked.
  root.append(el('h3', 'article-heading', 'Capital system'));
  const starText = home.stars.length === 1
    ? `a single ${home.stars[0].name} star`
    : `${home.stars.length} stars (${describeStars(home.stars)})`;
  root.append(el('p', '', `${home.name} lies in the ${map.constellations[home.constellation].name} constellation. It has ${starText} `
    + `and ${homePlanets.length} planet${homePlanets.length === 1 ? '' : 's'}, of which ${capitalName}, ${article(homePlanets[capital]?.type.name ?? 'world')} `
    + `${(homePlanets[capital]?.type.name ?? 'world').toLowerCase()} world, is the seat of government.`
    + (homePlanets[capital] ? ` ${homePlanets[capital].type.description}` : '')));
  const planetList = el('ul', 'article-list');
  homePlanets.forEach((planet, k) => {
    const item = el('li');
    const dot = el('span', 'body-swatch');
    dot.style.background = planet.type.colour;
    const moons = planet.moons.length;
    item.append(dot, el(k === capital ? 'strong' : 'span', '', homeNames[k]), el('span', 'muted', ` · ${planet.type.name}${moons > 0 ? ` · ${moons} moon${moons === 1 ? '' : 's'}` : ''}${k === capital ? ' · capital' : ''}`));
    planetList.append(item);
  });
  root.append(planetList);

  // Colonized worlds across the nation's territory.
  root.append(el('h3', 'article-heading', 'Colonized worlds'));
  root.append(el('p', '', worlds.length === 1
    ? `The ${short} has settled only its capital so far.`
    : `The ${short} has settled ${worlds.length} worlds across its ${territory} systems.`));
  const table = el('table', 'article-table');
  const head = el('tr');
  for (const label of ['World', 'Type', 'System', 'Moons']) head.append(el('th', '', label));
  table.append(head);
  for (const world of worlds) {
    const row = el('tr');
    row.append(
      el('td', world.capital ? 'article-capital' : '', world.capital ? `${world.name} (capital)` : world.name),
      el('td', '', world.type),
      el('td', '', world.system),
      el('td', '', String(world.moons)),
    );
    table.append(row);
  }
  root.append(table);
  return root;
}
