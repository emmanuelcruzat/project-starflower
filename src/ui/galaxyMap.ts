import { seededRandom } from '../engine/random';
import type { Nation } from '../types';
import { el } from './dom';
import { borderPath, fillPath, pointInRing, ringsPath, territoryCells, territoryRings, type Point } from './map/borders';
import {
  generateMap, MAP_HEIGHT, MAP_WIDTH, MULTIPLICITY_NAMES, systemPlanets, type GalaxyMap, type Lane, type Planet, type StarType,
} from './map/generate';

// PLACEHOLDER. The design doc defers the Galactic Map until after 1.0 (see
// "Preventing Feature Creep"). This draws generated star systems, hyperlanes
// and nation borders, and systems can be hovered to see their names. The map
// fills the window; drag to move around, scroll to zoom. The whole map is one
// sector made of constellations. Clicking focuses a place and fades the rest:
// a constellation (its outline), or a system (it and its direct
// connections). A Sector › Constellation › System trail in the header steps
// back out. Nothing here is saved or read by the engine.

const SVG_NS = 'http://www.w3.org/2000/svg';
/** How far a claimed system's territory reaches into open space. */
const TERRITORY_RADIUS = 52;
/** Font sizes for nation names written across their territory, in map units. */
const NAME_SIZE = { min: 14, max: 44 };
/** Faint background stars. Decoration only: they can't be hovered and have no names. */
const DUST_COUNT = 1800;
const MAX_ZOOM = 3;
/** How far one arrow-key press moves the map, in screen pixels. */
const KEY_PAN = 80;
/** A press that moves less than this many pixels is a click, not the start of a drag. */
const CLICK_SLOP = 4;
/** Focusing zooms in at least this far: enough to tell stars apart, and for a system, to see its planets. */
const FOCUS_ZOOM = { constellation: 1.2, system: 2.2 };
/** The faded overlay reaches this far past the map, so panning never shows its edge. */
const SHADE_MARGIN = 10_000;
/**
 * The rack of a focused system's star and planets. The star is drawn this
 * many times its usual size (see .racked in style.css), which keeps it the
 * biggest body there. Planets start `gap` past the star's edge and sit
 * `slot` apart, in map units.
 */
const RACK = { starScale: 2.4, gap: 9, slot: 17 };
/** Moons in the rack: their size, the space above their planet, and the distance between them, in map units. */
const MOON = { radius: 1.2, gap: 2.5, step: 3.6 };
/**
 * Placing constellation names: how far from the middle of the stars to look
 * for a clear spot, how finely, and how strongly to prefer spots near the
 * middle (in map units).
 */
const NAME_SEARCH = { radius: 50, step: 10, pull: 0.25 };
/** The glow of a black hole's accretion disc. Keep in step with .star.black-hole in style.css. */
const ACCRETION_COLOUR = '#ffb36b';

/**
 * Where the map is looking: the map point at the centre of the viewport, and
 * how many screen pixels one map unit takes up.
 */
interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** What the map is focused on. null is the whole sector. */
type Focus = { kind: 'constellation' | 'system'; index: number } | null;

/**
 * Cameras by nation id. The screen is rebuilt whenever the nation changes,
 * so the camera lives out here to keep the view from jumping back home.
 * Like the rest of the map, it's never saved.
 */
const cameras = new Map<string, Camera>();
/** The focus by nation id, kept across rebuilds for the same reason. */
const focused = new Map<string, Focus>();

