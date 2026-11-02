import type { Random } from '../../engine/random';
import type { MoonType, PlanetType, StarType } from './generate';

// How stars, planets, moons and asteroids are drawn, in SVG. Shading and
// glows are gradients, made once per drawing by a Paints (see below).
//
// - On the sector map a star is a white-hot core melting into a glow in
//   its own color, like a star in a photograph. A neutron star throws two
//   beams; a black hole is a dark disc in its tilted ring of light.
// - In the system diagram a star is a disc with a hot center and a darker
//   edge, mottled by its boiling surface. Brown dwarfs are banded like gas
//   giants, neutron stars throw two beams, and a black hole sits in a
//   tilted accretion disc.
// - Planets have a surface for their type (craters, cloud bands, continents,
//   lava...), lit from the side facing their star. The same planet looks
//   the same in the miniature and the diagram, since its details come from
//   a random stream of its own.

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The glow of a black hole's accretion disc. Keep in step with .star.black-hole in style.css. */
export const ACCRETION_COLOUR = '#ffb36b';
const EVENT_HORIZON = '#05060a';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/** A number for an SVG attribute: two decimals is plenty. */
const f = (n: number) => n.toFixed(2);

// --- Colors ---

function rgb(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `a` blended `t` of the way towards `b`. */
function mix(a: string, b: string, t: number): string {
  const p = rgb(a);
  const q = rgb(b);
  return `#${p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
const lighten = (colour: string, t: number) => mix(colour, '#ffffff', t);
const darken = (colour: string, t: number) => mix(colour, '#000000', t);

// --- Paints: one drawing's gradients and clip paths ---

type Stop = [offset: number, colour: string, opacity: number];

/**
 * The gradients one drawing (one <svg>, or a part of one) shares, added to
 * its <defs> the first time each is asked for. `prefix` keeps their ids
 * apart from another drawing's on the same page.
 */
export class Paints {
  private made = new Set<string>();

  constructor(readonly defs: SVGElement, readonly prefix: string) {}

  /** An id unique to this drawing, for a one-off clip path. */
  id(name: string): string {
    return `${this.prefix}-${name}`;
  }

  /** A clip path to a circle, for drawing a body's surface details inside it. */
  clipCircle(name: string, x: number, y: number, r: number): string {
    const id = this.id(`clip-${name}`);
    const clip = svg('clipPath', { id });
    clip.append(svg('circle', { cx: f(x), cy: f(y), r: f(r) }));
    this.defs.append(clip);
    return `url(#${id})`;
  }

  private radial(name: string, stops: Stop[], attrs: Record<string, string | number> = {}): string {
    const id = this.id(name);
    if (!this.made.has(id)) {
      this.made.add(id);
      const gradient = svg('radialGradient', { id, ...attrs });
      for (const [offset, colour, opacity] of stops) gradient.append(svg('stop', { offset, 'stop-color': colour, 'stop-opacity': opacity }));
      this.defs.append(gradient);
    }
    return `url(#${id})`;
  }

  /**
   * A star's glow on the map, like light bleeding round a star in a
   * photograph: bright and tinted close in, falling away fast, then a long,
   * faint tail (roughly one over the distance squared) rather than an even fade.
   */
  glow(star: StarType): string {
    const c = star.exotic === 'black-hole' ? ACCRETION_COLOUR : star.colour;
    const s = star.substellar ? 0.5 : 1;
    return this.radial(`glow-${slug(star)}`, [
      [0, lighten(c, 0.35), 0.8 * s], [0.12, c, 0.5 * s], [0.25, c, 0.2 * s], [0.45, c, 0.07 * s], [0.7, c, 0.02 * s], [1, c, 0],
    ]);
  }

  /**
   * A star's core on the map. Like a photographed star, it's burnt out to
   * white across most of its middle, its color showing only towards the
   * rim, and it has no hard edge: it melts into its glow. Brown dwarfs are
   * too cool to burn white.
   */
  core(star: StarType): string {
    const c = star.colour;
    return star.substellar
      ? this.radial(`core-${slug(star)}`, [[0, lighten(c, 0.3), 1], [0.6, c, 0.9], [1, c, 0]])
      : this.radial(`core-${slug(star)}`, [[0, '#ffffff', 1], [0.4, '#ffffff', 1], [0.65, lighten(c, 0.35), 0.9], [1, c, 0]]);
  }

  /** A star's face in the diagram: a hot center, darkening towards the edge. */
  surface(star: StarType): string {
    const c = star.colour;
    return this.radial(`surface-${slug(star)}`, [[0, lighten(c, 0.75), 1], [0.5, lighten(c, 0.25), 1], [0.85, c, 1], [1, darken(c, 0.3), 1]]);
  }

  /**
   * A planet's day and night: a highlight on the left, darkening to night
   * on the right. Rotate the circle it fills to turn the light towards the star.
   */
  daylight(): string {
    return this.radial('daylight', [[0, '#ffffff', 0.28], [0.3, '#ffffff', 0], [0.55, '#000000', 0.12], [0.85, '#000000', 0.62], [1, '#000000', 0.78]], {
      cx: 0.38, cy: 0.5, r: 0.75, fx: 0.22, fy: 0.5,
    });
  }

  /** Even darkening towards the edge, for a body lit from no particular side. */
  limb(): string {
    return this.radial('limb', [[0, '#ffffff', 0.12], [0.6, '#000000', 0], [1, '#000000', 0.5]]);
  }

  /** A pulsar's beam: brightest at the star, fading out along its length. */
  beam(): string {
    return this.radial('beam', [[0, '#ffffff', 0.9], [0.25, '#bfe0ff', 0.55], [1, '#8fc8ff', 0]]);
  }

  /** A neutron star's glow on the map: cold blue, not its own near-white. */
  pulsarGlow(): string {
    return this.radial('pulsar-glow', [[0, '#bfe0ff', 0.6], [0.3, '#8fc8ff', 0.22], [1, '#8fc8ff', 0]]);
  }

  /** A black hole's accretion disc, white-hot inside to dull orange outside. */
  accretion(): string {
    return this.radial('accretion', [[0, '#fff3dc', 1], [0.5, ACCRETION_COLOUR, 0.9], [1, '#c2541c', 0.2]]);
  }
}

const slug = (star: StarType) => star.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

// --- Shapes ---

/** A random spot inside a circle of radius `within` around (x, y), spread evenly. */
function spot(x: number, y: number, within: number, random: Random): [number, number] {
  const angle = random() * Math.PI * 2;
  const d = Math.sqrt(random()) * within;
  return [x + Math.cos(angle) * d, y + Math.sin(angle) * d];
}

/** A soft, rounded blob about `size` across from its middle, like a continent or a cloud of dust. */
function blob(x: number, y: number, size: number, random: Random, points = 7): string {
  const corners = Array.from({ length: points }, (_, i) => {
    const angle = (i / points) * Math.PI * 2 + random() * 0.5;
    const d = size * (0.55 + random() * 0.45);
    return [x + Math.cos(angle) * d, y + Math.sin(angle) * d];
  });
  const mid = (p: number[], q: number[]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const start = mid(corners[points - 1], corners[0]);
  let d = `M${f(start[0])} ${f(start[1])}`;
  corners.forEach((p, i) => {
    const m = mid(p, corners[(i + 1) % points]);
    d += ` Q${f(p[0])} ${f(p[1])} ${f(m[0])} ${f(m[1])}`;
  });
  return `${d}Z`;
}

/** A jagged line wandering from a random spot, like a crack or a lava channel. */
function crack(x: number, y: number, r: number, random: Random, steps = 4): string {
  let [px, py] = spot(x, y, r * 0.75, random);
  let heading = random() * Math.PI * 2;
  let d = `M${f(px)} ${f(py)}`;
  for (let k = 0; k < steps; k++) {
    heading += (random() - 0.5) * 1.4;
    const step = r * (0.15 + random() * 0.2);
    px += Math.cos(heading) * step;
    py += Math.sin(heading) * step;
    d += ` L${f(px)} ${f(py)}`;
  }
  return d;
}

/** A lumpy, angular rock about `size` across from its middle. */
export function rockPath(x: number, y: number, size: number, random: Random): string {
  const points = 5 + Math.floor(random() * 3);
  const turn = random() * Math.PI * 2;
  const corners = Array.from({ length: points }, (_, i) => {
    const angle = turn + (i / points) * Math.PI * 2;
    const d = size * (0.6 + random() * 0.4);
    return `${f(x + Math.cos(angle) * d)} ${f(y + Math.sin(angle) * d)}`;
  });
  return `M${corners.join(' L')}Z`;
}

// --- Stars ---

/** One ring of a black hole's accretion disc: its width out, thickness (both times the horizon's radius) and opacity. */
interface DiscBand { rx: number; w: number; o: number }

/**
 * A black hole of horizon radius `r`, in drawing order: the far side of
 * its tilted accretion disc, hidden behind the dark middle; a thin, bright
 * ring of bent light hugging the edge of the dark; the dark itself; and the
 * disc's near side, crossing in front.
 */
function blackHoleParts(paints: Paints, x: number, y: number, r: number, bands: DiscBand[], tilt: number): SVGElement[] {
  const cx = f(x);
  const cy = f(y);
  const turn = `rotate(${tilt} ${cx} ${cy})`;
  const far = svg('g', { transform: turn, class: 'accretion-disc' });
  const near = svg('g', { transform: turn, class: 'accretion-disc' });
  for (const band of bands) {
    const rx = r * band.rx;
    const ry = rx * 0.28;
    const style = { fill: 'none', stroke: paints.accretion(), 'stroke-width': f(r * band.w), 'stroke-opacity': band.o, 'stroke-linecap': 'round' };
    far.append(svg('ellipse', { cx, cy, rx: f(rx), ry: f(ry), ...style }));
    // Its near half: the lower arc, left to right.
    near.append(svg('path', { d: `M${f(x - rx)} ${cy} A${f(rx)} ${f(ry)} 0 0 0 ${f(x + rx)} ${cy}`, ...style }));
  }
  return [
    far,
    svg('circle', { cx, cy, r: f(r * 1.06), fill: 'none', stroke: '#fff0d8', 'stroke-width': f(r * 0.08), 'stroke-opacity': 0.9, class: 'photon-ring' }),
    svg('circle', { cx, cy, r: f(r), fill: EVENT_HORIZON, class: 'event-horizon' }),
    near,
  ];
}

/** How far a pulsar's beams and equator lean from upright, in degrees. */
const PULSAR_TILT = 28;

/** A pulsar's two beams, sweeping out from its poles: `length` long, `width` either side at their ends. */
function pulsarBeams(paints: Paints, x: number, y: number, length: number, width: number): SVGPathElement {
  const cx = f(x);
  const cy = f(y);
  return svg('path', {
    d: `M${cx} ${cy} L${f(x - width)} ${f(y - length)} L${f(x + width)} ${f(y - length)} Z M${cx} ${cy} L${f(x - width)} ${f(y + length)} L${f(x + width)} ${f(y + length)} Z`,
    fill: paints.beam(), transform: `rotate(${PULSAR_TILT} ${cx} ${cy})`, class: 'pulsar-beam',
  });
}

/**
 * A star on the sector map: a glow and a bright core, `r`
 * being its map size. The color goes in a CSS variable (--star) for the
 * hover glow. The group's center is the star's, so CSS can scale it in place.
 */
export function mapStar(paints: Paints, star: StarType, x: number, y: number, r: number, extra = ''): SVGGElement {
  const classes = ['star', star.exotic ?? '', star.substellar ? 'substellar' : '', extra].filter(Boolean).join(' ');
  const group = svg('g', { class: classes, style: `--star: ${star.exotic === 'black-hole' ? ACCRETION_COLOUR : star.colour}` });
  const cx = f(x);
  const cy = f(y);

  if (star.exotic === 'black-hole') {
    // The diagram's black hole in miniature: a dark middle in a tilted,
    // glowing disc, with fewer, bolder rings so it reads at map size.
    const horizon = r * 0.55;
    group.append(
      svg('circle', { cx, cy, r: f(r * 1.7), fill: paints.glow(star), class: 'star-glow' }),
      ...blackHoleParts(paints, x, y, horizon, [{ rx: 3.3, w: 0.4, o: 0.45 }, { rx: 2.3, w: 0.6, o: 0.95 }], -20),
    );
    return group;
  }

  if (star.exotic === 'neutron') {
    // A pulsar: a tiny, white-hot core in a cold blue glow, a thin ring
    // round its equator, and a beam from each pole.
    const ring = `rotate(${PULSAR_TILT} ${cx} ${cy})`;
    group.append(
      svg('circle', { cx, cy, r: f(r * 1.8), fill: paints.pulsarGlow(), class: 'star-glow' }),
      pulsarBeams(paints, x, y, r * 3, r * 0.3),
      svg('ellipse', { cx, cy, rx: f(r * 1.05), ry: f(r * 0.32), fill: 'none', stroke: '#bfe0ff', 'stroke-width': f(r * 0.09), 'stroke-opacity': 0.75, transform: ring, class: 'pulsar-ring' }),
      svg('circle', { cx, cy, r: f(r * 0.55), fill: paints.core(star), class: 'star-core' }),
    );
    return group;
  }

  group.append(svg('circle', { cx, cy, r: f(r * (star.substellar ? 1.6 : 2.4)), fill: paints.glow(star), class: 'star-glow' }));
  group.append(svg('circle', { cx, cy, r: f(r * 0.85), fill: paints.core(star), class: 'star-core' }));
  return group;
}

/**
 * A star in the system diagram, `r` across. `key` names its clip path,
 * and `random` places its surface details, so it always looks the same.
 */
export function diagramStar(paints: Paints, star: StarType, x: number, y: number, r: number, key: string, random: Random): SVGGElement {
  const classes = ['star', 'diagram-star', star.exotic ?? '', star.substellar ? 'substellar' : ''].filter(Boolean).join(' ');
  const group = svg('g', { class: classes, style: `--star: ${star.exotic === 'black-hole' ? ACCRETION_COLOUR : star.colour}` });
  const cx = f(x);
  const cy = f(y);

  if (star.exotic === 'black-hole') {
    group.append(...blackHoleParts(paints, x, y, r, [{ rx: 2.6, w: 0.22, o: 0.35 }, { rx: 2.1, w: 0.32, o: 0.6 }, { rx: 1.6, w: 0.36, o: 0.95 }], -14));
    return group;
  }

  // A neutron star's beams sweep out from its poles, under the star itself.
  if (star.exotic === 'neutron') group.append(pulsarBeams(paints, x, y, r * 4.5, r * 0.5));

  if (star.substellar) {
    // A brown dwarf is banded with clouds, like a gas giant, and glows dully rather than shining.
    const surface = svg('g', { 'clip-path': paints.clipCircle(key, x, y, r) });
    surface.append(svg('circle', { cx, cy, r: f(r), fill: star.colour }));
    bands(surface, x, y, r, star.colour, random, `rotate(-8 ${cx} ${cy})`);
    surface.append(svg('circle', { cx, cy, r: f(r), fill: paints.limb() }));
    group.append(surface);
    return group;
  }

  group.append(svg('circle', { cx, cy, r: f(r), fill: paints.surface(star) }));
  if (star.exotic !== 'white-dwarf' && star.exotic !== 'neutron') {
    // A boiling surface: soft, bright convection cells, and a sunspot or two.
    const cells = svg('g', { class: 'star-cells' });
    const count = 9 + Math.floor(random() * 6);
    for (let n = 0; n < count; n++) {
      const size = r * (0.1 + random() * 0.14);
      const [sx, sy] = spot(x, y, r - size * 1.2, random);
      cells.append(svg('path', { d: blob(sx, sy, size, random, 6), fill: lighten(star.colour, 0.6), 'fill-opacity': f(0.08 + random() * 0.1) }));
    }
    const spots = Math.floor(random() * 3);
    for (let n = 0; n < spots; n++) {
      const size = r * (0.04 + random() * 0.05);
      const [sx, sy] = spot(x, y, r * 0.6, random);
      cells.append(
        svg('circle', { cx: f(sx), cy: f(sy), r: f(size * 2), fill: darken(star.colour, 0.2), 'fill-opacity': 0.25 }),
        svg('circle', { cx: f(sx), cy: f(sy), r: f(size), fill: darken(star.colour, 0.4), 'fill-opacity': 0.4 }),
      );
    }
    group.append(cells);
  }
  return group;
}

// --- Planets and moons ---

/** Stripes of cloud across a body, like a gas giant's, inside whatever clips `into`. */
function bands(into: SVGElement, x: number, y: number, r: number, colour: string, random: Random, tilt: string): void {
  const stripes = svg('g', { transform: tilt });
  let top = -r;
  while (top < r) {
    const height = r * (0.1 + random() * 0.2);
    const shade = random() < 0.5 ? lighten(colour, 0.08 + random() * 0.25) : darken(colour, 0.08 + random() * 0.25);
    stripes.append(svg('rect', { x: f(x - r * 1.3), y: f(y + top), width: f(r * 2.6), height: f(height), fill: shade, 'fill-opacity': f(0.55 + random() * 0.35) }));
    top += height;
  }
  into.append(stripes);
}

interface Surface {
  into: SVGElement;
  x: number;
  y: number;
  r: number;
  colour: string;
  random: Random;
  /** The planet's tilt, matching its ring: details along its equator follow it. */
  tilt: string;
}

/** Wisps of white cloud. */
function clouds({ into, x, y, r, random, tilt }: Surface, count: number, opacity: number): void {
  const layer = svg('g', { transform: tilt });
  for (let n = 0; n < count; n++) {
    const [cx, cy] = spot(x, y, r * 0.9, random);
    layer.append(svg('ellipse', { cx: f(cx), cy: f(cy), rx: f(r * (0.2 + random() * 0.3)), ry: f(r * (0.04 + random() * 0.06)), fill: '#ffffff', 'fill-opacity': f(opacity * (0.6 + random() * 0.4)) }));
  }
  into.append(layer);
}

/** White polar caps, top and bottom along the planet's tilt. */
function polarCaps({ into, x, y, r, tilt }: Surface, size: number, opacity: number): void {
  const caps = svg('g', { transform: tilt });
  caps.append(
    svg('ellipse', { cx: f(x), cy: f(y - r * 0.98), rx: f(r * size), ry: f(r * size * 0.45), fill: '#ffffff', 'fill-opacity': opacity }),
    svg('ellipse', { cx: f(x), cy: f(y + r * 0.98), rx: f(r * size * 0.75), ry: f(r * size * 0.35), fill: '#ffffff', 'fill-opacity': opacity }),
  );
  into.append(caps);
}

/** Patches of `colours`, `count` of them, from `min` to `max` of the radius across. */
function patches({ into, x, y, r, random }: Surface, count: number, min: number, max: number, colours: string[], opacity: number): void {
  for (let n = 0; n < count; n++) {
    const size = r * (min + random() * (max - min));
    const [px, py] = spot(x, y, r * 0.95, random);
    into.append(svg('path', { d: blob(px, py, size, random), fill: colours[Math.floor(random() * colours.length)], 'fill-opacity': opacity }));
  }
}

/** A gas giant's banded clouds, ringed or not, and now and then a great storm. */
const GAS_GIANT: PlanetLook = {
  draw: (s) => {
    bands(s.into, s.x, s.y, s.r, s.colour, s.random, s.tilt);
    if (s.random() < 0.6) {
      const storm = svg('g', { transform: s.tilt });
      const sx = s.x + s.r * (s.random() - 0.5) * 0.9;
      const sy = s.y + s.r * (s.random() * 0.7 - 0.35);
      storm.append(svg('ellipse', {
        cx: f(sx), cy: f(sy), rx: f(s.r * 0.22), ry: f(s.r * 0.12), fill: mix(s.colour, '#b8462e', 0.45),
        stroke: lighten(s.colour, 0.35), 'stroke-width': f(s.r * 0.03), 'stroke-opacity': 0.7,
      }));
      s.into.append(storm);
    }
  },
  air: ['#ffe6c0', 0.25],
};

/** How a planet type looks: its base color (if not its own), its surface details, and its haze of air. */
interface PlanetLook {
  base?: (colour: string) => string;
  draw: (s: Surface) => void;
  air?: [colour: string, opacity: number];
}

/** Each planet type's surface, drawn over a disc of its own color (or of `base`, if given). */
const SURFACES: Record<string, PlanetLook> = {
  Barren: {
    draw: (s) => {
      patches(s, 3, 0.3, 0.5, [darken(s.colour, 0.12), lighten(s.colour, 0.08)], 0.5);
      const craters = 6 + Math.floor(s.random() * 5);
      for (let n = 0; n < craters; n++) {
        const size = s.r * (0.06 + s.random() * 0.15);
        const [cx, cy] = spot(s.x, s.y, s.r * 0.88, s.random);
        s.into.append(svg('circle', {
          cx: f(cx), cy: f(cy), r: f(size), fill: darken(s.colour, 0.28), 'fill-opacity': 0.75,
          stroke: lighten(s.colour, 0.3), 'stroke-width': f(size * 0.28), 'stroke-opacity': 0.55,
        }));
      }
    },
  },
  'Gas giant': GAS_GIANT,
  'Ringed gas giant': GAS_GIANT,
  'Ice giant': {
    draw: (s) => {
      // Faint bands under a thick haze, softer than a gas giant's.
      bands(s.into, s.x, s.y, s.r, s.colour, s.random, s.tilt);
      s.into.append(svg('circle', { cx: f(s.x), cy: f(s.y), r: f(s.r), fill: s.colour, 'fill-opacity': 0.55 }));
      // Sometimes a dark storm, like Neptune's.
      if (s.random() < 0.4) {
        const storm = svg('g', { transform: s.tilt });
        storm.append(svg('ellipse', {
          cx: f(s.x + s.r * (s.random() - 0.5) * 0.8), cy: f(s.y + s.r * (s.random() * 0.6 - 0.3)), rx: f(s.r * 0.2), ry: f(s.r * 0.1),
          fill: darken(s.colour, 0.45), 'fill-opacity': 0.6,
        }));
        s.into.append(storm);
      }
      clouds(s, 3, 0.35);
    },
    air: ['#c8f2ff', 0.45],
  },
  Ice: {
    draw: (s) => {
      patches(s, 4, 0.25, 0.45, [lighten(s.colour, 0.35), darken(s.colour, 0.08)], 0.55);
      const cracks = 4 + Math.floor(s.random() * 3);
      for (let n = 0; n < cracks; n++) {
        s.into.append(svg('path', { d: crack(s.x, s.y, s.r, s.random), fill: 'none', stroke: mix(s.colour, '#3f7fa8', 0.55), 'stroke-width': f(s.r * 0.035), 'stroke-opacity': 0.7, 'stroke-linejoin': 'round' }));
      }
      polarCaps(s, 0.7, 0.85);
    },
    air: ['#e6f6ff', 0.3],
  },
  Desert: {
    draw: (s) => {
      patches(s, 6, 0.2, 0.42, [darken(s.colour, 0.18), lighten(s.colour, 0.15), mix(s.colour, '#b0603a', 0.3)], 0.55);
      polarCaps(s, 0.4, 0.6);
    },
    air: ['#ffe2b0', 0.25],
  },
  Toxic: {
    draw: (s) => {
      // Thick, swirling cloud: soft bands, gently twisted.
      const swirl = svg('g', { transform: s.tilt });
      for (let n = 0; n < 6; n++) {
        swirl.append(svg('ellipse', {
          cx: f(s.x + s.r * (s.random() - 0.5) * 0.6), cy: f(s.y + s.r * (n / 3 - 0.85)), rx: f(s.r * 1.2), ry: f(s.r * (0.1 + s.random() * 0.1)),
          fill: s.random() < 0.5 ? lighten(s.colour, 0.25) : darken(s.colour, 0.2), 'fill-opacity': 0.5,
          transform: `rotate(${f((s.random() - 0.5) * 16)} ${f(s.x)} ${f(s.y)})`,
        }));
      }
      s.into.append(swirl);
      patches(s, 2, 0.15, 0.25, [mix(s.colour, '#e8f080', 0.4)], 0.5);
    },
    air: ['#e2f07a', 0.5],
  },
  Volcanic: {
    base: (colour) => darken(colour, 0.6),
    draw: (s) => {
      patches(s, 4, 0.25, 0.45, [darken(s.colour, 0.75), darken(s.colour, 0.5)], 0.7);
      // Glowing channels of lava, and pools where they gather.
      const lava = svg('g', { class: 'lava' });
      const channels = 4 + Math.floor(s.random() * 3);
      for (let n = 0; n < channels; n++) {
        lava.append(svg('path', { d: crack(s.x, s.y, s.r, s.random), fill: 'none', stroke: s.colour, 'stroke-width': f(s.r * 0.07), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      }
      const pools = 3 + Math.floor(s.random() * 3);
      for (let n = 0; n < pools; n++) {
        const [px, py] = spot(s.x, s.y, s.r * 0.8, s.random);
        lava.append(svg('circle', { cx: f(px), cy: f(py), r: f(s.r * (0.05 + s.random() * 0.07)), fill: '#ffc46b' }));
      }
      s.into.append(lava);
    },
    air: ['#ff8a5a', 0.3],
  },
  Ocean: {
    draw: (s) => {
      patches(s, 4, 0.3, 0.5, [darken(s.colour, 0.2), lighten(s.colour, 0.1)], 0.45);
      patches(s, 3 + Math.floor(s.random() * 3), 0.06, 0.14, ['#d8c48e', '#6fae5a'], 0.95);
      clouds(s, 6, 0.45);
    },
    air: ['#a8d8ff', 0.5],
  },
  Jungle: {
    draw: (s) => {
      patches(s, 6, 0.22, 0.45, [darken(s.colour, 0.3), lighten(s.colour, 0.12)], 0.65);
      patches(s, 3, 0.08, 0.16, ['#2f6f9a'], 0.85);
      clouds(s, 7, 0.5);
    },
    air: ['#b8e8ff', 0.5],
  },
  Terran: {
    // Mostly sea, with continents in the planet's own color.
    base: () => '#2d6aa8',
    draw: (s) => {
      const land = mix(s.colour, '#6fa356', 0.35);
      patches({ ...s, colour: land }, 3 + Math.floor(s.random() * 2), 0.28, 0.5, [land, darken(land, 0.15)], 1);
      patches(s, 2, 0.1, 0.18, ['#c9b27a'], 0.7);
      polarCaps(s, 0.55, 0.85);
      clouds(s, 7, 0.5);
    },
    air: ['#9fd0ff', 0.55],
  },
};

/** How a ringed planet's rings are drawn: each band's width out (times the radius), thickness and opacity. */
const RING_BANDS = [{ rx: 2.0, w: 0.16, o: 0.4 }, { rx: 1.65, w: 0.26, o: 0.75 }];
/** How flat a ring looks: its height over its width. */
const RING_FLAT = 0.3;

/**
 * A planet, `r` across, lit from `light` (the direction its star lies in,
 * in degrees). `key` names its clip path; `random` places its surface
 * details, so pass the same stream to draw it the same each time.
 */
export function planetBody(paints: Paints, type: PlanetType, x: number, y: number, r: number, key: string, random: Random, light: number): SVGGElement {
  const group = svg('g', { class: 'planet-art' });
  const cx = f(x);
  const cy = f(y);
  const tilt = `rotate(-18 ${cx} ${cy})`;
  const look = SURFACES[type.name];
  const ringColour = lighten(type.colour, 0.25);
  const ringStyle = (band: (typeof RING_BANDS)[number]) => ({ fill: 'none', stroke: ringColour, 'stroke-width': f(r * band.w), 'stroke-opacity': band.o });

  // A ring's far side goes behind the planet; its near side is drawn over it, below.
  if (type.ringed) {
    const far = svg('g', { transform: tilt, class: 'planet-ring' });
    for (const band of RING_BANDS) far.append(svg('ellipse', { cx, cy, rx: f(r * band.rx), ry: f(r * band.rx * RING_FLAT), ...ringStyle(band) }));
    group.append(far);
  }

  const surface = svg('g', { 'clip-path': paints.clipCircle(key, x, y, r) });
  surface.append(svg('circle', { cx, cy, r: f(r), fill: look?.base?.(type.colour) ?? type.colour }));
  look?.draw({ into: surface, x, y, r, colour: type.colour, random, tilt });
  // Day and night: the highlight points at the star.
  surface.append(svg('circle', { cx, cy, r: f(r), fill: paints.daylight(), transform: `rotate(${f(light - 180)} ${cx} ${cy})` }));
  group.append(surface);

  // A thin haze of air round the edge.
  if (look?.air) {
    const [colour, opacity] = look.air;
    group.append(svg('circle', { cx, cy, r: f(r * 1.03), fill: 'none', stroke: colour, 'stroke-width': f(r * 0.08), 'stroke-opacity': opacity, class: 'planet-air' }));
  }
  group.append(svg('circle', { cx, cy, r: f(r), class: 'planet-edge' }));

  if (type.ringed) {
    const near = svg('g', { transform: tilt, class: 'planet-ring' });
    for (const band of RING_BANDS) {
      const rx = r * band.rx;
      near.append(svg('path', { d: `M${f(x - rx)} ${cy} A${f(rx)} ${f(rx * RING_FLAT)} 0 0 0 ${f(x + rx)} ${cy}`, ...ringStyle(band) }));
    }
    group.append(near);
  }
  return group;
}

/** A moon, `r` across: a shaded disc with a mark of its kind. The caller adds the "moon" class's behavior. */
export function moonBody(paints: Paints, moon: MoonType, x: number, y: number, r: number): SVGGElement {
  const group = svg('g', { class: 'moon' });
  const c = moon.colour;
  group.append(svg('circle', { cx: f(x), cy: f(y), r: f(r), fill: c }));
  // Fixed marks, not random ones: moons draw from their system's orbit stream, which mustn't change.
  if (moon.name === 'Rocky moon') {
    group.append(
      svg('circle', { cx: f(x - r * 0.3), cy: f(y - r * 0.25), r: f(r * 0.28), fill: darken(c, 0.3) }),
      svg('circle', { cx: f(x + r * 0.35), cy: f(y + r * 0.3), r: f(r * 0.18), fill: darken(c, 0.3) }),
    );
  } else if (moon.name === 'Icy moon') {
    group.append(svg('path', { d: `M${f(x - r * 0.6)} ${f(y - r * 0.2)} L${f(x)} ${f(y + r * 0.1)} L${f(x + r * 0.5)} ${f(y - r * 0.35)}`, fill: 'none', stroke: mix(c, '#3f7fa8', 0.5), 'stroke-width': f(r * 0.12) }));
  } else if (moon.name === 'Volcanic moon') {
    group.append(svg('circle', { cx: f(x + r * 0.2), cy: f(y - r * 0.2), r: f(r * 0.25), fill: '#ffd27a' }));
  }
  group.append(svg('circle', { cx: f(x), cy: f(y), r: f(r), fill: paints.limb() }));
  return group;
}

/** The direction, in degrees, from (x, y) towards a star at (sx, sy): where a planet's light comes from. */
export function lightFrom(x: number, y: number, sx: number, sy: number): number {
  return (Math.atan2(sy - y, sx - x) * 180) / Math.PI;
}
