import { useRef, useState } from "react";
import { Midi } from "@tonejs/midi";
import { instruments } from "./instruments";
import { adaptMidi, guessInstrument } from "./midi-import";
import "./MidiImport.css";

export default function MidiImport({ socket, playing, connected }) {
  const [midi, setMidi] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [mappings, setMappings] = useState({});
  const [title, setTitle] = useState("");
  const [startBar, setStartBar] = useState(1);
  const [bars, setBars] = useState(4);
  const [bpm, setBpm] = useState(90);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState("");
  const loadVersion = useRef(0);

  async function readFile(event) {
    const file = event.target.files?.[0];
    const version = ++loadVersion.current;
    setMidi(null);
    setPreview(null);
    setError("");
    setMessage("");
    setLoading(false);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Choose a MIDI file smaller than 5 MB.");
      return;
    }
    setLoading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (version !== loadVersion.current) return;
      if (String.fromCharCode(...bytes.slice(0, 4)) !== "MThd")
        throw new Error(
          "This is not a standard MIDI file. Choose a .mid or .midi file, not an audio recording.",
        );
      const parsed = new Midi(bytes);
      if (
        parsed.tracks.length > 64 ||
        parsed.tracks.reduce((sum, track) => sum + track.notes.length, 0) >
          100000
      )
        throw new Error(
          "This MIDI is too large for the rehearsal importer. Try a smaller file.",
        );
      const available = parsed.tracks
        .map((track, index) => ({ track, index }))
        .filter(
          ({ track }) => track.notes.length && !track.instrument.percussion,
        );
      if (!available.length)
        throw new Error(
          "No pitched instrument tracks were found. Drum-only files are not supported.",
        );
      const used = new Set(),
        initial = {};
      available.forEach(({ track, index }) => {
        const guess = guessInstrument(track.instrument.number);
        initial[index] = guess && !used.has(guess) ? guess : "";
        if (initial[index]) used.add(initial[index]);
      });
      setMidi(parsed);
      setTracks(available);
      setMappings(initial);
      setTitle(
        (parsed.name || file.name.replace(/\.midi?$/i, "")).slice(0, 100),
      );
      setBpm(
        Math.max(
          40,
          Math.min(180, Math.round(parsed.header.tempos[0]?.bpm || 120)),
        ),
      );
      setStartBar(1);
    } catch (failure) {
      setError(failure.message || "Could not read this MIDI file.");
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }

  function previewImport(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setPreview(null);
    try {
      setPreview(adaptMidi(midi, { mappings, startBar, bars, bpm, title }));
    } catch (failure) {
      setError(failure.message);
    }
  }
  function invalidate() {
    setPreview(null);
    setMessage("");
  }
  function loadIntoRoom() {
    if (!preview || !socket?.connected) return;
    setBusy(true);
    setError("");
    socket
      .timeout(10000)
      .emit("import-arrangement", preview.arrangement, (failure, result) => {
        setBusy(false);
        if (failure || !result?.ok)
          setError(
            result?.error ||
              "Could not load the arrangement. Stop the current performance and try again.",
          );
        else
          setMessage(
            `Loaded ${result.title}. Choose matching instruments, then use the Start button below.`,
          );
      });
  }

  return (
    <section className="midi-panel" aria-label="Play a MIDI song">
      <p className="midi-kicker">PLAY A SONG</p>
      <h2>Bring your own score.</h2>
      <p>
        Upload a MIDI file, assign its tracks, and turn a short excerpt into a
        playable rehearsal.
      </p>
      <label className="room-field">
        MIDI file (.mid or .midi)
        <input
          type="file"
          accept=".mid,.midi,audio/midi,audio/x-midi"
          onChange={readFile}
          disabled={busy || playing}
        />
      </label>
      {loading && <p role="status">Reading tracks…</p>}
      {midi && (
        <form onSubmit={previewImport}>
          <label className="room-field">
            Piece title
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                invalidate();
              }}
              maxLength={100}
              required
              disabled={busy || playing}
            />
          </label>
          <div className="midi-settings">
            <label className="room-field">
              Start measure
              <input
                type="number"
                min="1"
                max="9999"
                value={startBar}
                onChange={(event) => {
                  setStartBar(Number(event.target.value));
                  invalidate();
                }}
                required
                disabled={busy || playing}
              />
            </label>
            <label className="room-field">
              Measures
              <select
                value={bars}
                onChange={(event) => {
                  setBars(Number(event.target.value));
                  invalidate();
                }}
                disabled={busy || playing}
              >
                <option value={4}>4</option>
                <option value={8}>8</option>
                <option value={16}>16</option>
              </select>
            </label>
            <label className="room-field">
              Tempo (BPM)
              <input
                type="number"
                min="40"
                max="180"
                value={bpm}
                onChange={(event) => {
                  setBpm(Number(event.target.value));
                  invalidate();
                }}
                required
                disabled={busy || playing}
              />
            </label>
          </div>
          <p>
            Assign at most one track to each Poco instrument. Leave other tracks
            out.
          </p>
          {tracks.map(({ track, index }) => (
            <label className="room-field midi-track" key={index}>
              <span>
                {track.name || `Track ${index + 1}`} · {track.instrument.name} ·{" "}
                {track.notes.length} notes
              </span>
              <select
                value={mappings[index] || ""}
                onChange={(event) => {
                  setMappings({ ...mappings, [index]: event.target.value });
                  invalidate();
                }}
                disabled={busy || playing}
              >
                <option value="">Leave out</option>
                {Object.entries(instruments).map(([id, definition]) => (
                  <option key={id} value={id}>
                    {definition.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button className="session-button" disabled={busy || playing}>
            Preview adaptation
          </button>
        </form>
      )}
      {preview && (
        <div className="midi-preview">
          <h3>{preview.arrangement.title}</h3>
          <p>
            {preview.arrangement.beats / 4} measures · {preview.arrangement.bpm}{" "}
            BPM ·{" "}
            {Object.keys(preview.arrangement.parts)
              .map((id) => instruments[id].name)
              .join(", ")}
          </p>
          <ul>
            {preview.messages.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
          <button
            className="session-button"
            onClick={loadIntoRoom}
            disabled={busy || playing || !connected}
          >
            {busy ? "Loading…" : "Use this arrangement"}
          </button>
        </div>
      )}
      {error && (
        <p className="room-error" role="alert">
          {error}
        </p>
      )}
      <p role="status">{message}</p>
      <p className="midi-footnote">
        An adapted practice part, not an exact transcription. The original file
        is parsed in your browser; only the adapted notes are sent to your room.
      </p>
    </section>
  );
}
