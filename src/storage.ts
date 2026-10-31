import type { DevSettings } from './clock';
import type { Nation } from './types';

// The only module that touches localStorage. When a backend arrives, this is
// the file that changes into API calls.

// Bump this when the Nation shape changes. Old saves are then discarded
// instead of loading half-compatible data that crashes in odd places.
const SAVE_VERSION = 2;
const SAVE_KEY = 'starflower-galaxy/save';
const DEV_KEY = 'starflower-galaxy/dev';
/** Saves from the original turn-based game. A different shape entirely, so they can't be converted. */
const OBSOLETE_KEYS = ['starflower-ii/save'];
/** Keys from when the game was called M33. Same save format, so they're carried over. */
const RENAMED_KEYS: [oldKey: string, newKey: string][] = [
  ['m33/save', SAVE_KEY],
  ['m33/dev', DEV_KEY],
];

interface SaveFile {
  version: number;
  nation: Nation | null;
}

// localStorage can throw (private browsing, storage full, disabled), so every
// access is wrapped. A failed save shouldn't crash the game.

/**
 * Tidies up keys from older versions of the game. Safe to call any number of
 * times: after the first run there is nothing left to move.
 */
function cleanUpOldKeys(): void {
  for (const key of OBSOLETE_KEYS) localStorage.removeItem(key);
  for (const [oldKey, newKey] of RENAMED_KEYS) {
    const old = localStorage.getItem(oldKey);
    // Never overwrite a save that already exists under the new name.
    if (old !== null && localStorage.getItem(newKey) === null) localStorage.setItem(newKey, old);
    localStorage.removeItem(oldKey);
  }
}

export function loadNation(): Nation | null {
  try {
    cleanUpOldKeys();
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveFile;
    return data?.version === SAVE_VERSION ? data.nation : null;
  } catch (err) {
    console.warn('Ignoring an unreadable save:', err);
    return null;
  }
}

export function saveNation(nation: Nation | null): void {
  try {
    const file: SaveFile = { version: SAVE_VERSION, nation };
    localStorage.setItem(SAVE_KEY, JSON.stringify(file));
  } catch (err) {
    console.warn('Could not save the game:', err);
  }
}

export function loadDevSettings(): DevSettings {
  try {
    // main.ts loads dev settings before the nation, so old keys are tidied here too.
    cleanUpOldKeys();
    const data = JSON.parse(localStorage.getItem(DEV_KEY) ?? 'null');
    if (typeof data?.speed === 'number' && typeof data?.offsetMs === 'number') return data;
  } catch {
    // Fall through to defaults.
  }
  return { speed: 1, offsetMs: 0 };
}

export function saveDevSettings(settings: DevSettings): void {
  try {
    localStorage.setItem(DEV_KEY, JSON.stringify(settings));
  } catch {
    // Dev settings are a convenience; losing them is harmless.
  }
}
