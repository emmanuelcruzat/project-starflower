import type { Clock } from '../clock';
import { HOUR, DAY } from '../config';
import { button, byId, el } from './dom';

// Real-time pacing makes testing painful, so the dev panel bends the clock.
// It only talks to the Clock and never touches the engine, so the game
// behaves exactly as it would in real time, just sooner.

const SPEEDS = [1, 60, 600, 3600];
const SKIPS: [label: string, ms: number][] = [['+1h', HOUR], ['+6h', 6 * HOUR], ['+1 day', DAY]];

/**
 * Builds the panel once. `onTimeChanged` lets main.ts advance and redraw
 * immediately; `onFogChanged` turns the star map's fog of war on or off.
 */
export function mountDevPanel(clock: Clock, onTimeChanged: () => void, onFogChanged: (on: boolean) => void): void {
  const panel = byId('dev-panel');
  panel.hidden = false;

  const clockText = el('p', 'dev-clock');
  clockText.id = 'dev-clock';
  const speedRow = el('div', 'dev-row');

  function drawSpeeds(): void {
    speedRow.replaceChildren(
      el('span', 'muted', 'Speed'),
      ...SPEEDS.map((speed) =>
        button(`${speed}×`, `dev-button ${clock.settings.speed === speed ? 'selected' : ''}`, () => {
          clock.setSpeed(speed);
          drawSpeeds();
          onTimeChanged();
        }),
      ),
    );
  }

  const skipRow = el('div', 'dev-row');
  skipRow.append(
    el('span', 'muted', 'Skip'),
    ...SKIPS.map(([label, ms]) =>
      button(label, 'dev-button', () => {
        clock.skip(ms);
        onTimeChanged();
      }),
    ),
  );

  // Fog of war: see the whole map while testing, or play it as a player would.
  const fogRow = el('div', 'dev-row');
  function drawFog(): void {
    const on = clock.settings.fogOfWar !== false;
    fogRow.replaceChildren(
      el('span', 'muted', 'Fog of war'),
      button(on ? 'On' : 'Off', `dev-button ${on ? 'selected' : ''}`, () => {
        clock.settings.fogOfWar = !on;
        drawFog();
        onFogChanged(!on);
      }),
    );
  }

  drawSpeeds();
  drawFog();
  panel.replaceChildren(el('p', 'eyebrow', 'Developer'), clockText, speedRow, skipRow, fogRow);
}

export function updateDevClock(clock: Clock, now: number): void {
  const node = document.getElementById('dev-clock');
  if (!node) return;
  const aheadHours = clock.settings.offsetMs / HOUR;
  node.textContent = `Game time ${new Date(now).toLocaleString()} (${aheadHours.toFixed(1)}h ahead)`;
}
