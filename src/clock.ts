// The only place in the game that reads the real clock. The engine is always
// handed `now` as a number, which means:
//  - the dev panel can speed time up or skip ahead without the engine knowing;
//  - tests and simulations can feed in any time they like;
//  - a future server can use its own clock instead.

export interface DevSettings {
  /** 1 = real time. 60 = one game minute per real second. */
  speed: number;
  /** How far game time has been pushed ahead of real time, in ms. */
  offsetMs: number;
}

export interface Clock {
  now(): number;
  skip(ms: number): void;
  setSpeed(speed: number): void;
  readonly settings: DevSettings;
}

export function createClock(settings: DevSettings): Clock {
  let lastReal = Date.now();

  // Speeding time up is the same as skipping ahead a little on every read:
  // at speed 60, each real millisecond adds 59 extra to the offset. So the
  // game only ever needs one idea, "game time = real time + offset".
  function now(): number {
    const real = Date.now();
    settings.offsetMs += (real - lastReal) * (settings.speed - 1);
    lastReal = real;
    return real + settings.offsetMs;
  }

  return {
    now,
    skip(ms) {
      now(); // Bank any sped-up time first, so the skip adds on top of it.
      settings.offsetMs += ms;
    },
    setSpeed(speed) {
      now(); // Bank time passed at the old speed before switching.
      settings.speed = speed;
    },
    settings,
  };
}
