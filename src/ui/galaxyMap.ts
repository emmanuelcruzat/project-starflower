import { seededRandom } from '../engine/random';
import type { Nation } from '../types';
import { el } from './dom';
import { playChirp, playWhoosh } from './sound';
import { borderPath, fillPath, pointInRing, ringsPath, territoryCells, territoryRings, type Point } from './map/borders';
import {
  generateMap, MAP_HEIGHT, MAP_WIDTH, MULTIPLICITY_NAMES, systemPlanets, type GalaxyMap, type Lane, type Planet, type StarSystem, type StarType,
} from './map/generate';
import { generateRegion, hexCorners, REGION_HEIGHT, REGION_WIDTH, SECTOR_RADIUS, type GalacticRegion } from './map/region';
import {
  CORE_RADIUS, GALAXY_CENTRE, GALAXY_RADIUS, GALAXY_SIZE, generateGalaxy, regionAt, wedgePath, type Galaxy,
} from './map/galaxy';

// PLACEHOLDER. The design doc defers the Galactic Map until after 1.0 (see
// "Preventing Feature Creep"). This draws generated star systems, hyperlanes
// and nation borders, and systems can be hovered to see their names. The map
// fills the window; drag to move around, scroll to zoom. The star map is one
// sector made of constellations. Clicking focuses a place and fades the rest:
// a constellation (its outline), or a system (it and its direct
// connections). Double-clicking a system, or zooming in on it as far as the
// map goes, opens a diagram of its orbits: its stars, planets and moons.
// Zooming out past the whole sector switches to the galactic
// region around it, a honeycomb of mostly uncharted sectors, and zooming out
// past that to the whole galaxy, a spiral cut into regions around its core.
// Zooming in on yours (or clicking it) goes back down a level. A Galaxy ›
// Region › Sector › Constellation › System trail in the header steps back
// out. Nothing here is saved or read by the engine.

const SVG_NS = 'http://www.w3.org/2000/svg';
/** How far a claimed system's territory reaches into open space. */
const TERRITORY_RADIUS = 52;
/** Font sizes for nation names written across their territory, in map units. */
const NAME_SIZE = { min: 14, max: 44 };
/** Faint background stars. Decoration only: they can't be hovered and have no names. */
const DUST_COUNT = 1800;
const MAX_ZOOM = 3;
/** Two taps on the map this close together (in milliseconds), the first on a system, open that system's diagram. */
const DOUBLE_TAP_MS = 400;
/**
 * Zooming out past the whole sector switches to the region around it, and
 * zooming in on your sector there switches back. The push has to add up to
 * this factor first, so the end of a scroll doesn't flip views by accident;
 * a pause longer than OVERSCROLL_RESET_MS starts the count again.
 */
const ZOOM_PAST = 1.3;
const OVERSCROLL_RESET_MS = 500;
/** The region view's closest zoom, and how close it starts when you zoom out of the sector into it. */
const REGION_ZOOM = { max: 2.4, arrive: 1.4 };
/** The same for the galaxy view. */
const GALAXY_ZOOM = { max: 2.4, arrive: 1.5 };
/** The system diagram is this many units across, square, with the star at the middle. Room past the outermost orbit is for the hyperlanes. */
const SYSTEM_SIZE = 1500;
const SYSTEM_ZOOM = { max: 3 };
/** How far one arrow-key press moves the map, in screen pixels. */
const KEY_PAN = 80;
/** A press that moves less than this many pixels is a click, not the start of a drag. */
const CLICK_SLOP = 4;
/** Focusing zooms in at least this far: enough to tell stars apart, and for a system, to see its planets. */
const FOCUS_ZOOM = { constellation: 1.2, system: 2.2 };
/** The faded overlay reaches this far past the map, so panning never shows its edge. */
const SHADE_MARGIN = 10_000;
/**
 * The miniature of a focused system drawn round its star, in map units.
 * Stars are drawn this many times their usual size (keep `starScale` in
 * step with .previewed in style.css) and planets `planetScale` times their
 * listed size. The first ring is `firstGap` past the stars, the rest `step`
 * apart; in a wide system, each star's rings sit `gap` from the next's.
 */
const PREVIEW = { starScale: 2, planetScale: 0.55, firstGap: 5, step: 5, gap: 5 };
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

/** One system's diagram, the star map of its sector, the region of sectors around that, or the galaxy of regions. */
type View = 'system' | 'sector' | 'region' | 'galaxy';
/** Which view, and the other views' cameras and picks, by nation id. Kept like the camera. */
const views = new Map<string, View>();
const regionCameras = new Map<string, Camera>();
const regionPicks = new Map<string, number | null>();
const galaxyCameras = new Map<string, Camera>();
const galaxyPicks = new Map<string, number | null>();
/** The system whose diagram is open (or was last), and that view's camera. */
const openSystems = new Map<string, number>();
const systemCameras = new Map<string, Camera>();

