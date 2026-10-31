import './home.css';
import { generateMap, MAP_HEIGHT, MAP_WIDTH, type GalaxyMap, type StarType } from '../ui/map/generate';
import type { Nation } from '../types';

// The homepage (index.html). The game itself lives at /play/. This draws
// the hero's star map and the Chart pillar's close-up from a real generated
// sector, and wires up the menu and the placeholder sign-in and newsletter.

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The homepage always shows the same sector. Only these fields matter to the map generator. */
const SHOWCASE = { id: 'starflower-homepage', name: 'Starflower', prefix: 'Union', claimedSystems: [] } as unknown as Nation;
/** The glow of a black hole's accretion disc, as in the game. */
const ACCRETION = '#ffb36b';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function star(type: StarType, x: number, y: number, scale: number): SVGCircleElement {
  const black = type.exotic === 'black-hole';
  return svg('circle', {
    cx: x.toFixed(1), cy: y.toFixed(1), r: (type.radius * scale).toFixed(2),
    fill: type.colour, stroke: black ? ACCRETION : 'none', 'stroke-width': black ? 1 : 0,
    class: 'map-star', style: `--star: ${black ? ACCRETION : type.colour}`,
  });
}

/** Lanes and stars of a map, inside a viewBox. `lit` systems (and lanes between them) are highlighted. */
function drawSector(map: GalaxyMap, viewBox: string, lit = new Set<number>(), scale = 1): SVGSVGElement {
  const root = svg('svg', { viewBox, preserveAspectRatio: 'xMidYMid slice', class: 'sector-art' });
  const lanes = svg('g', { class: 'map-lanes' });
  for (const [a, b] of map.lanes) {
    const p = map.systems[a];
    const q = map.systems[b];
    lanes.append(svg('line', {
      x1: p.x.toFixed(1), y1: p.y.toFixed(1), x2: q.x.toFixed(1), y2: q.y.toFixed(1),
      class: lit.has(a) && lit.has(b) ? 'map-lane lit' : 'map-lane',
    }));
  }
  const stars = svg('g', { class: 'map-stars' });
  map.systems.forEach((system, i) => {
    const node = star(system.stars[0], system.x, system.y, scale);
    if (lit.has(i)) node.classList.add('lit');
    // A gentle, staggered twinkle on some stars (home.css).
    if (i % 7 === 0) node.style.animationDelay = `${(i % 13) * 0.6}s`;
    if (i % 7 === 0) node.classList.add('twinkle');
    stars.append(node);
  });
  root.append(lanes, stars);
  return root;
}

function drawHero(map: GalaxyMap): void {
  const host = document.querySelector('.hero-map');
  if (!host) return;
  host.append(drawSector(map, `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`));

  const set = (key: string, text: string) => {
    const node = document.querySelector(`[data-hud="${key}"]`);
    if (node) node.textContent = text;
  };
  set('sector', `${map.sector.name} Sector`);
  set('systems', `${map.systems.length} systems · ${map.constellations.length} constellations`);
  // A made-up but steady sky position, from the sector's name.
  const code = [...map.sector.name].reduce((sum, c) => sum + c.charCodeAt(0), 0);
  set('coords', `RA ${String(code % 24).padStart(2, '0')}h ${String(code % 60).padStart(2, '0')}m · DEC ${code % 2 ? '+' : '−'}${String(code % 90).padStart(2, '0')}°`);
}

/** The Chart pillar: a close-up of the biggest constellation, lit as if selected, with its name. */
function drawCrop(map: GalaxyMap): void {
  const host = document.querySelector('[data-map-crop]');
  if (!host) return;
  const index = map.constellations.reduce((best, c, i) => (c.systems.length > map.constellations[best].systems.length ? i : best), 0);
  const members = map.constellations[index].systems;
  const xs = members.map((i) => map.systems[i].x);
  const ys = members.map((i) => map.systems[i].y);
  const pad = 70;
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  // A 4:3 frame round the constellation, with room around it.
  const w = Math.max(Math.max(...xs) - Math.min(...xs) + 2 * pad, ((Math.max(...ys) - Math.min(...ys) + 2 * pad) * 4) / 3);
  const h = (w * 3) / 4;
  const art = drawSector(map, `${(cx - w / 2).toFixed(0)} ${(cy - h / 2).toFixed(0)} ${w.toFixed(0)} ${h.toFixed(0)}`, new Set(members), 1.3);
  art.classList.add('crop');
  const name = svg('text', { x: cx.toFixed(1), y: (cy - h / 2 + 34).toFixed(1), 'text-anchor': 'middle', class: 'map-name' });
  name.textContent = map.constellations[index].name;
  art.append(name);
  host.append(art);
}

/** The small-screen menu. */
function wireMenu(): void {
  const toggle = document.querySelector<HTMLButtonElement>('.menu-toggle');
  const nav = document.getElementById('site-nav');
  if (!toggle || !nav) return;
  const set = (open: boolean) => {
    toggle.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('open', open);
  };
  toggle.addEventListener('click', () => set(toggle.getAttribute('aria-expanded') !== 'true'));
  // Following a link closes it.
  nav.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a')) set(false);
  });
}

/** PLACEHOLDER: sign-in and account buttons explain they're coming instead of doing anything. */
function wirePlaceholders(): void {
  const toast = document.querySelector<HTMLElement>('.toast');
  let timer = 0;
  document.querySelectorAll<HTMLElement>('[data-coming-soon]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!toast) return;
      toast.textContent = button.dataset.comingSoon ?? 'Coming soon.';
      toast.hidden = false;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => (toast.hidden = true), 4000);
    });
  });

  // PLACEHOLDER: the newsletter form sends nothing yet.
  const form = document.querySelector<HTMLFormElement>('.newsletter-form');
  const note = document.querySelector<HTMLElement>('[data-form-note]');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!note) return;
    note.textContent = "Thanks! Sign-ups aren't open yet, so nothing was sent. Check back soon.";
    note.classList.add('emphasis');
  });
}

const map = generateMap(SHOWCASE);
drawHero(map);
drawCrop(map);
wireMenu();
wirePlaceholders();
