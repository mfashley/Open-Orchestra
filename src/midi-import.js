import { RANGES, validateArrangement } from "../arrangement.js";
const EPS = 0.00001;
const round = (value) => Math.round(value * 2) / 2;

export function guessInstrument(program) {
  if (program >= 0 && program <= 7) return "piano";
  if (program === 13) return "xylophone";
  if (program === 40 || program === 41) return "violin";
  if (program === 42 || program === 43) return "cello";
  if (program >= 56 && program <= 63) return "trumpet";
  if (program >= 72 && program <= 79) return "flute";
  return "";
}

export function adaptMidi(midi, { mappings, startBar, bars, bpm, title }) {
  if (!Number.isInteger(startBar) || startBar < 1 || ![4, 8, 16].includes(bars))
    throw new Error(
      "Choose a valid starting measure and a 4, 8, or 16 measure excerpt.",
    );
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 180)
    throw new Error("Choose a tempo from 40 to 180 BPM.");
  if (!Number.isFinite(midi.header.ppq) || midi.header.ppq <= 0)
    throw new Error("This MIDI uses an unsupported time division.");
  if (
    (midi.header.timeSignatures || []).some(
      (entry) => entry.timeSignature[0] !== 4 || entry.timeSignature[1] !== 4,
    )
  )
    throw new Error("This first importer supports 4/4 MIDI files only.");
  const selected = Object.entries(mappings).filter(
    ([, instrument]) => instrument,
  );
  if (!selected.length)
    throw new Error("Assign at least one track to an instrument.");
  if (
    new Set(selected.map(([, instrument]) => instrument)).size !==
    selected.length
  )
    throw new Error("Assign only one track to each Poco instrument.");
  const start = (startBar - 1) * 4,
    beats = bars * 4;
  const parts = {};
  const report = { shifted: 0, timing: 0, reduced: 0, shortened: 0 };
  const messages = [
    "Adapted rehearsal excerpt: timing is snapped to eighth notes.",
  ];
  if (!midi.header.timeSignatures.length)
    messages.push("No time signature was found; this excerpt assumes 4/4.");
  if (midi.header.tempos.length > 1)
    messages.push(
      "Tempo changes are replaced by your selected constant tempo.",
    );

  for (const [trackIndex, instrument] of selected) {
    const track = midi.tracks[Number(trackIndex)];
    if (!track || track.instrument.percussion || !RANGES[instrument])
      throw new Error("Choose a pitched track and a supported instrument.");
    const [low, high] = RANGES[instrument];
    const groups = new Map();
    for (const note of track.notes) {
      const from = note.ticks / midi.header.ppq - start;
      const to = from + note.durationTicks / midi.header.ppq;
      if (to <= 0 || from >= beats) continue;
      const beat = Math.max(0, round(from));
      const end = Math.min(beats, Math.max(beat + 0.5, round(to)));
      if (beat >= beats || end <= beat) continue;
      if (
        Math.abs(beat - Math.max(0, from)) > EPS ||
        Math.abs(end - Math.min(beats, to)) > EPS
      )
        report.timing++;
      let pitch = note.midi;
      const original = pitch;
      while (pitch < low) pitch += 12;
      while (pitch > high) pitch -= 12;
      if (pitch !== original) report.shifted++;
      if (!groups.has(beat)) groups.set(beat, []);
      groups.get(beat).push({ pitch, end });
    }
    const events = [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([beat, notes]) => {
        const unique = [...new Set(notes.map((note) => note.pitch))].sort(
          (a, b) => a - b,
        );
        const kept =
          instrument === "piano" ? unique.slice(-3) : unique.slice(-1);
        report.reduced += unique.length - kept.length;
        const end = Math.min(
          ...notes
            .filter((note) => kept.includes(note.pitch))
            .map((note) => note.end),
        );
        return { beat, duration: end - beat, notes: kept };
      });
    events.forEach((event, index) => {
      const next = events[index + 1];
      if (next && event.beat + event.duration > next.beat) {
        event.duration = next.beat - event.beat;
        report.shortened++;
      }
    });
    if (!events.length) {
      messages.push(
        `No notes for ${instrument} in this excerpt; its part was omitted.`,
      );
      continue;
    }
    const playableNotes = [
      ...new Set(events.flatMap((event) => event.notes)),
    ].sort((a, b) => a - b);
    if (playableNotes.length > 24)
      throw new Error(
        `${instrument} uses more than 24 different pitches. Choose a shorter or simpler excerpt.`,
      );
    parts[instrument] = { playableNotes, events };
  }
  if (!Object.keys(parts).length)
    throw new Error(
      "No selected notes in that excerpt. Try an earlier or later starting measure.",
    );
  if (report.shifted)
    messages.push(
      `${report.shifted} notes moved by octaves to fit instrument ranges.`,
    );
  if (report.timing)
    messages.push(
      `${report.timing} note timings adjusted to the eighth-note grid.`,
    );
  if (report.reduced)
    messages.push(
      `${report.reduced} simultaneous pitches removed: winds/strings use a single melody; piano keeps up to three-note chords.`,
    );
  if (report.shortened)
    messages.push(
      `${report.shortened} overlapping holds shortened before the next entrance.`,
    );
  const arrangement = validateArrangement({
    version: 1,
    title: String(title || "Imported piece").slice(0, 100),
    bpm,
    beats,
    parts,
  });
  return { arrangement, messages };
}
