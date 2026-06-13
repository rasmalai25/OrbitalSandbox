// physics/collisionHandler.js
// Phase 3 — collision detection + slow-motion trigger.
// Phase 6 — particle bursts + spaghettification on capture.

import Matter from 'matter-js';
import { triggerSlowMotion } from '../simulation/SimulationLoop.js';
import {
  spawnCollisionParticles,
  triggerSpaghettification,
} from '../canvas/CanvasRenderer.js';

const BLACK_HOLE_CAPTURE_RADIUS = 25; // px inside which bodies are "captured"

/**
 * Register Matter.js collision event listeners on the engine.
 * @param {Matter.Engine} engine
 * @param {function} onCollision - callback({ bodyA, bodyB })
 */
export function registerCollisionHandlers(engine, onCollision = () => {}) {
  Matter.Events.on(engine, 'collisionStart', event => {
    event.pairs.forEach(pair => {
      const { bodyA, bodyB } = pair;
      // Phase 6: spawn particle burst at midpoint of collision
      const mx = (bodyA.position.x + bodyB.position.x) / 2;
      const my = (bodyA.position.y + bodyB.position.y) / 2;
      spawnCollisionParticles(mx, my, bodyA.mass, bodyB.mass);
      onCollision({ bodyA, bodyB });
    });
  });
}

/**
 * Check if any body has crossed a black hole capture radius.
 * Called each tick after Matter.Engine.update().
 * @param {Matter.Engine} engine
 * @param {function} onCapture - callback(capturedBody)
 */
export function checkBlackHoleCaptures(engine, onCapture = () => {}) {
  const bodies = Matter.Composite.allBodies(engine.world);
  const blackHoles = bodies.filter(b => b.label === 'BLACK_HOLE');
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
        onCapture(body);
        Matter.Composite.remove(engine.world, body);
      }
    });
  });
}
