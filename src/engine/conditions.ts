import { HOUR } from '../config';
import { STAT_KEYS, type Condition, type Nation } from '../types';

/**
 * The parts of a nation a condition can look at. Using a narrower type lets
 * the creation screen test prefix conditions before the nation exists.
 */
export type ConditionSubject = Pick<Nation, 'governmentId' | 'stats' | 'flags' | 'foundedAt' | 'lastUpdatedAt'>;

export function conditionMet(condition: Condition | undefined, subject: ConditionSubject): boolean {
  if (!condition) return true;
  const c = condition;

  if (c.governments && !c.governments.includes(subject.governmentId)) return false;

  if (c.minAgeHours !== undefined) {
    const ageHours = (subject.lastUpdatedAt - subject.foundedAt) / HOUR;
    if (ageHours < c.minAgeHours) return false;
  }

  if (c.requiresFlags?.some((flag) => !subject.flags.includes(flag))) return false;
  if (c.forbidsFlags?.some((flag) => subject.flags.includes(flag))) return false;

  for (const key of STAT_KEYS) {
    const min = c.minStats?.[key];
    const max = c.maxStats?.[key];
    if (min !== undefined && subject.stats[key] < min) return false;
    if (max !== undefined && subject.stats[key] > max) return false;
  }
  return true;
}
