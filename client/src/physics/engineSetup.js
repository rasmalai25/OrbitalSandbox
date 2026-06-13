// physics/engineSetup.js
// Phase 1 — Matter.js engine initialization + custom N-body gravitational forces.

import Matter from 'matter-js';

const G = 0.0001; // Gravitational constant — tuned for canvas scale

/**
 * Creates and returns a Matter.js engine with world gravity disabled.
 * We disable world gravity because orbital mechanics require every body
 * to attract every other body — Matter.js's single gravity vector can't do that.
 */
export function initEngine() {
  const engine = Matter.Engine.create({
    gravity: { x: 0, y: 0 }, // disabled — we apply forces manually each tick
    positionIterations: 6,
    velocityIterations: 4,
  });

  return engine;
}

/**
 * Apply Newtonian gravitational forces between every pair of bodies.
 * Runs O(n²) per tick — fast enough for up to ~30 bodies.
 * Called every frame BEFORE Matter.Engine.update().
 */
export function applyGravitationalForces(bodies) {
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];

      // Skip static pairs
      if (a.isStatic && b.isStatic) continue;

      const dx = b.position.x - a.position.x;
      const dy = b.position.y - a.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Clamp to the sum of their radii — gravity saturates at "touching" distance.
      // This prevents bodies from passing through each other and creating SHM.
      const rA = a.circleRadius || 5;
      const rB = b.circleRadius || 5;
      const contactDist = rA + rB;
      const safeDist = Math.max(dist, contactDist);

      // If bodies are overlapping, gently push them apart instead of attracting
      if (dist < contactDist) {
        const pushMag = 0.005 * (contactDist - dist) / contactDist;
        const nx = dist > 0 ? dx / dist : 1;
        const ny = dist > 0 ? dy / dist : 0;
        if (!a.isStatic) Matter.Body.applyForce(a, a.position, { x: -nx * pushMag * a.mass, y: -ny * pushMag * a.mass });
        if (!b.isStatic) Matter.Body.applyForce(b, b.position, { x:  nx * pushMag * b.mass, y:  ny * pushMag * b.mass });
        continue; // skip normal gravity when overlapping
      }

      const force = (G * a.mass * b.mass) / (safeDist * safeDist);
      const fx = force * (dx / safeDist);
      const fy = force * (dy / safeDist);

      if (!a.isStatic) Matter.Body.applyForce(a, a.position, { x: fx, y: fy });
      if (!b.isStatic) Matter.Body.applyForce(b, b.position, { x: -fx, y: -fy });
    }
  }
}
