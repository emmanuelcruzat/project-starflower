import { availablePrefixes, nationTitles, powerScore } from '../engine/titles';
import { STAT_KEYS, type GameContent, type Nation } from '../types';
import { el, formatStat, STAT_LABELS } from './dom';

/** The nation's identity, titles and stats. */
export function overviewView(nation: Nation, content: GameContent, onChangePrefix: (prefix: string) => void): HTMLElement {
  const panel = el('aside', 'panel overview');
  const government = content.governments.find((g) => g.id === nation.governmentId);
  const titles = nationTitles(nation, content);

  panel.append(
    el('h2', 'section-title', 'Nation Overview'),
    el('p', 'muted', government?.name ?? nation.governmentId),
  );

  const titleBlock = el('div', 'titles');
  titleBlock.append(
    titleRow('Power', titles.power.name, `Power score ${Math.round(powerScore(nation.stats, content))}`),
    titleRow('Military', titles.military.name),
    titleRow('Cohesion', titles.cohesion.name, titles.cohesion.description),
  );
  panel.append(titleBlock);

  panel.append(el('h2', 'section-title spaced', 'Statistics'));
  for (const key of STAT_KEYS) {
    const row = el('div', 'stat-row');
    row.append(el('span', 'stat-label', STAT_LABELS[key]), el('span', 'stat-value', formatStat(key, nation.stats[key])));
    panel.append(row);
    // Population has no fixed maximum, so only the 0–100 stats get a bar.
    if (key !== 'population') panel.append(meter(nation.stats[key]));
  }

  // Prefixes depend on stats, so the list can grow or shrink over time. The
  // current one always stays in the list, even if the nation no longer
  // qualifies for it; nobody should lose their name by accident.
  const options = availablePrefixes(nation, content).map((p) => p.name);
  if (!options.includes(nation.prefix)) options.unshift(nation.prefix);
  const select = el('select', 'select-input');
  select.id = 'change-prefix';
  for (const name of options) {
    const option = el('option', '', name);
    option.value = name;
    option.selected = name === nation.prefix;
    select.append(option);
  }
  select.addEventListener('change', () => onChangePrefix(select.value));
  const label = el('label', 'field-label', 'Nation prefix');
  label.htmlFor = 'change-prefix';
  panel.append(label, select);

  return panel;
}

function titleRow(label: string, title: string, detail?: string): HTMLElement {
  const row = el('div', 'title-row');
  row.append(el('span', 'stat-label', label), el('strong', 'title-name', title));
  if (detail) row.append(el('p', 'title-detail', detail));
  return row;
}

function meter(percent: number): HTMLElement {
  const bar = el('div', 'meter');
  const fill = el('div', `meter-fill ${percent < 25 ? 'negative' : ''}`);
  fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  bar.append(fill);
  return bar;
}
