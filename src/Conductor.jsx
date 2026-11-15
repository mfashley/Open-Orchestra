import { useState } from "react";
import "./Conductor.css";

export default function Conductor({
  socket,
  selection,
  playing,
  connected,
  players,
}) {
  const [prompt, setPrompt] = useState(
    "A mysterious midnight walk that ends with a little hope",
  );
  const [difficulty, setDifficulty] = useState("easy");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function generate(event) {
    event.preventDefault();
    if (!socket?.connected || busy || playing) return;
    setBusy(true);
    setMessage("Composing your parts… This can take up to a minute.");
    socket
      .timeout(60000)
      .emit("generate-arrangement", { prompt, difficulty }, (error, result) => {
        setBusy(false);
        if (error)
          setMessage(
            "The request timed out. Your previous piece is still available; check the server before retrying.",
          );
        else if (!result?.ok)
          setMessage(
            result?.error ||
              "Generation failed. First Light is still available.",
          );
        else
          setMessage(
            `Ready: ${result.title}. Use the Start button below to perform it.`,
          );
      });
  }

  function reset() {
    socket?.timeout(5000).emit("use-preset", (error, result) => {
      setMessage(
        error || !result?.ok
          ? "Could not switch pieces. Stop the performance first."
          : "First Light is ready.",
      );
    });
  }

  return (
    <section className="conductor-panel" aria-label="AI conductor">
      <p className="conductor-kicker">CREATE WITH GEMINI</p>
      <h2>Your ensemble. Your atmosphere.</h2>
      <p>
        Describe a mood. Get an original four-bar piece for the instruments
        currently in your room.
      </p>
      <form onSubmit={generate}>
        <label className="room-field">
          What should it feel like?
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            maxLength={400}
            required
            disabled={busy || playing}
            rows={3}
          />
        </label>
        <label className="room-field">
          Difficulty
          <select
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value)}
            disabled={busy || playing}
          >
            <option value="easy">Easy — room to breathe</option>
            <option value="standard">Standard — a little more movement</option>
          </select>
        </label>
        <button
          className="session-button"
          disabled={
            !connected || busy || playing || !players.length || !prompt.trim()
          }
        >
          {busy ? "Composing…" : "Compose for this ensemble"}
        </button>
      </form>
      {!players.length && <p>Invite at least one player before composing.</p>}
      {playing && <p>Stop the current piece before composing another.</p>}
      <p className="conductor-selection">
        Selected: <strong>{selection.title}</strong> ·{" "}
        {selection.source === "gemini"
          ? "Gemini composition"
          : "Prepared piece"}
      </p>
      <button
        className="back-button"
        onClick={reset}
        disabled={busy || playing || !connected}
      >
        Use First Light instead
      </button>
      <p role="status">{message}</p>
    </section>
  );
}
