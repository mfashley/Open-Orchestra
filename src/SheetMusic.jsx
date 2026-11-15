import { useEffect, useMemo, useRef, useState } from "react";
import {
  Renderer,
  Stave,
  StaveNote,
  StaveTie,
  Voice,
  Formatter,
  Dot,
  Accidental,
} from "vexflow";
import { instruments } from "./instruments";
import { measureFor, notationPitch, cursorPosition } from "./score-model";
import "./SheetMusic.css";

const durations = {
  4: ["w", false],
  3: ["h", true],
  2: ["h", false],
  1.5: ["q", true],
  1: ["q", false],
  0.5: ["8", false],
};

export default function SheetMusic({ arrangement, instrument, guide }) {
  const containerRef = useRef(null);
  const scrollRef = useRef(null);
  const cursorRef = useRef(null);
  const pointsRef = useRef([]);
  const [error, setError] = useState("");
  const bar = (guide?.bar || 1) - 1;
  const beat = guide?.beat ?? -4;
  const hasPart = !!arrangement?.parts?.[instrument];
  const model = useMemo(() => {
    try {
      return { segments: measureFor(arrangement, instrument, bar) };
    } catch (failure) {
      return { segments: [], error: failure.message };
    }
  }, [arrangement, instrument, bar]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.replaceChildren();
    cursorRef.current = null;
    pointsRef.current = [];
    if (!hasPart) return;
    if (model.error) {
      setError(model.error);
      return;
    }
    try {
      const clef = instrument === "cello" ? "bass" : "treble";
      const renderer = new Renderer(container, Renderer.Backends.SVG);
      renderer.resize(520, 200);
      const context = renderer.getContext();
      context.setFillStyle("#360d1c");
      context.setStrokeStyle("#360d1c");
      const stave = new Stave(10, 60, 500);
      stave.addClef(clef).addTimeSignature("4/4");
      stave.setContext(context).draw();
      const accidentalState = new Map();
      const notes = model.segments.map((segment) => {
        const [duration, dotted] = durations[segment.length];
        const rest = !segment.notes;
        const pitches = segment.notes?.map(notationPitch);
        const note = new StaveNote({
          clef,
          keys: rest
            ? [clef === "bass" ? "d/3" : "b/4"]
            : pitches.map((pitch) => pitch.key),
          duration: duration + (rest ? "r" : ""),
          dots: dotted ? 1 : 0,
          auto_stem: true,
        });
        if (dotted) Dot.buildAndAttach([note]);
        pitches?.forEach((pitch, index) => {
          const naturalKey = pitch.key.replace("#", "");
          const accidental = pitch.accidental || "n";
          const previous = accidentalState.get(naturalKey) || "n";
          if (accidental !== previous)
            note.addModifier(new Accidental(accidental), index);
          accidentalState.set(naturalKey, accidental);
        });
        return note;
      });
      const voice = new Voice({ num_beats: 4, beat_value: 4 });
      voice.addTickables(notes);
      new Formatter().joinVoices([voice]).formatToStave([voice], stave);
      voice.draw(context, stave);

      model.segments.forEach((segment, index) => {
        if (!segment.notes) return;
        const indexes = segment.notes.map((_, position) => position);
        if (segment.tiedIn && index === 0) {
          new StaveTie({
            last_note: notes[index],
            first_indices: indexes,
            last_indices: indexes,
          })
            .setContext(context)
            .draw();
        }
        if (segment.tiedOut) {
          const next = model.segments[index + 1];
          const connection = next?.tiedIn
            ? {
                first_note: notes[index],
                last_note: notes[index + 1],
                first_indices: indexes,
                last_indices: indexes,
              }
            : {
                first_note: notes[index],
                first_indices: indexes,
                last_indices: indexes,
              };
          new StaveTie(connection).setContext(context).draw();
        }
      });

      pointsRef.current = model.segments.map((segment, index) => ({
        beat: segment.beat,
        x: notes[index].getAbsoluteX(),
      }));
      pointsRef.current.push({ beat: 4, x: stave.getNoteEndX() - 5 });
      const svg = container.querySelector("svg");
      svg.setAttribute("aria-hidden", "true");
      const line = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
      );
      for (const [name, value] of Object.entries({
        y1: 25,
        y2: 165,
        stroke: "#b47723",
        "stroke-width": 3,
        "pointer-events": "none",
      }))
        line.setAttribute(name, String(value));
      svg.appendChild(line);
      cursorRef.current = line;
      setError("");
    } catch (failure) {
      console.error("Sheet music render failed:", failure.message);
      setError(
        "The score could not render. Follow the pads and beat indicator instead.",
      );
    }
    return () => {
      container.replaceChildren();
      cursorRef.current = null;
    };
  }, [model, instrument, hasPart]);

  useEffect(() => {
    const line = cursorRef.current;
    if (!line) return;
    const x = cursorPosition(pointsRef.current, beat < 0 ? 0 : beat - bar * 4);
    line.setAttribute("x1", String(x));
    line.setAttribute("x2", String(x));
    line.style.opacity = beat < 0 ? "0.35" : "1";
    if (scrollRef.current)
      scrollRef.current.scrollLeft = Math.max(
        0,
        x - scrollRef.current.clientWidth * 0.45,
      );
  }, [beat, model, bar]);

  if (!hasPart) return null;
  const text = model.segments
    .map(
      (segment) =>
        `${segment.notes ? segment.notes.map((midi) => notationPitch(midi).key).join(" + ") : "Rest"} for ${segment.length} beats`,
    )
    .join("; ");
  return (
    <section
      className="sheet-music"
      aria-label={`${instruments[instrument]?.name} sheet music`}
    >
      <header className="sheet-heading">
        <span>{instruments[instrument]?.name} · Concert pitch</span>
        <span>
          Measure {bar + 1} / {arrangement.beats / 4}
        </span>
      </header>
      <div className="sheet-scroll" ref={scrollRef}>
        <div className="sheet-svg" ref={containerRef} />
      </div>
      {error && <p role="status">{error}</p>}
      <p className="sheet-caption">
        4/4 · Follow the gold playhead · Ties mean keep holding
      </p>
      <p className="score-screen-reader">{text}</p>
    </section>
  );
}
