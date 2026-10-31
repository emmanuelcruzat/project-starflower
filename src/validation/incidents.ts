import type { Incident } from '../types';
import {
  OUTCOME_FIELDS, checkBoolean, checkCondition, checkFields, checkOutcome, checkPositiveNumber, checkText, isObject,
  validateList, type Obj, type Problems, type ValidationReport,
} from './common';

const INCIDENT_FIELDS = ['id', 'title', 'description', 'weight', 'repeatable', 'condition', 'choices', 'dismiss'];
const CHOICE_FIELDS = ['text', ...OUTCOME_FIELDS];

export function validateIncidents(raw: unknown, report: ValidationReport): Incident[] {
  return validateList<Incident>(raw, 'incidents.json', 'id', validateIncident, report);
}

function validateIncident(item: Obj, problems: Problems): void {
  checkFields(item, INCIDENT_FIELDS, 'incident', problems);
  checkText(item, 'id', 'incident', problems);
  checkText(item, 'title', 'incident', problems);
  checkText(item, 'description', 'incident', problems);
  checkPositiveNumber(item, 'weight', 'incident', problems, false);
  checkBoolean(item, 'repeatable', 'incident', problems);
  checkCondition(item.condition, 'condition', problems);

  if (!Array.isArray(item.choices) || item.choices.length === 0) {
    problems.push('"choices" must be a non-empty list');
  } else {
    item.choices.forEach((choice, i) => {
      const where = `choice ${i + 1}`;
      if (!isObject(choice)) {
        problems.push(`${where} must be an object`);
        return;
      }
      checkFields(choice, CHOICE_FIELDS, where, problems);
      checkText(choice, 'text', where, problems);
      checkOutcome(choice, where, problems);
    });
  }

  // Required on purpose: "take no action" is a real decision in this game, so
  // every incident should say what ignoring it costs.
  if (!isObject(item.dismiss)) {
    problems.push('"dismiss" is required: an object saying what happens if the player takes no action (it can be {})');
  } else {
    checkFields(item.dismiss, OUTCOME_FIELDS, 'dismiss', problems);
    checkOutcome(item.dismiss, 'dismiss', problems);
  }
}