export function galaxyMapView(nation: Nation): HTMLElement {
  const map = generateMap(nation);
  const home = map.systems[map.home];
  let camera = cameras.get(nation.id);
  if (!camera) {
    camera = { x: home.x, y: home.y, zoom: 1 };
    cameras.set(nation.id, camera);
  }

  const panel = el('section', 'panel map-panel');
  const viewport = el('div', 'map-viewport');
  const starmap = drawMap(map, nation.id);

  // The fade is one rectangle over the whole map. Whatever is in focus is
  // lifted above it into the lit layer: its stars, their names, and the
  // lanes between them.
  const shade = svg('rect', {
    x: -SHADE_MARGIN, y: -SHADE_MARGIN, width: MAP_WIDTH + 2 * SHADE_MARGIN, height: MAP_HEIGHT + 2 * SHADE_MARGIN, class: 'focus-shade',
  });
  const litLayer = svg('g', { class: 'lit-layer' });
  starmap.append(shade, litLayer);

  const info = el('aside', 'map-hud map-info');
  const crumbs = el('nav', 'map-crumbs');
  crumbs.setAttribute('aria-label', 'Map focus');

  const focus = (next: Focus, moveCamera: boolean) => {
    focused.set(nation.id, next);
    starmap.classList.toggle('focused', next !== null);
    const constellation = next === null ? null : next.kind === 'constellation' ? next.index : map.systems[next.index].constellation;
    const nearby = next?.kind === 'system' ? connections(map, next.index) : [];
    // The shade covers the whole map, and what's in focus is drawn above it
    // with names showing: a system and its direct connections, or every star
    // in a constellation, plus the lanes between them. Systems lit last time
    // go back below the shade first; the copied lanes and the old planet
    // rack just go.
    const lit = new Set(next === null ? [] : next.kind === 'system' ? [next.index, ...nearby] : map.constellations[next.index].systems);
    for (const node of [...litLayer.children]) {
      if (node.classList.contains('system')) starmap.insertBefore(node, shade);
      else node.remove();
    }
    const litLanes = next === null ? []
      : next.kind === 'system' ? nearby.map((n): Lane => [next.index, n])
        : map.lanes.filter(([a, b]) => lit.has(a) && lit.has(b));
    for (const [a, b] of litLanes) {
      litLayer.append(svg('line', {
        x1: map.systems[a].x.toFixed(1), y1: map.systems[a].y.toFixed(1), x2: map.systems[b].x.toFixed(1), y2: map.systems[b].y.toFixed(1), class: 'lane lit-lane',
      }));
    }
    starmap.querySelectorAll('.system').forEach((node) => {
      const isLit = lit.has(Number(node.getAttribute('data-system')));
      node.classList.toggle('lit', isLit);
      node.classList.remove('racked');
      if (isLit) litLayer.append(node);
    });
    // A focused constellation's name shows above the shade too, highlighted,
    // and after its stars so none of them covers it. It's a copy: the
    // original stays in the map, and the copy goes with the other copies
    // above when the focus changes.
    if (next?.kind === 'constellation') {
      const name = starmap.querySelector(`.constellation-name[data-constellation="${next.index}"]`)!.cloneNode(true) as SVGTextElement;
      name.classList.add('selected');
      litLayer.append(name);
    }
    const planets = next?.kind === 'system' ? systemPlanets(nation, next.index) : [];
    if (next?.kind === 'system') {
      // The rack goes over every other lit system (a neighbour can sit where
      // it reaches, and its shadow then hides it), with only the focused
      // star above it, so that can still be hovered. "racked" enlarges the
      // star (style.css).
      const star = litLayer.querySelector(`[data-system="${next.index}"]`)!;
      litLayer.append(planetRack(map, next.index, planets), star);
      star.classList.add('racked');
    }

    crumbs.replaceChildren(...breadcrumbs(map, next, constellation, focus));
    info.hidden = next === null;
    if (next === null) return;
    info.replaceChildren(...(next.kind === 'constellation'
      ? constellationPanel(map, next.index, focus)
      : systemPanel(map, next.index, nearby, planets, focus)));
    info.scrollTop = 0;

    if (moveCamera) {
      const points = next.kind === 'constellation' ? map.constellations[next.index].systems.map((i) => map.systems[i]) : [map.systems[next.index]];
      const x = points.reduce((sum, p) => sum + p.x, 0) / points.length;
      const y = points.reduce((sum, p) => sum + p.y, 0) / points.length;
      const zoom = Math.max(camera!.zoom, FOCUS_ZOOM[next.kind]);
      // Centre it in the part of the map the panel doesn't cover.
      controls.lookAt(x + info.offsetWidth / 2 / zoom, y, zoom);
    }
  };

  // A click on a star focuses that system; on a constellation's name, the
  // constellation; anywhere else clears the focus. Escape steps back out
  // one level.
  const controls = new MapControls(viewport, starmap, camera, (target) => {
    // The planet rack belongs to the focused system; clicking it keeps the focus.
    if (target?.closest('.planet-rack')) return;
    const star = target?.closest('.system');
    const name = target?.closest('.constellation-name');
    if (star) focus({ kind: 'system', index: Number(star.getAttribute('data-system')) }, true);
    else if (name) focus({ kind: 'constellation', index: Number(name.getAttribute('data-constellation')) }, true);
    else focus(null, false);
  }, () => {
    const current = focused.get(nation.id) ?? null;
    if (current?.kind === 'system') focus({ kind: 'constellation', index: map.systems[current.index].constellation }, false);
    else focus(null, false);
  });

  const header = el('div', 'map-hud map-header');
  header.append(
    crumbs,
    el('p', 'muted', `${map.systems.length} known star systems in ${map.constellations.length} constellations, joined by ${map.lanes.length} hyperlanes. Drag to move, scroll to zoom, click a constellation or a star to learn more.`),
  );

  const buttons = el('div', 'map-hud map-buttons');
  const button = (label: string, title: string, onClick: () => void) => {
    const b = el('button', 'secondary small', label);
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', onClick);
    buttons.append(b);
  };
  button('+', 'Zoom in', () => controls.zoomBy(1.4));
  button('−', 'Zoom out', () => controls.zoomBy(1 / 1.4));
  button('Home', `Centre on ${home.name}`, () => controls.lookAt(home.x, home.y, 1));
  button('Galaxy', 'Show the whole galaxy', () => controls.fit());

  const footer = el('div', 'map-hud map-footer');
  footer.append(
    legend(map),
    el('p', 'map-note', 'Stellar cartography is still underway. These borders are a preview: territory, neighbouring nations and travel will come in a future version.'),
  );

  viewport.append(starmap, header, buttons, info, footer);
  panel.append(viewport);
  // The screen is rebuilt every so often; restore the focus without moving the camera.
  focus(focused.get(nation.id) ?? null, false);
  return panel;
}

