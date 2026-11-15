// A prepared eight-bar arrangement. Indexes map to C D E F G A B C.
export const PRESET = { id: 'first-light', title: 'First Light', bpm: 90, beats: 32 };
export const DEFAULT_OCTAVE = { piano: 4, violin: 4, flute: 5, trumpet: 4, cello: 2, xylophone: 5 };
const chords = [[0, 2, 4], [4, 6, 1], [5, 0, 2], [3, 5, 7]];
const roots = [0, 4, 5, 3];
const melodies = [[2, 4], [4, 1], [5, 2], [3, 5]];
const upper = [4, 6, 7, 5];

export function partFor(instrument) {
  const events = [];
  for (let bar = 0; bar < 8; bar++) {
    const harmony = bar % 4;
    const at = bar * 4;
    if (instrument === 'piano') {
      events.push({ beat: at, length: 1.5, pads: chords[harmony] });
    } else if (instrument === 'cello') {
      events.push({ beat: at, length: 3, pads: [roots[harmony]] });
    } else if (instrument === 'violin') {
      events.push({ beat: at + 1, length: 2, pads: [upper[harmony]] });
    } else if (instrument === 'trumpet') {
      melodies[harmony].forEach((pad, i) => events.push({ beat: at + i * 2, length: 1, pads: [pad] }));
    } else if (instrument === 'flute') {
      events.push({ beat: at + 2, length: 1.5, pads: [melodies[harmony][1]] });
    } else if (instrument === 'xylophone') {
      [0, 1, 2, 1].forEach((position, i) => events.push({ beat: at + i, length: 0.5, pads: [chords[harmony][position]] }));
    }
  }
  return events;
}

export function guideAt(session, instrument, now) {
  if (!session) return null;
  const beat = (now - session.startsAt) * session.bpm / 60000;
  const events = partFor(instrument);
  const active = events.find((event) => beat >= event.beat && beat < event.beat + event.length);
  const next = events.find((event) => event.beat > beat);
  return {
    beat,
    count: beat < 0 ? Math.min(4, Math.ceil(-beat)) : 0,
    finished: beat >= session.beats,
    bar: Math.min(8, Math.max(1, Math.floor(beat / 4) + 1)),
    pulse: ((Math.floor(beat) % 4) + 4) % 4,
    active: active?.pads || [],
    next: next?.pads || [],
    nextBeat: next?.beat,
    progress: Math.min(100, Math.max(0, beat / session.beats * 100)),
  };
}
