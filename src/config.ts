// Tuning knobs for the simulation. Content lives in data/; the rules of time
// and growth live here.

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

// --- Incidents ---
/** Pending incidents beyond this are skipped, not banked, so a long absence doesn't bury the player. */
export const INCIDENT_QUEUE_CAP = 5;
/** The fastest incidents can arrive, however large the nation (from the design doc). */
export const MIN_INCIDENT_INTERVAL_HOURS = 2;
/** The interval for a nation of REFERENCE_POPULATION. Larger nations get incidents more often. */
export const BASE_INCIDENT_INTERVAL_HOURS = 8;
export const REFERENCE_POPULATION = 100; // millions

// --- Operations ---
export const MAX_ACTIVE_OPERATIONS = 3;

// --- Growth ---
/** Daily population growth when cohesion and economy are both at 100. */
export const MAX_DAILY_GROWTH = 0.01;
/** At these levels population holds steady; below them it shrinks. */
export const NEUTRAL_COHESION = 40;
export const NEUTRAL_ECONOMY = 40;

// --- Natural levels ---
// Each government has a natural level for each stat: its starting value.
// Without this, repeated small costs drain a stat to zero and repeated small
// gains pin it at 100.
/** Below its natural level, a stat recovers; above it, it stays. Downturns end, but built-up gains are kept. */
export const RECOVERING_STATS = ['economy'] as const;
/** These settle towards their natural level from either direction, the way public mood does. */
export const SETTLING_STATS = ['cohesion', 'liberties'] as const;
/** The fraction of the gap to the natural level that closes each day. */
export const DAILY_DRIFT_RATE = 0.1;

// --- Log ---
export const MAX_LOG_ENTRIES = 30;
