import type { GameContent, Nation } from '../types';
import { deliverIncident } from './incidents';
import { addLog } from './log';
import type { Random } from './random';
import { availablePrefixes } from './titles';

export interface NationSetup {
  name: string;
  governmentId: string;
  prefix: string;
}

export function createNation(setup: NationSetup, content: GameContent, now: number, random: Random = Math.random): Nation {
  const government = content.governments.find((g) => g.id === setup.governmentId);
  if (!government) throw new Error(`Unknown government "${setup.governmentId}"`);

  const nation: Nation = {
    // Not a security token; just unique enough to tell nations apart once
    // there is more than one.
    id: `nation-${now.toString(36)}-${Math.floor(random() * 1e9).toString(36)}`,
    name: setup.name.trim(),
    governmentId: government.id,
    prefix: setup.prefix,
    foundedAt: now,
    lastUpdatedAt: now,
    stats: { ...government.startingStats },
    flags: [],
    incidents: { queue: [], nextArrivalAt: now, seen: [] },
    operations: [],
    completedOperations: [],
    ambition: null,
    completedAmbitions: [],
    log: [],
  };

  // Reject a prefix this government can't use, in case the UI ever lets one through.
  if (!availablePrefixes(nation, content).some((p) => p.name === setup.prefix)) {
    throw new Error(`Prefix "${setup.prefix}" is not available to a ${government.name}`);
  }

  addLog(nation, { at: now, kind: 'nation', title: `${government.name} founded`, result: `The nation of ${nation.name} begins.` });
  // Hand a new player their first incident straight away, rather than an empty planner.
  deliverIncident(nation, content, now, random);
  return nation;
}

/** Prefixes depend on stats, so a nation can change its prefix as it changes. */
/**
 * Claims a star system for the nation. PLACEHOLDER: the map is generated in
 * the UI, so the caller checks the system is unclaimed and passes its name
 * for the log.
 */
export function claimSystem(previous: Nation, system: number, name: string, now: number): Nation {
  if (previous.claimedSystems?.includes(system)) return previous;
  const nation = structuredClone(previous);
  nation.claimedSystems = [...(nation.claimedSystems ?? []), system];
  addLog(nation, { at: now, kind: 'nation', title: `Claimed the ${name} system` });
  return nation;
}

export function changePrefix(previous: Nation, content: GameContent, prefix: string, now: number): Nation {
  if (prefix === previous.prefix || !availablePrefixes(previous, content).some((p) => p.name === prefix)) return previous;
  const nation = structuredClone(previous);
  nation.prefix = prefix;
  addLog(nation, { at: now, kind: 'nation', title: `The nation is now styled the ${prefix} of ${nation.name}` });
  return nation;
}
