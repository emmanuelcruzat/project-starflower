import type { Government, Prefix, TitlesData, TitleTier } from '../types';
import {
  checkCondition, checkFields, checkStats, checkText, isNumber, isObject, validateList,
  type Obj, type Problems, type ValidationReport,
} from './common';

export function validateGovernments(raw: unknown, report: ValidationReport): Government[] {
  return validateList<Government>(raw, 'governments.json', 'id', (item: Obj, problems: Problems) => {
    checkFields(item, ['id', 'name', 'description', 'startingStats'], 'government', problems);
    checkText(item, 'id', 'government', problems);
    checkText(item, 'name', 'government', problems);
    checkText(item, 'description', 'government', problems);
    if (item.startingStats === undefined) problems.push('needs "startingStats"');
    checkStats(item.startingStats, 'startingStats', problems, true);
  }, report);
}

export function validatePrefixes(raw: unknown, report: ValidationReport): Prefix[] {
  return validateList<Prefix>(raw, 'prefixes.json', 'name', (item: Obj, problems: Problems) => {
    checkFields(item, ['name', 'condition'], 'prefix', problems);
    checkText(item, 'name', 'prefix', problems);
    checkCondition(item.condition, 'condition', problems);
  }, report);
}

const TITLE_LISTS = ['power', 'cohesion', 'military'] as const;

/** Returns null if the file is unusable. The game can't show a nation without titles. */
export function validateTitles(raw: unknown, report: ValidationReport): TitlesData | null {
  const problems: Problems = [];
  if (!isObject(raw)) {
    report.errors.push('titles.json: must be an object with "powerWeights", "power", "cohesion" and "military"');
    return null;
  }
  checkFields(raw, ['powerWeights', ...TITLE_LISTS], 'titles.json', problems);
  if (raw.powerWeights === undefined) problems.push('titles.json needs "powerWeights"');
  checkStats(raw.powerWeights, 'titles.json powerWeights', problems);
  for (const list of TITLE_LISTS) checkTiers(raw[list], `titles.json "${list}"`, problems);

  report.errors.push(...problems);
  return problems.length === 0 ? (raw as unknown as TitlesData) : null;
}

function checkTiers(value: unknown, where: string, problems: Problems): void {
  if (!Array.isArray(value) || value.length === 0) {
    problems.push(`${where} must be a non-empty list of { "name": ..., "min": ... }`);
    return;
  }
  let previousMin = -Infinity;
  value.forEach((tier, i) => {
    const tierWhere = `${where} tier ${i + 1}`;
    if (!isObject(tier)) {
      problems.push(`${tierWhere} must be an object`);
      return;
    }
    checkFields(tier, ['name', 'min', 'description'], tierWhere, problems);
    checkText(tier, 'name', tierWhere, problems);
    checkText(tier, 'description', tierWhere, problems, false);
    if (!isNumber(tier.min)) {
      problems.push(`${tierWhere} needs "min" as a number`);
      return;
    }
    // Title lookup walks the list in order, so a tier out of order would be unreachable.
    if (tier.min <= previousMin) problems.push(`${tierWhere} ("${String(tier.name)}") must have a higher "min" than the tier before it`);
    previousMin = (tier as unknown as TitleTier).min;
  });
}
