import type { Ambition } from '../types';
import {
  checkCondition, checkFields, checkPositiveNumber, checkStats, checkStringArray, checkText, validateList,
  type Obj, type Problems, type ValidationReport,
} from './common';

const AMBITION_FIELDS = [
  'id', 'title', 'description', 'condition', 'durationHours',
  'startEffects', 'dailyEffects', 'completionEffects', 'setFlags', 'completionText',
];

export function validateAmbitions(raw: unknown, report: ValidationReport): Ambition[] {
  return validateList<Ambition>(raw, 'ambitions.json', 'id', validateAmbition, report);
}

function validateAmbition(item: Obj, problems: Problems): void {
  checkFields(item, AMBITION_FIELDS, 'ambition', problems);
  checkText(item, 'id', 'ambition', problems);
  checkText(item, 'title', 'ambition', problems);
  checkText(item, 'description', 'ambition', problems);
  checkText(item, 'completionText', 'ambition', problems, false);
  checkPositiveNumber(item, 'durationHours', 'ambition', problems);
  checkCondition(item.condition, 'condition', problems);
  checkStats(item.startEffects, 'startEffects', problems);
  checkStats(item.dailyEffects, 'dailyEffects', problems);
  checkStats(item.completionEffects, 'completionEffects', problems);
  checkStringArray(item.setFlags, 'setFlags', problems);
}
