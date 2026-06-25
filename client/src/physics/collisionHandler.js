// physics/collisionHandler.js
// Phase 3 — collision detection (custom — bodies don't physically collide).
// Phase 6 — particle bursts + spaghettification on capture.
//
// IMPORTANT: bodyFactory sets collisionFilter mask: 0x0000 so Matter.js
// NEVER fires collisionStart. We run our own per-tick distance check and
// fire callbacks ourselves. This preserves the "pure gravity" feel — bodies
// pass through each other under gravity (with a soft push-back from
// engineSetup.applyGravitationalForces) — while still letting particles,
// screen shake, and the controlled_collision challenge react to contact.

import Matter from 'matter-js';
import {
  spawnCollisionParticles,
  triggerSpaghettification,
  triggerShake,
} from '../canvas/CanvasRenderer.js';
import { triggerSlowMotion } from '../simulation/SimulationLoop.js';
import { playSfx } from '../audio/AudioManager.js';

const BLACK_HOLE_CAPTURE_RADIUS = 25; // px inside which bodies are "captured"

// ── Multi-listener pub/sub for collision events ──────────────────────────────
const _listeners = new Set();
let _activePairs = new Set(); // pairId -> currently in contact

/**
 * Subscribe to collision events. Returns an unsubscribe function.
 * Called by useSimulation (slow-mo trigger) and challengeEngine (success check).
 */
export function onCollision(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

/**
 * Kept for backward compatibility. Registers `cb` via the pub/sub above.
 * Returns an unsubscribe function.
 */
export function registerCollisionHandlers(engine, cb = () => {}) {
  return onCollision(cb);
}

/**
 * Clear pair tracking — call when world is cleared or session reset.
 * Prevents a stale pair from suppressing the first re-collision after reset.
 */
export function clearCollisionState() {
  _activePairs.clear();
}

/**
 * Custom collision detection — runs every tick from SimulationLoop.
 * Fires registered listeners ONCE per pair when they enter contact,
 * not every frame they stay in contact.
 *
 * Skips black holes — captures are handled by checkBlackHoleCaptures below.
 *
 * @param {Matter.Engine} engine
 */
export function checkCustomCollisions(engine) {
  const bodies = Matter.Composite.allBodies(engine.world);
  const candidates = [];
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (b.label === 'BLACK_HOLE') continue;
    if (!b.customData?.id) continue;
    candidates.push(b);
  }

  const currentPairs = new Set();

  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    const aId = a.customData.id;
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      const bId = b.customData.id;
      const dx = a.position.x - b.position.x;
      const dy = a.position.y - b.position.y;
      const distSq = dx * dx + dy * dy;
      const contact = (a.circleRadius || 5) + (b.circleRadius || 5);
      if (distSq >= contact * contact) continue;

      const pairId = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
      currentPairs.add(pairId);
      if (_activePairs.has(pairId)) continue;

      // New pair entering contact — fire once.
      const mx = (a.position.x + b.position.x) / 2;
      const my = (a.position.y + b.position.y) / 2;

      // Particle burst at midpoint
      spawnCollisionParticles(mx, my, a.mass, b.mass);

      // Screen shake scaled by combined mass (log-scaled, capped at 3)
      const shakeIntensity = Math.min(1 + Math.log10(a.mass + b.mass) * 0.3, 3);
      triggerShake(shakeIntensity);

      // Slow-motion replay for emphasis
      triggerSlowMotion(2200);

      // One-shot SFX (inert until ENTER unlocks audio)
      playSfx('collision');

      // Notify subscribers (challenge completion, etc.)
      _listeners.forEach(cb => {
        try { cb({ bodyA: a, bodyB: b }); }
        catch (err) { console.error('[collision listener]', err); }
      });
    }
  }

  _activePairs = currentPairs;
}

/**
 * Check if any body has crossed a black hole capture radius.
 * Called each tick from the simulation loop after Matter.Engine.update.
 *
 * @param {Matter.Engine} engine
 * @param {function} onCapture - callback(capturedBody)
 */
export function checkBlackHoleCaptures(engine, onCapture = () => {}) {
  const bodies = Matter.Composite.allBodies(engine.world);
  const blackHoles = bodies.filter(b => b.label === 'BLACK_HOLE');
  if (blackHoles.length === 0) return;
  const others = bodies.filter(b => b.label !== 'BLACK_HOLE');

  blackHoles.forEach(bh => {
    others.forEach(body => {
      const dx = body.position.x - bh.position.x;
      const dy = body.position.y - bh.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < BLACK_HOLE_CAPTURE_RADIUS + (body.circleRadius || 5)) {
        // Phase 6: spaghettification animation before removal
        triggerSpaghettification(body, bh);
        // Small particle burst at capture point
        spawnCollisionParticles(body.position.x, body.position.y, body.mass, 0);
        playSfx('capture');
        onCapture(body);
        Matter.Composite.remove(engine.world, body);
      }
    });
  });
}
