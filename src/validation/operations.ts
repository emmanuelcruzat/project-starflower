import type { Operation } from '../types';
import {
  OUTCOME_FIELDS, checkBoolean, checkCondition, checkFields, checkOutcome, checkPositiveNumber, checkStats, checkText,
  isObject, validateList, type Obj, type Problems, type ValidationReport,
} from './common';

const OPERATION_FIELDS = ['id', 'title', 'summary', 'condition', 'repeatable', 'startEffects', 'stages'];
const STAGE_FIELDS = ['id', 'title', 'description', 'durationHours', 'choices'];
const CHOICE_FIELDS = ['text', 'next', ...OUTCOME_FIELDS];

export function validateOperations(raw: unknown, report: ValidationReport): Operation[] {
  const operations = validateList<Operation>(raw, 'operations.json', 'id', validateOperation, report);
  for (const op of operations) report.warnings.push(...unreachableStages(op));
  return operations;
}

function validateOperation(item: Obj, problems: Problems): void {
  checkFields(item, OPERATION_FIELDS, 'operation', problems);
  checkText(item, 'id', 'operation', problems);
  checkText(item, 'title', 'operation', problems);
  checkText(item, 'summary', 'operation', problems);
  checkBoolean(item, 'repeatable', 'operation', problems);
  checkCondition(item.condition, 'condition', problems);
  checkStats(item.startEffects, 'startEffects', problems);

  if (!Array.isArray(item.stages) || item.stages.length === 0) {
    problems.push('"stages" must be a non-empty list');
    return;
  }

  const stageIds = new Set<string>();
  const nextRefs: { where: string; next: string }[] = [];

  item.stages.forEach((stage, s) => {
    const stageWhere = isObject(stage) && typeof stage.id === 'string' ? `stage "${stage.id}"` : `stage ${s + 1}`;
    if (!isObject(stage)) {
      problems.push(`${stageWhere} must be an object`);
      return;
    }
    checkFields(stage, STAGE_FIELDS, stageWhere, problems);
    checkText(stage, 'id', stageWhere, problems);
    checkText(stage, 'title', stageWhere, problems);
    checkText(stage, 'description', stageWhere, problems);
    checkPositiveNumber(stage, 'durationHours', stageWhere, problems);
    if (typeof stage.id === 'string') {
      if (stageIds.has(stage.id)) problems.push(`${stageWhere} is listed twice`);
      stageIds.add(stage.id);
    }

    if (!Array.isArray(stage.choices) || stage.choices.length === 0) {
      problems.push(`${stageWhere} needs a non-empty "choices" list`);
      return;
    }
    stage.choices.forEach((choice, c) => {
      const where = `${stageWhere} choice ${c + 1}`;
      if (!isObject(choice)) {
        problems.push(`${where} must be an object`);
        return;
      }
      checkFields(choice, CHOICE_FIELDS, where, problems);
      checkText(choice, 'text', where, problems);
      checkText(choice, 'next', where, problems, false);
      checkOutcome(choice, where, problems);
      if (typeof choice.next === 'string') nextRefs.push({ where, next: choice.next });
    });
  });

  // A misspelled "next" would silently end the operation early, so catch it here.
  for (const ref of nextRefs) {
    if (!stageIds.has(ref.next)) problems.push(`${ref.where} has "next": "${ref.next}", but there is no stage with that id`);
  }
}

/** Stages no choice ever leads to are probably a missing or misspelled "next". */
function unreachableStages(op: Operation): string[] {
  const reachable = new Set([op.stages[0].id]);
  for (const stage of op.stages) {
    for (const choice of stage.choices) if (choice.next) reachable.add(choice.next);
  }
  return op.stages
    .filter((stage) => !reachable.has(stage.id))
    .map((stage) => `operations.json "${op.id}": stage "${stage.id}" can never be reached (no choice has it as "next")`);
}
