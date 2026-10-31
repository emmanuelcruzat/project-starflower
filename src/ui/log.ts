import type { LogEntry } from '../types';
import { effectChips, el, formatAgo } from './dom';

const KIND_LABELS: Record<LogEntry['kind'], string> = {
  incident: 'Incident',
  operation: 'Operation',
  ambition: 'Ambition',
  nation: 'Nation',
};

/** The full decision log. It has a whole tab, so each entry shows its result and effects too. */
export function logView(log: LogEntry[], now: number): HTMLElement {
  const panel = el('section', 'panel log-panel');
  panel.append(el('h2', 'section-title', 'Decision Log'));
  if (log.length === 0) {
    panel.append(el('p', 'muted', 'No decisions on record yet.'));
    return panel;
  }
  const list = el('ol', 'log');
  for (const entry of log) {
    const item = el('li');
    item.append(
      el('span', `log-kind kind-${entry.kind}`, `${KIND_LABELS[entry.kind]} · ${formatAgo(now - entry.at)}`),
      el('span', 'log-title', entry.title),
    );
    if (entry.choice) item.append(el('span', 'log-choice', entry.choice));
    if (entry.result) item.append(el('span', 'log-result', entry.result));
    if (entry.effects) item.append(effectChips(entry.effects));
    list.append(item);
  }
  panel.append(list);
  return panel;
}
