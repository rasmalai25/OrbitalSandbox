// simulation/HistoryStore.js
// Phase 1 — circular buffer of simulation snapshots for rewind/scrub (Phase 3).

import Matter from 'matter-js';

const MAX_SNAPSHOTS = 3600; // 1 hour at 60fps
const snapshots = new Array(MAX_SNAPSHOTS);
let writeHead = 0;  // next slot to write into
let totalWritten = 0;

/**
 * Record the current engine state into the circular buffer.
 * Called once per simulation tick.
 */
export function recordSnapshot(engine) {
  const bodies = Matter.Composite.allBodies(engine.world);

  snapshots[writeHead % MAX_SNAPSHOTS] = {
    timestamp: performance.now(),
    bodies: bodies.map(b => ({
      id: b.customData?.id,
      x: b.position.x,
      y: b.position.y,
      vx: b.velocity.x,
      vy: b.velocity.y,
      angle: b.angle,
    })),
  };

  writeHead++;
  totalWritten++;
}

export function getSnapshot(index) {
  return snapshots[index % MAX_SNAPSHOTS];
}

export function getCursor() { return writeHead; }
export function getTotalWritten() { return totalWritten; }

export function rewindTo(targetCursor, engine) {
  const snapshot = getSnapshot(targetCursor);
  if (!snapshot) return;

  const bodies = Matter.Composite.allBodies(engine.world);
  snapshot.bodies.forEach(snap => {
    const body = bodies.find(b => b.customData?.id === snap.id);
    if (!body) return;
    Matter.Body.setPosition(body, { x: snap.x, y: snap.y });
    Matter.Body.setVelocity(body, { x: snap.vx, y: snap.vy });
    Matter.Body.setAngle(body, snap.angle);
  });

  writeHead = targetCursor;
}

export function clearHistory() {
  writeHead = 0;
  totalWritten = 0;
}