export function galaxyMapView(nation: Nation): HTMLElement {
  const map = generateMap(nation);
  const region = generateRegion(nation, map.sector.name);
  const galaxy = generateGalaxy(nation, region.name);
  const home = map.systems[map.home];
  const homeSector = region.sectors[region.home];
  let camera = cameras.get(nation.id);
  if (!camera) {
    camera = { x: home.x, y: home.y, zoom: 1 };
    cameras.set(nation.id, camera);
  }
  let regionCamera = regionCameras.get(nation.id);
  if (!regionCamera) {
    regionCamera = { x: homeSector.x, y: homeSector.y, zoom: 1 };
    regionCameras.set(nation.id, regionCamera);
  }
  let systemCamera = systemCameras.get(nation.id);
  if (!systemCamera) {
    systemCamera = { x: SYSTEM_SIZE / 2, y: SYSTEM_SIZE / 2, zoom: 1 };
    systemCameras.set(nation.id, systemCamera);
  }
  let galaxyCamera = galaxyCameras.get(nation.id);
  if (!galaxyCamera) {
    galaxyCamera = { x: GALAXY_CENTRE, y: GALAXY_CENTRE, zoom: 1 };
    galaxyCameras.set(nation.id, galaxyCamera);
  }

  const panel = el('section', 'panel map-panel');
  const viewport = el('div', 'map-viewport');
  const starmap = drawMap(map, nation.id);
  const regionMap = drawRegion(region, map, nation.id);
  const galaxyMap = drawGalaxy(galaxy, region, nation.id);
  // One diagram, refilled with whichever system is opened.
  const systemMap = svg('svg', { viewBox: `0 0 ${SYSTEM_SIZE} ${SYSTEM_SIZE}`, role: 'img', class: 'starmap system-map', tabindex: 0 });
  systemMap.append(dust(`${nation.id}/system`, SYSTEM_SIZE, SYSTEM_SIZE, 700));
  const systemContent = svg('g', { class: 'system-diagram' });
  systemMap.append(systemContent);

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
    // A chirp when the player opens a constellation or system (clicking it,
    // or a link to it). Quiet restores, like after a rebuild, don't move the camera.
    if (next && moveCamera) playChirp(next.kind);
    focused.set(nation.id, next);
    starmap.classList.toggle('focused', next !== null);
    const constellation = next === null ? null : next.kind === 'constellation' ? next.index : map.systems[next.index].constellation;
    const nearby = next?.kind === 'system' ? connections(map, next.index) : [];
    // The shade covers the whole map, and what's in focus is drawn above it
    // with names showing: a system and its direct connections, or every star
    // in a constellation, plus the lanes between them. Systems lit last time
    // go back below the shade first; the copied lanes and the old system
    // miniature just go.
    const lit = new Set(next === null ? [] : next.kind === 'system' ? [next.index, ...nearby] : map.constellations[next.index].systems);
    for (const node of [...litLayer.children]) {
      if (node.classList.contains('system')) starmap.insertBefore(node, shade);
      else node.remove();
    }
    // Lanes inside a constellation are drawn solid. Lanes leading out (from
    // a system to its neighbours, or a constellation's gateways to the next
    // one) are dashed and flow outwards: each runs from the inside end to
    // the outside end, which sets the direction of the flow (style.css).
    const members = next?.kind === 'constellation' ? lit : new Set<number>();
    const insideLanes = map.lanes.filter(([a, b]) => members.has(a) && members.has(b));
    const exitLanes = next === null ? []
      : next.kind === 'system' ? nearby.map((n): Lane => [next.index, n])
        : map.lanes.flatMap(([a, b]): Lane[] => (members.has(a) === members.has(b) ? [] : members.has(a) ? [[a, b]] : [[b, a]]));
    const drawLane = ([a, b]: Lane, kind: string) => {
      litLayer.append(svg('line', {
        x1: map.systems[a].x.toFixed(1), y1: map.systems[a].y.toFixed(1), x2: map.systems[b].x.toFixed(1), y2: map.systems[b].y.toFixed(1), class: `lane lit-lane ${kind}`,
      }));
    };
    for (const lane of insideLanes) drawLane(lane, '');
    for (const lane of exitLanes) drawLane(lane, 'exit-lane');
    starmap.querySelectorAll('.system').forEach((node) => {
      const isLit = lit.has(Number(node.getAttribute('data-system')));
      node.classList.toggle('lit', isLit);
      node.classList.remove('previewed');
      node.querySelector<SVGTextElement>('.system-label')?.style.removeProperty('transform');
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
    const planets = next?.kind === 'system' ? systemPlanets(nation, next.index, map.systems[next.index].stars.length) : [];
    if (next?.kind === 'system') {
      // The miniature goes over every other lit system (a neighbour can sit
      // inside its rings, and its dark disc then hides it), with only the
      // focused star above it, so that can still be hovered. "previewed"
      // enlarges the star (style.css). The system's name moves down to
      // clear the rings.
      const star = litLayer.querySelector<SVGGElement>(`[data-system="${next.index}"]`)!;
      const preview = systemPreview(map, next.index, planets, nation.id);
      litLayer.append(preview.node, star);
      star.classList.add('previewed');
      const label = star.querySelector<SVGTextElement>('.system-label');
      if (label) {
        const gap = Number(label.getAttribute('y')) - map.systems[next.index].y;
        label.style.transform = `translateY(${Math.max(0, preview.below + 10 - gap).toFixed(1)}px)`;
      }
    }

    crumbs.replaceChildren(...breadcrumbs(map, galaxy, region, next, constellation, focus, (view) => showView(view, 'zoom')));
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
    // The miniature belongs to the focused system; clicking it keeps the focus.
    if (target?.closest('.system-preview')) return;
    const star = target?.closest('.system');
    const name = target?.closest('.constellation-name');
    // Focusing a system moves the camera, so the second tap of a double
    // click lands somewhere else. Any quick second tap counts.
    const now = performance.now();
    if (lastStarTap && now - lastStarTap.time < DOUBLE_TAP_MS) {
      const index = lastStarTap.index;
      lastStarTap = null;
      return openSystem(index);
    }
    lastStarTap = star ? { index: Number(star.getAttribute('data-system')), time: now } : null;
    if (star) focus({ kind: 'system', index: Number(star.getAttribute('data-system')) }, true);
    else if (name) focus({ kind: 'constellation', index: Number(name.getAttribute('data-constellation')) }, true);
    else focus(null, false);
  }, () => {
    // Escape steps out: system, constellation, sector, then the region.
    const current = focused.get(nation.id) ?? null;
    if (current?.kind === 'system') focus({ kind: 'constellation', index: map.systems[current.index].constellation }, false);
    else if (current) focus(null, false);
    else showView('region', 'zoom');
  }, { width: MAP_WIDTH, height: MAP_HEIGHT, maxZoom: MAX_ZOOM }, (direction, point) => {
    if (direction === 'out') return showView('region', 'zoom');
    // Zooming in all the way on a star opens it; failing that, the focused system.
    const near = systemNear(map, point, 24);
    const current = focused.get(nation.id);
    if (near !== null) openSystem(near);
    else if (current?.kind === 'system') openSystem(current.index);
  });
  let lastStarTap: { index: number; time: number } | null = null;

  // The system diagram. Links in its panel and trail lead back out to the
  // sector, except links to other systems, which open their diagrams.
  const openSystem = (index: number) => {
    openSystems.set(nation.id, index);
    // The sector keeps the system focused, for when you come back out.
    if (views.get(nation.id) === 'sector') focus({ kind: 'system', index }, false);
    else focused.set(nation.id, { kind: 'system', index });
    showView('system', 'zoom');
  };
  const fromSystem: FocusHandler = (next, moveCamera) => {
    if (next?.kind === 'system') return openSystem(next.index);
    showView('sector', 'zoom');
    focus(next, moveCamera);
  };
  // Clicking a hyperlane (or its name) leaving the diagram opens the system at its other end.
  const systemControls = new MapControls(viewport, systemMap, systemCamera, (target) => {
    const lane = target?.closest('.diagram-lane');
    if (!lane) return;
    playChirp('system');
    openSystem(Number(lane.getAttribute('data-system')));
  }, () => showView('sector', 'zoom'),
    { width: SYSTEM_SIZE, height: SYSTEM_SIZE, maxZoom: SYSTEM_ZOOM.max }, (direction) => {
      if (direction === 'out') showView('sector', 'zoom');
    });
  /** Draws the open system's diagram, and its trail and panel. `frame` fits the camera to its outermost orbit. */
  const showSystem = (index: number, frame: boolean) => {
    const planets = systemPlanets(nation, index, map.systems[index].stars.length);
    const { parts, reach } = systemDiagram(map, index, planets, nation.id);
    systemContent.replaceChildren(...parts);
    // Most systems don't reach the edge of the diagram, so fit what's there,
    // with room for the hyperlanes and their names.
    const margin = LANE_OUT.label + 40;
    if (frame) systemControls.lookAt(SYSTEM_SIZE / 2, SYSTEM_SIZE / 2, systemControls.zoomToFit(2 * (reach.x + margin), 2 * (reach.y + margin)));
    systemMap.setAttribute('aria-label', `Diagram of the ${map.systems[index].name} system: ${describeStars(map.systems[index].stars)}, ${planets.length} planets. Zoom out or press Escape to return to the sector.`);
    crumbs.replaceChildren(...breadcrumbs(map, galaxy, region, { kind: 'system', index }, map.systems[index].constellation, fromSystem, (view) => showView(view, 'zoom')));
    info.hidden = false;
    info.replaceChildren(...systemPanel(map, index, connections(map, index), planets, fromSystem), bodiesSection(map, index, planets));
    info.scrollTop = 0;
  };

  // The region: clicking your sector (or zooming in on it) opens its star
  // map; clicking another shows what little is known of it.
  const pickSector = (index: number | null) => {
    regionPicks.set(nation.id, index);
    regionMap.querySelectorAll('.sector').forEach((node) => node.classList.toggle('selected', Number(node.getAttribute('data-sector')) === index));
    info.hidden = index === null;
    if (index === null) return;
    info.replaceChildren(...sectorPanel(region, map, index, () => pickSector(null), () => showView('sector', 'zoom')));
    info.scrollTop = 0;
  };
  /** The sector whose hexagon holds this point, near enough, or null over empty space. */
  const sectorAt = (point: Point) => {
    let best: number | null = null;
    let bestDistance = SECTOR_RADIUS;
    region.sectors.forEach((sector, i) => {
      const d = Math.hypot(sector.x - point.x, sector.y - point.y);
      if (d <= bestDistance) [best, bestDistance] = [i, d];
    });
    return best;
  };
  const regionControls = new MapControls(viewport, regionMap, regionCamera, (target) => {
    const sector = target?.closest('.sector');
    const index = sector ? Number(sector.getAttribute('data-sector')) : null;
    if (index === region.home) showView('sector', 'zoom');
    else pickSector(index);
  }, () => {
    // Escape clears the pick, then steps out to the galaxy.
    if (regionPicks.get(nation.id) != null) pickSector(null);
    else showView('galaxy', 'zoom');
  }, { width: REGION_WIDTH, height: REGION_HEIGHT, maxZoom: REGION_ZOOM.max }, (direction, point) => {
    // Zooming in on your sector opens it; on another, shows that it's uncharted.
    if (direction === 'out') return showView('galaxy', 'zoom');
    const index = sectorAt(point);
    if (index === region.home) showView('sector', 'zoom');
    else if (index !== null) pickSector(index);
  });

  // The galaxy: the same again, one level up.
  const pickRegion = (index: number | null) => {
    galaxyPicks.set(nation.id, index);
    galaxyMap.querySelectorAll('.galaxy-region').forEach((node) => node.classList.toggle('selected', Number(node.getAttribute('data-region')) === index));
    info.hidden = index === null;
    if (index === null) return;
    info.replaceChildren(...regionPanel(galaxy, region, map, index, () => pickRegion(null), () => showView('region', 'zoom')));
    info.scrollTop = 0;
  };
  const galaxyControls = new MapControls(viewport, galaxyMap, galaxyCamera, (target) => {
    const wedge = target?.closest('.galaxy-region');
    const index = wedge ? Number(wedge.getAttribute('data-region')) : null;
    if (index === galaxy.home) showView('region', 'zoom');
    else pickRegion(index);
  }, () => pickRegion(null), { width: GALAXY_SIZE, height: GALAXY_SIZE, maxZoom: GALAXY_ZOOM.max }, (direction, point) => {
    if (direction !== 'in') return;
    const index = regionAt(galaxy, point);
    if (index === galaxy.home) showView('region', 'zoom');
    else if (index !== null) pickRegion(index);
  });

  const summary = el('p', 'muted');
  const summaries: Record<View, string> = {
    system: 'Orbits are drawn to show order, not scale. Hover a body for its name; zoom out or press Escape to return to the sector.',
    sector: `${map.systems.length} known star systems in ${map.constellations.length} constellations, joined by ${map.lanes.length} hyperlanes. Drag to move, scroll to zoom, click a constellation or a star to learn more, double-click a star to open its system. Zoom out to see the region.`,
    region: `${region.sectors.length} sectors in the ${region.name} Region. Only ${map.sector.name} has been charted: click it, or zoom in on it, to open its star map. Zoom out to see the galaxy.`,
    galaxy: `${galaxy.regions.length} regions around the core of the ${galaxy.name} Galaxy. Only ${region.name} has been surveyed: click it, or zoom in on it, to see its sectors.`,
  };

  // Each level's map, its controls, and where the level below it sits on
  // it (the point a zoom between them grows out of or shrinks into).
  const levels: Record<View, { node: SVGSVGElement; controls: MapControls; child?: () => Point; depth: number }> = {
    system: { node: systemMap, controls: systemControls, depth: -1 },
    sector: { node: starmap, controls, child: () => map.systems[openSystems.get(nation.id) ?? map.home], depth: 0 },
    region: { node: regionMap, controls: regionControls, child: () => homeSector, depth: 1 },
    galaxy: { node: galaxyMap, controls: galaxyControls, child: () => galaxy.regions[galaxy.home], depth: 2 },
  };
  const ARRIVE: Record<View, number> = { system: 1, sector: FOCUS_ZOOM.system, region: REGION_ZOOM.arrive, galaxy: GALAXY_ZOOM.arrive };

  /**
   * Switches between the galaxy, the region, the sector and a system. 'zoom' animates
   * the change as if the camera kept going, out of or into your place on
   * the outer map; 'jump' shows the whole of it without animating; 'none'
   * restores the last view as it was, after a rebuild.
   */
  const showView = (next: View, how: 'zoom' | 'jump' | 'none') => {
    // A system's diagram needs a system; without one, show the sector.
    if (next === 'system' && !openSystems.has(nation.id)) next = 'sector';
    const previous = views.get(nation.id) ?? 'sector';
    views.set(nation.id, next);
    viewport.dataset.view = next;
    summary.textContent = summaries[next];
    const level = levels[next];
    const out = level.depth > levels[previous].depth;

    // Pulling out of a level centres the one above on where you came from,
    // still close in; going in shows the whole of the level below.
    const child = level.child?.();
    if (how === 'zoom' && out && child) level.controls.lookAt(child.x, child.y, Math.max(level.controls.fitZoom(), ARRIVE[next]));
    else if (how !== 'none') level.controls.fit();

    if (next === 'system') showSystem(openSystems.get(nation.id)!, how !== 'none');
    else if (next === 'sector') focus(focused.get(nation.id) ?? null, false);
    else {
      crumbs.replaceChildren(...outerCrumbs(next));
      if (next === 'region') pickSector(regionPicks.get(nation.id) ?? null);
      else pickRegion(galaxyPicks.get(nation.id) ?? null);
    }

    if (how !== 'zoom' || next === previous) return;
    // The outer of the two maps holds the spot to grow from.
    const outer = out ? level : levels[previous];
    const origin = outer.controls.toScreen(outer.child!());
    const incoming = level.node;
    incoming.style.transformOrigin = `${origin.x.toFixed(0)}px ${origin.y.toFixed(0)}px`;
    incoming.classList.remove('arrive-out', 'arrive-in');
    // Reading the layout restarts the animation if it was already running.
    void incoming.getBoundingClientRect();
    incoming.classList.add(out ? 'arrive-out' : 'arrive-in');
    incoming.focus({ preventScroll: true });
    playWhoosh(out ? 'out' : 'in');
  };
  for (const { node } of Object.values(levels)) node.addEventListener('animationend', () => node.classList.remove('arrive-out', 'arrive-in'));
  const current = () => views.get(nation.id) ?? 'sector';

  /** The trail for the galaxy and region views: "Galaxy › Region", with the galaxy a link back out. */
  const outerCrumbs = (view: View): HTMLElement[] => {
    const galaxyLabel = `${galaxy.name} Galaxy`;
    if (view === 'galaxy') return [el('span', 'map-crumb current', galaxyLabel)];
    const link = el('button', 'link-button map-crumb', galaxyLabel);
    link.addEventListener('click', () => showView('galaxy', 'zoom'));
    return [link, el('span', 'map-crumb-separator', '›'), el('span', 'map-crumb current', `${region.name} Region`)];
  };

  const header = el('div', 'map-hud map-header');
  header.append(
    crumbs,
    summary,
  );

  const buttons = el('div', 'map-hud map-buttons');
  const button = (label: string, title: string, onClick: () => void) => {
    const b = el('button', 'secondary small', label);
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', onClick);
    buttons.append(b);
  };
  // Like the scroll wheel, zooming past the limit with these switches views.
  // The other three jump straight to a level, zooming if it's a different one.
  const goTo = (view: View) => showView(view, current() === view ? 'jump' : 'zoom');
  button('+', 'Zoom in', () => levels[current()].controls.zoomBy(1.4));
  button('−', 'Zoom out', () => levels[current()].controls.zoomBy(1 / 1.4));
  button('Home', `Centre on ${home.name}`, () => {
    if (current() !== 'sector') showView('sector', 'zoom');
    controls.lookAt(home.x, home.y, 1);
  });
  button('Sector', `Show the whole ${map.sector.name} Sector`, () => goTo('sector'));
  button('Region', `Show the ${region.name} Region`, () => goTo('region'));
  button('Galaxy', `Show the whole ${galaxy.name} Galaxy`, () => goTo('galaxy'));

  const footer = el('div', 'map-hud map-footer');
  footer.append(
    legend(map),
    el('p', 'map-note', 'Stellar cartography is still underway. These borders are a preview: territory, neighbouring nations and travel will come in a future version.'),
  );

  viewport.append(systemMap, starmap, regionMap, galaxyMap, header, buttons, info, footer);
  panel.append(viewport);
  // The screen is rebuilt every so often; restore the view and focus without moving the camera.
  showView(views.get(nation.id) ?? 'sector', 'none');
  return panel;
}

