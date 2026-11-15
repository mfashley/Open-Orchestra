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
const roles = [
  "piano",
  "violin",
  "flute",
  "trumpet",
  "cello",
  "xylophone",
];

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
    });

    socket.join(code);
    socket.data.code = code;

    reply({ ok: true, code });
  });

  socket.on("join-room", (data, reply) => {
    if (typeof reply !== "function") return;

    const code = String(data?.code ?? "").trim();
    const name = String(data?.name ?? "").trim().slice(0, 24);
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
    if (typeof reply === "function") reply(rooms.get(socket.data.code)?.ensemble || null);
  });

  socket.on("start-ensemble", (reply) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.host !== socket.id || typeof reply !== "function") return;
    clearTimeout(room.ensembleTimer);
    for (const id of room.players.keys()) {
      const player = io.sockets.sockets.get(id);
      if (player) releaseNotes(player);
    }
    const bpm = 90;
    room.ensemble = { id: "first-light", title: "First Light", bpm,
      startsAt: Date.now() + 4 * 60000 / bpm, beats: 32 };
    io.to(socket.data.code).emit("ensemble", room.ensemble);
    reply({ ok: true });
    const code = socket.data.code;
    room.ensembleTimer = setTimeout(() => {
      if (rooms.get(code) !== room) return;
      for (const id of room.players.keys()) {
        const player = io.sockets.sockets.get(id);
        if (player) releaseNotes(player);
      }
      room.ensemble = null;
      io.to(code).emit("ensemble", null);
    }, (4 + 32) * 60000 / bpm);
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
    if (!player || typeof data?.voice !== "string" || data.voice.length > 80) return;
    const midi = data.midi;
    const ranges = { piano: [48, 84], violin: [60, 96], flute: [72, 96],
      trumpet: [48, 84], cello: [36, 72], xylophone: [60, 96] };
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