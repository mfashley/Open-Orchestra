import { FIRST_LIGHT, DEFAULT_OCTAVE } from '../arrangement.js';
export { DEFAULT_OCTAVE };
export const PRESET = { id: 'first-light', ...FIRST_LIGHT };

// Compatibility bridge: existing pad guidance can consume any validated arrangement.
export function partFor(instrument, arrangement = FIRST_LIGHT) {
  const part = arrangement.parts[instrument];
  if (!part) return [];
  return part.events.map((event) => ({
    beat: event.beat,
    length: event.duration,
    pads: event.notes.map((note) => part.playableNotes.indexOf(note)),
  }));
}

export function guideAt(session, instrument, now) {
  if (!session) return null;
  const arrangement = session.arrangement || FIRST_LIGHT;
  const beat = (now - session.startsAt) * arrangement.bpm / 60000;
  const events = partFor(instrument, arrangement);
  const active = events.filter((event) => beat >= event.beat && beat < event.beat + event.length);
  const next = events.find((event) => event.beat > beat);
  const nextPads = next ? events.filter((event) => event.beat === next.beat).flatMap((event) => event.pads) : [];
  const bars = arrangement.beats / 4;
  return {
    beat,
    count: beat < 0 ? Math.min(4, Math.ceil(-beat)) : 0,
    finished: beat >= arrangement.beats,
    bar: Math.min(bars, Math.max(1, Math.floor(beat / 4) + 1)),
    bars,
    pulse: ((Math.floor(beat) % 4) + 4) % 4,
    active: [...new Set(active.flatMap((event) => event.pads))],
    next: [...new Set(nextPads)],
    nextBeat: next?.beat,
    progress: Math.min(100, Math.max(0, beat / arrangement.beats * 100)),
  };
}