type FocusHandler = (next: Focus, moveCamera: boolean) => void;

/** Systems one hyperlane away from this one. */
function connections(map: GalaxyMap, system: number): number[] {
  return map.lanes.flatMap(([a, b]) => (a === system ? [b] : b === system ? [a] : []));
}


/**
 * "Sector › Constellation › System". Every step but the last is a link back
 * out to that level.
 */
function breadcrumbs(map: GalaxyMap, current: Focus, constellation: number | null, focus: FocusHandler): HTMLElement[] {
  const steps: { label: string; target: Focus }[] = [{ label: `${map.sector.name} Sector`, target: null }];
  if (constellation !== null) steps.push({ label: map.constellations[constellation].name, target: { kind: 'constellation', index: constellation } });
  if (current?.kind === 'system') steps.push({ label: map.systems[current.index].name, target: current });

  return steps.flatMap(({ label, target }, i) => {
    const last = i === steps.length - 1;
    const node = last
      ? el('span', 'map-crumb current', label)
      : el('button', 'link-button map-crumb', label);
    if (!last) node.addEventListener('click', () => focus(target, target !== null));
    return i === 0 ? [node] : [el('span', 'map-crumb-separator', '›'), node];
  });
}

function ownerName(map: GalaxyMap, owner: number | null): string {
  if (owner === null) return 'Unclaimed';
  return map.powers[owner].isPlayer ? `${map.powers[owner].name} (you)` : map.powers[owner].name;
}

function closeButton(focus: FocusHandler): HTMLElement {
  const close = el('button', 'secondary small map-info-close', '×');
  close.title = 'Close';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => focus(null, false));
  return close;
}

/** A system's name as a link that focuses it, with its owner's colour. */
function systemRow(map: GalaxyMap, i: number, focus: FocusHandler, note = ownerName(map, map.owners[i])): HTMLElement {
  const item = el('li');
  const owner = map.owners[i];
  const system = map.systems[i];
  const link = el('button', 'link-button map-system-link', system.name + (i === map.home ? ' (capital)' : ''));
  // Named systems still have a designation; it shows on hover.
  if (system.name !== system.designation) link.title = system.designation;
  link.addEventListener('click', () => focus({ kind: 'system', index: i }, true));
  item.append(el('span', `swatch ${owner === null ? 'unclaimed' : `power-${owner}`}`), link, el('span', 'muted', note));
  return item;
}

/** The sector's summary, then the focused constellation's details. */
function constellationPanel(map: GalaxyMap, index: number, focus: FocusHandler): HTMLElement[] {
  const constellation = map.constellations[index];

  // Sector: who holds how much of it, largest first.
  const holdings = map.powers
    .map((_, power) => ({ power, count: map.owners.filter((o) => o === power).length }))
    .filter((h) => h.count > 0)
    .sort((a, b) => b.count - a.count);
  const sector = el('section', 'map-info-section');
  sector.append(
    el('p', 'eyebrow', 'Sector'),
    el('h3', 'map-info-title', map.sector.name),
    el('p', 'muted', `${map.constellations.length} constellations · ${map.systems.length} systems · ${map.owners.filter((o) => o === null).length} unclaimed`),
    ownerList(holdings.map((h) => ({ power: h.power, label: ownerName(map, h.power), count: h.count }))),
  );

  // Constellation: its systems, who owns them, and where its lanes lead.
  const members = new Set(constellation.systems);
  const neighbours = new Set<number>();
  for (const [a, b] of map.lanes) {
    if (members.has(a) !== members.has(b)) neighbours.add(map.systems[members.has(a) ? b : a].constellation);
  }
  const systems = el('ul', 'map-info-systems');
  for (const i of constellation.systems) systems.append(systemRow(map, i, focus));

  const part = el('section', 'map-info-section');
  part.append(
    el('p', 'eyebrow', 'Constellation'),
    el('h3', 'map-info-title', constellation.name),
    el('p', 'muted', `${constellation.systems.length} systems · lanes to ${neighbours.size} neighbouring constellation${neighbours.size === 1 ? '' : 's'}`),
    systems,
  );
  if (neighbours.size > 0) {
    part.append(el('p', 'map-info-neighbours', `Connects to ${[...neighbours].map((n) => map.constellations[n].name).join(', ')}.`));
  }
  return [closeButton(focus), sector, part];
}

/**
 * The focused system laid out like a system diagram: its stars come first,
 * biggest first (the primary is drawn by its own group, enlarged; any
 * companions are drawn here at the same scale), and its planets follow in a
 * row to the right, innermost first, sized and coloured by type. Each
 * planet's moons stack in a column above it (below is where the system's
 * name sits). No frame: a soft shadow keeps the rack readable over lanes,
 * and a line fading out to the right ties the bodies together. Hovering any
 * body shows its name.
 */
