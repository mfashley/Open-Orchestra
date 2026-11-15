/* Shared by the Node server and React client. Notes use MIDI concert pitches.
   Beat 0 is the first beat after the count-in; durations are measured in beats. */
export const INSTRUMENTS = ['piano', 'violin', 'flute', 'trumpet', 'cello', 'xylophone'];
export const DEFAULT_OCTAVE = { piano: 4, violin: 4, flute: 5, trumpet: 4, cello: 2, xylophone: 5 };
export const RANGES = {
  piano: [48, 84], violin: [60, 96], flute: [72, 96],
  trumpet: [48, 84], cello: [36, 72], xylophone: [60, 96],
};
const steps = [0, 2, 4, 5, 7, 9, 11, 12];
export function defaultNotes(instrument) {
  return steps.map((step) => (DEFAULT_OCTAVE[instrument] + 1) * 12 + step);
}

// Returns a clean copy. Unknown fields are discarded at the trust boundary.
// AI and import adapters must pass through this before a room can use their music.
export function validateArrangement(input) {
  const fail = (message) => { throw new Error(`Invalid arrangement: ${message}`); };
  if (!input || typeof input !== 'object') fail('expected an object.');
  if (input.version !== 1) fail('unsupported format version.');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 100) fail('title must contain 1–100 characters.');
  if (!Number.isFinite(input.bpm) || input.bpm < 40 || input.bpm > 180) fail('tempo must be 40–180 BPM.');
  if (!Number.isInteger(input.beats) || input.beats < 4 || input.beats > 128 || input.beats % 4) fail('length must be 4–128 beats in complete 4/4 measures.');
  if (!input.parts || typeof input.parts !== 'object' || Array.isArray(input.parts)) fail('missing instrument parts.');
  const parts = {};
  for (const [instrument, part] of Object.entries(input.parts)) {
    if (!INSTRUMENTS.includes(instrument)) fail(`unknown instrument ${instrument}.`);
    if (!part || !Array.isArray(part.playableNotes) || part.playableNotes.length < 1 || part.playableNotes.length > 24) fail(`${instrument} needs 1–24 playable notes.`);
    const [low, high] = RANGES[instrument];
    const notes = [...new Set(part.playableNotes)].sort((a, b) => a - b);
    if (notes.length !== part.playableNotes.length || notes.some((note) => !Number.isInteger(note) || note < low || note > high)) fail(`${instrument} contains duplicate or out-of-range pitches (${low}–${high}).`);
    if (!Array.isArray(part.events) || part.events.length > 512) fail(`${instrument} has too many events.`);
    const events = part.events.map((event) => {
      if (!event || !Number.isFinite(event.beat) || event.beat < 0 || !Number.isFinite(event.duration) || event.duration <= 0 || event.beat + event.duration > input.beats + 0.000001) fail(`${instrument} has an invalid note time.`);
      if (!Array.isArray(event.notes) || event.notes.length < 1 || event.notes.length > 8 || new Set(event.notes).size !== event.notes.length || event.notes.some((note) => !notes.includes(note))) fail(`${instrument} has notes outside its playable palette.`);
      return { beat: event.beat, duration: event.duration, notes: [...event.notes].sort((a, b) => a - b) };
    }).sort((a, b) => a.beat - b.beat);
    parts[instrument] = { playableNotes: notes, events };
  }
  if (!Object.keys(parts).length) fail('at least one instrument is required.');
  if (!Object.values(parts).some((part) => part.events.length)) fail('the piece is empty.');
  return { version: 1, title: input.title.trim(), bpm: input.bpm, beats: input.beats, parts };
}

function makeFirstLight() {
  const parts = Object.fromEntries(INSTRUMENTS.map((id) => [id, { playableNotes: defaultNotes(id), events: [] }]));
  const chords = [[0, 2, 4], [4, 6, 1], [5, 0, 2], [3, 5, 7]];
  const roots = [0, 4, 5, 3], upper = [4, 6, 7, 5];
  const melody = [[2, 4], [4, 1], [5, 2], [3, 5]];
  function add(id, beat, duration, pads) {
    parts[id].events.push({ beat, duration, notes: pads.map((pad) => parts[id].playableNotes[pad]) });
  }
  for (let bar = 0; bar < 8; bar++) {
    const h = bar % 4, at = bar * 4;
    add('piano', at, 1.5, chords[h]);
    add('cello', at, 3, [roots[h]]);
    add('violin', at + 1, 2, [upper[h]]);
    melody[h].forEach((pad, index) => add('trumpet', at + index * 2, 1, [pad]));
    add('flute', at + 2, 1.5, [melody[h][1]]);
    [0, 1, 2, 1].forEach((position, index) => add('xylophone', at + index, 0.5, [chords[h][position]]));
  }
  return validateArrangement({ version: 1, title: 'First Light', bpm: 90, beats: 32, parts });
}
export const FIRST_LIGHT = makeFirstLight();
