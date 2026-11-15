import "dotenv/config";
import {
  generateArrangement,
  publicGenerationError,
} from "./gemini-conductor.mjs";
import { FIRST_LIGHT, validateArrangement } from "./arrangement.js";
import express from "express";
import { createServer } from "node:http";
import { randomInt } from "node:crypto";
import { Server } from "socket.io";

const app = express();
const server = createServer(app);

// Open CORS is for this local prototype.
const io = new Server(server, {
  cors: { origin: "*" },
});

const rooms = new Map();
const roles = ["piano", "violin", "flute", "trumpet", "cello", "xylophone"];

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

function publish(code) {
  const room = rooms.get(code);
  if (!room) return;

  io.to(code).emit("players", [...room.players.values()]);
}

function releaseNotes(socket) {
  const room = rooms.get(socket.data.code);
  for (const event of (socket.data.held || new Map()).values()) {
    if (room) io.to(room.host).emit("note-off", event);
  }
  socket.data.held = new Map();
}

function leave(socket) {
  releaseNotes(socket);
  const code = socket.data.code;
  if (!code) return;

  const room = rooms.get(code);

  socket.leave(code);
  socket.data.code = null;

  if (!room) return;

  if (room.host === socket.id) {
    clearTimeout(room.ensembleTimer);
    io.to(code).emit("room-ended");

    for (const id of room.players.keys()) {
      const playerSocket = io.sockets.sockets.get(id);
      if (playerSocket) {
        playerSocket.leave(code);
        playerSocket.data.code = null;
      }
    }

    rooms.delete(code);
  } else {
    room.players.delete(socket.id);
    publish(code);
  }
}

