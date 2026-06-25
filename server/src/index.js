// server/src/index.js
// Phase 4 — Express + Socket.io with full room management.
// Phase 9 — REST endpoints for save/load session (companion path to socket events).

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import 'dotenv/config';
import { registerHandlers } from './socketHandlers.js';
import { getActiveRooms, getRoomCount } from './roomManager.js';
import { saveSession, loadSession, ensureSchema } from './db/queries.js';
import { isDbAvailable } from './db/pool.js';

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

// ── Express ──────────────────────────────────────────────
const app = express();

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '2mb' })); // session JSON can be ~100kb with chat history

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    rooms: getRoomCount(),
    db: isDbAvailable() ? 'connected' : 'unavailable',
  });
});

app.get('/rooms', (_req, res) => {
  res.json({ rooms: getActiveRooms() });
});

// ── Phase 9 REST API ───────────────────────────────────
// Used by ShareModal for cross-device save/load. Socket events do the same
// thing — REST is provided so a session URL can be opened in a fresh tab
// without a socket connection.

app.post('/api/session', async (req, res) => {
  try {
    const state  = req.body?.state;
    const userId = req.body?.userId || null;
    if (!state) return res.status(400).json({ error: 'Missing state' });
    const { shareId } = await saveSession(state, userId);
    res.json({ shareId });
  } catch (err) {
    console.error('[POST /api/session]', err);
    res.status(503).json({ error: err.message });
  }
});

app.get('/api/session/:shareId', async (req, res) => {
  try {
    const state = await loadSession(req.params.shareId);
    if (!state) return res.status(404).json({ error: 'Session not found' });
    res.json({ state });
  } catch (err) {
    console.error('[GET /api/session]', err);
    res.status(503).json({ error: err.message });
  }
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

io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);
  socket.emit('server_hello', {
    message: 'Orbital Sandbox server ready',
    socketId: socket.id,
  });
  registerHandlers(io, socket);
});

// ── Start ────────────────────────────────────────────────
httpServer.listen(PORT, async () => {
  console.log(`\n🚀 Orbital Sandbox server running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Active rooms: http://localhost:${PORT}/rooms`);
  console.log(`   Accepting clients from: ${CLIENT_ORIGIN}`);

  // Best-effort schema bootstrap — safe if DB is unavailable.
  try { await ensureSchema(); }
  catch (err) { console.warn('[DB] ensureSchema failed:', err.message); }
});