function planetRack(map: GalaxyMap, index: number, planets: Planet[]): SVGGElement {
  const system = map.systems[index];
  const [primary, ...companions] = system.stars;
  let starEdge = system.x + primary.radius * RACK.starScale;
  const companionXs = companions.map((companion) => {
    const r = companion.radius * RACK.starScale;
    const x = starEdge + RACK.gap * 0.6 + r;
    starEdge = x + r;
    return x;
  });
  const first = starEdge + RACK.gap + (planets[0]?.type.radius ?? 0);
  const xs = planets.map((_, k) => first + RACK.slot * k);
  const end = (xs[xs.length - 1] ?? starEdge) + RACK.slot / 2;
  // Where a planet's moons sit, stacked upwards from it, and how far the
  // tallest column reaches above the row.
  const moonY = (planet: Planet, m: number) => system.y - planet.type.radius - MOON.gap - MOON.radius - m * MOON.step;
  const reach = Math.max(0, ...planets.map((p) => (p.moons.length > 0 ? system.y - moonY(p, p.moons.length - 1) + MOON.radius : 0)));

  const rack = svg('g', { class: 'planet-rack' });
  // The fade is in map units along this rack, so it gets its own gradient
  // (only one rack is ever shown, so one id is enough).
  // A black hole is nearly black, so its line takes the accretion disc's glow instead.
  const glow = primary.exotic === 'black-hole' ? ACCRETION_COLOUR : primary.colour;
  const fade = svg('linearGradient', { id: 'rack-axis-fade', gradientUnits: 'userSpaceOnUse', x1: system.x, y1: 0, x2: end, y2: 0 });
  fade.append(svg('stop', { offset: 0, 'stop-color': glow, 'stop-opacity': 0.6 }), svg('stop', { offset: 1, 'stop-color': glow, 'stop-opacity': 0 }));
  // The shadow stretches upwards to cover the tallest column of moons.
  const extra = Math.max(0, reach - 12);
  rack.append(
    svg('defs', {}),
    svg('ellipse', {
      cx: (system.x + end) / 2, cy: system.y - extra / 2, rx: (end - system.x) / 2 + 14, ry: 18 + extra / 2, class: 'planet-rack-shadow',
    }),
    svg('line', { x1: system.x, y1: system.y, x2: end, y2: system.y, class: 'planet-rack-axis', stroke: 'url(#rack-axis-fade)' }),
  );
  rack.querySelector('defs')!.append(fade);

  companions.forEach((companion, k) => {
    const node = starCircle(companion, companionXs[k], system.y, companion.radius * RACK.starScale, 'rack-star');
    const title = svg('title', {});
    // Stars in a system are lettered too, the primary being A.
    title.textContent = `${system.name} ${String.fromCharCode(66 + k)} · ${companion.name}`;
    node.append(title);
    rack.append(node);
  });

  planets.forEach((planet, k) => {
    const { type } = planet;
    const cx = xs[k].toFixed(1);
    const cy = system.y.toFixed(1);
    const name = `${system.name} ${roman(k + 1)}`;

    // Moons first, so the planet is drawn over the line that ties them to it.
    if (planet.moons.length > 0) {
      rack.append(svg('line', { x1: cx, y1: cy, x2: cx, y2: moonY(planet, planet.moons.length - 1).toFixed(1), class: 'moon-tether', stroke: type.colour }));
    }
    planet.moons.forEach((moon, m) => {
      const node = svg('circle', { cx, cy: moonY(planet, m).toFixed(1), r: MOON.radius, fill: moon.colour, class: 'moon' });
      const title = svg('title', {});
      // Moons are lettered outwards from their planet: a, b, c...
      title.textContent = `${name}-${String.fromCharCode(97 + m)} · ${moon.name}`;
      node.append(title);
      rack.append(node);
    });

    const body = svg('g', { class: 'planet' });
    const title = svg('title', {});
    title.textContent = `${name} · ${type.name}${planet.moons.length > 0 ? ` · ${planet.moons.length} moon${planet.moons.length === 1 ? '' : 's'}` : ''}`;
    body.append(title);
    if (type.ringed) {
      body.append(svg('ellipse', { cx, cy, rx: type.radius * 1.5, ry: type.radius * 0.45, class: 'planet-ring', stroke: type.colour, transform: `rotate(-18 ${cx} ${cy})` }));
    }
    // The shine is a second circle over the planet, lit from the top left, so it looks round.
    body.append(
      svg('circle', { cx, cy, r: type.radius, fill: type.colour }),
      svg('circle', { cx, cy, r: type.radius, fill: 'url(#planet-shine)' }),
    );
    rack.append(body);
  });
  return rack;
}

/** Planets are numbered outwards from their star, astronomer-style: I, II, III... */
function roman(n: number): string {
  return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n - 1] ?? String(n);
}

