import { HOUR, MAX_ACTIVE_OPERATIONS } from '../config';
import type { ActiveOperation, GameContent, Nation, Operation, OperationStage } from '../types';
import { conditionMet } from './conditions';
import { applyEffects, applyOutcome } from './effects';
import { addLog } from './log';

// Operations need no help from the simulation loop. A stage simply finishes
// when its end time passes, and then waits for the player's decision.

export function availableOperations(nation: Nation, content: GameContent): Operation[] {
  return content.operations.filter((op) => {
    if (nation.operations.some((active) => active.operationId === op.id)) return false;
    if (!op.repeatable && nation.completedOperations.includes(op.id)) return false;
    return conditionMet(op.condition, nation);
  });
}

export function hasFreeOperationSlot(nation: Nation): boolean {
  return nation.operations.length < MAX_ACTIVE_OPERATIONS;
}

export function isAwaitingDecision(active: ActiveOperation, now: number): boolean {
  return now >= active.stageEndsAt;
}

/** Looks up the content behind an active operation. Null if the data files changed under a save. */
export function describeActive(
  active: ActiveOperation, content: GameContent,
): { operation: Operation; stage: OperationStage } | null {
  const operation = content.operations.find((op) => op.id === active.operationId);
  const stage = operation?.stages.find((s) => s.id === active.stageId);
  return operation && stage ? { operation, stage } : null;
}

export function startOperation(previous: Nation, content: GameContent, operationId: string, now: number): Nation {
  const operation = availableOperations(previous, content).find((op) => op.id === operationId);
  if (!operation || !hasFreeOperationSlot(previous)) return previous;

  const nation = structuredClone(previous);
  if (operation.startEffects) applyEffects(nation, operation.startEffects);
  const firstStage = operation.stages[0];
  nation.operations.push({
    operationId,
    stageId: firstStage.id,
    stageEndsAt: now + firstStage.durationHours * HOUR,
  });
  addLog(nation, { at: now, kind: 'operation', title: `Operation launched: ${operation.title}`, effects: operation.startEffects });
  return nation;
}

/** The player decides at the end of a stage. The choice decides what comes next. */
export function chooseStageOption(
  previous: Nation, content: GameContent, operationId: string, choiceIndex: number, now: number,
): Nation {
  const active = previous.operations.find((op) => op.operationId === operationId);
  const found = active && describeActive(active, content);
  const choice = found?.stage.choices[choiceIndex];
  if (!active || !found || !choice || !isAwaitingDecision(active, now)) return previous;

  const nation = structuredClone(previous);
  applyOutcome(nation, choice);

  const nextStage = choice.next ? found.operation.stages.find((s) => s.id === choice.next) : undefined;
  if (nextStage) {
    const running = nation.operations.find((op) => op.operationId === operationId)!;
    running.stageId = nextStage.id;
    running.stageEndsAt = now + nextStage.durationHours * HOUR;
  } else {
    nation.operations = nation.operations.filter((op) => op.operationId !== operationId);
    if (!nation.completedOperations.includes(operationId)) nation.completedOperations.push(operationId);
  }

  addLog(nation, {
    at: now,
    kind: 'operation',
    title: nextStage ? `${found.operation.title}: ${found.stage.title}` : `${found.operation.title}: complete`,
    choice: choice.text,
    result: choice.result,
    effects: choice.effects,
  });
  return nation;
}

/** Abandoning keeps whatever effects already happened. The operation can be started again later. */
export function abandonOperation(previous: Nation, content: GameContent, operationId: string, now: number): Nation {
  if (!previous.operations.some((op) => op.operationId === operationId)) return previous;
  const nation = structuredClone(previous);
  nation.operations = nation.operations.filter((op) => op.operationId !== operationId);
  const title = content.operations.find((op) => op.id === operationId)?.title ?? operationId;
  addLog(nation, { at: now, kind: 'operation', title: `Operation abandoned: ${title}` });
  return nation;
}
