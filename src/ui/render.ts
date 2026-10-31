import { availableAmbitions } from '../engine/ambitions';
import type { NationSetup } from '../engine/nation';
import { availableOperations, isAwaitingDecision } from '../engine/operations';
import { fullName } from '../engine/titles';
import type { GameContent, LogEntry, Nation } from '../types';
import { byId, el, formatStat, liveClock, STAT_LABELS } from './dom';
import { STAT_KEYS } from '../types';
import { creationView } from './creation';
import { attentionCount, dashboardView } from './dashboard';
import { nationArticle } from './article';
import { diplomacyView, galaxyMapView } from './galaxyMap';
import { logView } from './log';
import { overviewView } from './overview';
import { plannerView, type PlannerHandlers } from './planner';
import { trackerView } from './tracker';
import { chatMockup } from './chat';

// Top-level rendering: picks the screen and assembles it from the view
// modules. Each render rebuilds the screen from the nation, so the page can
// never drift out of sync with the state.

/**
 * The galactic map always fills the window. Everything else opens from the
 * dock down the left edge, in a sheet over the map; null means none is open.
 */
export type Tab = 'overview' | 'planner' | 'diplomacy' | 'log';

const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  planner: 'Management',
  diplomacy: 'Diplomacy',
  log: 'Logs',
};

/** UI-only state. It belongs to this browser window, not to the nation, so it's never saved with it. */
export interface ViewState {
  tab: Tab | null;
  /** The latest decision's result, shown at the top of the planner until closed. */
  outcome: LogEntry | null;
}

export interface GameHandlers extends PlannerHandlers {
  onChangePrefix: (prefix: string) => void;
  /** Claims an unclaimed star system on the map; `name` is for the log. */
  onClaimSystem: (system: number, name: string) => void;
  /** Opens a sheet over the map, or with null, closes it. */
  onSelectTab: (tab: Tab | null) => void;
}

export function renderCreation(content: GameContent, onCreate: (setup: NationSetup) => void): void {
  document.body.classList.remove('game-mode');
  byId('nation-title').textContent = 'Project Starflower';
  byId('screen').replaceChildren(creationView(content, onCreate));
  byId('new-nation').hidden = true;
}

export function renderGame(nation: Nation, content: GameContent, now: number, view: ViewState, handlers: GameHandlers): void {
  byId('nation-title').textContent = fullName(nation);
  byId('new-nation').hidden = false;
  // The map fills the window, with the status bar over its top edge and the dock down its left (see .game-mode in style.css).
  document.body.classList.add('game-mode');

  const parts: HTMLElement[] = [
    galaxyMapView(nation, handlers.onClaimSystem, () => handlers.onSelectTab('planner')),
    rightColumn(trackerView(nation, content, now, () => handlers.onSelectTab('planner')), chatMockup()),
  ];
  if (view.tab) {
    const close = () => handlers.onSelectTab(null);
    // A dimmed backdrop over the map: clicking it closes the panel.
    const backdrop = el('div', 'sheet-backdrop');
    backdrop.addEventListener('click', close);
    parts.push(backdrop, sheet(view.tab, sheetBody(view.tab, nation, content, now, view, handlers), close));
  }
  parts.push(statusBar(nation, now), dock(view.tab, attentionCount(nation, now), handlers.onSelectTab));
  byId('screen').replaceChildren(...parts);
}

/** Down the right of the map: the task tracker at the top, the chat window at the bottom. */
function rightColumn(tracker: HTMLElement, chat: HTMLElement): HTMLElement {
  const column = el('div', 'map-right');
  column.append(tracker, chat);
  return column;
}

function sheetBody(tab: Tab, nation: Nation, content: GameContent, now: number, view: ViewState, handlers: GameHandlers): HTMLElement {
  if (tab === 'overview') {
    const body = el('div', 'overview-layout');
    const main = dashboardView(nation, content, now, () => handlers.onSelectTab('planner'), nationArticle(nation, content));
    body.append(overviewView(nation, content, handlers.onChangePrefix), main);
    return body;
  }
  if (tab === 'planner') return plannerView(nation, content, now, view.outcome, handlers);
  if (tab === 'diplomacy') return diplomacyView(nation);
  return logView(nation.log, now);
}

/** A view opened from the dock, over the map, with a title and a close button. Escape closes it too. */
function sheet(tab: Tab, body: HTMLElement, onClose: () => void): HTMLElement {
  const node = el('section', 'sheet');
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-label', TAB_LABELS[tab]);
  const header = el('div', 'sheet-header');
  const close = el('button', 'secondary small sheet-close', '×');
  close.title = 'Close and return to the map';
  close.setAttribute('aria-label', close.title);
  close.addEventListener('click', onClose);
  header.append(el('h2', 'sheet-title', TAB_LABELS[tab]), close);
  const scroller = el('div', 'sheet-body');
  scroller.append(body);
  node.append(header, scroller);
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') onClose();
  });
  return node;
}

/** The dock down the left edge: a button for each view. Pressing the open one again closes it. */
function dock(selected: Tab | null, attention: number, onSelect: (tab: Tab | null) => void): HTMLElement {
  const bar = el('nav', 'dock');
  bar.setAttribute('aria-label', 'Game views');
  const buttons = el('div', 'dock-buttons');
  for (const tab of Object.keys(TAB_LABELS) as Tab[]) {
    const b = iconButton(`dock-button ${tab === selected ? 'selected' : ''}`, TAB_LABELS[tab]);
    b.setAttribute('aria-pressed', String(tab === selected));
    // A badge on the planner, so pending work is visible from anywhere.
    if (tab === 'planner' && attention > 0) b.append(el('span', 'badge', String(attention)));
    b.addEventListener('click', () => onSelect(tab === selected ? null : tab));
    buttons.append(b);
  }
  bar.append(buttons);
  return bar;
}

/**
 * The bar across the top: the nation's name, its stats, and the clock and
 * New Nation. viewKey covers the name and stats, so the bar redraws when
 * they change; the clock ticks on its own (updateLiveTimers).
 */
function statusBar(nation: Nation, now: number): HTMLElement {
  const bar = el('header', 'status-bar');
  const list = el('dl', 'status-stats');
  list.setAttribute('aria-label', 'Nation stats');
  for (const key of STAT_KEYS) {
    const value = nation.stats[key];
    const item = el('div', 'status-stat');
    // The full figure in the tooltip, since population is shortened here.
    item.title = `${STAT_LABELS[key]}: ${formatStat(key, value)}`;
    const short = key === 'population' ? shortPopulation(value) : formatStat(key, value);
    item.append(el('dt', 'status-stat-label', STAT_LABELS[key]), el('dd', 'status-stat-value', short));
    list.append(item);
  }
  // The real New Nation button lives in the page's (hidden) top bar, where main.ts listens to it.
  const restart = el('button', 'secondary small status-restart', 'New Nation');
  restart.addEventListener('click', () => byId('new-nation').click());
  const right = el('div', 'status-right');
  right.append(liveClock(now), restart);
  bar.append(el('span', 'status-name', fullName(nation)), list, right);
  return bar;
}

/** Population (in millions) shortened for the status bar: "850M", "1.23B". */
function shortPopulation(millions: number): string {
  return millions >= 1000 ? `${(millions / 1000).toFixed(2)}B` : `${Math.round(millions)}M`;
}

/** A dock button: an icon (PLACEHOLDER: blank until real icons are drawn), then its name. */
function iconButton(className: string, label: string): HTMLButtonElement {
  const b = el('button', className);
  b.append(el('span', 'dock-icon'), el('span', 'dock-label', label));
  return b;
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
