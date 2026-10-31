import {
  BASE_INCIDENT_INTERVAL_HOURS, HOUR, INCIDENT_QUEUE_CAP, MIN_INCIDENT_INTERVAL_HOURS, REFERENCE_POPULATION,
} from '../config';
import type { GameContent, Incident, Nation } from '../types';
import { conditionMet } from './conditions';
import { applyOutcome } from './effects';
import { addLog } from './log';
import { weightedPick, type Random } from './random';

/**
 * Larger nations have more going on, so incidents arrive more often. The
 * fourth root keeps growth gentle: 16× the population means half the
 * interval. The design doc caps the rate at one incident every 2 hours.
 */
export function incidentIntervalMs(population: number): number {
  const hours = BASE_INCIDENT_INTERVAL_HOURS * Math.pow(REFERENCE_POPULATION / population, 0.25);
  return Math.max(MIN_INCIDENT_INTERVAL_HOURS, hours) * HOUR;
}

function isEligible(incident: Incident, nation: Nation): boolean {
  if (!incident.repeatable && nation.incidents.seen.includes(incident.id)) return false;
  // Even a repeatable incident shouldn't sit in the queue twice.
  if (nation.incidents.queue.some((p) => p.incidentId === incident.id)) return false;
  return conditionMet(incident.condition, nation);
}

/**
 * Called by the simulation when an incident is due. Adds one to the queue if
 * there's room and something is eligible, then schedules the next arrival.
 * Changes `nation` in place.
 */
export function deliverIncident(nation: Nation, content: GameContent, at: number, random: Random): void {
  if (nation.incidents.queue.length < INCIDENT_QUEUE_CAP) {
    const eligible = content.incidents.filter((incident) => isEligible(incident, nation));
    const incident = weightedPick(eligible, (i) => i.weight ?? 1, random);
    if (incident) {
      nation.incidents.queue.push({ incidentId: incident.id, arrivedAt: at });
      if (!nation.incidents.seen.includes(incident.id)) nation.incidents.seen.push(incident.id);
    }
  }
  nation.incidents.nextArrivalAt = at + incidentIntervalMs(nation.stats.population);
}

/** The player picked a choice (by index) or dismissed the incident. */
export function resolveIncident(
  previous: Nation, content: GameContent, incidentId: string, choice: number | 'dismiss', now: number,
): Nation {
  const incident = content.incidents.find((i) => i.id === incidentId);
  const isPending = previous.incidents.queue.some((p) => p.incidentId === incidentId);
  if (!incident || !isPending) return previous;

  const outcome = choice === 'dismiss' ? incident.dismiss : incident.choices[choice];
  if (!outcome) return previous;

  const nation = structuredClone(previous);
  applyOutcome(nation, outcome);
  nation.incidents.queue = nation.incidents.queue.filter((p) => p.incidentId !== incidentId);
  addLog(nation, {
    at: now,
    kind: 'incident',
    title: incident.title,
    choice: choice === 'dismiss' ? 'Dismissed. No action taken.' : incident.choices[choice].text,
    result: outcome.result,
    effects: outcome.effects,
  });
  return nation;
}