/** One system: what and whose it is, and every system a hyperlane leads to. */
function systemPanel(map: GalaxyMap, index: number, nearby: number[], planets: Planet[], focus: FocusHandler): HTMLElement[] {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const moonCount = planets.reduce((sum, p) => sum + p.moons.length, 0);
  const system = map.systems[index];
  const part = el('section', 'map-info-section');
  part.append(
    el('p', 'eyebrow', index === map.home ? 'System · your capital' : 'System'),
    el('h3', 'map-info-title', system.name),
  );
  if (system.name !== system.designation) part.append(el('p', 'muted', `Designation ${system.designation}`));
  part.append(
    el('p', 'muted', describeStars(system.stars)),
    el('p', 'muted', `${plural(planets.length, 'planet')} · ${plural(moonCount, 'moon')} · ${plural(nearby.length, 'hyperlane')}`),
  );
  part.append(el('p', 'muted', ownerName(map, map.owners[index])));

  // Lanes into other constellations are its gateways, so say where they lead.
  const list = el('ul', 'map-info-systems');
  for (const n of nearby) {
    const other = map.systems[n].constellation;
    list.append(systemRow(map, n, focus, other === system.constellation ? ownerName(map, map.owners[n]) : `to ${map.constellations[other].name}`));
  }
  part.append(el('p', 'stat-label map-info-subhead', 'Connections'), list);
  return [closeButton(focus), part];
}

/** Who holds how many of the sector's systems, as a compact wrapping row. */
function ownerList(rows: { power: number | null; label: string; count: number }[]): HTMLElement {
  const list = el('ul', 'map-info-holdings');
  for (const row of rows) {
    const item = el('li');
    item.title = `${row.label}: ${row.count} systems`;
    item.append(el('span', `swatch ${row.power === null ? 'unclaimed' : `power-${row.power}`}`), el('span', '', `${row.label} ${row.count}`));
    list.append(item);
  }
  return list;
}

/**
 * Pans and zooms the map by changing the SVG's viewBox, which keeps lines
 * and text crisp at any zoom. Drag (mouse or finger) to pan, scroll wheel to
 * zoom around the pointer, and arrow keys and +/- when the map has focus.
 */
class MapControls {
  /**
   * `onTap` gets the element under a click that wasn't a drag, or the
   * focused element when Enter is pressed. `onBack` runs on Escape.
   */
  constructor(
    private viewport: HTMLElement,
    private svg: SVGSVGElement,
    private camera: Camera,
    private onTap: (target: Element | null) => void,
    private onBack: () => void,
  ) {
    // The viewport has no size until it's on the page, and changes size with
    // the window, so redraw whenever its size changes.
    new ResizeObserver(() => this.apply()).observe(viewport);
    this.listenForDrags();

    svg.addEventListener('wheel', (event) => {
      event.preventDefault();
      // Trackpads send many small deltas and mice a few large ones; scaling
      // exponentially makes both feel the same.
      const rect = svg.getBoundingClientRect();
      this.zoomBy(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });

    svg.addEventListener('keydown', (event) => {
      const pan = KEY_PAN / camera.zoom;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-pan, 0], ArrowRight: [pan, 0], ArrowUp: [0, -pan], ArrowDown: [0, pan] };
      if (event.key in moves) {
        const [dx, dy] = moves[event.key];
        this.lookAt(camera.x + dx, camera.y + dy);
      } else if (event.key === '+' || event.key === '=') {
        this.zoomBy(1.4);
      } else if (event.key === '-') {
        this.zoomBy(1 / 1.4);
      } else if (event.key === 'Enter') {
        this.onTap(event.target as Element);
      } else if (event.key === 'Escape') {
        this.onBack();
      } else {
        return;
      }
      event.preventDefault();
    });

