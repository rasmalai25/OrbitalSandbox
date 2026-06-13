// server/src/middleware/rateLimiter.js
// Prevents individual sockets from flooding socket events.
// Phase 4 activates this middleware.

const WINDOW_MS = 1000;  // 1 second
const MAX_EVENTS = 60;   // max 60 events/second per socket

const counters = new Map(); // socketId -> { count, resetAt }

/**
 * Returns a middleware function that rate-limits a specific socket.
 * Call once per connection: socket.use(rateLimiter(socket));
 */
export function rateLimiter(socket) {
  return ([event], next) => {
    const now = Date.now();
    let entry = counters.get(socket.id);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      counters.set(socket.id, entry);
    }

    entry.count++;
    if (entry.count > MAX_EVENTS) {
      console.warn(`[RateLimit] Socket ${socket.id} exceeded ${MAX_EVENTS} events/sec on event "${event}"`);
      return next(new Error('Rate limit exceeded'));
    }

    next();
  };
}

// Clean up stale entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of counters) {
    if (now > entry.resetAt + 5000) counters.delete(id);
  }
}, 30_000);
