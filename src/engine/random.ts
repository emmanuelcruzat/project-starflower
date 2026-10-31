/** A function returning a number in [0, 1), like Math.random. Tests and a future server can pass a seeded one. */
export type Random = () => number;

/**
 * A repeatable random sequence: the same seed always gives the same numbers.
 * Used to draw the same galaxy for a nation every time, and useful later for
 * a server that needs to replay outcomes. (Mulberry32: tiny, fast, and good
 * enough for games; not for anything security-related.)
 */
export function seededRandom(seed: string): Random {
  // Turn the seed text into a 32-bit number (FNV-1a hash).
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Picks an item at random, so an item with weight 3 is three times as likely
 * as one with weight 1. Returns null for an empty list.
 */
export function weightedPick<T>(items: T[], weightOf: (item: T) => number, random: Random): T | null {
  if (items.length === 0) return null;

  // Picture the weights laid end to end on a line. Throw a dart at a random
  // point and walk along until you reach the segment it landed in.
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  let roll = random() * total;
  for (const item of items) {
    roll -= weightOf(item);
    if (roll < 0) return item;
  }
  // Only reached through floating-point rounding at the very end of the line.
  return items[items.length - 1];
}
