import { HOUR, INCIDENT_QUEUE_CAP, MAX_ACTIVE_OPERATIONS } from '../config';
import { activeAmbition, availableAmbitions } from '../engine/ambitions';
import { availableOperations, describeActive, hasFreeOperationSlot, isAwaitingDecision } from '../engine/operations';
import type { ActiveOperation, GameContent, LogEntry, Nation, PendingIncident } from '../types';
import {
  button, countdown, effectChips, el, formatAgo, formatHours, paragraphs, progressBar,
} from './dom';

export interface PlannerHandlers {
  onIncidentChoice: (incidentId: string, choice: number | 'dismiss') => void;
  onStartOperation: (operationId: string) => void;
  onOperationChoice: (operationId: string, choiceIndex: number) => void;
  onAbandonOperation: (operationId: string) => void;
  onStartAmbition: (ambitionId: string) => void;
  onAbandonAmbition: () => void;
  onCloseOutcome: () => void;
}

/**
 * The Planner: the screen the design doc says players spend most of their
 * time on. Three sections, one for each layer of nation management.
 * `outcome` is the result of the player's most recent decision, if it should
 * still be shown.
 */
export function plannerView(
  nation: Nation, content: GameContent, now: number, outcome: LogEntry | null, handlers: PlannerHandlers,
): HTMLElement {
  const root = el('section', 'planner');
  if (outcome) root.append(outcomeBox(outcome, handlers.onCloseOutcome));
  root.append(
    incidentsSection(nation, content, now, handlers),
    operationsSection(nation, content, now, handlers),
    ambitionSection(nation, content, now, handlers),
  );
  return root;
}

function outcomeBox(entry: LogEntry, onClose: () => void): HTMLElement {
  const box = el('div', 'panel outcome');
  box.append(el('p', 'eyebrow', 'Outcome'), el('h3', 'card-title', entry.title));
  if (entry.choice) box.append(el('p', 'chosen', entry.choice));
  if (entry.result) box.append(...paragraphs(entry.result));
  if (entry.effects) box.append(effectChips(entry.effects));
  box.append(button('Close', 'secondary small', onClose));
  return box;
}

function sectionHeader(title: string, detail: string | HTMLElement): HTMLElement {
  const header = el('div', 'section-header');
  const detailNode = typeof detail === 'string' ? el('span', 'muted', detail) : detail;
  header.append(el('h2', 'section-title', title), detailNode);
  return header;
}

// --- Incidents ---

function incidentsSection(nation: Nation, content: GameContent, now: number, handlers: PlannerHandlers): HTMLElement {
  const section = el('section', 'panel');
  const next = el('span', 'muted');
  if (nation.incidents.queue.length >= INCIDENT_QUEUE_CAP) {
    next.textContent = 'Queue full: new reports are being missed';
  } else {
    next.append('Next report in ', countdown(nation.incidents.nextArrivalAt, now, 'moments'));
  }
  section.append(sectionHeader(`Incidents (${nation.incidents.queue.length}/${INCIDENT_QUEUE_CAP})`, next));

  if (nation.incidents.queue.length === 0) {
    section.append(el('p', 'muted', 'All quiet. Nothing requires your attention.'));
  }
  nation.incidents.queue.forEach((pending, index) => {
    const card = incidentCard(pending, content, now, handlers, index === 0);
    if (card) section.append(card);
  });
  return section;
}

function incidentCard(
  pending: PendingIncident, content: GameContent, now: number, handlers: PlannerHandlers, open: boolean,
): HTMLElement | null {
  const incident = content.incidents.find((i) => i.id === pending.incidentId);
  if (!incident) return null; // Removed from incidents.json since it arrived.

  // <details> gives collapsing for free and keeps a full queue scannable;
  // only the oldest incident starts open.
  const card = el('details', 'card');
  card.open = open;
  const summary = el('summary');
  summary.append(el('span', 'card-title', incident.title), el('span', 'muted small-text', formatAgo(now - pending.arrivedAt)));
  card.append(summary, ...paragraphs(incident.description));

  const choices = el('div', 'choices');
  incident.choices.forEach((choice, index) => {
    const b = el('button', 'choice');
    b.append(el('span', 'choice-number', `${index + 1}`), el('span', '', choice.text));
    b.addEventListener('click', () => handlers.onIncidentChoice(incident.id, index));
    choices.append(b);
  });
  const dismiss = el('button', 'choice dismiss');
  dismiss.append(el('span', 'choice-number', '×'), el('span', '', 'Dismiss. Take no action.'));
  dismiss.addEventListener('click', () => handlers.onIncidentChoice(incident.id, 'dismiss'));
  choices.append(dismiss);

  card.append(choices);
  return card;
}

// --- Operations ---