type FocusHandler = (next: Focus, moveCamera: boolean) => void;

/** Systems one hyperlane away from this one. */
function connections(map: GalaxyMap, system: number): number[] {
  return map.lanes.flatMap(([a, b]) => (a === system ? [b] : b === system ? [a] : []));
}


/**
 * "Galaxy › Region › Sector › Constellation › System". Every step but the
 * last is a link back out to that level.
 */
function breadcrumbs(
  map: GalaxyMap, galaxy: Galaxy, region: GalacticRegion, current: Focus, constellation: number | null, focus: FocusHandler,
  showLevel: (view: 'region' | 'galaxy') => void,
): HTMLElement[] {
  const steps: { label: string; target: Focus | 'region' | 'galaxy' }[] = [
    { label: `${galaxy.name} Galaxy`, target: 'galaxy' },
    { label: `${region.name} Region`, target: 'region' },
    { label: `${map.sector.name} Sector`, target: null },
  ];
  if (constellation !== null) steps.push({ label: map.constellations[constellation].name, target: { kind: 'constellation', index: constellation } });
  if (current?.kind === 'system') steps.push({ label: map.systems[current.index].name, target: current });

  return steps.flatMap(({ label, target }, i) => {
    const last = i === steps.length - 1;
    const node = last
      ? el('span', 'map-crumb current', label)
      : el('button', 'link-button map-crumb', label);
    if (!last) node.addEventListener('click', () => (target === 'region' || target === 'galaxy' ? showLevel(target) : focus(target, target !== null)));
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
 * A miniature of the focused system's diagram, drawn around its star on the
 * star map: faint orbit rings with each planet as a dot on its ring, at the
 * same place round its orbit as in the full diagram (double-click opens
 * that). Close systems have every ring round all their stars; in a wide
 * system each star has its own rings and sits beside the primary. No labels:
 * hovering a body shows its name. A soft dark disc behind keeps it readable
 * over lanes.
 *
 * The primary is the system's own star, enlarged (.previewed in style.css);
 * companions are drawn here. Returns the drawing and how far below the
 * star it reaches, so the system's name can move clear of it.
 */
function systemPreview(map: GalaxyMap, index: number, planets: Planet[], seed: string): { node: SVGGElement; below: number } {
  const system = map.systems[index];
  const names = planetNames(system, planets);
  const radius = (star: StarType) => star.radius * PREVIEW.starScale;
  /** The j-th ring out from a star (or huddle of stars) this big. */
  const orbitOf = (core: number, j: number) => core + PREVIEW.firstGap + j * PREVIEW.step;
  const glow = (star: StarType) => (star.exotic === 'black-hole' ? ACCRETION_COLOUR : star.colour);
  const group = svg('g', { class: 'system-preview' });
  const back = svg('g', {});
  const rings = svg('g', { class: 'preview-rings' });
  const bodies = svg('g', {});
  group.append(back, rings, bodies);

  // Where each star sits, and which planets circle it (null: all of them).
  const [primary, ...companions] = system.stars;
  const wide = planets.some((p) => p.host !== null);
  // `core` is how far the stars at that spot reach, which the first ring clears.
  const hosts: { x: number; y: number; core: number; own: number[] }[] = [];
  if (!wide) {
    // Close: companions huddle round the primary, as in the diagram.
    const places = [{ x: system.x, y: system.y }];
    companions.forEach((star, k) => {
      const angle = -Math.PI / 4 + (k * Math.PI * 2) / companions.length;
      const distance = radius(primary) + radius(star) + 2.5;
      places.push({ x: system.x + Math.cos(angle) * distance, y: system.y + Math.sin(angle) * distance });
    });
    const huddle = Math.max(...system.stars.map((star, k) => Math.hypot(places[k].x - system.x, places[k].y - system.y) + radius(star)));
    // Every planet circles the whole huddle.
    system.stars.forEach((star, k) => hosts.push({ ...places[k], core: k === 0 ? huddle : radius(star), own: k === 0 ? planets.map((_, i) => i) : [] }));
  } else {
    // Wide: each star with its own rings, in a row to the right of the primary.
    let x = system.x;
    system.stars.forEach((star, k) => {
      const own = planets.flatMap((p, i) => (p.host === k ? [i] : []));
      const extent = own.length > 0 ? orbitOf(radius(star), own.length - 1) : radius(star);
      if (k > 0) x += PREVIEW.gap + extent;
      hosts.push({ x, y: system.y, core: radius(star), own });
      x += extent;
    });
    const last = hosts[hosts.length - 1];
    rings.append(svg('line', { x1: system.x, y1: system.y, x2: last.x, y2: last.y, class: 'preview-ring preview-pair' }));
  }

  // The same stream, used in the same order, as the full diagram, so every
  // planet sits where it will in the diagram.
  const random = seededRandom(`${seed}/orbits/${index}`);
  let reach = radius(primary);
  let left = system.x;
  let right = system.x;
  hosts.forEach((host) => {
    host.own.forEach((i, j) => {
      const planet = planets[i];
      const orbit = orbitOf(host.core, j);
      rings.append(svg('circle', { cx: host.x.toFixed(1), cy: host.y.toFixed(1), r: orbit.toFixed(1), class: 'preview-ring', stroke: glow(primary) }));
      const angle = random();
      planet.moons.forEach(() => random());
      const x = host.x + Math.cos(angle * Math.PI * 2) * orbit;
      const y = host.y + Math.sin(angle * Math.PI * 2) * orbit;
      const r = planet.type.radius * PREVIEW.planetScale;
      const body = svg('g', { class: 'planet' });
      const title = svg('title', {});
      const moons = planet.moons.length;
      title.textContent = `${names[i]} · ${planet.type.name}${moons > 0 ? ` · ${moons} moon${moons === 1 ? '' : 's'}` : ''}`;
      body.append(title);
      // A planet with moons gets a faint halo ring, a hint of what's round it.
      if (moons > 0) body.append(svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: (r + 1.4).toFixed(2), class: 'preview-moons', stroke: planet.type.colour }));
      if (planet.type.ringed) {
        body.append(svg('ellipse', {
          cx: x.toFixed(1), cy: y.toFixed(1), rx: (r * 1.7).toFixed(2), ry: (r * 0.5).toFixed(2), class: 'planet-ring', stroke: planet.type.colour,
          transform: `rotate(-18 ${x.toFixed(1)} ${y.toFixed(1)})`,
        }));
      }
      body.append(
        svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: r.toFixed(2), fill: planet.type.colour }),
        svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: r.toFixed(2), fill: 'url(#planet-shine)' }),
      );
      bodies.append(body);
      reach = Math.max(reach, orbit);
      left = Math.min(left, host.x - orbit);
      right = Math.max(right, host.x + orbit);
    });
  });

  // Companion stars, over their rings. (The primary is the system's own star.)
  system.stars.forEach((star, k) => {
    if (k === 0) return;
    const at = hosts[k];
    const node = starCircle(star, at.x, at.y, radius(star), 'preview-star');
    const title = svg('title', {});
    title.textContent = `${system.name} ${starLetter(k)} · ${star.name}`;
    node.append(title);
    bodies.append(node);
    right = Math.max(right, at.x + radius(star));
  });

  back.append(svg('ellipse', {
    cx: ((left + right) / 2).toFixed(1), cy: system.y.toFixed(1), rx: ((right - left) / 2 + 8).toFixed(1), ry: (reach + 8).toFixed(1), class: 'preview-shadow',
  }));
  return { node: group, below: reach };
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
  /** How far past a zoom limit the wheel or buttons have pushed, as a factor. See zoomBy. */
  private overscroll = 1;
  private lastOverscroll = 0;

  /**
   * `world` is the size of the map in map units. `onZoomPast`, if given,
   * runs when zooming keeps pushing past the furthest-out or furthest-in
   * zoom, with the map point under the pointer.
   */
  constructor(
    private viewport: HTMLElement,
    private svg: SVGSVGElement,
    private camera: Camera,
    private onTap: (target: Element | null) => void,
    private onBack: () => void,
    private world: { width: number; height: number; maxZoom: number },
    private onZoomPast?: (direction: 'in' | 'out', point: Point) => void,
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

    // Already as far out (or in) as it goes: add up the extra, and once
    // it's a deliberate push rather than the tail of a scroll, hand over.
    const pinned = factor < 1 ? camera.zoom <= this.fitZoom() * 1.001 : factor > 1 && camera.zoom >= this.world.maxZoom * 0.999;
    if (pinned && this.onZoomPast) {
      const now = performance.now();
      if (now - this.lastOverscroll > OVERSCROLL_RESET_MS) this.overscroll = 1;
      this.lastOverscroll = now;
      this.overscroll *= factor;
      if (Math.abs(Math.log(this.overscroll)) >= Math.log(ZOOM_PAST)) {
        this.overscroll = 1;
        this.onZoomPast(factor < 1 ? 'out' : 'in', { x: pointX, y: pointY });
      }
      return;
    }
    this.overscroll = 1;

    const zoom = this.clampZoom(camera.zoom * factor);
    this.lookAt(pointX - offsetX / zoom, pointY - offsetY / zoom, zoom);
  }

  lookAt(x: number, y: number, zoom = this.camera.zoom): void {
    Object.assign(this.camera, { x, y, zoom: this.clampZoom(zoom) });
    this.apply();
  }

  fit(): void {
    this.lookAt(this.world.width / 2, this.world.height / 2, this.fitZoom());
  }

  /** Where a map point is on screen, in pixels from the viewport's top left. */
  toScreen(point: Point): Point {
    return {
      x: (point.x - this.camera.x) * this.camera.zoom + this.viewport.clientWidth / 2,
      y: (point.y - this.camera.y) * this.camera.zoom + this.viewport.clientHeight / 2,
    };
  }

  /** The zoom at which an area this many map units across and down just fits on screen. */
  zoomToFit(width: number, height: number): number {
    return Math.min(this.viewport.clientWidth / width, this.viewport.clientHeight / height);
  }

  /** The zoom at which the whole map just fits. Zooming out further would only show empty space. */
  fitZoom(): number {
    const { width: mapWidth, height: mapHeight } = this.world;
    const width = this.viewport.clientWidth || mapWidth;
    const height = this.viewport.clientHeight || mapHeight;
    return Math.min(width / mapWidth, height / mapHeight, 1);
  }

  private clampZoom(zoom: number): number {
    return Math.min(this.world.maxZoom, Math.max(this.fitZoom(), zoom));
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
    // Keep the view over the map. If the map is narrower than the view
    // along an axis, centre it on that axis instead.
    const [, , width, height] = this.viewBox();
    const clamp = (value: number, half: number, size: number) => (half * 2 >= size ? size / 2 : Math.min(size - half, Math.max(half, value)));
    camera.x = clamp(camera.x, width / 2, this.world.width);
    camera.y = clamp(camera.y, height / 2, this.world.height);
    this.svg.setAttribute('viewBox', this.viewBox().map((n) => n.toFixed(1)).join(' '));
    // For styles that change with zoom, like nation names fading out up close (style.css).
    this.svg.style.setProperty('--zoom', camera.zoom.toFixed(3));
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
  const root = svg('svg', { viewBox: `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`, role: 'img', class: 'starmap sector-map', tabindex: 0 });
  root.setAttribute('aria-label', `Star map with ${systems.length} systems. ${powers[0].name} is at ${systems[home].name}. Use the arrow keys to move and plus or minus to zoom.`);

  // Layers, back to front: dust, territories, lanes, stars.
  root.append(dust(seed));
  const claimed = owners.flatMap((owner, i) => (owner === null ? [] : [i]));
  const cells = territoryCells(systems, claimed, TERRITORY_RADIUS);
  const defs = svg('defs', {});
  // Shading laid over every planet in a system's miniature: a highlight at the top left
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
    // Companion stars sit just beside the primary, smaller. The system's
    // miniature draws them in their own places instead, so they hide when it's showing.
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
function dust(seed: string, width = MAP_WIDTH, height = MAP_HEIGHT, count = DUST_COUNT): SVGGElement {
  // A separate seed, so the dust doesn't change the systems' layout.
  const random = seededRandom(`${seed}/dust`);
  const group = svg('g', { class: 'dust', 'aria-hidden': 'true' });
  for (let i = 0; i < count; i++) {
    // Squaring makes most dust tiny, with a few brighter specks.
    const size = random() ** 2;
    group.append(svg('circle', {
      cx: (random() * width).toFixed(1),
      cy: (random() * height).toFixed(1),
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

// --- Region ---

/** Specks of stars in one sector's hexagon, at full density. */
const SECTOR_SPECKS = 70;

/**
 * The region: one hexagon per sector, speckled with stars, with its name in
 * the middle. Yours is outlined in amber, with your nation's name under its
 * own; the rest are uncharted.
 */
function drawRegion(region: GalacticRegion, map: GalaxyMap, seed: string): SVGSVGElement {
  const root = svg('svg', { viewBox: `0 0 ${REGION_WIDTH} ${REGION_HEIGHT}`, role: 'img', class: 'starmap region-map', tabindex: 0 });
  root.setAttribute('aria-label', `Map of the ${region.name} Region: ${region.sectors.length} sectors. ${map.sector.name}, yours, is the only one charted. Use the arrow keys to move and plus or minus to zoom.`);
  root.append(dust(`${seed}/region`, REGION_WIDTH, REGION_HEIGHT, 900));

  const random = seededRandom(`${seed}/region-specks`);
  let homeGroup: SVGGElement | null = null;
  region.sectors.forEach((sector, i) => {
    const isHome = i === region.home;
    const group = svg('g', { class: isHome ? 'sector home' : 'sector', tabindex: 0, 'data-sector': i });
    const title = svg('title', {});
    title.textContent = isHome ? `${sector.name} Sector (yours)` : `${sector.name} Sector (uncharted)`;
    const corners = hexCorners(sector).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    group.append(title, svg('polygon', { points: corners, class: 'sector-cell' }));

    // Stars scattered inside the hexagon's inner circle, thicker towards the middle.
    const specks = svg('g', { class: 'sector-specks', 'aria-hidden': 'true' });
    const count = Math.round(SECTOR_SPECKS * sector.density);
    for (let k = 0; k < count; k++) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * SECTOR_RADIUS * 0.78;
      const size = random() ** 2;
      specks.append(svg('circle', {
        cx: (sector.x + Math.cos(angle) * distance).toFixed(1),
        cy: (sector.y + Math.sin(angle) * distance).toFixed(1),
        r: (0.8 + size * 1.8).toFixed(2),
        opacity: (0.25 + size * 0.5).toFixed(2),
      }));
    }
    group.append(specks);

    const label = svg('text', { x: sector.x.toFixed(1), y: sector.y.toFixed(1), class: 'sector-name', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    label.textContent = sector.name;
    group.append(label);
    if (isHome) {
      const note = svg('text', { x: sector.x.toFixed(1), y: (sector.y + 24).toFixed(1), class: 'sector-note', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      note.textContent = map.powers[0].name;
      group.append(note);
      homeGroup = group;
    } else {
      root.append(group);
    }
  });
  // Yours goes last, so no neighbour's edge is drawn over its amber outline.
  if (homeGroup) root.append(homeGroup);
  return root;
}

/** What's known about a sector picked in the region. */
function sectorPanel(region: GalacticRegion, map: GalaxyMap, index: number, close: () => void, open: () => void): HTMLElement[] {
  const sector = region.sectors[index];
  const part = el('section', 'map-info-section');
  part.append(el('p', 'eyebrow', 'Sector'), el('h3', 'map-info-title', sector.name));
  if (index === region.home) {
    part.append(el('p', 'muted', `${map.constellations.length} constellations · ${map.systems.length} systems · home of ${map.powers[0].name}`));
    const button = el('button', 'secondary small', 'Open star map');
    button.addEventListener('click', open);
    part.append(button);
  } else {
    part.append(el('p', 'muted', `Uncharted. Stellar cartography hasn't reached the ${sector.name} Sector yet.`));
  }
  return [closeButton(close), part];
}

// --- Galaxy ---

/** Stars in the spiral arms, the haze between them, and the core's glow. Decoration only. */
const GALAXY_STARS = { arms: 4200, haze: 700, core: 800 };
const GALAXY_ARMS = 4;
/** How tightly the arms wind: the angle gained as the radius grows by a factor of e. */
const ARM_WINDING = 2.4;

/**
 * The galaxy: a spiral of stars, with the regions laid over it as wedges in
 * rings around the core. Yours is outlined in amber; the rest are unsurveyed.
 */
function drawGalaxy(galaxy: Galaxy, region: GalacticRegion, seed: string): SVGSVGElement {
  const root = svg('svg', { viewBox: `0 0 ${GALAXY_SIZE} ${GALAXY_SIZE}`, role: 'img', class: 'starmap galaxy-map', tabindex: 0 });
  root.setAttribute('aria-label', `Map of the ${galaxy.name} Galaxy: ${galaxy.regions.length} regions around its core. ${region.name}, yours, is the only one surveyed. Use the arrow keys to move and plus or minus to zoom.`);
  root.append(dust(`${seed}/galaxy`, GALAXY_SIZE, GALAXY_SIZE, 500));

  const defs = svg('defs', {});
  const glow = svg('radialGradient', { id: `core-glow-${seed}` });
  glow.append(
    svg('stop', { offset: '0%', 'stop-color': '#fff1c4', 'stop-opacity': 0.55 }),
    svg('stop', { offset: '35%', 'stop-color': '#ffcf8f', 'stop-opacity': 0.18 }),
    svg('stop', { offset: '100%', 'stop-color': '#ffcf8f', 'stop-opacity': 0 }),
  );
  defs.append(glow);
  root.append(defs, svg('circle', { cx: GALAXY_CENTRE, cy: GALAXY_CENTRE, r: CORE_RADIUS * 2.2, fill: `url(#core-glow-${seed})`, class: 'galaxy-glow' }));

  // Stars along logarithmic spiral arms, scattered more the further out
  // they are, plus a faint haze over the whole disc and a dense core. A
  // soft, blurred band under each arm makes the spiral read at a glance.
  const random = seededRandom(`${seed}/galaxy-stars`);
  const armAngle = (arm: number, r: number) => galaxy.twist + (arm * Math.PI * 2) / GALAXY_ARMS + Math.log(r / CORE_RADIUS) * ARM_WINDING;
  const blur = svg('filter', { id: `arm-blur-${seed}`, x: '-20%', y: '-20%', width: '140%', height: '140%' });
  blur.append(svg('feGaussianBlur', { stdDeviation: 22 }));
  defs.append(blur);
  const bands = svg('g', { class: 'galaxy-arms', filter: `url(#arm-blur-${seed})`, 'aria-hidden': 'true' });
  for (let arm = 0; arm < GALAXY_ARMS; arm++) {
    const points: string[] = [];
    for (let r = CORE_RADIUS * 0.7; r <= GALAXY_RADIUS * 0.97; r += 10) {
      const a = armAngle(arm, r);
      points.push(`${(GALAXY_CENTRE + Math.cos(a) * r).toFixed(1)},${(GALAXY_CENTRE + Math.sin(a) * r).toFixed(1)}`);
    }
    bands.append(svg('polyline', { points: points.join(' ') }));
  }
  root.append(bands);
  const stars = svg('g', { class: 'galaxy-stars', 'aria-hidden': 'true' });
  const star = (x: number, y: number, warmth: number) => {
    const size = random() ** 2;
    stars.append(svg('circle', {
      cx: x.toFixed(1), cy: y.toFixed(1), r: (0.6 + size * 1.6).toFixed(2), opacity: (0.2 + size * 0.55).toFixed(2),
      // Old yellow stars in the middle, young blue ones in the arms.
      fill: warmth > 0.5 ? '#ffe3b8' : '#b9cdf0',
    }));
  };
  for (let i = 0; i < GALAXY_STARS.arms; i++) {
    const arm = i % GALAXY_ARMS;
    const t = random();
    const r = CORE_RADIUS * 0.6 + t * (GALAXY_RADIUS - CORE_RADIUS * 0.4);
    const angle = armAngle(arm, r);
    // Bunched towards the arm's spine: the average of two rolls is more often near the middle.
    const spread = 14 + t * 40;
    const along = (random() + random() - 1) * 0.12;
    star(
      GALAXY_CENTRE + Math.cos(angle + along) * r + (random() + random() - 1) * spread,
      GALAXY_CENTRE + Math.sin(angle + along) * r + (random() + random() - 1) * spread,
      random() * (1 - t),
    );
  }
  for (let i = 0; i < GALAXY_STARS.haze; i++) {
    const r = Math.sqrt(random()) * GALAXY_RADIUS;
    const angle = random() * Math.PI * 2;
    star(GALAXY_CENTRE + Math.cos(angle) * r, GALAXY_CENTRE + Math.sin(angle) * r, random() * (1 - r / GALAXY_RADIUS));
  }
  for (let i = 0; i < GALAXY_STARS.core; i++) {
    // Squaring piles them up in the middle.
    const r = random() ** 2 * CORE_RADIUS * 1.3;
    const angle = random() * Math.PI * 2;
    star(GALAXY_CENTRE + Math.cos(angle) * r, GALAXY_CENTRE + Math.sin(angle) * r, 1);
  }
  root.append(stars);

  const core = svg('text', { x: GALAXY_CENTRE, y: GALAXY_CENTRE, class: 'galaxy-core-name', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
  core.textContent = 'Galactic Core';
  root.append(core);

  let homeGroup: SVGGElement | null = null;
  galaxy.regions.forEach((part, i) => {
    const isHome = i === galaxy.home;
    const group = svg('g', { class: isHome ? 'galaxy-region home' : 'galaxy-region', tabindex: 0, 'data-region': i });
    const title = svg('title', {});
    title.textContent = isHome ? `${part.name} Region (yours)` : `${part.name} Region (unsurveyed)`;
    group.append(title, svg('path', { d: wedgePath(part), class: 'region-cell' }));

    // Fit the name to the wedge's width at its middle.
    const width = ((part.end - part.start) * (part.inner + part.outer)) / 2;
    const size = Math.min(isHome ? 22 : 18, (width * 0.85) / (part.name.length * 0.75));
    const label = svg('text', {
      x: part.x.toFixed(1), y: part.y.toFixed(1), class: 'region-name', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': size.toFixed(1),
    });
    label.textContent = part.name;
    group.append(label);
    if (isHome) {
      const note = svg('text', { x: part.x.toFixed(1), y: (part.y + size + 4).toFixed(1), class: 'region-note', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      note.textContent = 'You are here';
      group.append(note);
      homeGroup = group;
    } else {
      root.append(group);
    }
  });
  // Yours goes last, so no neighbour's edge is drawn over its amber outline.
  if (homeGroup) root.append(homeGroup);
  return root;
}

/** What's known about a region picked in the galaxy. */
function regionPanel(galaxy: Galaxy, region: GalacticRegion, map: GalaxyMap, index: number, close: () => void, open: () => void): HTMLElement[] {
  const part = galaxy.regions[index];
  const section = el('section', 'map-info-section');
  section.append(el('p', 'eyebrow', 'Region'), el('h3', 'map-info-title', part.name));
  if (index === galaxy.home) {
    section.append(el('p', 'muted', `${region.sectors.length} sectors · 1 charted (${map.sector.name}) · home of ${map.powers[0].name}`));
    const button = el('button', 'secondary small', 'Open region');
    button.addEventListener('click', open);
    section.append(button);
  } else {
    section.append(el('p', 'muted', `Unsurveyed. No expedition has reached the ${part.name} Region yet.`));
  }
  return [closeButton(close), section];
}

// --- System diagram ---

/**
 * Laying out a system's diagram, in diagram units. Stars and planets are
 * drawn this many times their size on the star map. Planet orbits fill the
 * space from `firstGap` past the stars out to `outerOrbit`, evenly spaced:
 * the diagram shows order, not real distances. Moons circle their planet
 * `moonGap` past its edge, each `moonStep` further out.
 */
const DIAGRAM = { starScale: 7, planetScale: 3.2, firstGap: 80, outerOrbit: 480, moonGap: 9, moonStep: 7, moonRadius: 2.4 };
/**
 * Hyperlanes leaving the diagram, in diagram units past the outermost
 * orbit: where each starts and ends, and where the name of the system it
 * leads to goes.
 */
const LANE_OUT = { start: 24, end: 150, label: 166 };
/** How long moons take to go round, in seconds: the innermost, plus this much more for each one further out. */
const MOON_PERIOD = { first: 14, step: 9 };

/** The system with a star within `within` map units of this point, nearest first, or null. */
function systemNear(map: GalaxyMap, point: Point, within: number): number | null {
  let best: number | null = null;
  let bestDistance = within;
  map.systems.forEach((system, i) => {
    const d = Math.hypot(system.x - point.x, system.y - point.y);
    if (d <= bestDistance) [best, bestDistance] = [i, d];
  });
  return best;
}

/** Stars in a system are lettered, the primary being A. */
function starLetter(k: number): string {
  return String.fromCharCode(65 + k);
}

/**
 * Each planet's name. Planets around the whole system are numbered outwards
 * after it ("Kessra II"); in a wide system, each star's planets are numbered
 * after that star ("Kessra B II").
 */
function planetNames(system: StarSystem, planets: Planet[]): string[] {
  const counts = new Map<number | null, number>();
  return planets.map((planet) => {
    const n = (counts.get(planet.host) ?? 0) + 1;
    counts.set(planet.host, n);
    return planet.host === null ? `${system.name} ${roman(n)}` : `${system.name} ${starLetter(planet.host)} ${roman(n)}`;
  });
}

/**
 * In a wide system, each star's own orbits, in diagram units: the first
 * this far past the star's edge, the rest this far apart. Stars sit `gap`
 * apart, edge of orbits to edge of orbits.
 */
const WIDE = { firstGap: 62, step: 56, gap: 60 };
/** Room under a planet for its name and type, in diagram units. */
const LABEL_ROOM = 34;

/**
 * A top-down diagram of one system. In a close system the stars huddle in
 * the middle and every planet circles all of them, each on its own orbit,
 * innermost first. In a wide system each star has its own planets: the
 * stars sit side by side, each with its own set of orbits, like small
 * systems of their own. Moons circle their planets slowly. Every body shows
 * its name on hover; planets are labelled with their name and type.
 *
 * Returns the drawing and how far it reaches from the centre across and
 * down, for framing it.
 */
function systemDiagram(map: GalaxyMap, index: number, planets: Planet[], seed: string): { parts: SVGElement[]; reach: { x: number; y: number } } {
  const system = map.systems[index];
  const centre = SYSTEM_SIZE / 2;
  const names = planetNames(system, planets);
  const defs = svg('defs', {});
  // The same round shading as the star map's miniature, defined here because a
  // gradient inside a hidden map (the star map, while this shows) won't draw.
  const shineId = `diagram-shine-${seed}`;
  const shine = svg('radialGradient', { id: shineId, cx: 0.35, cy: 0.32, r: 0.8 });
  shine.append(
    svg('stop', { offset: 0, 'stop-color': '#ffffff', 'stop-opacity': 0.55 }),
    svg('stop', { offset: 0.4, 'stop-color': '#ffffff', 'stop-opacity': 0 }),
    svg('stop', { offset: 0.7, 'stop-color': '#000000', 'stop-opacity': 0.1 }),
    svg('stop', { offset: 1, 'stop-color': '#000000', 'stop-opacity': 0.55 }),
  );
  defs.append(shine);
  const back = svg('g', { class: 'diagram-orbits' });
  const front = svg('g', { class: 'diagram-bodies' });
  const random = seededRandom(`${seed}/orbits/${index}`);
  const radius = (star: StarType) => star.radius * DIAGRAM.starScale;
  /** How far a planet's moons and label reach past its orbit. */
  const planetReach = (planet: Planet) => planet.type.radius * DIAGRAM.planetScale
    + (planet.moons.length > 0 ? DIAGRAM.moonGap + (planet.moons.length - 1) * DIAGRAM.moonStep : 0);

  const drawStar = (star: StarType, k: number, x: number, y: number) => {
    const r = radius(star);
    // A soft glow in the star's own colour.
    const haloId = `diagram-halo-${seed}-${k}`;
    const halo = svg('radialGradient', { id: haloId });
    halo.append(
      svg('stop', { offset: 0, 'stop-color': star.exotic === 'black-hole' ? ACCRETION_COLOUR : star.colour, 'stop-opacity': 0.35 }),
      svg('stop', { offset: 1, 'stop-color': star.colour, 'stop-opacity': 0 }),
    );
    defs.append(halo);
    back.append(svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: (r * 3.2).toFixed(1), fill: `url(#${haloId})`, class: 'diagram-halo' }));
    const node = starCircle(star, x, y, r, 'diagram-star');
    const title = svg('title', {});
    title.textContent = `${system.name}${system.stars.length > 1 ? ` ${starLetter(k)}` : ''} · ${star.name}`;
    node.append(title);
    front.append(node);
  };

  /** A planet on an orbit of radius `orbit` around (cx, cy), at a random spot on it. */
  const drawPlanet = (k: number, cx: number, cy: number, orbit: number) => {
    const planet = planets[k];
    const { type } = planet;
    back.append(svg('circle', { cx: cx.toFixed(1), cy: cy.toFixed(1), r: orbit.toFixed(1), class: 'diagram-orbit' }));
    const angle = random() * Math.PI * 2;
    const x = cx + Math.cos(angle) * orbit;
    const y = cy + Math.sin(angle) * orbit;
    const r = type.radius * DIAGRAM.planetScale;
    const name = names[k];
    const group = svg('g', { class: 'diagram-planet' });

    // Moons, each on its own ring, going round at its own pace. A negative
    // delay starts each one partway round, so they don't all line up.
    planet.moons.forEach((moon, m) => {
      const ring = r + DIAGRAM.moonGap + m * DIAGRAM.moonStep;
      group.append(svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: ring.toFixed(1), class: 'diagram-moon-orbit' }));
      const period = MOON_PERIOD.first + m * MOON_PERIOD.step;
      const spin = svg('g', {
        class: 'moon-spin',
        style: `transform-origin: ${x.toFixed(1)}px ${y.toFixed(1)}px; animation-duration: ${period}s; animation-delay: -${(random() * period).toFixed(1)}s`,
      });
      const node = svg('circle', { cx: (x + ring).toFixed(1), cy: y.toFixed(1), r: DIAGRAM.moonRadius, fill: moon.colour, class: 'moon' });
      const title = svg('title', {});
      // Moons are lettered outwards from their planet: a, b, c...
      title.textContent = `${name}-${String.fromCharCode(97 + m)} · ${moon.name}`;
      node.append(title);
      spin.append(node);
      group.append(spin);
    });

    const body = svg('g', { class: 'diagram-planet-body' });
    const title = svg('title', {});
    title.textContent = `${name} · ${type.name}${planet.moons.length > 0 ? ` · ${planet.moons.length} moon${planet.moons.length === 1 ? '' : 's'}` : ''}`;
    body.append(title);
    const px = x.toFixed(1);
    const py = y.toFixed(1);
    if (type.ringed) {
      body.append(svg('ellipse', { cx: px, cy: py, rx: (r * 1.7).toFixed(1), ry: (r * 0.5).toFixed(1), class: 'planet-ring', stroke: type.colour, transform: `rotate(-18 ${px} ${py})` }));
    }
    body.append(
      svg('circle', { cx: px, cy: py, r: r.toFixed(1), fill: type.colour }),
      svg('circle', { cx: px, cy: py, r: r.toFixed(1), fill: `url(#${shineId})` }),
    );
    group.append(body);

    // Name and type under the planet, clear of its moons.
    const below = y + planetReach(planet) + 16;
    const label = svg('text', { x: px, y: below.toFixed(1), class: 'diagram-label', 'text-anchor': 'middle' });
    label.textContent = name;
    const kind = svg('text', { x: px, y: (below + 14).toFixed(1), class: 'diagram-sublabel', 'text-anchor': 'middle' });
    kind.textContent = type.name;
    group.append(label, kind);
    front.append(group);
  };

  // Star names go above their stars: planets' names go below the planets,
  // and an inner planet's would land on a star's name there.
  const starLabel = (text: string, x: number, y: number) => {
    const label = svg('text', { x: x.toFixed(1), y: y.toFixed(1), class: 'diagram-label diagram-star-label', 'text-anchor': 'middle' });
    label.textContent = text;
    front.append(label);
  };

  let reach: { x: number; y: number };
  const wide = planets.some((p) => p.host !== null);
  if (!wide) {
    // Close: the primary in the middle, companions spaced around it, and
    // every planet circling the lot on evenly spaced orbits.
    const [primary, ...companions] = system.stars;
    const stars = [{ x: centre, y: centre }];
    companions.forEach((star, k) => {
      const angle = -Math.PI / 4 + (k * Math.PI * 2) / companions.length;
      const distance = radius(primary) + radius(star) + 18;
      stars.push({ x: centre + Math.cos(angle) * distance, y: centre + Math.sin(angle) * distance });
    });
    const starReach = Math.max(...system.stars.map((star, k) => Math.hypot(stars[k].x - centre, stars[k].y - centre) + radius(star)));
    if (companions.length > 0) {
      back.append(svg('circle', { cx: centre, cy: centre, r: Math.hypot(stars[1].x - centre, stars[1].y - centre).toFixed(1), class: 'diagram-orbit companion-orbit' }));
    }
    system.stars.forEach((star, k) => drawStar(star, k, stars[k].x, stars[k].y));

    const first = starReach + DIAGRAM.firstGap;
    const step = planets.length > 1 ? (DIAGRAM.outerOrbit - first) / (planets.length - 1) : 0;
    const orbitOf = (k: number) => (planets.length === 1 ? first + 60 : first + step * k);
    planets.forEach((_, k) => drawPlanet(k, centre, centre, orbitOf(k)));
    starLabel(system.name, centre, centre - starReach - 16);
    const outer = planets.length === 0 ? starReach : orbitOf(planets.length - 1) + 20;
    reach = { x: outer, y: outer };
  } else {
    // Wide: each star with its own planets, side by side, in letter order.
    // Each star's orbits are sized to its planets, not stretched to fill.
    const groups = system.stars.map((star, k) => {
      const own = planets.flatMap((p, i) => (p.host === k ? [i] : []));
      const orbits = own.map((_, j) => radius(star) + WIDE.firstGap + j * WIDE.step);
      const last = own.length > 0 ? orbits[orbits.length - 1] + planetReach(planets[own[own.length - 1]]) : radius(star);
      return { star, own, orbits, extent: last + LABEL_ROOM };
    });
    const total = groups.reduce((sum, g) => sum + 2 * g.extent, 0) + WIDE.gap * (groups.length - 1);
    let left = centre - total / 2;
    // The stars' path around each other: a dashed line through their middles.
    const xs = groups.map((g) => {
      const x = left + g.extent;
      left += 2 * g.extent + WIDE.gap;
      return x;
    });
    back.append(svg('line', { x1: xs[0].toFixed(1), y1: centre, x2: xs[xs.length - 1].toFixed(1), y2: centre, class: 'diagram-orbit companion-orbit' }));
    groups.forEach((g, k) => {
      drawStar(g.star, k, xs[k], centre);
      g.own.forEach((i, j) => drawPlanet(i, xs[k], centre, g.orbits[j]));
      starLabel(`${system.name} ${starLetter(k)}`, xs[k], centre - radius(g.star) - 16);
    });
    reach = { x: total / 2, y: Math.max(...groups.map((g) => g.extent)) };
  }

  // Hyperlanes heading off past the planets, each pointing the way its
  // system really lies on the star map, dashed and flowing outwards like a
  // focused system's lanes there. Lanes into another constellation say so.
  for (const n of connections(map, index)) {
    const other = map.systems[n];
    const angle = Math.atan2(other.y - system.y, other.x - system.x);
    // Start where the lane leaves the box around everything drawn.
    const edge = Math.min(reach.x / Math.max(Math.abs(Math.cos(angle)), 1e-6), reach.y / Math.max(Math.abs(Math.sin(angle)), 1e-6));
    const at = (r: number) => ({ x: (centre + Math.cos(angle) * r).toFixed(1), y: (centre + Math.sin(angle) * r).toFixed(1) });
    const from = at(edge + LANE_OUT.start);
    const to = at(edge + LANE_OUT.end);
    const group = svg('g', { class: 'diagram-lane', 'data-system': n, tabindex: 0 });
    const title = svg('title', {});
    title.textContent = `Hyperlane to ${other.name}`;
    group.append(
      title,
      svg('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: 'lane lit-lane exit-lane' }),
      // A wide, invisible line over it, so it's easy to click.
      svg('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: 'diagram-lane-hit' }),
    );
    // The name reads outwards from the lane's end: left-aligned on the right, right-aligned on the left.
    const place = at(edge + LANE_OUT.label);
    const anchor = Math.abs(Math.cos(angle)) < 0.3 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end';
    const name = svg('text', { x: place.x, y: place.y, class: 'diagram-lane-name', 'text-anchor': anchor, 'dominant-baseline': 'central' });
    name.textContent = other.name;
    group.append(name);
    if (other.constellation !== system.constellation) {
      const where = svg('text', { x: place.x, y: (Number(place.y) + 14).toFixed(1), class: 'diagram-sublabel', 'text-anchor': anchor, 'dominant-baseline': 'central' });
      where.textContent = `to ${map.constellations[other.constellation].name}`;
      group.append(where);
    }
    back.append(group);
  }
  return { parts: [defs, back, front], reach };
}

/** The open system's stars and planets, listed for the panel beside its diagram. */
function bodiesSection(map: GalaxyMap, index: number, planets: Planet[]): HTMLElement {
  const system = map.systems[index];
  const names = planetNames(system, planets);
  const section = el('section', 'map-info-section');
  const list = el('ul', 'map-info-systems');
  const row = (colour: string, name: string, note: string) => {
    const item = el('li');
    const dot = el('span', 'body-swatch');
    dot.style.background = colour;
    item.append(dot, el('span', '', name), el('span', 'muted', note));
    list.append(item);
  };
  system.stars.forEach((star, k) => {
    row(star.exotic === 'black-hole' ? ACCRETION_COLOUR : star.colour, system.stars.length > 1 ? `${system.name} ${starLetter(k)}` : system.name, star.name);
  });
  // Each star's planets together, A's first; within a star, innermost first.
  const order = planets.map((_, k) => k).sort((a, b) => (planets[a].host ?? -1) - (planets[b].host ?? -1) || a - b);
  for (const k of order) {
    const moons = planets[k].moons.length;
    row(planets[k].type.colour, names[k], `${planets[k].type.name}${moons > 0 ? ` · ${moons} moon${moons === 1 ? '' : 's'}` : ''}`);
  }
  const wide = planets.some((p) => p.host !== null);
  section.append(el('p', 'stat-label map-info-subhead', 'Bodies'));
  if (system.stars.length > 1) {
    section.append(el('p', 'muted', wide ? 'A wide system: each star has planets of its own.' : 'A close system: its planets circle all its stars together.'));
  }
  section.append(list);
  return section;
}