io.on("connection", (socket) => {
  socket.on("create-room", (_data, reply) => {
    if (typeof reply !== "function") return;

    leave(socket);

    let code;
    do {
      code = String(randomInt(100000, 1000000));
    } while (rooms.has(code));

    rooms.set(code, {
      host: socket.id,
      players: new Map(),
      arrangement: validateArrangement(FIRST_LIGHT),
      source: "prepared",
    });

    socket.join(code);
    socket.data.code = code;

    reply({ ok: true, code });
  });

  socket.on("join-room", (data, reply) => {
    if (typeof reply !== "function") return;

    const code = String(data?.code ?? "").trim();
    const name = String(data?.name ?? "")
      .trim()
      .slice(0, 24);
    const room = rooms.get(code);

    if (!room) {
      return reply({ ok: false, error: "That room wasn't found." });
    }

    if (!name) {
      return reply({ ok: false, error: "Enter your name first." });
    }

    if (room.players.size >= 12) {
      return reply({ ok: false, error: "This room is full." });
    }

    if (room.host === socket.id) {
      return reply({
        ok: false,
        error: "Join using a different tab or device.",
      });
    }

    leave(socket);

    room.players.set(socket.id, {
      id: socket.id,
      name,
      instrument: "piano",
    });

    socket.join(code);
    socket.data.code = code;

    reply({ ok: true, code });
    publish(code);
  });

  socket.on("instrument", (instrument) => {
    if (!roles.includes(instrument)) return;

    const room = rooms.get(socket.data.code);
    const player = room?.players.get(socket.id);
    if (!player) return;

    releaseNotes(socket);
    player.instrument = instrument;
    publish(socket.data.code);
  });

  socket.on("clock", (reply) => {
    if (typeof reply === "function") reply(Date.now());
  });

  socket.on("get-ensemble", (reply) => {
    if (typeof reply === "function")
      reply(rooms.get(socket.data.code)?.ensemble || null);
  });

  socket.on("get-selection", (reply) => {
    const room = rooms.get(socket.data.code);
    if (room && typeof reply === "function")
      reply({ title: room.arrangement.title, source: room.source });
  });

  socket.on("use-preset", (reply) => {
    const room = rooms.get(socket.data.code);
    if (typeof reply !== "function") return;
    if (!room || room.host !== socket.id || room.ensemble || room.generating)
      return reply({ ok: false });
    room.arrangement = validateArrangement(FIRST_LIGHT);
    room.source = "prepared";
    io.to(socket.data.code).emit("selection", {
      title: room.arrangement.title,
      source: room.source,
    });
    reply({ ok: true });
  });

  socket.on("generate-arrangement", async (data, reply) => {
    if (typeof reply !== "function") return;
    const code = socket.data.code;
    const room = rooms.get(code);
    if (!room || room.host !== socket.id)
      return reply({ ok: false, error: "Only the host can compose." });
    if (room.ensemble || room.generating)
      return reply({
        ok: false,
        error: "Stop the piece or wait for the current composition.",
      });
    if (!process.env.GEMINI_API_KEY)
      return reply({
        ok: false,
        error:
          "Add GEMINI_API_KEY to .env beside server.mjs, then restart the server.",
      });
    const prompt = typeof data?.prompt === "string" ? data.prompt.trim() : "";
    if (!prompt || prompt.length > 400)
      return reply({ ok: false, error: "Enter a mood of 1–400 characters." });
    const instrumentIds = [
      ...new Set([...room.players.values()].map((player) => player.instrument)),
    ];
    if (!instrumentIds.length)
      return reply({ ok: false, error: "Invite at least one player first." });
    if (Date.now() - (room.lastGeneration || 0) < 20000)
      return reply({
        ok: false,
        error: "Please wait 20 seconds between composition requests.",
      });
    room.lastGeneration = Date.now();
    room.generating = true;
    try {
      const arrangement = await generateArrangement({
        prompt,
        difficulty: data?.difficulty === "standard" ? "standard" : "easy",
        instrumentIds,
      });
      if (rooms.get(code) !== room || !socket.connected) return;
      room.arrangement = arrangement;
      room.source = "gemini";
      io.to(code).emit("selection", {
        title: arrangement.title,
        source: room.source,
      });
      reply({ ok: true, title: arrangement.title });
    } catch (error) {
      // Never send the SDK error (which may include request details) to clients.
      console.error(
        "Composition failed:",
        Number(error?.status || error?.code) || "invalid-output-or-network",
      );
      reply({ ok: false, error: publicGenerationError(error) });
    } finally {
      room.generating = false;
    }
  });

  socket.on("start-ensemble", (reply) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.host !== socket.id || typeof reply !== "function") return;
    if (room.generating)
      return reply({ ok: false, error: "Wait for the composition to finish." });
    clearTimeout(room.ensembleTimer);
    for (const id of room.players.keys()) {
      const player = io.sockets.sockets.get(id);
      if (player) releaseNotes(player);
    }
    const arrangement = validateArrangement(room.arrangement);
    const bpm = arrangement.bpm;
    room.ensemble = {
      id: room.source,
      source: room.source,
      title: arrangement.title,
      bpm,
      startsAt: Date.now() + (4 * 60000) / bpm,
      beats: arrangement.beats,
      arrangement,
    };
    io.to(socket.data.code).emit("ensemble", room.ensemble);
    reply({ ok: true });
    const code = socket.data.code;
    room.ensembleTimer = setTimeout(
      () => {
        if (rooms.get(code) !== room) return;
        for (const id of room.players.keys()) {
          const player = io.sockets.sockets.get(id);
          if (player) releaseNotes(player);
        }
        room.ensemble = null;
        io.to(code).emit("ensemble", null);
      },
      ((4 + arrangement.beats) * 60000) / bpm,
    );
  });

  socket.on("stop-ensemble", () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.host !== socket.id) return;
    clearTimeout(room.ensembleTimer);
    for (const id of room.players.keys()) {
      const player = io.sockets.sockets.get(id);
      if (player) releaseNotes(player);
    }
    room.ensemble = null;
    io.to(socket.data.code).emit("ensemble", null);
  });

  socket.on("note-on", (data) => {
    const room = rooms.get(socket.data.code);
    const player = room?.players.get(socket.id);
    if (!player || typeof data?.voice !== "string" || data.voice.length > 80)
      return;
    const midi = data.midi;
    const ranges = {
      piano: [48, 84],
      violin: [60, 96],
      flute: [72, 96],
      trumpet: [48, 84],
      cello: [36, 72],
      xylophone: [60, 96],
    };
    const [low, high] = ranges[player.instrument];
    if (!Number.isInteger(midi) || midi < low || midi > high) return;

    socket.data.held ??= new Map();
    if (socket.data.held.has(data.voice) || socket.data.held.size >= 16) return;

    // A burst allowance supports chords; releases are never rate limited.
    const now = Date.now();
    const bucket = socket.data.bucket || { tokens: 80, time: now };
    bucket.tokens = Math.min(80, bucket.tokens + (now - bucket.time) * 0.08);
    bucket.time = now;
    socket.data.bucket = bucket;
    if (bucket.tokens < 1) return;
    bucket.tokens -= 1;

    const event = { ...player, voice: data.voice, midi };
    socket.data.held.set(data.voice, event);
    io.to(room.host).emit("note-on", event);
  });

  socket.on("note-off", (voice) => {
    const event = socket.data.held?.get(voice);
    if (!event) return;
    const room = rooms.get(socket.data.code);
    socket.data.held.delete(voice);
    if (room) io.to(room.host).emit("note-off", event);
  });

  socket.on("release-notes", () => releaseNotes(socket));

  socket.on("leave-room", () => leave(socket));
  socket.on("disconnect", () => leave(socket));
});

server.listen(3001, "0.0.0.0", () => {
  console.log("Poco room server listening on port 3001");
});
