import './home.css';
import { MAP_HEIGHT, MAP_WIDTH, type GalaxyMap } from '../ui/map/generate';
import { drawSector, showcaseMap, svg } from './sectorArt';
import { drawSystem, showcaseSystems } from './systemArt';

// The homepage (index.html). The game itself lives at /play/. This draws
// the hero's star map, the Chart pillar's close-up and the system view
// gallery from a real generated sector (sectorArt.ts, systemArt.ts), and
// wires up the menu and the placeholder newsletter.

function drawHero(map: GalaxyMap): void {
  const host = document.querySelector('.hero-map');
  if (!host) return;
  host.append(drawSector(map, `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`));

  const set = (key: string, text: string) => {
    const node = document.querySelector(`[data-hud="${key}"]`);
    if (node) node.textContent = text;
  };
  set('sector', `${map.sector.name} Cluster`);
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

/** The system view gallery: a few of the showcase sector's systems, as the game draws them. */
function drawGallery(map: GalaxyMap): void {
  const host = document.querySelector('[data-system-gallery]');
  if (!host) return;
  for (const shown of showcaseSystems(map)) {
    const system = map.systems[shown.index];
    const moons = shown.planets.reduce((sum, p) => sum + p.moons.length, 0);
    const card = document.createElement('figure');
    card.className = 'system-card';
    const frame = document.createElement('div');
    frame.className = 'system-frame';
    frame.append(drawSystem(map, shown));
    const caption = document.createElement('figcaption');
    const kind = document.createElement('span');
    kind.className = 'system-kind';
    kind.textContent = system.stars.map((s) => s.name).join(' + ');
    const name = document.createElement('span');
    name.className = 'system-name';
    name.textContent = system.name;
    const facts = document.createElement('span');
    facts.className = 'system-facts';
    const parts = [`${shown.planets.length} planet${shown.planets.length === 1 ? '' : 's'}`, `${moons} moon${moons === 1 ? '' : 's'}`];
    if (shown.belt) parts.push('an asteroid belt');
    facts.textContent = parts.join(' · ');
    caption.append(kind, name, facts);
    card.append(frame, caption);
    host.append(card);
  }
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

/** PLACEHOLDER: buttons for what isn't built yet explain they're coming instead of doing anything. */
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

const map = showcaseMap();
drawHero(map);
drawCrop(map);
drawGallery(map);
wireMenu();
wirePlaceholders();
