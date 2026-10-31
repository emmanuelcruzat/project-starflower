import ambitionsRaw from './data/ambitions.json';
import governmentsRaw from './data/governments.json';
import incidentsRaw from './data/incidents.json';
import operationsRaw from './data/operations.json';
import prefixesRaw from './data/prefixes.json';
import titlesRaw from './data/titles.json';
import type { GameContent } from './types';
import { validateAmbitions } from './validation/ambitions';
import type { ValidationReport } from './validation/common';
import { checkLinks } from './validation/links';
import { validateGovernments, validatePrefixes, validateTitles } from './validation/nationData';
import { validateIncidents } from './validation/incidents';
import { validateOperations } from './validation/operations';

export interface LoadedContent extends ValidationReport {
  /** Null when a problem is serious enough that the game can't start. */
  content: GameContent | null;
}

/**
 * Validates every data file and bundles the valid entries into one
 * GameContent object. Only this file knows where the content comes from, so
 * fetching it from a server later is a change in this one place.
 */
export function loadContent(): LoadedContent {
  const report: ValidationReport = { errors: [], warnings: [] };

  const titles = validateTitles(titlesRaw, report);
  const governments = validateGovernments(governmentsRaw, report);
  const partial = {
    incidents: validateIncidents(incidentsRaw, report),
    operations: validateOperations(operationsRaw, report),
    ambitions: validateAmbitions(ambitionsRaw, report),
    prefixes: validatePrefixes(prefixesRaw, report),
    governments,
  };

  if (!titles || governments.length === 0) {
    report.errors.push('The game cannot start without valid titles.json and at least one valid government.');
    return { ...report, content: null };
  }

  const content: GameContent = { ...partial, titles };
  report.warnings.push(...checkLinks(content));
  return { ...report, content };
}
