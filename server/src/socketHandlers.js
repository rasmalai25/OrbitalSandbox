// server/src/socketHandlers.js
// Phase 4 — room lifecycle + physics state sync.
// Phase 8 — chat history on join, annotations, tug-of-war.
// Phase 9 — save_session / load_session via PostgreSQL.

import { createRoom, joinRoom, getRoomBySocket, removeFromRoom } from './roomManager.js';
import { nanoid } from 'nanoid';
import { rateLimiter } from './middleware/rateLimiter.js';
import { saveSession, loadSession } from './db/queries.js';

export function registerHandlers(io, socket) {

  // Per-socket flood guard (H2)
  socket.use(rateLimiter(socket));

  // ── Room lifecycle ──────────────────────────────────────

  socket.on('create_room', (callback) => {
    const roomId = nanoid(8);
    createRoom(roomId);
    const { role } = joinRoom(roomId, socket.id);
    socket.join(roomId);
    console.log(`[Room] ${socket.id} created room ${roomId} as ${role}`);
    callback({ roomId, role });
  });

  socket.on('join_room', ({ roomId }, callback) => {
    const result = joinRoom(roomId, socket.id);
    if (result.error) return callback(result);
    socket.join(roomId);
    const { room } = getRoomBySocket(socket.id);
    console.log(`[Room] ${socket.id} joined room ${roomId} as ${result.role}`);

    socket.to(roomId).emit('partner_joined', { role: result.role });
    socket.emit('partner_joined', { role: result.role === 'observer' ? 'host' : 'observer' });

    // Send full initial state so the joining client sees existing bodies,
    // chat history, and the host's latest tick (so positions are current, not stale placement positions).
    callback({
      role: result.role,
      initialState: {
        bodies:       room.bodies,
        chatHistory:  room.chatHistory,
        lastTick:     room.lastTick,
        simTime:      room.simTime,
        simRunning:   room.simRunning,
      },
    });
  });

  socket.on('disconnect', () => {
    const result = getRoomBySocket(socket.id);
    if (result) {
      const { roomId } = result;
      removeFromRoom(socket.id);
      socket.to(roomId).emit('partner_disconnected');
      console.log(`[Room] ${socket.id} left room ${roomId}`);
    }
  });

  // ── Physics state sync ──────────────────────────────────

  socket.on('sim_tick', ({ bodies, simTime }) => {
    const result = getRoomBySocket(socket.id);
    if (!result) return;
    const { roomId, room } = result;
    if (room.hostId !== socket.id) return;

    // Enrich tick bodies with metadata (type/mass/name/ownerId) from room.bodies
    // so a late-joining observer materialised via lastTick has all the info
    // it needs without waiting for body_placed.
    const meta = new Map(room.bodies.map(b => [b.id, b]));
    const enriched = bodies.map(b => {
      const m = meta.get(b.id);
      return {
        ...b,
        type:    m?.type    || 'PLANET',
        mass:    m?.mass    || 1000,
        name:    m?.name    || null,
        ownerId: m?.ownerId || 'remote',
      };
    });

    room.lastTick = { bodies: enriched, simTime };
    room.simTime = simTime;
    socket.to(roomId).emit('sim_tick', { bodies: enriched, simTime });
  });

  socket.on('body_placed', (bodyData) => {
    const result = getRoomBySocket(socket.id);
    if (!result) return;
    const { roomId, room } = result;
    room.bodies.push(bodyData);
    socket.to(roomId).emit('body_placed', bodyData);
  });

  socket.on('body_updated', (update) => {
    const result = getRoomBySocket(socket.id);
    if (!result) return;
    const { roomId, room } = result;
    // Patch the cached metadata so late joiners see the updated name/mass
    const body = room.bodies.find(b => b.id === update.id);
    if (body) {
      if (update.name !== undefined) body.name = update.name;
      if (update.mass !== undefined) body.mass = update.mass;
      if (update.velocityX !== undefined) body.velocityX = update.velocityX;
      if (update.velocityY !== undefined) body.velocityY = update.velocityY;
    }
    socket.to(roomId).emit('body_updated', update);
  });

  socket.on('body_removed', ({ bodyId }) => {
    const result = getRoomBySocket(socket.id);
    if (!result) return;
    const { roomId, room } = result;
    room.bodies = room.bodies.filter(b => b.id !== bodyId);
    socket.to(roomId).emit('body_removed', { bodyId });
  });

  socket.on('sim_control', ({ action, speed }) => {
    const result = getRoomBySocket(socket.id);
    if (!result) return;
    const { roomId, room } = result;
    if (room.hostId !== socket.id) return;
    socket.to(roomId).emit('sim_control', { action, speed });
  });

  // ── Collaboration features ──────────────────────────────

  socket.on('cursor_move', ({ x, y }) => {
    const result = getRoomBySocket(socket.id);
    if (!result) return;
    socket.to(result.roomId).emit('partner_cursor', { x, y });
  });

  socket.on('chat_message', ({ text }) => {
    const result = getRoomBySocket(socket.id);
    if (!result) return;
    const { roomId, room } = result;
    const msg = {
      text, simTime: room.simTime, senderId: socket.id,
      id: nanoid(), timestamp: Date.now(),
    };
    room.chatHistory.push(msg);
    // Cap chat history at a reasonable size so it stays in memory bounds
    if (room.chatHistory.length > 200) room.chatHistory.shift();
    io.to(roomId).emit('chat_message', msg);
  });

  socket.on('annotation_draw', (annotation) => {
    const result = getRoomBySocket(socket.id);
    if (!result) return;
    socket.to(result.roomId).emit('annotation_draw', {
      ...annotation,
      senderId: socket.id,
    });
  });

  socket.on('tug_of_war', ({ bodyId, force }) => {
    const result = getRoomBySocket(socket.id);
    if (!result) return;
    socket.to(result.roomId).emit('tug_of_war', {
      bodyId, force, fromId: socket.id,
    });
  });

  // ── Phase 9: persistence ────────────────────────────────

  socket.on('save_session', async (sessionPayload, callback) => {
    try {
      const { shareId } = await saveSession(sessionPayload);
      callback?.({ shareId });
    } catch (err) {
      console.error('[save_session]', err);
      callback?.({ error: err.message });
    }
  });

  socket.on('load_session', async ({ shareId }, callback) => {
    try {
      const state = await loadSession(shareId);
      if (!state) return callback?.({ error: 'Not found' });
      callback?.({ state });
    } catch (err) {
      console.error('[load_session]', err);
      callback?.({ error: err.message });
    }
  });
}
