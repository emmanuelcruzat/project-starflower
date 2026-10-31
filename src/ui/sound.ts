// Small sound effects, synthesized with the Web Audio API so the game needs
// no audio files. Browsers only allow sound after the player has clicked or
// pressed a key on the page; before that, effects are silently skipped.

let context: AudioContext | null = null;
let noise: AudioBuffer | null = null;

/**
 * Runs `play` with a running audio context, starting one if needed. Skipped
 * if the player hasn't interacted with the page yet: the browser would hold
 * the sound back and might play it much later, out of nowhere.
 */
function withAudio(play: (ctx: AudioContext) => void): void {
  if (typeof AudioContext === 'undefined' || navigator.userActivation?.hasBeenActive === false) return;
  context ??= new AudioContext();
  const ctx = context;
  if (ctx.state === 'running') play(ctx);
  else ctx.resume().then(() => play(ctx), () => {});
}

/** One second of white noise, made once and reused. */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise) return noise;
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

/** How long the whoosh lasts, in seconds. Matches the zoom animation in style.css (.arrive-out, .arrive-in). */
const WHOOSH_SECONDS = 0.45;
const WHOOSH_VOLUME = 0.22;

/**
 * A soft whoosh for moving between map levels: falling in pitch when
 * pulling 'out' to a wider view, rising when going 'in'. Filtered noise
 * gives the rush of air, and a quiet sine underneath gives it a tone.
 */
export function playWhoosh(direction: 'in' | 'out'): void {
  withAudio((ctx) => whoosh(ctx, direction));
}

function whoosh(ctx: AudioContext, direction: 'in' | 'out'): void {
  const now = ctx.currentTime;
  const end = now + WHOOSH_SECONDS;
  const [from, to] = direction === 'in' ? [300, 2400] : [2400, 300];

  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(WHOOSH_VOLUME, now + WHOOSH_SECONDS * 0.3);
  master.gain.exponentialRampToValueAtTime(0.0001, end);
  master.connect(ctx.destination);

  const rush = ctx.createBufferSource();
  rush.buffer = noiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(from, now);
  filter.frequency.exponentialRampToValueAtTime(to, end);
  rush.connect(filter).connect(master);

  const tone = ctx.createOscillator();
  tone.type = 'sine';
  tone.frequency.setValueAtTime(from / 4, now);
  tone.frequency.exponentialRampToValueAtTime(to / 4, end);
  const toneGain = ctx.createGain();
  toneGain.gain.value = 0.25;
  tone.connect(toneGain).connect(master);

  for (const source of [rush, tone]) {
    source.start(now);
    source.stop(end);
  }
  // Disconnect when done, so finished effects don't pile up in the graph.
  tone.onended = () => master.disconnect();
}

/** Notes in each panel chirp, in Hz, played one after another. */
const CHIRPS: Record<'constellation' | 'system', number[]> = {
  constellation: [880, 1320],
  system: [1320, 1760, 2640],
};
const CHIRP_NOTE_SECONDS = 0.045;
const CHIRP_VOLUME = 0.08;

/**
 * A quick electronic chirp, like a readout panel opening: a few short notes
 * stepping upwards. Square waves give it a buzzy, screen-like edge, and a
 * filter takes off the harshest highs. A system gets one more note, higher,
 * than a constellation.
 */
export function playChirp(kind: 'constellation' | 'system'): void {
  withAudio((ctx) => {
    const now = ctx.currentTime;
    const notes = CHIRPS[kind];
    const end = now + notes.length * CHIRP_NOTE_SECONDS + 0.08;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 4200;
    const master = ctx.createGain();
    master.gain.value = CHIRP_VOLUME;
    filter.connect(master).connect(ctx.destination);

    const oscillator = ctx.createOscillator();
    oscillator.type = 'square';
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    notes.forEach((frequency, i) => {
      const start = now + i * CHIRP_NOTE_SECONDS;
      // Each note starts a touch flat and slides up, which reads as "tech".
      oscillator.frequency.setValueAtTime(frequency * 0.94, start);
      oscillator.frequency.exponentialRampToValueAtTime(frequency, start + CHIRP_NOTE_SECONDS * 0.6);
      envelope.gain.setValueAtTime(1, start + 0.002);
      envelope.gain.exponentialRampToValueAtTime(0.25, start + CHIRP_NOTE_SECONDS * 0.9);
    });
    // The last note rings out briefly.
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(envelope).connect(filter);
    oscillator.start(now);
    oscillator.stop(end);
    oscillator.onended = () => master.disconnect();
  });
}
