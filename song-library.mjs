import {
  FIRST_LIGHT,
  INSTRUMENTS,
  defaultNotes,
  validateArrangement,
} from "./arrangement.js";

// Small original Poco arrangements of familiar historical melodies.
// This provider can later be replaced by an authorized external catalog.
function arrange(title, melody, bpm, harmony) {
  const parts = Object.fromEntries(
    INSTRUMENTS.map((id) => [
      id,
      { playableNotes: defaultNotes(id), events: [] },
    ]),
  );
  const add = (id, beat, duration, pads) =>
    parts[id].events.push({
      beat,
      duration,
      notes: pads.map((pad) => parts[id].playableNotes[pad]),
    });
  let position = 0;
  for (const [pad, duration] of melody) {
    add("trumpet", position, duration, [pad]);
    position += duration;
  }
  for (let bar = 0; bar < 4; bar++) {
    const at = bar * 4,
      chord = harmony[bar];
    add("piano", at, 2, chord);
    add("cello", at, 3, [chord[0]]);
    add("violin", at + 1, 2, [chord[2]]);
    add("flute", at + 2, 1, [chord[1]]);
    [0, 1, 2, 1].forEach((position, beat) =>
      add("xylophone", at + beat, 0.5, [chord[position]]),
    );
  }
  return validateArrangement({ version: 1, title, bpm, beats: 16, parts });
}
const C = [0, 2, 4],
  F = [3, 5, 7],
  G = [4, 6, 1];
const all = [
  {
    id: "first-light",
    title: "First Light",
    artist: "Poco",
    description: "An original, spacious ensemble piece.",
    kind: "Original",
    difficulty: "Easy",
    tags: ["original", "calm", "beginner"],
    arrangement: FIRST_LIGHT,
  },
  {
    id: "ode-to-joy",
    title: "Ode to Joy",
    artist: "Ludwig van Beethoven",
    description:
      "Opening theme · a four-measure Poco arrangement. Trumpet leads the melody.",
    kind: "Public-domain melody",
    difficulty: "Easy",
    tags: ["classical", "beethoven", "symphony 9"],
    arrangement: arrange(
      "Ode to Joy — opening theme",
      [
        [2, 1],
        [2, 1],
        [3, 1],
        [4, 1],
        [4, 1],
        [3, 1],
        [2, 1],
        [1, 1],
        [0, 1],
        [0, 1],
        [1, 1],
        [2, 1],
        [2, 1.5],
        [1, 0.5],
        [1, 2],
      ],
      88,
      [C, G, C, G],
    ),
  },
  {
    id: "twinkle",
    title: "Twinkle, Twinkle, Little Star",
    artist: "Traditional",
    description:
      "Opening phrase · a four-measure Poco arrangement. Trumpet leads the melody.",
    kind: "Public-domain melody",
    difficulty: "Easy",
    tags: ["traditional", "twinkle", "children", "ah vous dirai-je maman"],
    arrangement: arrange(
      "Twinkle, Twinkle — opening phrase",
      [
        [0, 1],
        [0, 1],
        [4, 1],
        [4, 1],
        [5, 1],
        [5, 1],
        [4, 2],
        [3, 1],
        [3, 1],
        [2, 1],
        [2, 1],
        [1, 1],
        [1, 1],
        [0, 2],
      ],
      84,
      [C, F, C, G],
    ),
  },
  {
    id: "frere-jacques",
    title: "Frère Jacques",
    artist: "Traditional",
    description:
      "Opening phrase · a four-measure Poco arrangement. Trumpet leads the melody.",
    kind: "Public-domain melody",
    difficulty: "Easy",
    tags: ["traditional", "frere jacques", "brother john", "french"],
    arrangement: arrange(
      "Frère Jacques — opening phrase",
      [
        [0, 1],
        [1, 1],
        [2, 1],
        [0, 1],
        [0, 1],
        [1, 1],
        [2, 1],
        [0, 1],
        [2, 1],
        [3, 1],
        [4, 2],
        [2, 1],
        [3, 1],
        [4, 2],
      ],
      96,
      [C, C, C, C],
    ),
  },
  {
    id: "mary-lamb",
    title: "Mary Had a Little Lamb",
    artist: "Traditional",
    description:
      "Opening phrase · a four-measure Poco arrangement. Trumpet leads the melody.",
    kind: "Public-domain melody",
    difficulty: "Easy",
    tags: ["traditional", "mary", "children", "beginner"],
    arrangement: arrange(
      "Mary Had a Little Lamb — opening phrase",
      [
        [2, 1],
        [1, 1],
        [0, 1],
        [1, 1],
        [2, 1],
        [2, 1],
        [2, 2],
        [1, 1],
        [1, 1],
        [1, 2],
        [2, 1],
        [4, 1],
        [4, 2],
      ],
      88,
      [C, C, G, C],
    ),
  },
];

function normalize(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
function metadata(song) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    description: song.description,
    kind: song.kind,
    difficulty: song.difficulty,
    bpm: song.arrangement.bpm,
    measures: song.arrangement.beats / 4,
    instruments: Object.keys(song.arrangement.parts),
  };
}
export function searchSongs(query = "") {
  const words = normalize(query)
    .trim()
    .slice(0, 100)
    .split(/\s+/)
    .filter(Boolean);
  return all
    .filter((song) => {
      const text = normalize([song.title, song.artist, ...song.tags].join(" "));
      return words.every((word) => text.includes(word));
    })
    .map(metadata);
}
export function getSong(id) {
  const song = all.find((song) => song.id === id);
  return song
    ? { ...metadata(song), arrangement: validateArrangement(song.arrangement) }
    : null;
}
