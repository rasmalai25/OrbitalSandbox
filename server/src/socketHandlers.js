// server/src/socketHandlers.js
// Phase 4 — all Socket.io event handlers.

import { createRoom, joinRoom, getRoomBySocket, removeFromRoom } from './roomManager.js';
import { nanoid } from 'nanoid';

export function registerHandlers(io, socket) {

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

    // Tell the host that the observer joined
    socket.to(roomId).emit('partner_joined', { role: result.role });

    // Tell the joining client that the host is already there
    // (without this the observer stays on "Waiting for partner...")
    socket.emit('partner_joined', { role: result.role === 'observer' ? 'host' : 'observer' });

    callback({ role: result.role, initialState: room });
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

    // CRITICAL: do NOT overwrite room.bodies with tick data — tick data lacks
    // type/mass/ownerId which are needed when a new observer joins.
    // Instead, enrich tick bodies with metadata from room.bodies before broadcasting.
    const bodyMeta = new Map(room.bodies.map(b => [b.id, b]));
    const enrichedBodies = bodies.map(b => ({
      ...b,
      type:    bodyMeta.get(b.id)?.type    || 'PLANET',
      mass:    bodyMeta.get(b.id)?.mass    || 1000,
      ownerId: bodyMeta.get(b.id)?.ownerId || 'remote',
    }));

    room.lastTick = { bodies: enrichedBodies, simTime };
    room.simTime = simTime;
    socket.to(roomId).emit('sim_tick', { bodies: enrichedBodies, simTime });
  });

  socket.on('body_placed', (bodyData) => {
    const result = getRoomBySocket(socket.id);
    if (!result) return;
    const { roomId, room } = result;
    room.bodies.push(bodyData);
    socket.to(roomId).emit('body_placed', bodyData);
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
    io.to(roomId).emit('chat_message', msg);
  });

  socket.on('tug_of_war', ({ bodyId, force }) => {
    const result = getRoomBySocket(socket.id);
    if (!result) return;
    socket.to(result.roomId).emit('tug_of_war', { bodyId, force, fromId: socket.id });
  });
}
