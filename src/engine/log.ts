import { MAX_LOG_ENTRIES } from '../config';
import type { LogEntry, Nation } from '../types';

/** Adds an entry to the front of the log, dropping the oldest. Changes `nation` in place. */
export function addLog(nation: Nation, entry: LogEntry): void {
  nation.log = [entry, ...nation.log].slice(0, MAX_LOG_ENTRIES);
}
