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

function leave(socket) {
  const code = socket.data.code;
  if (!code) return;

  const room = rooms.get(code);

  socket.leave(code);
  socket.data.code = null;

  if (!room) return;

  if (room.host === socket.id) {
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

    player.instrument = instrument;
    publish(socket.data.code);
  });

  socket.on("play", (index) => {
    if (!Number.isInteger(index) || index < 0 || index > 3) return;

    const room = rooms.get(socket.data.code);
    const player = room?.players.get(socket.id);
    if (!player) return;

    // Limit accidental floods of input.
    const now = Date.now();
    if (now - (socket.data.lastPlay || 0) < 60) return;
    socket.data.lastPlay = now;

    io.to(room.host).emit("note", {
      ...player,
      index,
    });
  });

  socket.on("leave-room", () => leave(socket));
  socket.on("disconnect", () => leave(socket));
});

server.listen(3001, "0.0.0.0", () => {
  console.log("Poco room server listening on port 3001");
});