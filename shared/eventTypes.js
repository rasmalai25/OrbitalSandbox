// shared/eventTypes.js
// Canonical list of all Socket.io event name strings.
// Import from here in both client and server to avoid magic strings.

export const EVENTS = {
  // --- Room Lifecycle ---
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  PARTNER_DISCONNECTED: 'partner_disconnected',

  // --- Physics State Sync ---
  SIM_TICK: 'sim_tick',
  BODY_PLACED: 'body_placed',
  BODY_UPDATED: 'body_updated',
  BODY_REMOVED: 'body_removed',
  SIM_CONTROL: 'sim_control',

  // --- Collaboration ---
  CURSOR_MOVE: 'cursor_move',
  PARTNER_CURSOR: 'partner_cursor',
  ANNOTATION_DRAW: 'annotation_draw',
  CHAT_MESSAGE: 'chat_message',
  CHAT_HISTORY: 'chat_history',
  TUG_OF_WAR: 'tug_of_war',

  // --- Session Persistence ---
  SAVE_SESSION: 'save_session',
  LOAD_SESSION: 'load_session',
  SESSION_SAVED: 'session_saved',
  SESSION_LOADED: 'session_loaded',

  // --- Collision ---
  COLLISION_EVENT: 'collision_event',
};
