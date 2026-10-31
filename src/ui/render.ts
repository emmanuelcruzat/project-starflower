import { availableAmbitions } from '../engine/ambitions';
import type { NationSetup } from '../engine/nation';
import { availableOperations, isAwaitingDecision } from '../engine/operations';
import { fullName } from '../engine/titles';
import type { GameContent, LogEntry, Nation } from '../types';
import { byId, el, formatStat } from './dom';
import { STAT_KEYS } from '../types';
import { creationView } from './creation';
import { attentionCount, dashboardView } from './dashboard';
import { galaxyMapView } from './galaxyMap';
import { logView } from './log';
import { overviewView } from './overview';
import { plannerView, type PlannerHandlers } from './planner';

// Top-level rendering: picks the screen and assembles it from the view
// modules. Each render rebuilds the screen from the nation, so the page can
// never drift out of sync with the state.

export type Tab = 'overview' | 'planner' | 'map' | 'log';

const TAB_LABELS: Record<Tab, string> = {
  overview: 'Nation Overview',
  planner: 'Incidents · Operations · Ambitions',
  map: 'Galactic Map',
  log: 'Decision Log',
};

/** UI-only state. It belongs to this browser window, not to the nation, so it's never saved with it. */
export interface ViewState {
  tab: Tab;
  /** The latest decision's result, shown at the top of the planner until closed. */
  outcome: LogEntry | null;
}

export interface GameHandlers extends PlannerHandlers {
  onChangePrefix: (prefix: string) => void;  onSelectTab: (tab: Tab) => void;
}

export function renderCreation(content: GameContent, onCreate: (setup: NationSetup) => void): void {
  document.body.classList.remove('map-mode');
  byId('nation-title').textContent = 'Project Starflower';
  byId('screen').replaceChildren(creationView(content, onCreate));
  byId('new-nation').hidden = true;
}

export function renderGame(nation: Nation, content: GameContent, now: number, view: ViewState, handlers: GameHandlers): void {
  byId('nation-title').textContent = fullName(nation);
  byId('new-nation').hidden = false;
  // The map tab stretches the screen to fill the window (see .map-mode in style.css).
  document.body.classList.toggle('map-mode', view.tab === 'map');

  let body: HTMLElement;
  if (view.tab === 'overview') {
    body = el('div', 'overview-layout');
    body.append(
      overviewView(nation, content, handlers.onChangePrefix),
      dashboardView(nation, content, now, () => handlers.onSelectTab('planner')),
    );
  } else if (view.tab === 'planner') {
    body = plannerView(nation, content, now, view.outcome, handlers);
  } else if (view.tab === 'map') {
    body = galaxyMapView(nation);
  } else {
    body = logView(nation.log, now);
  }

  byId('screen').replaceChildren(tabBar(view.tab, attentionCount(nation, now), handlers.onSelectTab), body);
}

function tabBar(selected: Tab, attention: number, onSelect: (tab: Tab) => void): HTMLElement {
  const bar = el('nav', 'tabs');
  bar.setAttribute('role', 'tablist');
  for (const tab of Object.keys(TAB_LABELS) as Tab[]) {
    const b = el('button', `tab ${tab === selected ? 'selected' : ''}`, TAB_LABELS[tab]);
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(tab === selected));
    // A badge on the planner tab, so pending work is visible from any tab.
    if (tab === 'planner' && attention > 0) b.append(el('span', 'badge', String(attention)));
    b.addEventListener('click', () => onSelect(tab));
    bar.append(b);
  }
  return bar;
}

/**
 * A summary of everything visible on screen, apart from countdowns. main.ts
 * redraws the page only when this changes, and otherwise just ticks the
 * countdowns. Rebuilding every second would swallow clicks that land
 * mid-rebuild and reset collapsed sections.
 */
export function viewKey(nation: Nation, content: GameContent, now: number): string {
  return JSON.stringify([
    nation.prefix,
    STAT_KEYS.map((key) => formatStat(key, nation.stats[key])),
    nation.incidents.queue.map((p) => p.incidentId),
    nation.operations.map((op) => [op.operationId, op.stageId, isAwaitingDecision(op, now)]),
    nation.ambition?.ambitionId,
    availableOperations(nation, content).map((op) => op.id),
    availableAmbitions(nation, content).map((a) => a.id),
    nation.log.length > 0 ? nation.log[0].at : 0,
  ]);
}

export function showContentProblems(errorCount: number, warningCount: number): void {
  if (errorCount === 0 && warningCount === 0) return;
  const banner = byId('dev-banner');
  banner.hidden = false;
  banner.textContent =
    `Data files: ${errorCount} error(s), ${warningCount} warning(s). ` +
    'Entries with errors were skipped. Open the browser console for details.';
}
