// socket/syncEngine.js
// Phase 4 — applies server-authoritative state to the local Matter.js engine.
// Camera doc §socket-sync — customData.name is preserved end-to-end.

import Matter from 'matter-js';
import { createBody } from '../physics/bodyFactory.js';

const LERP = 0.3; // interpolation factor — hides network jitter

/**
 * Apply a sim_tick snapshot. Called on the observer client only.
 * If a body in the tick doesn't exist locally yet, materialise a placeholder
 * using metadata enriched by the server (type/mass/name/ownerId).
 */
export function applySyncedTick(engine, serverBodies) {
  const localBodies = Matter.Composite.allBodies(engine.world);
  const localById = new Map(localBodies.map(b => [b.customData?.id, b]));

  serverBodies.forEach(sb => {
    let local = localById.get(sb.id);

    if (!local) {
      const placeholder = createBody({
        type:      sb.type || 'PLANET',
        x:         sb.x,
        y:         sb.y,
        mass:      sb.mass || 1000,
        velocityX: sb.vx || 0,
        velocityY: sb.vy || 0,
        ownerId:   sb.ownerId || 'remote',
        name:      sb.name || undefined, // use host's name if present
      });
      placeholder.customData.id = sb.id;
      Matter.Composite.add(engine.world, placeholder);
      local = placeholder;
    } else if (sb.name && local.customData?.name !== sb.name) {
      // Late-arriving name fix (placeholder created before body_placed/host name update)
      local.customData.name = sb.name;
    }

    Matter.Body.setPosition(local, {
      x: local.position.x + (sb.x - local.position.x) * LERP,
      y: local.position.y + (sb.y - local.position.y) * LERP,
    });
    Matter.Body.setVelocity(local, { x: sb.vx, y: sb.vy });
  });

  // Remove bodies the server no longer reports
  const serverIds = new Set(serverBodies.map(sb => sb.id));
  localBodies.forEach(b => {
    if (b.customData?.id && !serverIds.has(b.customData.id)) {
      Matter.Composite.remove(engine.world, b);
    }
  });
}

/**
 * Instantiate a body received from a remote body_placed event.
 * The host's name travels with the payload; we use it verbatim.
 */
export function applyRemoteBodyPlaced(engine, bodyData) {
  if (!bodyData?.id || !bodyData?.type) return;

  const existing = Matter.Composite.allBodies(engine.world)
    .find(b => b.customData?.id === bodyData.id);
  if (existing) {
    // Already materialised by an earlier sim_tick placeholder — overwrite the
    // auto-generated placeholder name with the host's canonical name so both
    // clients agree on what the body is called.
    if (bodyData.name && existing.customData) {
      existing.customData.name = bodyData.name;
    }
    return;
  }

  const body = createBody({
    type:      bodyData.type,
    x:         bodyData.x,
    y:         bodyData.y,
    mass:      bodyData.mass,
    velocityX: bodyData.velocityX ?? bodyData.vx ?? 0,
    velocityY: bodyData.velocityY ?? bodyData.vy ?? 0,
    ownerId:   bodyData.ownerId || 'remote',
    name:      bodyData.name || undefined,
  });

  body.customData.id = bodyData.id;
  Matter.Composite.add(engine.world, body);
}

/**
 * Apply a partial update to an existing body — covers renames (name),
 * mass changes, and direct velocity tweaks.
 */
export function applyRemoteBodyUpdated(engine, update) {
  if (!update?.id) return;
  const body = Matter.Composite.allBodies(engine.world)
    .find(b => b.customData?.id === update.id);
  if (!body) return;

  if (update.name !== undefined && body.customData) {
    body.customData.name = update.name;
  }
  if (update.mass !== undefined) {
    Matter.Body.setMass(body, update.mass);
  }
  if (update.velocityX !== undefined || update.velocityY !== undefined) {
    Matter.Body.setVelocity(body, {
      x: update.velocityX ?? body.velocity.x,
      y: update.velocityY ?? body.velocity.y,
    });
  }
}

export function applyRemoteBodyRemoved(engine, bodyId) {
  const bodies = Matter.Composite.allBodies(engine.world);
  const target = bodies.find(b => b.customData?.id === bodyId);
  if (target) Matter.Composite.remove(engine.world, target);
}
