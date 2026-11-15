import Conductor from "./Conductor";
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import * as Tone from "tone";
import "./Session.css";
import GuidedEnsemble from "./GuidedEnsemble";
import { guideAt, DEFAULT_OCTAVE } from "./ensemble";
import { instruments } from "./instruments";

const roles = Object.keys(instruments);

const steps = [0, 2, 4, 5, 7, 9, 11, 12];
const keyCodes = [
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyF",
  "KeyG",
  "KeyH",
  "KeyJ",
  "KeyK",
];
const octaves = {
  piano: [3, 4, 5],
  violin: [4, 5, 6],
  flute: [5, 6],
  trumpet: [3, 4, 5],
  cello: [2, 3, 4],
  xylophone: [4, 5, 6],
};
const defaultOctave = {
  piano: 4,
  violin: 4,
  flute: 5,
  trumpet: 4,
  cello: 2,
  xylophone: 5,
};

export default function Session({ mode, onBack }) {
  const socketRef = useRef(null);
  const engineRef = useRef(null);
  const startingRef = useRef(false);
  const heldRef = useRef(new Map());
  const soundingRef = useRef(new Map());
  const [ensemble, setEnsemble] = useState(null);
  const [now, setNow] = useState(Date.now());
  const clockRef = useRef({ offset: 0, best: Infinity });
  const [octave, setOctave] = useState(4);
  const [pressed, setPressed] = useState([]);

  function releaseAll() {
    heldRef.current.clear();
    setPressed([]);
    if (socketRef.current?.connected) socketRef.current.emit("release-notes");
  }

  function startNote(voice, midi) {
    if (!socketRef.current?.connected || heldRef.current.has(voice)) return;
    heldRef.current.set(voice, midi);
    setPressed([...heldRef.current.values()]);
    socketRef.current.emit("note-on", { voice, midi });
  }

  function stopNote(voice) {
    if (!heldRef.current.has(voice)) return;
    heldRef.current.delete(voice);
    setPressed([...heldRef.current.values()]);
    if (socketRef.current?.connected) socketRef.current.emit("note-off", voice);
  }

  const [connected, setConnected] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [players, setPlayers] = useState([]);
  const [instrument, setInstrument] = useState("piano");
  const notes =
    ensemble?.arrangement?.parts[instrument]?.playableNotes ||
    steps.map((step) => (octave + 1) * 12 + step);
  const [selection, setSelection] = useState({
    title: "First Light",
    source: "prepared",
  });
  const [soundReady, setSoundReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState("Waiting for the first note.");

  useEffect(() => {
    const socket = io(`http://${window.location.hostname}:3001`);
    socketRef.current = socket;
    function syncClock() {
      if (!socket.connected) return;
      const sent = Date.now();
      socket.timeout(3000).emit("clock", (error, serverTime) => {
        if (error || !Number.isFinite(serverTime)) return;
        const received = Date.now();
        const roundTrip = received - sent;
        if (roundTrip <= clockRef.current.best) {
          clockRef.current = {
            best: roundTrip,
            offset: serverTime - (sent + received) / 2,
          };
        }
      });
    }
    const syncTimer = setInterval(syncClock, 5000);
    socket.on("ensemble", setEnsemble);
    socket.on("selection", setSelection);

    socket.on("connect", () => {
      clockRef.current = { offset: 0, best: Infinity };
      syncClock();
      setConnected(true);
      setError("");
    });

    socket.on("connect_error", () => {
      setError("Can't reach the room server. Check that it's running.");
    });

    socket.on("disconnect", () => {
      heldRef.current.clear();
      setPressed([]);
      soundingRef.current.clear();
      for (const role of roles) engineRef.current?.[role]?.releaseAll();
      setEnsemble(null);
      setConnected(false);
      setJoined(false);
      setPlayers([]);
      setError("Disconnected. Reconnect, then create or join a room again.");
    });

    socket.on("players", setPlayers);

    socket.on("room-ended", () => {
      heldRef.current.clear();
      setPressed([]);
      setJoined(false);
      setPlayers([]);
      setEnsemble(null);
      setError("The host closed the session.");
    });

    socket.on("note-on", (event) => {
      const definition = instruments[event.instrument];
      const sampler = engineRef.current?.[event.instrument];
      if (!definition || !sampler?.loaded) return;
      const note = Tone.Frequency(event.midi, "midi").toNote();
      const key = `${event.instrument}:${event.midi}`;
      const owners = soundingRef.current.get(key) || new Set();
      if (!owners.size) sampler.triggerAttack(note, Tone.now(), 0.7);
      owners.add(`${event.id}:${event.voice}`);
      soundingRef.current.set(key, owners);
      setActivity(`${event.name} played ${note} on ${definition.name}.`);
    });

    socket.on("note-off", (event) => {
      const key = `${event.instrument}:${event.midi}`;
      const owners = soundingRef.current.get(key);
      if (!owners) return;
      owners.delete(`${event.id}:${event.voice}`);
      if (!owners.size) {
        engineRef.current?.[event.instrument]?.triggerRelease(
          Tone.Frequency(event.midi, "midi").toNote(),
          Tone.now(),
        );
        soundingRef.current.delete(key);
      }
    });

    return () => {
      clearInterval(syncTimer);
      socket.disconnect();
      socketRef.current = null;

      if (engineRef.current) {
        Object.values(engineRef.current).forEach((node) => node.dispose());
        engineRef.current = null;
      }
    };
  }, []);

  async function enableSound() {
    if (startingRef.current || engineRef.current) return;

    startingRef.current = true;
    setStarting(true);
    setError("");

    const pending = {};

    try {
      await Tone.start();

      if (!socketRef.current) return;

      pending.output = new Tone.Volume(-14).toDestination();

      const loads = Object.entries(instruments).map(
        ([id, definition]) =>
          new Promise((resolve, reject) => {
            pending[id] = new Tone.Sampler({
              urls: definition.samples,
              baseUrl: `/samples/${id}/`,
              attack: 0.01,
              release: 0.3,
              volume: definition.volume,
              onload: resolve,
              onerror: reject,
            }).connect(pending.output);
          }),
      );

      const results = await Promise.allSettled(loads);

      if (results.some((result) => result.status === "rejected")) {
        throw new Error("An instrument sample couldn't load.");
      }

      if (!socketRef.current) {
        Object.values(pending).forEach((node) => node.dispose());
        return;
      }

      engineRef.current = pending;
      setSoundReady(true);
    } catch (error) {
      Object.values(pending).forEach((node) => node.dispose());

      if (socketRef.current) {
        setError(
          `${error.message || "Audio couldn't start."} Check public/samples and try again.`,
        );
      }
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }

  function requestRoom(event) {
    event.preventDefault();
    if (!connected || busy) return;

    setBusy(true);
    setError("");

    socketRef.current
      .timeout(5000)
      .emit(
        mode === "host" ? "create-room" : "join-room",
        { name, code },
        (timeoutError, result) => {
          setBusy(false);

          if (timeoutError) {
            setError("The server didn't respond. Please try again.");
          } else if (!result?.ok) {
            setError(result?.error || "Couldn't open the room.");
          } else {
            setCode(result.code);
            setInstrument("piano");
            setOctave(4);
            setJoined(true);
            socketRef.current
              ?.timeout(3000)
              .emit("get-selection", (error, state) => {
                if (!error && state) setSelection(state);
              });
            socketRef.current
              ?.timeout(3000)
              .emit("get-ensemble", (error, state) => {
                if (!error) setEnsemble(state);
              });
          }
        },
      );
  }

  function chooseInstrument(value) {
    releaseAll();
    setInstrument(value);
    setOctave(defaultOctave[value]);
    socketRef.current?.emit("instrument", value);
  }

  useEffect(() => {
    function down(event) {
      if (
        mode !== "join" ||
        !joined ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      if (
        event.target.closest?.(
          "input, select, textarea, [contenteditable=true]",
        )
      )
        return;
      const index = keyCodes.indexOf(event.code);
      if (index < 0) return;
      event.preventDefault();
      startNote(`key-${event.code}`, notes[index]);
    }
    function up(event) {
      stopNote(`key-${event.code}`);
    }
    function hidden() {
      if (document.hidden) releaseAll();
    }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", releaseAll);
    window.addEventListener("pagehide", releaseAll);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", releaseAll);
      window.removeEventListener("pagehide", releaseAll);
      document.removeEventListener("visibilitychange", hidden);
    };
  });

  useEffect(() => {
    releaseAll();
    if (ensemble) setOctave(DEFAULT_OCTAVE[instrument]);
    // A shared start time drives visual guidance, not automatic playback.
  }, [ensemble, instrument]);

  useEffect(() => {
    if (!ensemble) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 40);
    return () => clearInterval(timer);
  }, [ensemble]);

  const guide = guideAt(ensemble, instrument, now + clockRef.current.offset);
  const guidePanel = (
    <GuidedEnsemble
      instrument={instrument}
      selection={selection}
      session={ensemble}
      guide={guide}
      host={mode === "host"}
      ready={soundReady && connected}
      noteNames={notes.map((midi) => Tone.Frequency(midi, "midi").toNote())}
      onStart={() =>
        socketRef.current
          ?.timeout(5000)
          .emit("start-ensemble", (error, result) => {
            if (error || !result?.ok)
              setError(
                result?.error ||
                  "Couldn't start the piece. Check your connection.",
              );
          })
      }
      onStop={() => socketRef.current?.emit("stop-ensemble")}
    />
  );

  return (
    <main className="session-screen">
      <div className="session-panel">
        <header className="room-header">
          <button className="back-button" onClick={onBack}>
            ← Leave
          </button>
          <span>{connected ? "Connected" : "Connecting…"}</span>
        </header>

        <p className="room-brand">poco</p>

        {!joined ? (
          <form onSubmit={requestRoom}>
            <h1>
              {mode === "host"
                ? "Bring everyone together."
                : "Take your place."}
            </h1>

            {mode === "join" && (
              <>
                <label className="room-field">
                  Your name
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={24}
                    autoComplete="given-name"
                    required
                  />
                </label>

                <label className="room-field">
                  Room code
                  <input
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    placeholder="Six-digit code"
                    required
                  />
                </label>
              </>
            )}

            <button className="session-button" disabled={!connected || busy}>
              {busy
                ? "One moment…"
                : mode === "host"
                  ? "Create room"
                  : "Join room"}
            </button>
          </form>
        ) : mode === "host" ? (
          <>
            <h1>The ensemble is yours.</h1>
            <p>Invite players with this room code:</p>
            <div className="room-code">{code}</div>

            {!soundReady ? (
              <button
                className="session-button"
                onClick={enableSound}
                disabled={starting}
              >
                {starting ? "Loading instruments…" : "Enable ensemble sound"}
              </button>
            ) : (
              <p>Sound enabled · Keep this tab open.</p>
            )}

            <Conductor
              socket={socketRef.current}
              selection={selection}
              playing={!!ensemble}
              connected={connected}
              players={players}
            />
            {guidePanel}
            <h2>Musicians · {players.length}</h2>

            {players.length === 0 ? (
              <p>No players yet. Join from your phone.</p>
            ) : (
              <ul className="player-list">
                {players.map((player) => (
                  <li key={player.id}>
                    <span>{player.name}</span>
                    <span>{instruments[player.instrument]?.name}</span>
                  </li>
                ))}
              </ul>
            )}

            <p className="room-activity">{activity}</p>
          </>
        ) : (
          <>
            <h1>You're in, {name}.</h1>
            <p>Room {code} · Sound plays on the host's speakers.</p>

            <label className="room-field">
              Your instrument
              <select
                value={instrument}
                onChange={(event) => chooseInstrument(event.target.value)}
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {instruments[role].name}
                  </option>
                ))}
              </select>
            </label>
            {ensemble && !ensemble.arrangement?.parts[instrument] && (
              <p>
                This piece has no {instruments[instrument].name} part. Choose an
                instrument that was connected when the host composed it, or play
                freely.
              </p>
            )}

            {guidePanel}
            <div className="octave-controls">
              <button
                disabled={!!ensemble || octave === octaves[instrument][0]}
                onClick={() => {
                  releaseAll();
                  setOctave((value) => value - 1);
                }}
              >
                − Octave
              </button>
              <span aria-live="polite">Octave {octave}</span>
              <button
                disabled={!!ensemble || octave === octaves[instrument].at(-1)}
                onClick={() => {
                  releaseAll();
                  setOctave((value) => value + 1);
                }}
              >
                + Octave
              </button>
            </div>

            <div className="room-pads performance-pads">
              {notes.map((midi, index) => (
                <button
                  key={midi}
                  disabled={!connected}
                  className={[
                    pressed.includes(midi) ? "note-held" : "",
                    guide?.active.includes(index) ? "guide-now" : "",
                    !guide?.active.length && guide?.next.includes(index)
                      ? "guide-next"
                      : "",
                  ].join(" ")}
                  aria-label={`Play ${Tone.Frequency(midi, "midi").toNote()}`}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.currentTarget.focus({ preventScroll: true });
                    event.currentTarget.setPointerCapture(event.pointerId);
                    startNote(`pointer-${event.pointerId}`, midi);
                  }}
                  onPointerUp={(event) =>
                    stopNote(`pointer-${event.pointerId}`)
                  }
                  onPointerCancel={(event) =>
                    stopNote(`pointer-${event.pointerId}`)
                  }
                  onLostPointerCapture={(event) =>
                    stopNote(`pointer-${event.pointerId}`)
                  }
                  onClick={(event) => {
                    // Support assistive activation without pointer/key events.
                    if (event.detail === 0 && !heldRef.current.size) {
                      const voice = `assist-${midi}`;
                      startNote(voice, midi);
                      window.setTimeout(() => stopNote(voice), 350);
                    }
                  }}
                >
                  <span>{Tone.Frequency(midi, "midi").toNote()}</span>
                  <small>{"ASDFGHJK"[index] || ""}</small>
                </button>
              ))}
            </div>
            <p>
              Hold notes. Use multiple fingers for chords, or A S D F G H J K.
            </p>
            <button className="back-button" onClick={releaseAll}>
              Release all notes
            </button>
          </>
        )}

        {error && (
          <p className="room-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
