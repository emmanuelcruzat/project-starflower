import { STAT_KEYS } from '../types';

// Shared building blocks for checking hand-written data files. Each check
// pushes plain-English problems onto a list instead of throwing, so one run
// reports every mistake in a file, not just the first.

export type Obj = Record<string, unknown>;
export type Problems = string[];

export interface ValidationReport {
  errors: string[];
  warnings: string[];
}

export function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Unknown fields count as errors. They are almost always typos ("setFlag"
 * instead of "setFlags") that would otherwise be silently ignored.
 */
export function checkFields(obj: Obj, allowed: readonly string[], where: string, problems: Problems): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) problems.push(`${where} has unknown field "${key}" (allowed: ${allowed.join(', ')})`);
  }
}

export function checkText(obj: Obj, field: string, where: string, problems: Problems, required = true): void {
  const value = obj[field];
  if (value === undefined && !required) return;
  if (typeof value !== 'string' || value.trim() === '') problems.push(`${where} needs "${field}" as non-empty text`);
}

export function checkPositiveNumber(obj: Obj, field: string, where: string, problems: Problems, required = true): void {
  const value = obj[field];
  if (value === undefined && !required) return;
  if (!isNumber(value) || value <= 0) problems.push(`${where} needs "${field}" as a number greater than 0`);
}

export function checkBoolean(obj: Obj, field: string, where: string, problems: Problems): void {
  if (obj[field] !== undefined && typeof obj[field] !== 'boolean') problems.push(`${where} "${field}" must be true or false`);
}

export function checkStringArray(value: unknown, where: string, problems: Problems): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && v !== '')) {
    problems.push(`${where} must be a list of non-empty strings, like ["some_flag"]`);
  }
}

/** An object of stat deltas or limits, like { "economy": 5 }. */
export function checkStats(value: unknown, where: string, problems: Problems, requireAll = false): void {
  if (value === undefined) return;
  if (!isObject(value)) {
    problems.push(`${where} must be an object, like { "economy": 5 }`);
    return;
  }
  checkFields(value, STAT_KEYS, where, problems);
  for (const key of STAT_KEYS) {
    if (value[key] === undefined) {
      if (requireAll) problems.push(`${where} is missing "${key}"`);
    } else if (!isNumber(value[key])) {
      problems.push(`${where}.${key} must be a number`);
    }
  }
}

const CONDITION_FIELDS = ['requiresFlags', 'forbidsFlags', 'minStats', 'maxStats', 'governments', 'minAgeHours'];

export function checkCondition(value: unknown, where: string, problems: Problems): void {
  if (value === undefined) return;
  if (!isObject(value)) {
    problems.push(`${where} must be an object`);
    return;
  }
  checkFields(value, CONDITION_FIELDS, where, problems);
  checkStringArray(value.requiresFlags, `${where}.requiresFlags`, problems);
  checkStringArray(value.forbidsFlags, `${where}.forbidsFlags`, problems);
  checkStringArray(value.governments, `${where}.governments`, problems);
  checkStats(value.minStats, `${where}.minStats`, problems);
  checkStats(value.maxStats, `${where}.maxStats`, problems);
  if (value.minAgeHours !== undefined && !isNumber(value.minAgeHours)) problems.push(`${where}.minAgeHours must be a number`);
}

export const OUTCOME_FIELDS = ['effects', 'setFlags', 'clearFlags', 'result'];

/** Checks the outcome fields only. The caller checks for unknown fields, since choices allow extra ones. */
export function checkOutcome(obj: Obj, where: string, problems: Problems): void {
  checkStats(obj.effects, `${where} effects`, problems);
  checkStringArray(obj.setFlags, `${where} setFlags`, problems);
  checkStringArray(obj.clearFlags, `${where} clearFlags`, problems);
  checkText(obj, 'result', where, problems, false);
}

/**
 * Validates a top-level list of items that each have a unique key (usually
 * "id"). Items with problems are reported and left out, so one broken entry
 * can't crash the game.
 */
export function validateList<T>(
  raw: unknown,
  fileName: string,
  keyField: string,
  validateItem: (item: Obj, problems: Problems) => void,
  report: ValidationReport,
): T[] {
  if (!Array.isArray(raw)) {
    report.errors.push(`${fileName}: must contain a list: [ { ... }, { ... } ]`);
    return [];
  }

  const valid: T[] = [];
  const keys = new Set<string>();
  raw.forEach((item, index) => {
    const key = isObject(item) && typeof item[keyField] === 'string' ? (item[keyField] as string) : null;
    // Name items by key where possible; use their position for items missing one.
    const label = key ? `${fileName} "${key}"` : `${fileName} item #${index + 1}`;

    const problems: Problems = [];
    if (!isObject(item)) {
      problems.push('must be an object { ... }');
    } else {
      validateItem(item, problems);
      if (key && keys.has(key)) problems.push(`duplicate ${keyField} (another entry already uses it)`);
      if (key) keys.add(key);
    }

    if (problems.length > 0) report.errors.push(...problems.map((p) => `${label}: ${p}`));
    else valid.push(item as T);
  });
  return valid;
}
