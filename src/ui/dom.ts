import { HOUR } from '../config';
import { STAT_KEYS, type Effects, type StatKey } from '../types';

// Small helpers shared by every UI module. Text is always set with
// textContent, never innerHTML, so nothing written in the data files can
// inject markup into the page.

export const STAT_LABELS: Record<StatKey, string> = {
  population: 'Population',
  economy: 'Economy',
  technology: 'Technology',
  military: 'Military',
  liberties: 'Liberties',
  cohesion: 'Cohesion',
};

export function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`index.html is missing an element with id="${id}"`);
  return node;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function button(label: string, className: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = el('button', className, label);
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

/** Splits text on blank lines so content can have multiple paragraphs. */
export function paragraphs(text: string, className = 'body-text'): HTMLElement[] {
  return text.split(/\n\s*\n/).map((p) => el('p', className, p.trim()));
}

/** "2d 4h", "3h 12m", "45s". Precise enough to watch, short enough to scan. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatAgo(ms: number): string {
  return ms < 60_000 ? 'just now' : `${formatDuration(ms)} ago`;
}

export function formatHours(hours: number): string {
  return formatDuration(hours * HOUR);
}

/** Population is stored in millions. */
export function formatPopulation(millions: number): string {
  if (millions >= 1000) return `${(millions / 1000).toFixed(2)} billion`;
  return `${Math.round(millions)} million`;
}

export function formatStat(key: StatKey, value: number): string {
  return key === 'population' ? formatPopulation(value) : `${Math.round(value)}`;
}

export function signed(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return rounded > 0 ? `+${rounded}` : rounded < 0 ? `−${-rounded}` : '±0';
}

/** Colored chips like "Economy +4". `suffix` adds a unit, e.g. "/day". */
export function effectChips(effects: Effects, suffix = ''): HTMLElement {
  const chips = el('div', 'effects');
  for (const key of STAT_KEYS) {
    const delta = effects[key];
    if (!delta) continue;
    const label = key === 'population' ? `Population ${signed(delta)}M` : `${STAT_LABELS[key]} ${signed(delta)}`;
    chips.append(el('span', `chip ${delta > 0 ? 'positive' : 'negative'}`, `${label}${suffix}`));
  }
  return chips;
}

/**
 * A countdown that main.ts updates every second without re-rendering the
 * page. Marking it with data attributes keeps the timing logic in one place
 * (updateLiveTimers) instead of a timer per element.
 */
export function countdown(endsAt: number, now: number, doneText = 'ready'): HTMLElement {
  const span = el('span', 'countdown', endsAt > now ? formatDuration(endsAt - now) : doneText);
  span.dataset.endsAt = String(endsAt);
  span.dataset.doneText = doneText;
  return span;
}

/** A progress bar that fills from `from` to `to` (timestamps), also live-updated. */
export function progressBar(from: number, to: number, now: number): HTMLElement {
  const bar = el('div', 'meter');
  const fill = el('div', 'meter-fill');
  fill.dataset.progressFrom = String(from);
  fill.dataset.progressTo = String(to);
  fill.style.width = `${progressPercent(from, to, now)}%`;
  bar.append(fill);
  return bar;
}

function progressPercent(from: number, to: number, now: number): number {
  return Math.min(100, Math.max(0, ((now - from) / (to - from)) * 100));
}

/** "14:05:09", in the player's own time format. */
function formatClock(now: number): string {
  return new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** "Saturday, October 31, 2026", for the clock's tooltip. */
function formatDate(now: number): string {
  return new Date(now).toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/** The game clock's time, kept ticking by updateLiveTimers like the countdowns. */
export function liveClock(now: number): HTMLElement {
  const time = el('time', 'clock', formatClock(now));
  time.dataset.clock = '';
  time.title = formatDate(now);
  return time;
}

/** Refreshes every countdown, progress bar and clock on the page in place. */
export function updateLiveTimers(now: number): void {
  document.querySelectorAll<HTMLElement>('[data-clock]').forEach((node) => {
    node.textContent = formatClock(now);
    node.title = formatDate(now);
  });
  document.querySelectorAll<HTMLElement>('[data-ends-at]').forEach((node) => {
    const endsAt = Number(node.dataset.endsAt);
    node.textContent = endsAt > now ? formatDuration(endsAt - now) : (node.dataset.doneText ?? 'ready');
  });
  document.querySelectorAll<HTMLElement>('[data-progress-from]').forEach((node) => {
    node.style.width = `${progressPercent(Number(node.dataset.progressFrom), Number(node.dataset.progressTo), now)}%`;
  });
}
