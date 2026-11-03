import { el } from './dom';
import { RESOURCE_KEYS, RESOURCES, RICHNESS_NAMES, type Deposits, type ResourceKey, type Richness } from './map/resources';

// Small icons for the six resources, drawn in each resource's color, and
// the rows of them that the map's hover card, panels and right-click menus
// and the status bar show.

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The radiation trefoil: three blades round a dot, on a 16 by 16 grid. */
function trefoil(): string {
  const point = (r: number, degrees: number) => {
    const a = (degrees * Math.PI) / 180;
    return `${(8 + Math.cos(a) * r).toFixed(2)} ${(8 + Math.sin(a) * r).toFixed(2)}`;
  };
  const blades = [-90, 30, 150].map((middle) => {
    const [from, to] = [middle - 30, middle + 30];
    return `M${point(2.6, from)}L${point(7, from)}A7 7 0 0 1 ${point(7, to)}L${point(2.6, to)}A2.6 2.6 0 0 0 ${point(2.6, from)}Z`;
  });
  return `${blades.join('')}M9.5 8a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0Z`;
}

/** Each icon's shape, on a 16 by 16 grid. */
const ICON_PATHS: Record<ResourceKey, string> = {
  // An ingot, seen from the side.
  metals: 'M1.5 12.5h13l-2.6-6.5H4.1Z M4.6 5h6.8l-.6-1.5H5.2Z',
  // A cut gem.
  rare: 'M4.5 2.5h7l3 4-6.5 7.5-6.5-7.5Z',
  // A drop.
  water: 'M8 1.5S3.2 7.2 3.2 10.2a4.8 4.8 0 0 0 9.6 0C12.8 7.2 8 1.5 8 1.5Z',
  // A cloud.
  gas: 'M4.6 13a3.1 3.1 0 0 1-.5-6.2 4.1 4.1 0 0 1 7.8-1.1A3.7 3.7 0 0 1 11.6 13Z',
  // A leaf.
  biomass: 'M14 2C6.5 2 2.5 5.8 2.5 10.6c0 1 .2 1.9.6 2.7C4.3 9.8 6.8 7.6 10.2 6 7 8 5 10.6 4 13.8c6.6.6 10-3.8 10-11.8Z',
  radioactives: trefoil(),
};

/** A resource's icon, in its color, at `size` pixels. Decorative: whatever it sits in names the resource. */
export function resourceIcon(key: ResourceKey, size = 14): SVGSVGElement {
  const icon = document.createElementNS(SVG_NS, 'svg');
  icon.setAttribute('viewBox', '0 0 16 16');
  icon.setAttribute('width', String(size));
  icon.setAttribute('height', String(size));
  icon.setAttribute('class', 'resource-icon');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICON_PATHS[key]);
  path.setAttribute('fill', RESOURCES[key].colour);
  icon.append(path);
  return icon;
}

/** The resources held, richest first (ties in the usual order). */
export function heldResources(deposits: Deposits): { key: ResourceKey; richness: Richness }[] {
  return RESOURCE_KEYS.flatMap((key) => (deposits[key] ? [{ key, richness: deposits[key]! }] : []))
    .sort((a, b) => b.richness - a.richness);
}

/** "Metals: 3 (rich)". */
function depositName(key: ResourceKey, richness: Richness): string {
  return `${RESOURCES[key].name}: ${richness} (${RICHNESS_NAMES[richness].toLowerCase()})`;
}

/**
 * A row of what a body holds, richest first: each an icon and its amount,
 * 1 to 4, named in its tooltip. With `labels`, each is named beside its
 * icon too ("Metals 3"), one to a line. "None" if it holds nothing.
 */
export function depositChips(deposits: Deposits, labels = false): HTMLElement {
  const held = heldResources(deposits);
  const row = el('span', labels ? 'resource-chips labeled' : 'resource-chips');
  if (held.length === 0) {
    row.append(el('span', 'muted', 'None'));
    return row;
  }
  for (const { key, richness } of held) {
    const chip = el('span', 'resource-chip');
    const name = depositName(key, richness);
    chip.title = name;
    chip.setAttribute('aria-label', name);
    chip.append(resourceIcon(key));
    if (labels) chip.append(el('span', '', RESOURCES[key].name));
    chip.append(el('span', 'resource-amount', String(richness)));
    row.append(chip);
  }
  return row;
}
