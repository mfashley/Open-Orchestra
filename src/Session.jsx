import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import * as Tone from "tone";
import "./Session.css";
import { instruments } from "./instruments";

const roles = Object.keys(instruments);

const labels = Object.fromEntries(
  roles.map((id) => [id, instruments[id].notes]),
);

export default function Session({ mode, onBack }) {
  const socketRef = useRef(null);
  const engineRef = useRef(null);
  const startingRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [players, setPlayers] = useState([]);
  const [instrument, setInstrument] = useState("piano");
  const [soundReady, setSoundReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState("Waiting for the first note.");

  useEffect(() => {
    const socket = io(`http://${window.location.hostname}:3001`);
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setError("");
    });

    socket.on("connect_error", () => {
      setError("Can't reach the room server. Check that it's running.");
    });

    socket.on("disconnect", () => {
      setConnected(false);
      setJoined(false);
      setPlayers([]);
      setError("Disconnected. Reconnect, then create or join a room again.");
    });

    socket.on("players", setPlayers);

    socket.on("room-ended", () => {
      setJoined(false);
      setPlayers([]);
      setError("The host closed the session.");
    });

    socket.on("note", (event) => {
      const definition = instruments[event.instrument];
      const note = definition?.notes[event.index];

      if (!note) return;

      setActivity(`${event.name} played ${note} on ${definition.name}.`);

      const sampler = engineRef.current?.[event.instrument];

      if (!sampler?.loaded) return;

      sampler.triggerAttackRelease(note, definition.duration, Tone.now(), 0.7);
    });

    return () => {
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
            setJoined(true);
          }
        },
      );
  }

  function chooseInstrument(value) {
    setInstrument(value);
    socketRef.current?.emit("instrument", value);
  }

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

            <div className="room-pads">
              {labels[instrument].map((label, index) => (
                <button
                  key={label}
                  disabled={!connected}
                  onClick={() => socketRef.current?.emit("play", index)}
                >
                  {label}
                </button>
              ))}
            </div>
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
