// server/src/roomManager.js
// Phase 4 — manages rooms and their state.

const rooms = new Map(); // roomId -> { hostId, observerId, bodies, simRunning, simTime, chatHistory }

export function createRoom(roomId) {
  rooms.set(roomId, {
    hostId: null,
    observerId: null,
    bodies: [],
    simRunning: false,
    simTime: 0,
    chatHistory: [],
  });
}

export function joinRoom(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  if (!room.hostId) {
    room.hostId = socketId;
    return { role: 'host' };
  }
  if (!room.observerId) {
    room.observerId = socketId;
    return { role: 'observer' };
  }
  return { error: 'Room full' };
}

export function getRoomBySocket(socketId) {
  for (const [roomId, room] of rooms) {
    if (room.hostId === socketId || room.observerId === socketId) {
      return { roomId, room };
    }
  }
  return null;
}

export function removeFromRoom(socketId) {
  const result = getRoomBySocket(socketId);
  if (!result) return;
  const { room } = result;
  if (room.hostId === socketId) room.hostId = null;
  if (room.observerId === socketId) room.observerId = null;
}

export function getRoomCount() {
  return rooms.size;
}

export function getActiveRooms() {
  const active = [];
  for (const [roomId, room] of rooms) {
    active.push({
      roomId,
      hasHost: !!room.hostId,
      hasObserver: !!room.observerId,
      bodyCount: room.bodies.length,
    });
  }
  return active;
}
