// server/src/index.js
// Phase 4 — Express + Socket.io with full room management and event handlers.

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import 'dotenv/config';
import { registerHandlers } from './socketHandlers.js';
import { getActiveRooms, getRoomCount } from './roomManager.js';

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

// ── Express ──────────────────────────────────────────────
const app = express();

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    rooms: getRoomCount(),
  });
});

app.get('/rooms', (_req, res) => {
  res.json({ rooms: getActiveRooms() });
});

// ── HTTP + Socket.io ─────────────────────────────────────
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// ── Socket.io ────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  socket.emit('server_hello', {
    message: 'Orbital Sandbox server ready',
    socketId: socket.id,
  });

  // Phase 4: register all room + collaboration handlers
  registerHandlers(io, socket);
});

// ── Start ────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n🚀 Orbital Sandbox server running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Active rooms: http://localhost:${PORT}/rooms`);
  console.log(`   Accepting clients from: ${CLIENT_ORIGIN}\n`);
});
