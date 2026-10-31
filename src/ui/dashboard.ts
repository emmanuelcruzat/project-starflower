import { HOUR, INCIDENT_QUEUE_CAP, MAX_ACTIVE_OPERATIONS } from '../config';
import { activeAmbition, availableAmbitions } from '../engine/ambitions';
import { availableOperations, describeActive, isAwaitingDecision } from '../engine/operations';
import type { GameContent, Nation } from '../types';
import { button, countdown, el, formatAgo, progressBar } from './dom';

// A read-only, at-a-glance summary of everything in motion. The Planner tab
// is where decisions are made; this is where a returning player looks first
// to see what happened while they were away.

/** How many things are waiting on the player: pending incidents plus operation stages ready for orders. */
export function attentionCount(nation: Nation, now: number): number {
  return nation.incidents.queue.length + nation.operations.filter((op) => isAwaitingDecision(op, now)).length;
}

/** `article` (the nation's encyclopedia article) goes between the attention banner and the summaries. */
export function dashboardView(nation: Nation, content: GameContent, now: number, onOpenPlanner: () => void, article: HTMLElement): HTMLElement {
  const root = el('section', 'dashboard');

  const waiting = attentionCount(nation, now);
  const banner = el('div', `panel attention ${waiting > 0 ? 'urgent' : ''}`);
  banner.append(
    el('span', '', waiting > 0 ? `${waiting} ${waiting === 1 ? 'matter needs' : 'matters need'} your attention` : 'Nothing needs your attention right now'),
  );
  if (waiting > 0) banner.append(button('Open Management', 'secondary small', onOpenPlanner));

  root.append(
    banner,
    article,
    incidentSummary(nation, content, now),
    operationsSummary(nation, content, now),
    ambitionSummary(nation, content, now),
  );
  return root;
}

function summaryPanel(title: string): HTMLElement {
  const panel = el('div', 'panel summary-panel');
  panel.append(el('h2', 'section-title', title));
  return panel;
}

function incidentSummary(nation: Nation, content: GameContent, now: number): HTMLElement {
  const queue = nation.incidents.queue;
  const panel = summaryPanel(`Incidents (${queue.length}/${INCIDENT_QUEUE_CAP})`);

  if (queue.length === 0) panel.append(el('p', 'muted', 'All quiet.'));
  const list = el('ul', 'summary-list');
  for (const pending of queue) {
    const title = content.incidents.find((i) => i.id === pending.incidentId)?.title;
    if (!title) continue;
    const item = el('li');
    item.append(el('span', 'summary-name', title), el('span', 'muted small-text', formatAgo(now - pending.arrivedAt)));
    list.append(item);
  }
  if (list.childElementCount > 0) panel.append(list);

  const next = el('p', 'muted small-text');
  if (queue.length >= INCIDENT_QUEUE_CAP) next.textContent = 'Queue full: new reports are being missed.';
  else next.append('Next report in ', countdown(nation.incidents.nextArrivalAt, now, 'moments'));
  panel.append(next);
  return panel;
}

function operationsSummary(nation: Nation, content: GameContent, now: number): HTMLElement {
  const panel = summaryPanel(`Operations (${nation.operations.length}/${MAX_ACTIVE_OPERATIONS})`);

  if (nation.operations.length === 0) {
    const available = availableOperations(nation, content).length;
    panel.append(el('p', 'muted', available > 0 ? `None running. ${available} available to launch.` : 'None running.'));
  }

  const list = el('ul', 'summary-list');
  for (const active of nation.operations) {
    const found = describeActive(active, content);
    if (!found) continue;
    const { operation, stage } = found;
    const stageNumber = operation.stages.indexOf(stage) + 1;

    const item = el('li');
    item.append(
      el('span', 'summary-name', operation.title),
      el('span', 'muted small-text', `Stage ${stageNumber}: ${stage.title}`),
    );
    if (isAwaitingDecision(active, now)) {
      item.append(el('span', 'awaiting-tag', 'Awaiting your decision'));
    } else {
      const timer = el('span', 'muted small-text');
      timer.append(countdown(active.stageEndsAt, now, 'awaiting orders'), ' remaining');
      item.append(progressBar(active.stageEndsAt - stage.durationHours * HOUR, active.stageEndsAt, now), timer);
    }
    list.append(item);
  }
  if (list.childElementCount > 0) panel.append(list);
  return panel;
}

function ambitionSummary(nation: Nation, content: GameContent, now: number): HTMLElement {
  const panel = summaryPanel('Ambition');
  const ambition = activeAmbition(nation, content);

  if (!ambition || !nation.ambition) {
    const available = availableAmbitions(nation, content).length;
    panel.append(el('p', 'muted', available > 0 ? `No ambition set. ${available} to choose from.` : 'No ambition set.'));
    return panel;
  }

  const timer = el('span', 'muted small-text');
  timer.append('Completes in ', countdown(nation.ambition.endsAt, now, 'any moment'));
  panel.append(
    el('span', 'summary-name', ambition.title),
    progressBar(nation.ambition.startedAt, nation.ambition.endsAt, now),
    timer,
  );
  return panel;
}
