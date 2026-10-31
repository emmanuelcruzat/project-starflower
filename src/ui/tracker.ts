import { HOUR } from '../config';
import { activeAmbition } from '../engine/ambitions';
import { describeActive, isAwaitingDecision } from '../engine/operations';
import type { GameContent, Nation } from '../types';
import { countdown, el, formatAgo, progressBar } from './dom';

// The task tracker: a panel down the right of the map listing the management
// tasks in motion (incidents waiting, operations, the ambition) with their
// progress. Clicking a task opens the Management panel, where it's handled.
// The countdowns and bars are live (updateLiveTimers), and viewKey covers the
// tasks themselves, so the list redraws only when a task comes or goes.

export function trackerView(nation: Nation, content: GameContent, now: number, onOpenPlanner: () => void): HTMLElement {
  const panel = el('aside', 'task-tracker');
  panel.setAttribute('aria-label', 'Management tasks');
  panel.append(el('p', 'task-tracker-title', 'Management'));

  const list = el('ul', 'task-list');
  const task = (kind: string, name: string, urgent: boolean, ...detail: (HTMLElement | string)[]) => {
    const b = el('button', `task ${urgent ? 'urgent' : ''}`);
    b.title = 'Open Management';
    b.addEventListener('click', onOpenPlanner);
    b.append(el('span', 'task-kind', kind), el('span', 'task-name', name), ...detail);
    const item = el('li');
    item.append(b);
    list.append(item);
  };

  for (const pending of nation.incidents.queue) {
    const incident = content.incidents.find((i) => i.id === pending.incidentId);
    if (!incident) continue;
    task('Incident', incident.title, true, el('span', 'awaiting-tag', `Arrived ${formatAgo(now - pending.arrivedAt)}`));
  }

  for (const active of nation.operations) {
    const found = describeActive(active, content);
    if (!found) continue;
    const { operation, stage } = found;
    const stageText = `Stage ${operation.stages.indexOf(stage) + 1}: ${stage.title}`;
    if (isAwaitingDecision(active, now)) {
      task('Operation', operation.title, true, el('span', 'task-detail', stageText), el('span', 'awaiting-tag', 'Awaiting your decision'));
    } else {
      const timer = el('span', 'task-detail');
      timer.append(countdown(active.stageEndsAt, now, 'awaiting orders'), ' remaining');
      task(
        'Operation',
        operation.title,
        false,
        el('span', 'task-detail', stageText),
        progressBar(active.stageEndsAt - stage.durationHours * HOUR, active.stageEndsAt, now),
        timer,
      );
    }
  }

  const ambition = activeAmbition(nation, content);
  if (ambition && nation.ambition) {
    const timer = el('span', 'task-detail');
    timer.append('Completes in ', countdown(nation.ambition.endsAt, now, 'any moment'));
    task('Ambition', ambition.title, false, progressBar(nation.ambition.startedAt, nation.ambition.endsAt, now), timer);
  }

  if (list.childElementCount > 0) {
    panel.append(list);
  } else {
    // Still clickable, so starting something is one click away.
    const empty = el('button', 'task task-empty', 'Nothing underway. Open Management to start an operation or ambition.');
    empty.addEventListener('click', onOpenPlanner);
    panel.append(empty);
  }
  return panel;
}