    // Tabbing to a system that's off screen brings it into view.
    svg.addEventListener('focusin', (event) => {
      const target = event.target as Element;
      const star = target.classList.contains('system') ? target.querySelector('.star') : null;
      if (!star) return;
      const x = Number(star.getAttribute('cx'));
      const y = Number(star.getAttribute('cy'));
      const [left, top, width, height] = this.viewBox();
      if (x < left || x > left + width || y < top || y > top + height) this.lookAt(x, y);
    });
  }

  zoomBy(factor: number, screenX = this.viewport.clientWidth / 2, screenY = this.viewport.clientHeight / 2): void {
    const { camera } = this;
    // Keep the map point under the pointer in the same place on screen.
    const offsetX = screenX - this.viewport.clientWidth / 2;
    const offsetY = screenY - this.viewport.clientHeight / 2;
    const pointX = camera.x + offsetX / camera.zoom;
    const pointY = camera.y + offsetY / camera.zoom;
    const zoom = this.clampZoom(camera.zoom * factor);
    this.lookAt(pointX - offsetX / zoom, pointY - offsetY / zoom, zoom);
  }

  lookAt(x: number, y: number, zoom = this.camera.zoom): void {
    Object.assign(this.camera, { x, y, zoom: this.clampZoom(zoom) });
    this.apply();
  }

  fit(): void {
    this.lookAt(MAP_WIDTH / 2, MAP_HEIGHT / 2, this.fitZoom());
  }

  /** The zoom at which the whole galaxy just fits. Zooming out further would only show empty space. */
  private fitZoom(): number {
    const width = this.viewport.clientWidth || MAP_WIDTH;
    const height = this.viewport.clientHeight || MAP_HEIGHT;
    return Math.min(width / MAP_WIDTH, height / MAP_HEIGHT, 1);
  }

  private clampZoom(zoom: number): number {
    return Math.min(MAX_ZOOM, Math.max(this.fitZoom(), zoom));
  }

  /** Visible area in map units: left, top, width, height. */
  private viewBox(): [number, number, number, number] {
    const { camera } = this;
    const width = this.viewport.clientWidth / camera.zoom;
    const height = this.viewport.clientHeight / camera.zoom;
    return [camera.x - width / 2, camera.y - height / 2, width, height];
  }

  private apply(): void {
    if (this.viewport.clientWidth === 0) return;
    const { camera } = this;
    camera.zoom = this.clampZoom(camera.zoom);
    // Keep the view over the galaxy. If the galaxy is narrower than the view
    // along an axis, centre it on that axis instead.
    const [, , width, height] = this.viewBox();
    const clamp = (value: number, half: number, size: number) => (half * 2 >= size ? size / 2 : Math.min(size - half, Math.max(half, value)));
    camera.x = clamp(camera.x, width / 2, MAP_WIDTH);
    camera.y = clamp(camera.y, height / 2, MAP_HEIGHT);
    this.svg.setAttribute('viewBox', this.viewBox().map((n) => n.toFixed(1)).join(' '));
  }

  /**
   * Every press starts a drag. If the pointer barely moved by the time it's
   * released, it was a click instead, aimed at whatever was under it when
   * pressed. (Pointer capture sends the later events to the map itself, so
   * the target has to be remembered from the press.)
   */
  private listenForDrags(): void {
    const { svg, camera } = this;
    let drag: { id: number; x: number; y: number; moved: number; target: Element } | null = null;

    svg.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || drag) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0, target: event.target as Element };
      svg.setPointerCapture(event.pointerId);
      svg.classList.add('dragging');
    });
    svg.addEventListener('pointermove', (event) => {
      if (drag?.id !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      drag.moved += Math.hypot(dx, dy);
      this.lookAt(camera.x - dx / camera.zoom, camera.y - dy / camera.zoom);
    });
    const end = (event: PointerEvent) => {
      if (drag?.id !== event.pointerId) return;
      const tapped = event.type === 'pointerup' && drag.moved < CLICK_SLOP ? drag.target : undefined;
      drag = null;
      svg.classList.remove('dragging');
      if (tapped) this.onTap(tapped);
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
  }
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function drawMap(map: GalaxyMap, seed: string): SVGSVGElement {
  const { systems, lanes, powers, owners, home } = map;
  const root = svg('svg', { viewBox: `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`, role: 'img', class: 'starmap', tabindex: 0 });
  root.setAttribute('aria-label', `Star map with ${systems.length} systems. ${powers[0].name} is at ${systems[home].name}. Use the arrow keys to move and plus or minus to zoom.`);

  // Layers, back to front: dust, territories, lanes, stars.
  root.append(dust(seed));
  const claimed = owners.flatMap((owner, i) => (owner === null ? [] : [i]));
  const cells = territoryCells(systems, claimed, TERRITORY_RADIUS);
  const defs = svg('defs', {});
  // Shading laid over every planet in the rack: a highlight at the top left
  // fading to shadow at the bottom right, so flat circles look round.
  const shine = svg('radialGradient', { id: 'planet-shine', cx: 0.35, cy: 0.32, r: 0.8 });
  shine.append(
    svg('stop', { offset: 0, 'stop-color': '#ffffff', 'stop-opacity': 0.55 }),
    svg('stop', { offset: 0.4, 'stop-color': '#ffffff', 'stop-opacity': 0 }),
    svg('stop', { offset: 0.7, 'stop-color': '#000000', 'stop-opacity': 0.1 }),
    svg('stop', { offset: 1, 'stop-color': '#000000', 'stop-opacity': 0.55 }),
  );
  defs.append(shine);
  const territories = svg('g', { class: 'territories' });

  const names = svg('g', { class: 'territory-names', 'aria-hidden': 'true' });

  powers.forEach((mapPower, power) => {
    const own = cells.filter((cell) => owners[cell.system] === power);
    if (own.length === 0) return;
    // Tracing the outline fills in holes. If that fails, draw the cells as
    // they are, holes and all.
    const rings = territoryRings(own, systems, owners, power);
    const shape = rings ? ringsPath(rings) : fillPath(own);
    const edge = rings ? shape : borderPath(own, owners, power);

    // The border line is drawn twice as thick as wanted, then clipped to the
    // territory's own shape so only the inner half shows. Where two nations
    // meet, their borders then sit side by side instead of overlapping.
    const clipId = `territory-clip-${power}`;
    const clip = svg('clipPath', { id: clipId });
    clip.append(svg('path', { d: shape, 'clip-rule': 'evenodd' }));
    defs.append(clip);

    territories.append(
      svg('path', { d: shape, class: `territory power-${power}`, 'fill-rule': 'evenodd' }),
      svg('path', { d: edge, class: `border power-${power}`, 'clip-path': `url(#${clipId})` }),
    );
    names.append(territoryName(mapPower.name, power, own.map((cell) => systems[cell.system]), rings));
  });
  root.append(defs, territories);

  for (const [a, b] of lanes) {
    root.append(svg('line', {
      x1: systems[a].x.toFixed(1), y1: systems[a].y.toFixed(1),
      x2: systems[b].x.toFixed(1), y2: systems[b].y.toFixed(1),
      class: 'lane',
    }));
  }
  // Above the lanes so they don't cross out the letters, below the stars so
  // hovering still works.
  root.append(constellationLayer(map), names);

  systems.forEach((system, i) => {
    const isHome = i === home;
    const owner = owners[i];
    const ownerName = owner === null ? 'Unclaimed' : powers[owner].name;
    // The hover effect is plain CSS (see .system in style.css). tabindex lets
    // keyboard users focus a system and see the same label.
    // data-system lets a click on the star focus it.
    const group = svg('g', { class: isHome ? 'system home' : 'system', tabindex: 0, 'data-system': i });
    const x = system.x.toFixed(1);
    const y = system.y.toFixed(1);

    const title = svg('title', {});
    const designation = system.name === system.designation ? '' : ` (${system.designation})`;
    title.textContent = `${system.name}${designation} · ${describeStars(system.stars)} · ${ownerName}`;
    // An invisible, larger circle makes small stars easy to hover.
    group.append(title, svg('circle', { cx: x, cy: y, r: 12, class: 'hit' }));
    if (isHome) group.append(svg('circle', { cx: x, cy: y, r: 11, class: 'home-ring' }));
    // Companion stars sit just beside the primary, smaller. The planet rack
    // draws them in its own row instead, so they hide when it's showing.
    const [primary, ...companions] = system.stars;
    const bottoms = [primary.radius];
    companions.forEach((companion, k) => {
      const { dx, dy, r } = companionOffset(primary, companion, k);
      bottoms.push(dy + r);
      group.append(starCircle(companion, system.x + dx, system.y + dy, r, 'companion'));
    });
    group.append(starCircle(primary, system.x, system.y, primary.radius));

    // The name sits centred under the stars.
    const label = svg('text', {
      x: x,
      y: (system.y + Math.max(...bottoms) + 12).toFixed(1),
      class: 'system-label',
      'text-anchor': 'middle',
    });
    label.textContent = isHome ? `${system.name} · ${ownerName}` : system.name;
    group.append(label);
    root.append(group);
  });
  return root;
}

/**
 * Where to put a constellation's name: near the middle of its stars, but
 * clear of any star and the name under it. Tries a grid of spots around the
 * middle and takes the one furthest from everything, with a small pull back
 * towards the middle so names don't wander off.
 */
function clearSpot(map: GalaxyMap, members: number[]): Point {
  const middle = {
    x: members.reduce((sum, i) => sum + map.systems[i].x, 0) / members.length,
    y: members.reduce((sum, i) => sum + map.systems[i].y, 0) / members.length,
  };
  // Every nearby star, and where its name sits (centred about 16 units below it).
  const obstacles = map.systems
    .filter((s) => Math.hypot(s.x - middle.x, s.y - middle.y) < NAME_SEARCH.radius + 80)
    .flatMap((s) => [{ x: s.x, y: s.y }, { x: s.x - 18, y: s.y + 16 }, { x: s.x + 18, y: s.y + 16 }]);
  let best = middle;
  let bestScore = -Infinity;
  for (let dx = -NAME_SEARCH.radius; dx <= NAME_SEARCH.radius; dx += NAME_SEARCH.step) {
    for (let dy = -NAME_SEARCH.radius; dy <= NAME_SEARCH.radius; dy += NAME_SEARCH.step) {
      const spot = { x: middle.x + dx, y: middle.y + dy };
      const clearance = Math.min(...obstacles.map((o) => Math.hypot(o.x - spot.x, o.y - spot.y)));
      const score = clearance - Math.hypot(dx, dy) * NAME_SEARCH.pull;
      if (score > bestScore) {
        bestScore = score;
        best = spot;
      }
    }
  }
  return best;
}

/**
 * One star. The colour goes in a CSS variable rather than a fill attribute,
 * because CSS rules (like hover) would otherwise override it. Neutron stars
 * and black holes get an extra class for their own look.
 */
function starCircle(star: StarType, x: number, y: number, r: number, extra = ''): SVGCircleElement {
  const classes = ['star', star.exotic ?? '', extra].filter(Boolean).join(' ');
  return svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: r.toFixed(2), class: classes, style: `--star: ${star.colour}` });
}

