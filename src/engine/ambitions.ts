import { HOUR } from '../config';
import type { ActiveAmbition, Ambition, GameContent, Nation } from '../types';
import { conditionMet } from './conditions';
import { applyEffects, setFlags } from './effects';
import { addLog } from './log';

export function availableAmbitions(nation: Nation, content: GameContent): Ambition[] {
  return content.ambitions.filter(
    (ambition) => !nation.completedAmbitions.includes(ambition.id) && conditionMet(ambition.condition, nation),
  );
}

export function activeAmbition(nation: Nation, content: GameContent): Ambition | null {
  if (!nation.ambition) return null;
  return content.ambitions.find((a) => a.id === nation.ambition!.ambitionId) ?? null;
}

/** 0 to 1. */
export function ambitionProgress(active: ActiveAmbition, now: number): number {
  return Math.min(1, Math.max(0, (now - active.startedAt) / (active.endsAt - active.startedAt)));
}

export function startAmbition(previous: Nation, content: GameContent, ambitionId: string, now: number): Nation {
  const ambition = availableAmbitions(previous, content).find((a) => a.id === ambitionId);
  // Only one ambition at a time: a nation can't chase every dream at once.
  if (!ambition || previous.ambition) return previous;

  const nation = structuredClone(previous);
  if (ambition.startEffects) applyEffects(nation, ambition.startEffects);
  nation.ambition = { ambitionId, startedAt: now, endsAt: now + ambition.durationHours * HOUR };
  addLog(nation, { at: now, kind: 'ambition', title: `Ambition declared: ${ambition.title}`, effects: ambition.startEffects });
  return nation;
}

/** Progress is lost, and so are any start costs. That's the price of changing course. */
export function abandonAmbition(previous: Nation, content: GameContent, now: number): Nation {
  if (!previous.ambition) return previous;
  const nation = structuredClone(previous);
  const title = activeAmbition(nation, content)?.title ?? nation.ambition!.ambitionId;
  nation.ambition = null;
  addLog(nation, { at: now, kind: 'ambition', title: `Ambition abandoned: ${title}` });
  return nation;
}

/** Called by the simulation when the active ambition's end time arrives. Changes `nation` in place. */
export function completeAmbition(nation: Nation, content: GameContent): void {
  const active = nation.ambition;
  if (!active) return;
  const ambition = activeAmbition(nation, content);
  nation.ambition = null;
  if (!ambition) return; // Removed from the data files since it started; just drop it.

  if (ambition.completionEffects) applyEffects(nation, ambition.completionEffects);
  setFlags(nation, ambition.setFlags);
  if (!nation.completedAmbitions.includes(ambition.id)) nation.completedAmbitions.push(ambition.id);
  addLog(nation, {
    at: active.endsAt,
    kind: 'ambition',
    title: `Ambition achieved: ${ambition.title}`,
    result: ambition.completionText,
    effects: ambition.completionEffects,
  });
}
