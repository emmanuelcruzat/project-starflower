import { availablePrefixes, fullName } from '../engine/titles';
import type { GameContent, Government } from '../types';
import { STAT_KEYS } from '../types';
import { button, el, formatStat, STAT_LABELS } from './dom';
import type { NationSetup } from '../engine/nation';

const MAX_NAME_LENGTH = 40;

/**
 * The nation creation form. It keeps its own small bits of state (the chosen
 * government and prefix) in local variables, because nothing else needs them
 * until the player presses "Found Nation".
 */
export function creationView(content: GameContent, onCreate: (setup: NationSetup) => void): HTMLElement {
  const root = el('section', 'panel creation');
  root.append(
    el('p', 'eyebrow', 'The Starflower Galaxy'),
    el('h2', 'screen-title', 'Found a Nation'),
    el('p', 'body-text', 'Forty billion stars, a thousand fledgling powers, and room for one more. Choose a name and a form of government. Everything after that is up to you.'),
  );

  let government: Government = content.governments[0];
  let prefix = '';

  const nameInput = el('input', 'text-input');
  nameInput.type = 'text';
  nameInput.maxLength = MAX_NAME_LENGTH;
  nameInput.placeholder = 'e.g. Zecoso';
  nameInput.id = 'nation-name';
  const nameLabel = el('label', 'field-label', 'Nation name');
  nameLabel.htmlFor = 'nation-name';

  const governmentList = el('div', 'government-list');
  const prefixSelect = el('select', 'select-input');
  prefixSelect.id = 'nation-prefix';
  const prefixLabel = el('label', 'field-label', 'Nation prefix');
  prefixLabel.htmlFor = 'nation-prefix';
  const preview = el('p', 'name-preview');
  const submit = button('Found Nation', 'primary', () => {
    const name = nameInput.value.trim();
    if (name && prefix) onCreate({ name, governmentId: government.id, prefix });
  });

  // Prefixes depend on the government and its starting stats, so the list is
  // rebuilt whenever the government changes. A prefix that is still allowed
  // stays selected.
  function refreshPrefixes(): void {
    const subject = { governmentId: government.id, stats: government.startingStats, flags: [], foundedAt: 0, lastUpdatedAt: 0 };
    const options = availablePrefixes(subject, content);
    if (!options.some((p) => p.name === prefix)) prefix = options[0]?.name ?? '';
    prefixSelect.replaceChildren(
      ...options.map((p) => {
        const option = el('option', '', p.name);
        option.value = p.name;
        option.selected = p.name === prefix;
        return option;
      }),
    );
    refreshPreview();
  }

  function refreshPreview(): void {
    const name = nameInput.value.trim();
    preview.textContent = name ? fullName({ prefix, name }) : 'Name your nation to see its full title.';
    submit.disabled = !name || !prefix;
  }

  for (const gov of content.governments) {
    const card = el('label', 'government-card');
    const radio = el('input');
    radio.type = 'radio';
    radio.name = 'government';
    radio.checked = gov === government;
    radio.addEventListener('change', () => {
      government = gov;
      refreshPrefixes();
    });
    const stats = el('div', 'mini-stats');
    for (const key of STAT_KEYS) {
      stats.append(el('span', '', `${STAT_LABELS[key]} ${formatStat(key, gov.startingStats[key])}`));
    }
    const text = el('div');
    text.append(el('strong', '', gov.name), el('p', 'muted', gov.description), stats);
    card.append(radio, text);
    governmentList.append(card);
  }

  nameInput.addEventListener('input', refreshPreview);
  prefixSelect.addEventListener('change', () => {
    prefix = prefixSelect.value;
    refreshPreview();
  });

  root.append(
    nameLabel, nameInput,
    el('p', 'field-label', 'Government'), governmentList,
    prefixLabel, prefixSelect,
    preview, submit,
  );
  refreshPrefixes();
  return root;
}
