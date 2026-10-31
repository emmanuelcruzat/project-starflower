// Shared types for the whole game. The engine, the UI and the data files all
// agree on these shapes; the validation/ folder enforces them on load.

// A real array (not just a type) so code can loop over the stats. Adding a
// stat here makes TypeScript point out every place that needs updating.
export const STAT_KEYS = ['population', 'economy', 'technology', 'military', 'liberties', 'cohesion'] as const;
export type StatKey = (typeof STAT_KEYS)[number];

/** Population is in millions. Every other stat is a 0–100 index. */
export type Stats = Record<StatKey, number>;

/** Stat deltas. Everything is optional so content only lists what changes. */
export type Effects = Partial<Stats>;

/** Every requirement listed must hold. Used by incidents, operations, ambitions and prefixes. */
export interface Condition {
  requiresFlags?: string[];
  forbidsFlags?: string[];
  minStats?: Partial<Stats>;
  maxStats?: Partial<Stats>;
  /** Government ids allowed. Omit to allow every government. */
  governments?: string[];
  /** Real hours since the nation was founded. */
  minAgeHours?: number;
}

/** What happens when the player makes a decision. Shared by every kind of choice. */
export interface Outcome {
  effects?: Effects;
  /** Flags are cleared before new ones are set, so an outcome can swap one flag for another. */
  setFlags?: string[];
  clearFlags?: string[];
  result?: string;
}

// --- Incidents ---

export interface IncidentChoice extends Outcome {
  text: string;
}

export interface Incident {
  id: string;
  title: string;
  /** Separate paragraphs with a blank line ("\n\n"). */
  description: string;
  /** Relative chance of being picked among eligible incidents. Defaults to 1. */
  weight?: number;
  /** Non-repeatable incidents (the default) arrive at most once per nation. */
  repeatable?: boolean;
  condition?: Condition;
  choices: IncidentChoice[];
  /** Taking no action is always allowed, and has its own consequences. */
  dismiss: Outcome;
}

// --- Operations ---

export interface StageChoice extends Outcome {
  text: string;
  /** Id of the stage that follows. Omit it to end the operation. */
  next?: string;
}

export interface OperationStage {
  id: string;
  title: string;
  description: string;
  durationHours: number;
  choices: StageChoice[];
}

export interface Operation {
  id: string;
  title: string;
  summary: string;
  condition?: Condition;
  repeatable?: boolean;
  /** Applied when the player launches the operation (usually a cost). */
  startEffects?: Effects;
  /** The first stage is where every run begins. */
  stages: OperationStage[];
}

// --- Ambitions ---

export interface Ambition {
  id: string;
  title: string;
  description: string;
  condition?: Condition;
  durationHours: number;
  startEffects?: Effects;
  /** Applied continuously while active, scaled to elapsed time. */
  dailyEffects?: Effects;
  completionEffects?: Effects;
  /** Set on completion. Use these to unlock follow-up ambitions and operations. */
  setFlags?: string[];
  completionText?: string;
}

// --- Nation setup data ---

export interface Government {
  id: string;
  name: string;
  description: string;
  startingStats: Stats;
}

export interface Prefix {
  name: string;
  condition?: Condition;
}

export interface TitleTier {
  name: string;
  /** The lowest value that earns this title. Tiers are listed in ascending order. */
  min: number;
  description?: string;
}

export interface TitlesData {
  /** How much each stat counts towards the overall power score. */
  powerWeights: Partial<Stats>;
  power: TitleTier[];
  cohesion: TitleTier[];
  military: TitleTier[];
}

/** Everything loaded from data/, validated. Passed to the engine as one object. */
export interface GameContent {
  incidents: Incident[];
  operations: Operation[];
  ambitions: Ambition[];
  governments: Government[];
  prefixes: Prefix[];
  titles: TitlesData;
}

// --- Nation state ---
// Everything about one nation lives in this one plain object: no classes, no
// Sets, no references to content. That keeps it JSON-serializable, so it can
// move into localStorage today and a server database later.

export interface PendingIncident {
  incidentId: string;
  arrivedAt: number;
}

export interface ActiveOperation {
  operationId: string;
  stageId: string;
  /** Once this time has passed, the stage is waiting for the player's decision. */
  stageEndsAt: number;
}

export interface ActiveAmbition {
  ambitionId: string;
  startedAt: number;
  endsAt: number;
}

export interface LogEntry {
  at: number;
  kind: 'incident' | 'operation' | 'ambition' | 'nation';
  title: string;
  choice?: string;
  result?: string;
  effects?: Effects;
}

export interface Nation {
  id: string;
  name: string;
  governmentId: string;
  prefix: string;
  /** All times are milliseconds since 1970 (Date.now() format). */
  foundedAt: number;
  /** How far the simulation has been run. */
  lastUpdatedAt: number;
  stats: Stats;
  flags: string[];
  incidents: {
    queue: PendingIncident[];
    nextArrivalAt: number;
    seen: string[];
  };
  operations: ActiveOperation[];
  completedOperations: string[];
  ambition: ActiveAmbition | null;
  completedAmbitions: string[];
  /** Newest first. */
  log: LogEntry[];
}
