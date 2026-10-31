import { availablePrefixes } from '../engine/titles';
import type { Condition, GameContent, Outcome } from '../types';

// Checks between files. Each file can be valid on its own and still not fit
// together: a flag nobody sets, a government that doesn't exist, a
// government with no prefixes. These are warnings, because the game still
// runs; some content just can never appear.

export function checkLinks(content: GameContent): string[] {
  const warnings: string[] = [];
  const conditions = collectConditions(content);
  const settable = collectSettableFlags(content);
  const governmentIds = new Set(content.governments.map((g) => g.id));

  // Chains break silently if a flag is misspelled at either end.
  for (const { label, condition } of conditions) {
    for (const flag of [...(condition.requiresFlags ?? []), ...(condition.forbidsFlags ?? [])]) {
      if (!settable.has(flag)) warnings.push(`${label}: condition uses flag "${flag}", but nothing ever sets it (typo?)`);
    }
    for (const id of condition.governments ?? []) {
      if (!governmentIds.has(id)) warnings.push(`${label}: condition names government "${id}", which isn't in governments.json`);
    }
  }

  // Every government needs at least one prefix at its starting stats, or
  // nobody could found a nation of that type.
  for (const government of content.governments) {
    const subject = { governmentId: government.id, stats: government.startingStats, flags: [], foundedAt: 0, lastUpdatedAt: 0 };
    if (availablePrefixes(subject, content).length === 0) {
      warnings.push(`governments.json "${government.id}": no prefix in prefixes.json is available at its starting stats`);
    }
  }
  return warnings;
}

function collectConditions(content: GameContent): { label: string; condition: Condition }[] {
  const found: { label: string; condition: Condition }[] = [];
  const add = (label: string, condition?: Condition) => {
    if (condition) found.push({ label, condition });
  };
  for (const i of content.incidents) add(`incidents.json "${i.id}"`, i.condition);
  for (const o of content.operations) add(`operations.json "${o.id}"`, o.condition);
  for (const a of content.ambitions) add(`ambitions.json "${a.id}"`, a.condition);
  for (const p of content.prefixes) add(`prefixes.json "${p.name}"`, p.condition);
  return found;
}

function collectSettableFlags(content: GameContent): Set<string> {
  const outcomes: Outcome[] = [
    ...content.incidents.flatMap((i) => [...i.choices, i.dismiss]),
    ...content.operations.flatMap((o) => o.stages.flatMap((s) => s.choices)),
  ];
  return new Set([
    ...outcomes.flatMap((o) => o.setFlags ?? []),
    ...content.ambitions.flatMap((a) => a.setFlags ?? []),
  ]);
}
