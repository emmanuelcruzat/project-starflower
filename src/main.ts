import './style.css';
import { createClock } from './clock';
import { loadContent } from './content';
import { abandonAmbition, startAmbition } from './engine/ambitions';
import { resolveIncident } from './engine/incidents';
import { changePrefix, createNation } from './engine/nation';
import { abandonOperation, chooseStageOption, startOperation } from './engine/operations';
import { advanceTo } from './engine/simulation';
import { loadDevSettings, loadNation, saveDevSettings, saveNation } from './storage';
import type { GameContent, Nation } from './types';
import { mountDevPanel, updateDevClock } from './ui/devPanel';
import { updateLiveTimers } from './ui/dom';
import { renderCreation, renderGame, showContentProblems, viewKey, type Tab } from './ui/render';

// The entry point connects things and does nothing else. The engine decides
// what happens, the ui/ modules draw it, and this file holds the one
// current nation and passes it between them.

const TICK_MS = 1000;

const loaded = loadContent();
for (const error of loaded.errors) console.error(`[data] ${error}`);
for (const warning of loaded.warnings) console.warn(`[data] ${warning}`);
showContentProblems(loaded.errors.length, loaded.warnings.length);

if (loaded.content) start(loaded.content);

function start(content: GameContent): void {
  const devMode = new URLSearchParams(location.search).has('dev');
  const devSettings = loadDevSettings();
  // A fast-forward speed is only allowed while the dev panel is visible, so
  // the game can't race ahead unnoticed. Any offset already added stays,
  // because saved timestamps depend on it.
  if (!devMode) devSettings.speed = 1;
  const clock = createClock(devSettings);

  let nation: Nation | null = loadNation();
  // UI-only state: which tab is open, and whether the latest decision's result is showing.
  let tab: Tab = 'overview';
  let showOutcome = false;
  let lastViewKey = '';

  function draw(): void {
    const now = clock.now();
    if (!nation) {
      renderCreation(content, (setup) => {
        showOutcome = false;
        tab = 'overview';
        commit(createNation(setup, content, clock.now()));
      });
      lastViewKey = '';
      return;
    }
    const outcome = showOutcome ? nation.log[0] ?? null : null;
    renderGame(nation, content, now, { tab, outcome }, {
      onIncidentChoice: (id, choice) => act((n, t) => resolveIncident(n, content, id, choice, t)),
      onStartOperation: (id) => act((n, t) => startOperation(n, content, id, t), false),
      onOperationChoice: (id, index) => act((n, t) => chooseStageOption(n, content, id, index, t)),
      onAbandonOperation: (id) => {
        if (confirm('Abandon this operation? Progress on the current stage will be lost.')) {
          act((n, t) => abandonOperation(n, content, id, t), false);
        }
      },
      onStartAmbition: (id) => act((n, t) => startAmbition(n, content, id, t), false),
      onAbandonAmbition: () => {
        if (confirm('Abandon this ambition? All progress will be lost.')) act((n, t) => abandonAmbition(n, content, t), false);
      },
      onChangePrefix: (prefix) => act((n, t) => changePrefix(n, content, prefix, t), false),      onCloseOutcome: () => {
        showOutcome = false;
        draw();
      },
      onSelectTab: (next) => {
        tab = next;
        showOutcome = false; // An old result shouldn't greet the player when they come back to the planner.
        draw();
      },
    });
    lastViewKey = viewKey(nation, content, now);
  }

  /** Every state change goes through here, so saving and redrawing are never forgotten. */
  function commit(next: Nation): void {
    nation = next;
    saveNation(nation);
    draw();
  }

  /**
   * Runs a player action. The nation is brought up to date first, so the
   * action happens "now" and not at the last tick. `showResult` controls
   * whether the outcome box appears afterwards.
   */
  function act(action: (n: Nation, now: number) => Nation, showResult = true): void {
    if (!nation) return;
    const now = clock.now();
    const before = advanceTo(nation, now, content);
    const after = action(before, now);
    showOutcome = showResult && after !== before;
    commit(after);
  }

  /** Once a second: let time pass, then redraw only if something visible changed. */
  function tick(): void {
    const now = clock.now();
    if (devMode) {
      updateDevClock(clock, now);
      saveDevSettings(clock.settings);
    }
    if (!nation) return;

    nation = advanceTo(nation, now, content);
    saveNation(nation);
    if (viewKey(nation, content, now) !== lastViewKey) draw();
    else updateLiveTimers(now);
  }

  document.getElementById('new-nation')?.addEventListener('click', () => {
    if (!confirm('Abandon your nation and found a new one? This cannot be undone.')) return;
    nation = null;
    saveNation(null);
    draw();
  });

  if (devMode) mountDevPanel(clock, tick);

  // Catch up on everything that happened while the page was closed, then start the clock.
  if (nation) nation = advanceTo(nation, clock.now(), content);
  draw();
  tick();
  setInterval(tick, TICK_MS);
}
