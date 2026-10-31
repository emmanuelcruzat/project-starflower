import type { Clock } from '../clock';
import { HOUR, DAY } from '../config';
import { button, byId, el } from './dom';

// Real-time pacing makes testing painful, so the dev panel bends the clock.
// It only talks to the Clock and never touches the engine, so the game
// behaves exactly as it would in real time, just sooner.

const SPEEDS = [1, 60, 600, 3600];
const SKIPS: [label: string, ms: number][] = [['+1h', HOUR], ['+6h', 6 * HOUR], ['+1 day', DAY]];

/** Builds the panel once. `onTimeChanged` lets main.ts advance and redraw immediately. */
export function mountDevPanel(clock: Clock, onTimeChanged: () => void): void {
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

  drawSpeeds();
  panel.replaceChildren(el('p', 'eyebrow', 'Developer'), clockText, speedRow, skipRow);
}

export function updateDevClock(clock: Clock, now: number): void {
  const node = document.getElementById('dev-clock');
  if (!node) return;
  const aheadHours = clock.settings.offsetMs / HOUR;
  node.textContent = `Game time ${new Date(now).toLocaleString()} (${aheadHours.toFixed(1)}h ahead)`;
}