function operationsSection(nation: Nation, content: GameContent, now: number, handlers: PlannerHandlers): HTMLElement {
  const section = el('section', 'panel');
  section.append(sectionHeader(`Operations (${nation.operations.length}/${MAX_ACTIVE_OPERATIONS})`, 'Multi-stage efforts you direct'));

  for (const active of nation.operations) {
    const card = activeOperationCard(active, content, now, handlers);
    if (card) section.append(card);
  }

  const available = availableOperations(nation, content);
  if (available.length > 0) {
    section.append(el('h3', 'subsection-title', 'Available'));
    const slotFree = hasFreeOperationSlot(nation);
    for (const op of available) {
      const card = el('div', 'card available');
      const totalHours = op.stages.reduce((sum, s) => sum + s.durationHours, 0);
      card.append(
        el('span', 'card-title', op.title),
        el('p', 'body-text', op.summary),
        el('p', 'muted small-text', `${op.stages.length} stages · about ${formatHours(totalHours)} in total`),
      );
      if (op.startEffects) card.append(el('p', 'muted small-text', 'Launch cost:'), effectChips(op.startEffects));
      card.append(button(slotFree ? 'Launch' : 'All slots in use', 'secondary', () => handlers.onStartOperation(op.id), !slotFree));
      section.append(card);
    }
  } else if (nation.operations.length === 0) {
    section.append(el('p', 'muted', 'No operations are possible right now. Events and growth will open new opportunities.'));
  }
  return section;
}

function activeOperationCard(
  active: ActiveOperation, content: GameContent, now: number, handlers: PlannerHandlers,
): HTMLElement | null {
  const found = describeActive(active, content);
  if (!found) return null;
  const { operation, stage } = found;
  const stageNumber = operation.stages.indexOf(stage) + 1;

  const card = el('div', 'card active');
  card.append(
    el('p', 'eyebrow', `${operation.title} · Stage ${stageNumber}`),
    el('span', 'card-title', stage.title),
  );

  if (isAwaitingDecision(active, now)) {
    card.classList.add('awaiting');
    card.append(...paragraphs(stage.description));
    const choices = el('div', 'choices');
    stage.choices.forEach((choice, index) => {
      const b = el('button', 'choice');
      b.append(el('span', 'choice-number', `${index + 1}`), el('span', '', choice.text));
      b.addEventListener('click', () => handlers.onOperationChoice(operation.id, index));
      choices.append(b);
    });
    card.append(choices);
  } else {
    // The stage description is held back until the stage finishes, so the
    // decision arrives as news rather than a spoiler.
    const startedAt = active.stageEndsAt - stage.durationHours * HOUR;
    const timer = el('p', 'muted small-text');
    timer.append('In progress · ', countdown(active.stageEndsAt, now, 'awaiting orders'));
    card.append(progressBar(startedAt, active.stageEndsAt, now), timer);
  }

  card.append(button('Abandon', 'link-button', () => handlers.onAbandonOperation(operation.id)));
  return card;
}

// --- Ambition ---

function ambitionSection(nation: Nation, content: GameContent, now: number, handlers: PlannerHandlers): HTMLElement {
  const section = el('section', 'panel');
  section.append(sectionHeader('Ambition', 'One long-term national goal at a time'));

  const current = activeAmbition(nation, content);
  if (current && nation.ambition) {
    const card = el('div', 'card active');
    const timer = el('p', 'muted small-text');
    timer.append('Completes in ', countdown(nation.ambition.endsAt, now, 'any moment'));
    card.append(
      el('span', 'card-title', current.title),
      ...paragraphs(current.description),
      progressBar(nation.ambition.startedAt, nation.ambition.endsAt, now),
      timer,
    );
    if (current.dailyEffects) card.append(el('p', 'muted small-text', 'While active:'), effectChips(current.dailyEffects, '/day'));
    if (current.completionEffects) card.append(el('p', 'muted small-text', 'On completion:'), effectChips(current.completionEffects));
    card.append(button('Abandon', 'link-button', handlers.onAbandonAmbition));
    section.append(card);
    return section;
  }

  const available = availableAmbitions(nation, content);
  if (available.length === 0) {
    section.append(el('p', 'muted', 'No ambitions are within reach yet. Grow stronger, and new goals will appear.'));
  }
  for (const ambition of available) {
    const card = el('div', 'card available');
    card.append(
      el('span', 'card-title', ambition.title),
      ...paragraphs(ambition.description),
      el('p', 'muted small-text', `Takes ${formatHours(ambition.durationHours)}`),
    );
    if (ambition.startEffects) card.append(el('p', 'muted small-text', 'Cost to begin:'), effectChips(ambition.startEffects));
    if (ambition.dailyEffects) card.append(el('p', 'muted small-text', 'While active:'), effectChips(ambition.dailyEffects, '/day'));
    if (ambition.completionEffects) card.append(el('p', 'muted small-text', 'On completion:'), effectChips(ambition.completionEffects));
    card.append(button('Pursue this Ambition', 'secondary', () => handlers.onStartAmbition(ambition.id)));
    section.append(card);
  }
  return section;
}