/** Where a companion star sits beside its primary on the map: up right, down left, down right. */
function companionOffset(primary: StarType, companion: StarType, k: number): { dx: number; dy: number; r: number } {
  const r = companion.radius * 0.7;
  const angle = ([-35, 145, 50][k] * Math.PI) / 180;
  const distance = primary.radius + r + 1;
  return { dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance, r };
}

/** "Class G", or for several stars "Binary · G + M". */
function describeStars(stars: StarType[]): string {
  if (stars.length === 1) return stars[0].name;
  return `${MULTIPLICITY_NAMES[stars.length - 1]} · ${stars.map((s) => s.short).join(' + ')}`;
}

/**
 * A nation's name written across its territory, map-style: tilted along the
 * territory's longest direction and sized to fit inside it.
 */
function territoryName(name: string, power: number, points: Point[], rings: Point[][] | null): SVGTextElement {
  const n = points.length;
  const mean = { x: points.reduce((sum, p) => sum + p.x, 0) / n, y: points.reduce((sum, p) => sum + p.y, 0) / n };

  // The longest direction through the systems (their principal axis). Kept
  // within ±30° of level so the name stays easy to read.
  let xx = 0, yy = 0, xy = 0;
  for (const p of points) {
    xx += (p.x - mean.x) ** 2;
    yy += (p.y - mean.y) ** 2;
    xy += (p.x - mean.x) * (p.y - mean.y);
  }
  const limit = Math.PI / 6;
  const angle = n < 3 ? 0 : Math.max(-limit, Math.min(limit, Math.atan2(2 * xy, xx - yy) / 2));

  // A C-shaped territory's middle can be outside it. If so, centre on its
  // system nearest the middle instead.
  let centre = mean;
  if (!rings?.some((ring) => pointInRing(mean, ring))) {
    centre = points.reduce((best, p) => (Math.hypot(p.x - mean.x, p.y - mean.y) < Math.hypot(best.x - mean.x, best.y - mean.y) ? p : best));
  }

  // Fit the name to the territory's length along that direction. Each
  // letter, with the letter spacing, is about 0.8 of the font size wide.
  const along = points.map((p) => (p.x - centre.x) * Math.cos(angle) + (p.y - centre.y) * Math.sin(angle));
  const span = Math.max(...along) - Math.min(...along) + TERRITORY_RADIUS * 1.5;
  const size = Math.max(NAME_SIZE.min, Math.min(NAME_SIZE.max, span / (name.length * 0.8)));

  const text = svg('text', {
    x: centre.x.toFixed(1),
    y: centre.y.toFixed(1),
    class: `territory-name power-${power}`,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'font-size': size.toFixed(1),
    transform: `rotate(${((angle * 180) / Math.PI).toFixed(1)} ${centre.x.toFixed(1)} ${centre.y.toFixed(1)})`,
  });
  text.textContent = name;
  return text;
}

