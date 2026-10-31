import type { GameContent, Nation } from '../types';
import { completeAmbition } from './ambitions';
import { applyGrowth } from './growth';
import { deliverIncident } from './incidents';
import type { Random } from './random';

// A safety net against an infinite loop if a bug ever stops time advancing.
// A month away at the fastest incident rate is about 360 steps.
const MAX_STEPS = 10_000;

/**
 * Brings a nation up to date with the clock. This is the heart of real-time
 * play: it doesn't matter whether one second or one week has passed since
 * the last call, because the same code walks forward through every
 * scheduled happening in order.
 *
 * Between happenings, stats drift (growth.ts). At each happening, the due
 * thing occurs (an incident arrives, an ambition completes). Handling them in
 * time order matters: an ambition that completed on Tuesday should boost the
 * population growth that happened on Wednesday.
 *
 * Returns a new nation; `previous` is untouched. A future server would call
 * exactly this function before showing or changing a nation.
 */
export function advanceTo(previous: Nation, now: number, content: GameContent, random: Random = Math.random): Nation {
  if (now <= previous.lastUpdatedAt) return previous;

  const nation = structuredClone(previous);
  for (let step = 0; step < MAX_STEPS && nation.lastUpdatedAt < now; step++) {
    const stepEnd = Math.min(now, nextHappeningAt(nation));
    applyGrowth(nation, content, stepEnd - nation.lastUpdatedAt);
    nation.lastUpdatedAt = stepEnd;

    if (nation.ambition && nation.ambition.endsAt <= stepEnd) completeAmbition(nation, content);
    if (nation.incidents.nextArrivalAt <= stepEnd) deliverIncident(nation, content, stepEnd, random);
  }
  return nation;
}

function nextHappeningAt(nation: Nation): number {
  // Operation stages are missing on purpose: when one ends, nothing changes
  // until the player decides, so the loop doesn't need to stop for it.
  return Math.min(nation.incidents.nextArrivalAt, nation.ambition?.endsAt ?? Infinity);
}
