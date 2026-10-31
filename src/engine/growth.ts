import {
  DAILY_DRIFT_RATE, DAY, MAX_DAILY_GROWTH, NEUTRAL_COHESION, NEUTRAL_ECONOMY, RECOVERING_STATS, SETTLING_STATS,
} from '../config';
import type { GameContent, Nation, StatKey } from '../types';
import { activeAmbition } from './ambitions';
import { applyEffects, changeStat } from './effects';

/**
 * Applies the slow, continuous changes that happen between events, for any
 * length of time. Changes `nation` in place.
 */
export function applyGrowth(nation: Nation, content: GameContent, elapsedMs: number): void {
  const days = elapsedMs / DAY;
  if (days <= 0) return;

  // A united, prosperous nation attracts settlers and raises families; a
  // fractured, poor one loses people. The rate is measured from the neutral
  // levels in config.ts, and compounds like interest.
  const { cohesion, economy } = nation.stats;
  const dailyRate = ((cohesion - NEUTRAL_COHESION + (economy - NEUTRAL_ECONOMY)) / 100) * MAX_DAILY_GROWTH;
  const population = nation.stats.population;
  changeStat(nation, 'population', population * (Math.pow(1 + dailyRate, days) - 1));

  driftTowardNaturalLevels(nation, content, days);

  // An ambition's ongoing effects, scaled to the time that passed.
  const ambition = activeAmbition(nation, content);
  if (ambition?.dailyEffects) applyEffects(nation, ambition.dailyEffects, days);
}

/** Each government's starting stats are its natural levels. See config.ts for why this exists. */
function driftTowardNaturalLevels(nation: Nation, content: GameContent, days: number): void {
  const government = content.governments.find((g) => g.id === nation.governmentId);
  if (!government) return;

  // Closing a fixed fraction of the gap per day, compounded, gives the same
  // result whether this runs once for a whole day or 86,400 times for a second each.
  const closed = 1 - Math.pow(1 - DAILY_DRIFT_RATE, days);
  const drift = (key: StatKey) => (government.startingStats[key] - nation.stats[key]) * closed;

  for (const key of RECOVERING_STATS) {
    const delta = drift(key);
    if (delta > 0) changeStat(nation, key, delta);
  }
  for (const key of SETTLING_STATS) changeStat(nation, key, drift(key));
}
