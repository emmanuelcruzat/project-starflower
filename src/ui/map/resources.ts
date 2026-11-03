import { seededRandom, type Random } from '../../engine/random';
import type { Nation } from '../../types';
import type { Belt, GalaxyMap, Planet } from './generate';
import { BELT_TYPE, generateMap, systemBelt, systemPlanets } from './generate';

// What a system's planets, moons and asteroid belt hold, for system
// development to build on. Stars hold nothing. Like the planets, deposits are
// generated from the nation's id when asked for and never saved.

export const RESOURCE_KEYS = ['metals', 'rare', 'water', 'gas', 'biomass', 'radioactives'] as const;
export type ResourceKey = (typeof RESOURCE_KEYS)[number];

export interface Resource {
  name: string;
  /** Lowercase, for the middle of a sentence: "rich metals". */
  noun: string;
  colour: string;
  description: string;
}

export const RESOURCES: Record<ResourceKey, Resource> = {
  metals: {
    name: 'Metals', noun: 'metals', colour: '#a8a29a',
    description: 'Iron, nickel, aluminum and the other common metals: the bulk of anything built.',
  },
  rare: {
    name: 'Rare elements', noun: 'rare elements', colour: '#c9a3e6',
    description: 'Platinum-group metals and rare earths, scarce and precious: what advanced technology runs on.',
  },
  water: {
    name: 'Water', noun: 'water', colour: '#7cc4e8',
    description: 'Ice and liquid water, for drinking, growing food and splitting into air and rocket fuel.',
  },
  gas: {
    name: 'Gas', noun: 'gas', colour: '#e6c27a',
    description: 'Hydrogen, helium-3 and other light gases, skimmed or mined to fuel reactors and ships.',
  },
  biomass: {
    name: 'Biomass', noun: 'biomass', colour: '#6fbf73',
    description: 'Living things and what they leave behind, a source of food, medicine and materials.',
  },
  radioactives: {
    name: 'Radioactives', noun: 'radioactives', colour: '#c6e05a',
    description: 'Uranium, thorium and other heavy elements that power fission reactors, and weapons.',
  },
};

/**
 * How much of a resource a body holds, from 1 to 4. A body with none of a
 * resource leaves it out.
 */
export type Richness = 1 | 2 | 3 | 4;
export const RICHNESS_NAMES: Record<Richness, string> = { 1: 'Poor', 2: 'Moderate', 3: 'Rich', 4: 'Abundant' };

/** What a body holds. Only the resources it has are listed. */
export type Deposits = Partial<Record<ResourceKey, Richness>>;

/**
 * What a kind of body tends to hold: for each resource, its typical
 * richness on the same 0–4 scale. Each body lands within RICHNESS_SPREAD of
 * it, so worlds of one kind differ. A resource left out never turns up.
 */
export type ResourceProfile = Partial<Record<ResourceKey, number>>;

/** How far a body's richness can stray either way from its kind's typical value. */
const RICHNESS_SPREAD = 1.2;

function rollDeposits(profile: ResourceProfile, random: Random): Deposits {
  const deposits: Deposits = {};
  // Every resource rolls, listed or not, so changing one kind's profile never shifts any other body's deposits.
  for (const key of RESOURCE_KEYS) {
    const roll = (random() * 2 - 1) * RICHNESS_SPREAD;
    const typical = profile[key];
    if (typical === undefined) continue;
    const richness = Math.round(Math.min(4, Math.max(0, typical + roll)));
    if (richness > 0) deposits[key] = richness as Richness;
  }
  return deposits;
}

export interface SystemDeposits {
  /** By planet index. */
  planets: Deposits[];
  /** By planet index, then moon index. */
  moons: Deposits[][];
  belt: Deposits | null;
}

/**
 * Every deposit in a system. It has its own random stream, so adding
 * resources changed no planets, moons or belts.
 */
export function systemDeposits(nation: Nation, system: number, planets: Planet[], belt: Belt | null): SystemDeposits {
  const random = seededRandom(`${nation.id}/resources/${system}`);
  const planetDeposits: Deposits[] = [];
  const moonDeposits: Deposits[][] = [];
  for (const planet of planets) {
    planetDeposits.push(rollDeposits(planet.type.resources, random));
    moonDeposits.push(planet.moons.map((moon) => rollDeposits(moon.resources, random)));
  }
  // Rolled whether or not there's a belt, so a belt never shifts anything after it.
  const beltDeposits = rollDeposits(BELT_TYPE.resources, random);
  return { planets: planetDeposits, moons: moonDeposits, belt: belt ? beltDeposits : null };
}

/** Every resource found anywhere in a system, at its richest. */
export function systemTotals(all: SystemDeposits): Deposits {
  const totals: Deposits = {};
  for (const deposits of [...all.planets, ...all.moons.flat(), ...(all.belt ? [all.belt] : [])]) {
    for (const key of RESOURCE_KEYS) {
      const richness = deposits[key];
      if (richness && richness > (totals[key] ?? 0)) totals[key] = richness;
    }
  }
  return totals;
}

/**
 * The last map made for the status bar, which redraws often. A map only
 * changes when the nation claims a system, so that's part of the key.
 */
let cached: { key: string; map: GalaxyMap } | null = null;

/**
 * What the nation's systems hold, for the status bar: for each resource,
 * how many bodies have it and their richness added up (two rich deposits
 * and a poor one make 7). PLACEHOLDER until system development turns
 * deposits into stockpiles and income.
 */
export function nationResources(nation: Nation): Record<ResourceKey, { deposits: number; richness: number }> {
  const key = `${nation.id}/${(nation.claimedSystems ?? []).join(',')}`;
  if (cached?.key !== key) cached = { key, map: generateMap(nation) };
  const { map } = cached;
  const totals = Object.fromEntries(RESOURCE_KEYS.map((key) => [key, { deposits: 0, richness: 0 }])) as Record<ResourceKey, { deposits: number; richness: number }>;
  map.owners.forEach((owner, system) => {
    if (owner !== 0) return;
    const planets = systemPlanets(nation, system, map.systems[system].stars.length);
    const belt = systemBelt(nation, system, planets);
    const all = systemDeposits(nation, system, planets, belt);
    for (const deposits of [...all.planets, ...all.moons.flat(), ...(all.belt ? [all.belt] : [])]) {
      for (const key of RESOURCE_KEYS) {
        if (!deposits[key]) continue;
        totals[key].deposits++;
        totals[key].richness += deposits[key]!;
      }
    }
  });
  return totals;
}
