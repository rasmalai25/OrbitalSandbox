// physics/trajectoryPredictor.js
// Camera & Body Interaction System — future trajectory arc for selected body.
//
// Simple Euler integrator. Matches the precision of collisionPredictor.js —
// sufficient for a visual guide, not a physics guarantee.
// Only computed every 6 frames when a body is selected & trajectory toggle is on.

const TRAJECTORY_STEPS = 200;
const G = 0.0001; // must match engineSetup.js

/**
 * Predict future positions of `body` under gravity from all other `allBodies`.
 * Returns an array of { x, y } world-space points.
 * Does NOT mutate any real bodies.
 */
export function predictTrajectory(body, allBodies) {
  let x  = body.position.x;
  let y  = body.position.y;
  let vx = body.velocity.x;
  let vy = body.velocity.y;
  const mass = body.mass;

  const path = [{ x, y }];

  for (let step = 0; step < TRAJECTORY_STEPS; step++) {
    let fx = 0, fy = 0;

    for (let i = 0; i < allBodies.length; i++) {
      const other = allBodies[i];
      if (other === body) continue;

      const dx = other.position.x - x;
      const dy = other.position.y - y;
      const distSq   = dx * dx + dy * dy;
      const safeDist = Math.max(Math.sqrt(distSq), 10);
      const force    = (G * mass * other.mass) / (safeDist * safeDist);

      fx += force * (dx / safeDist);
      fy += force * (dy / safeDist);
    }

    vx += fx / mass;
    vy += fy / mass;
    x  += vx;
    y  += vy;

    path.push({ x, y });
  }

  return path;
}
