// server/src/roomManager.js
// Phase 4 — manages rooms and their state. Phase 8 — chatHistory persistence
// per room. Phase 9 — rooms now also carry a `lastTick` for late-join sync.

const rooms = new Map(); // roomId -> { hostId, observerId, bodies, simRunning, simTime, chatHistory, lastTick }

export function createRoom(roomId) {
  rooms.set(roomId, {
    hostId: null,
    observerId: null,
    bodies: [],
    simRunning: false,
    simTime: 0,
    chatHistory: [],
    lastTick: null,
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

/**
 * Remove a socket from its room. If the room is empty afterward,
 * delete the room entry from the map so long-running servers don't
 * accumulate dead rooms.
 */
export function removeFromRoom(socketId) {
  const result = getRoomBySocket(socketId);
  if (!result) return;
  const { roomId, room } = result;
  if (room.hostId === socketId) room.hostId = null;
  if (room.observerId === socketId) room.observerId = null;
  if (!room.hostId && !room.observerId) {
    rooms.delete(roomId);
  }
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