/**
 * Each constellation's name, near the middle of its stars. Clicking a name
 * focuses that constellation.
 */
function constellationLayer(map: GalaxyMap): SVGGElement {
  const layer = svg('g', { class: 'constellation-layer' });
  map.constellations.forEach((constellation, index) => {
    const { x, y } = clearSpot(map, constellation.systems);
    const label = svg('text', {
      x: x.toFixed(1), y: y.toFixed(1), class: 'constellation-name', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'data-constellation': index,
    });
    label.textContent = constellation.name;
    layer.append(label);
  });
  return layer;
}

/** Thousands of faint, unnamed stars behind the systems, so the galaxy looks full. */
function dust(seed: string): SVGGElement {
  // A separate seed, so the dust doesn't change the systems' layout.
  const random = seededRandom(`${seed}/dust`);
  const group = svg('g', { class: 'dust', 'aria-hidden': 'true' });
  for (let i = 0; i < DUST_COUNT; i++) {
    // Squaring makes most dust tiny, with a few brighter specks.
    const size = random() ** 2;
    group.append(svg('circle', {
      cx: (random() * MAP_WIDTH).toFixed(1),
      cy: (random() * MAP_HEIGHT).toFixed(1),
      r: (0.5 + size * 1.3).toFixed(2),
      opacity: (0.15 + size * 0.45).toFixed(2),
    }));
  }
  return group;
}

function legend(map: GalaxyMap): HTMLElement {
  const list = el('ul', 'map-legend');
  const count = (owner: number | null) => map.owners.filter((o) => o === owner).length;
  map.powers.forEach((power, i) => {
    const item = el('li');
    item.append(
      el('span', `swatch power-${i}`),
      el('span', '', power.isPlayer ? `${power.name} (you)` : power.name),
      el('span', 'muted', `${count(i)} systems`),
    );
    list.append(item);
  });
  const unclaimed = el('li');
  unclaimed.append(el('span', 'swatch unclaimed'), el('span', '', 'Unclaimed'), el('span', 'muted', `${count(null)} systems`));
  list.append(unclaimed);
  return list;
}
