import { useEffect, useRef, useState } from "react";
import "./SongLibrary.css";

export default function SongLibrary({
  socket,
  connected,
  playing,
  soundReady,
}) {
  const [query, setQuery] = useState("");
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const versionRef = useRef(0);

  useEffect(() => {
    const version = ++versionRef.current;
    if (!connected || !socket) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      socket.timeout(5000).emit("search-songs", query, (failure, result) => {
        if (version !== versionRef.current) return;
        setLoading(false);
        if (failure || !result?.ok) {
          setError(
            "The song library could not load. Check your room-server connection.",
          );
          setSongs([]);
        } else {
          setError("");
          setSongs(result.songs);
        }
      });
    }, 200);
    return () => {
      clearTimeout(timer);
      versionRef.current++;
    };
  }, [query, connected, socket]);

  function playSong(song) {
    if (!socket?.connected || playing || busyId || !soundReady) return;
    setBusyId(song.id);
    setError("");
    setMessage("");
    socket.timeout(5000).emit("select-song", song.id, (failure, result) => {
      if (failure || !result?.ok) {
        setBusyId("");
        setError(result?.error || "Could not load this song.");
        return;
      }
      socket.timeout(5000).emit("start-ensemble", (startError, startResult) => {
        setBusyId("");
        if (startError || !startResult?.ok)
          setError(
            startResult?.error ||
              "The song is loaded. Use the Start button below to retry.",
          );
        else
          setMessage(
            `${song.title} is starting. Follow the count-in on your phones.`,
          );
      });
    });
  }

  return (
    <section className="song-library" aria-label="Search songs">
      <p className="song-library-kicker">PLAY TOGETHER</p>
      <h2>Find your next piece.</h2>
      <p>
        Search the Poco collection by title or composer. Parts are already
        assigned—no files to find.
      </p>
      <label className="room-field">
        Song title or artist / composer
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={100}
          placeholder="Try Beethoven, Twinkle, or First Light"
        />
      </label>
      <p className="song-library-note">
        Starter collection · original pieces and short arrangements of
        public-domain melodies. Contemporary commercial songs are not included
        yet.
      </p>
      {!soundReady && <p>Enable ensemble sound above before playing a song.</p>}
      {playing && (
        <p>Stop the current performance before choosing another piece.</p>
      )}
      {loading ? (
        <p role="status">Searching…</p>
      ) : songs.length ? (
        <ul className="song-results">
          {songs.map((song) => (
            <li key={song.id}>
              <div className="song-result-title">
                <h3>{song.title}</h3>
                <span>{song.difficulty}</span>
              </div>
              <p className="song-artist">{song.artist}</p>
              <p>{song.description}</p>
              <p className="song-details">
                {song.measures} measures · {song.bpm} BPM ·{" "}
                {song.instruments.length} instrument parts
              </p>
              <button
                className="session-button"
                onClick={() => playSong(song)}
                disabled={!connected || playing || !soundReady || !!busyId}
              >
                {busyId === song.id ? "Starting…" : "Play together"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          No playable arrangements match “{query}” in this collection yet. Try
          another title or create an original with Gemini below.
        </p>
      )}
      {error && (
        <p className="room-error" role="alert">
          {error}
        </p>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
