// physics/orbitAnalyzer.js
// Phase 5 — tracks orbital periods by accumulating angle swept around the dominant attractor.

const TWO_PI = Math.PI * 2;

/**
 * Pick the body that exerts the strongest gravitational pull on `b`.
 * F ∝ m_other / r² — this picks the right attractor whether b is a
 * planet near a star (star wins) or a moon near a planet (planet wins,
 * because the much closer planet's 1/r² beats the distant star's mass).
 */
function dominantAttractor(b, bodies) {
  let best = null;
  let bestForce = 0;
  for (let i = 0; i < bodies.length; i++) {
    const o = bodies[i];
    if (o === b) continue;
    const dx = o.position.x - b.position.x;
    const dy = o.position.y - b.position.y;
    const distSq = Math.max(dx * dx + dy * dy, 1);
    const f = o.mass / distSq;
    if (f > bestForce) { bestForce = f; best = o; }
  }
  return best;
}

/**
 * Called every tick. Mutates body.customData in place.
 * @param {Array} bodies - all Matter.js bodies in world
 * @param {number} simTime - current sim tick count (for period calculation)
 */
export function updateOrbitalPeriods(bodies, simTime) {
  bodies.forEach(body => {
    const cd = body.customData;
    if (!cd) return;
    if (body.isStatic) return;

    // Pick the body that pulls hardest on this one (force-weighted)
    const attractor = dominantAttractor(body, bodies);
    if (!attractor) return;

    const dx = body.position.x - attractor.position.x;
    const dy = body.position.y - attractor.position.y;
    const currentAngle = Math.atan2(dy, dx);

    if (cd.lastAngle !== null && cd.lastAngle !== undefined) {
      let delta = currentAngle - cd.lastAngle;
      if (delta > Math.PI)  delta -= TWO_PI;
      if (delta < -Math.PI) delta += TWO_PI;

      cd.angleAccumulated = (cd.angleAccumulated || 0) + delta;

      if (Math.abs(cd.angleAccumulated) >= TWO_PI) {
        cd.fullOrbitsCompleted = (cd.fullOrbitsCompleted || 0) + 1;
        const prev = cd.simTimeAtLastOrbit;
        cd.orbitalPeriod = prev != null ? simTime - prev : null;
        cd.simTimeAtLastOrbit = simTime;
        cd.angleAccumulated = 0;
      }
    } else {
      cd.angleAccumulated = 0;
    }

    cd.lastAngle = currentAngle;
    cd.currentSimTime = simTime;
  });
}

/**
 * Returns a human-readable orbit classification for a body.
 */
export function classifyOrbit(body, bodies) {
  if (body.isStatic) return 'pinned';
  const attractor = dominantAttractor(body, bodies);
  if (!attractor) return 'free';

  const dx = body.position.x - attractor.position.x;
  const dy = body.position.y - attractor.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;

  const G = 0.0001;
  const speed = Math.sqrt(body.velocity.x ** 2 + body.velocity.y ** 2);
  const ke = 0.5 * body.mass * speed * speed;
  const pe = -(G * body.mass * attractor.mass) / dist;
  const totalEnergy = ke + pe;

  if (totalEnergy > 0) return 'escape';

  // Estimate circular velocity at this distance
  const vCirc = Math.sqrt((G * attractor.mass) / dist);
  const ratio = speed / vCirc;
  if (ratio > 0.5 && ratio < 2.0) return 'stable';
  return 'unstable';
}
