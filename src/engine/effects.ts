import { STAT_KEYS, type Effects, type Nation, type Outcome, type StatKey } from '../types';

// These helpers change the nation they are given. The engine's public
// functions always pass them a fresh copy, so nothing outside the engine ever
// sees a half-updated nation.

// All limits live here, so no content file can push a stat out of range.
const STAT_LIMITS: Record<StatKey, [min: number, max: number]> = {
  population: [1, Infinity], // A nation of zero would divide by zero in the incident rate.
  economy: [0, 100],
  technology: [0, 100],
  military: [0, 100],
  liberties: [0, 100],
  cohesion: [0, 100],
};

export function changeStat(nation: Nation, key: StatKey, delta: number): void {
  const [min, max] = STAT_LIMITS[key];
  nation.stats[key] = Math.min(max, Math.max(min, nation.stats[key] + delta));
}

/** `scale` lets daily effects be applied for a fraction of a day. */
export function applyEffects(nation: Nation, effects: Effects, scale = 1): void {
  for (const key of STAT_KEYS) {
    const delta = effects[key];
    if (delta) changeStat(nation, key, delta * scale);
  }
}

export function setFlags(nation: Nation, flags: string[] = []): void {
  for (const flag of flags) {
    if (!nation.flags.includes(flag)) nation.flags.push(flag);
  }
}

export function applyOutcome(nation: Nation, outcome: Outcome): void {
  if (outcome.effects) applyEffects(nation, outcome.effects);
  // Clear first, then set, so an outcome can replace one flag with another.
  const cleared = new Set(outcome.clearFlags ?? []);
  nation.flags = nation.flags.filter((flag) => !cleared.has(flag));
  setFlags(nation, outcome.setFlags);
}
