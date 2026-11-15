// Convert the same MIDI events that drive the pads into one measure of notation.
const EPS = 0.00001;
const SPELLINGS = [
  "c",
  "c#",
  "d",
  "d#",
  "e",
  "f",
  "f#",
  "g",
  "g#",
  "a",
  "a#",
  "b",
];
export function notationPitch(midi) {
  const pitch = SPELLINGS[midi % 12];
  return {
    key: `${pitch}/${Math.floor(midi / 12) - 1}`,
    accidental: pitch.includes("#") ? "#" : null,
  };
}

export function measureFor(arrangement, instrument, bar) {
  const part = arrangement?.parts?.[instrument];
  if (!part) return [];
  const start = bar * 4,
    end = start + 4;
  const events = part.events.filter(
    (event) =>
      event.beat < end - EPS && event.beat + event.duration > start + EPS,
  );
  const segments = [];
  let cursor = start;

  function append(from, length, notes, tiedIn = false, tiedOut = false) {
    const first = segments.length;
    while (length > EPS) {
      if (Math.abs(length * 2 - Math.round(length * 2)) > EPS)
        throw new Error("This score currently supports half-beat timing.");
      const options = !notes && from % 1 ? [0.5] : [4, 3, 2, 1.5, 1, 0.5];
      const duration = options.find((value) => value <= length + EPS);
      segments.push({
        beat: from - start,
        length: duration,
        notes,
        tiedIn: false,
        tiedOut: false,
      });
      from += duration;
      length -= duration;
    }
    if (notes && segments.length > first) {
      segments[first].tiedIn = tiedIn;
      segments.at(-1).tiedOut = tiedOut;
      for (let index = first; index < segments.length - 1; index++) {
        segments[index].tiedOut = true;
        segments[index + 1].tiedIn = true;
      }
    }
  }

  for (const event of events) {
    const from = Math.max(start, event.beat);
    const to = Math.min(end, event.beat + event.duration);
    if (from < cursor - EPS)
      throw new Error("Overlapping parts need multiple notation voices.");
    if (from > cursor + EPS) append(cursor, from - cursor, null);
    append(
      from,
      to - from,
      event.notes,
      event.beat < start - EPS,
      event.beat + event.duration > end + EPS,
    );
    cursor = to;
  }
  if (cursor < end - EPS) append(cursor, end - cursor, null);
  return segments;
}

export function cursorPosition(points, beat) {
  const bounded = Math.max(0, Math.min(4, beat));
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index],
      b = points[index + 1];
    if (bounded >= a.beat && bounded <= b.beat)
      return a.x + ((bounded - a.beat) / (b.beat - a.beat)) * (b.x - a.x);
  }
  return points[0]?.x || 0;
}
