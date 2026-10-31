import { STAT_KEYS, type GameContent, type Nation, type Prefix, type Stats, type TitleTier } from '../types';
import { conditionMet, type ConditionSubject } from './conditions';

/**
 * Population spans orders of magnitude (millions to hundreds of billions), so
 * it's put on a log scale to fit 0–100 beside the other stats:
 * 100 million → 40, 1 billion → 60, 100 billion → 100.
 */
export function populationScore(populationMillions: number): number {
  return Math.min(100, Math.max(0, 20 * Math.log10(populationMillions)));
}

/** Weighted average of the stats, 0–100. The weights come from titles.json so they can be tuned. */
export function powerScore(stats: Stats, content: GameContent): number {
  const weights = content.titles.powerWeights;
  let total = 0;
  let weightSum = 0;
  for (const key of STAT_KEYS) {
    const weight = weights[key] ?? 0;
    const value = key === 'population' ? populationScore(stats[key]) : stats[key];
    total += value * weight;
    weightSum += weight;
  }
  return weightSum > 0 ? total / weightSum : 0;
}

/** The highest tier whose minimum the value reaches. Tiers are validated to be in ascending order. */
export function tierFor(value: number, tiers: TitleTier[]): TitleTier {
  let found = tiers[0];
  for (const tier of tiers) {
    if (value >= tier.min) found = tier;
  }
  return found;
}

export interface NationTitles {
  power: TitleTier;
  cohesion: TitleTier;
  military: TitleTier;
}

export function nationTitles(nation: Nation, content: GameContent): NationTitles {
  return {
    power: tierFor(powerScore(nation.stats, content), content.titles.power),
    cohesion: tierFor(nation.stats.cohesion, content.titles.cohesion),
    military: tierFor(nation.stats.military, content.titles.military),
  };
}

export function fullName(nation: Pick<Nation, 'prefix' | 'name'>): string {
  return `The ${nation.prefix} of ${nation.name}`;
}

export function availablePrefixes(subject: ConditionSubject, content: GameContent): Prefix[] {
  return content.prefixes.filter((prefix) => conditionMet(prefix.condition, subject));
}
