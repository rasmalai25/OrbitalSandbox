// server/src/sessionState.js
// In-memory session state per room. Phase 9 adds PostgreSQL persistence.

export function createSessionState() {
  return {
    bodies: [],
    simRunning: false,
    simTime: 0,
    speed: 1,
    chatHistory: [],
    createdAt: Date.now(),
    lastUpdated: Date.now(),
  };
}
