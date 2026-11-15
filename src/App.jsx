import { useEffect, useRef, useState } from "react";
import "./App.css";
import Session from "./Session";

export default function App() {
  const [opened, setOpened] = useState(false);
  const [finished, setFinished] = useState(false);
  const [message, setMessage] = useState("");
  const [screen, setScreen] = useState("welcome");

  const audioRef = useRef(null);
  const timerRef = useRef(null);
  const createRef = useRef(null);

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
      audioRef.current?.close().catch(() => {});
    };
  }, []);

  function openCurtains() {
    if (opened) return;

    // Audio starts from a user gesture, as required by browsers.
    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (AudioContextClass) {
        const context = new AudioContextClass();
        audioRef.current = context;

        context
          .resume()
          .then(() => {
            if (context.state === "closed") return;

            const oscillator = context.createOscillator();
            const gain = context.createGain();
            const now = context.currentTime;

            oscillator.type = "sine";
            oscillator.frequency.value = 440;

            // A short, gentle Concert A with a fade in and out.
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.12, now + 0.08);
            gain.gain.setValueAtTime(0.12, now + 0.65);
            gain.gain.linearRampToValueAtTime(0, now + 1.2);

            oscillator.connect(gain);
            gain.connect(context.destination);

            oscillator.start(now);
            oscillator.stop(now + 1.25);

            oscillator.onended = () => {
              oscillator.disconnect();
              gain.disconnect();
              context.close().catch(() => {});
            };
          })
          .catch(() => {
            // The entrance still works if audio is unavailable.
          });
      }
    } catch {
      // Sound is optional; never block the entrance.
    }

    setOpened(true);

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    timerRef.current = window.setTimeout(
      () => {
        setFinished(true);
        createRef.current?.focus();
      },
      reducedMotion ? 50 : 1900,
    );
  }

  if (screen !== "welcome") {
    return <Session mode={screen} onBack={() => setScreen("welcome")} />;
  }

  return (
    <main className={`theatre ${opened ? "is-open" : ""}`}>
      <section
        className="welcome"
        aria-label="Welcome to Poco"
        aria-hidden={!finished}
        inert={!finished}
      >
        <div className="invitation">
          <h1>Poco Invites You To:</h1>

          <div className="session-options">
            <article className="session-card"> 
              <h2>Create a session</h2>
              <p>
                Bring everyone together. Start a new session and invite others
                to join.
              </p>
              <button
                ref={createRef}
                className="session-button"
                onClick={() => setScreen("host")}
              >
                Create a session
              </button>
            </article>

            <article className="session-card">
              <h2>Join a room</h2>
              <p>
                Already have an invitation? Use your room code or invite link to
                join the session.
              </p>
              <button
                className="session-button"
                onClick={() => setScreen("join")}
              >
                Join a room
              </button>
            </article>
          </div>

          <p className="session-message" role="status">
            {message}
          </p>
        </div>
      </section>

      {!finished && (
        <div className="entrance">
          <img
            className="curtain curtain-left"
            src="/Left curtain.png"
            alt=""
            draggable="false"
          />
          <img
            className="curtain curtain-right"
            src="/Right curtain.png"
            alt=""
            draggable="false"
          />

          <div className="stand">
            <img src="/music stand1.png" alt="" draggable="false" />

            <button
              className="tuning-button"
              onClick={openCurtains}
              disabled={opened}
              aria-label="Play Concert A and open the curtains"
            >
              <span>Tuning Note</span>
              <span>Concert A</span>
            </button>

            <p className="entrance-hint">Tap the note to begin</p>
          </div>
        </div>
      )}
    </main>
  );
}
