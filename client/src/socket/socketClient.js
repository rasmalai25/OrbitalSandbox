// socket/socketClient.js
// Phase 4 — auto-connects on import. Safe to call connectSocket() multiple times.

import { io } from 'socket.io-client';

// Connect on module load — this fires once when any file imports socketClient.
// Using window.location.origin so Vite's /socket.io proxy is used in dev.
const SERVER_URL = import.meta.env.VITE_SERVER_URL
  ? import.meta.env.VITE_SERVER_URL
  : window.location.origin;

const socket = io(SERVER_URL, {
  path: '/socket.io',
  autoConnect: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  transports: ['websocket', 'polling'],
});

/**
 * Returns the singleton socket. Always safe to call — socket is created at module load.
 */
export function getSocket() {
  return socket;
}

/**
 * Alias kept for backward compatibility with App.jsx useEffect.
 * Returns the same singleton.
 */
export function connectSocket() {
  return socket;
}

export default socket;
