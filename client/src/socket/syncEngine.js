// socket/syncEngine.js
// Phase 4 — applies server-authoritative state to the local Matter.js engine (observer only).

import Matter from 'matter-js';
import { createBody } from '../physics/bodyFactory.js';

const LERP = 0.3; // interpolation factor — hides network jitter

/**
 * Apply a sim_tick snapshot from the server to the local engine.
 * Called on the observer client only — the host runs the real simulation.
 *
 * CRITICAL FIX: if a body in the tick doesn't exist locally yet, we can't
 * render it. Instead of silently skipping, we materialise it on the spot
 * using a sensible fallback type (the server tick only carries position/velocity,
 * not full metadata). The proper body_placed event will have already arrived
 * (or arrives shortly after) and will be deduped by the id-guard in
 * applyRemoteBodyPlaced.
 *
 * @param {Matter.Engine} engine
 * @param {Array} serverBodies  - array of { id, x, y, vx, vy, angle, type?, mass? }
 */
export function applySyncedTick(engine, serverBodies) {
  const localBodies = Matter.Composite.allBodies(engine.world);
  const localById = new Map(localBodies.map(b => [b.customData?.id, b]));

  serverBodies.forEach(sb => {
    let local = localById.get(sb.id);

    // If the body hasn't been materialised yet (race: tick arrives before body_placed),
    // create a placeholder body so the observer canvas is never blank.
    if (!local) {
      const placeholder = createBody({
        type: sb.type || 'PLANET',
        x: sb.x,
        y: sb.y,
        mass: sb.mass || 1000,
        velocityX: sb.vx || 0,
        velocityY: sb.vy || 0,
        ownerId: sb.ownerId || 'remote',
      });
      placeholder.customData.id = sb.id;
      Matter.Composite.add(engine.world, placeholder);
      local = placeholder;
    }

    // Lerp toward server position to hide network jitter (~50ms visual lag)
    Matter.Body.setPosition(local, {
      x: local.position.x + (sb.x - local.position.x) * LERP,
      y: local.position.y + (sb.y - local.position.y) * LERP,
    });
    Matter.Body.setVelocity(local, { x: sb.vx, y: sb.vy });
  });

  // Remove bodies the server no longer reports (captured by black hole, cleared, etc.)
  const serverIds = new Set(serverBodies.map(sb => sb.id));
  localBodies.forEach(b => {
    if (b.customData?.id && !serverIds.has(b.customData.id)) {
      Matter.Composite.remove(engine.world, b);
    }
  });
}

/**
 * Instantiate a body received from a remote body_placed event.
 * @param {Matter.Engine} engine
 * @param {object} bodyData  - same shape as createBody opts + id field
 */
export function applyRemoteBodyPlaced(engine, bodyData) {
  if (!bodyData?.id || !bodyData?.type) return; // malformed data guard

  const existing = Matter.Composite.allBodies(engine.world)
    .find(b => b.customData?.id === bodyData.id);
  if (existing) return; // already exists (race condition guard)

  const body = createBody({
    type: bodyData.type,
    x: bodyData.x,
    y: bodyData.y,
    mass: bodyData.mass,
    velocityX: bodyData.velocityX ?? bodyData.vx ?? 0,
    velocityY: bodyData.velocityY ?? bodyData.vy ?? 0,
    ownerId: bodyData.ownerId || 'remote',
  });

  // Override generated id with the one from the host so both clients share the same id
  body.customData.id = bodyData.id;
  Matter.Composite.add(engine.world, body);
}

/**
 * Remove a body by id (received from body_removed event).
 */
export function applyRemoteBodyRemoved(engine, bodyId) {
  const bodies = Matter.Composite.allBodies(engine.world);
  const target = bodies.find(b => b.customData?.id === bodyId);
  if (target) Matter.Composite.remove(engine.world, target);
}
