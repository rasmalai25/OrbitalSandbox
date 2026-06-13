// simulation/collisionPredictor.js
// Phase 5 — projects body paths forward N steps to predict close approaches.

const PREDICT_STEPS = 60;
const WARNING_DIST = 40; // pixels — surface-to-surface threshold

export function predictCollisions(bodies) {
  const nonStatic = bodies.filter(b => !b.isStatic && b.customData?.id);
  if (nonStatic.length < 2) return [];

  const warnings = [];

  const projections = nonStatic.map(body => {
    const path = [];
    let x = body.position.x;
    let y = body.position.y;
    for (let i = 0; i < PREDICT_STEPS; i++) {
      x += body.velocity.x;
      y += body.velocity.y;
      path.push({ x, y });
    }
    return { id: body.customData.id, radius: body.circleRadius || 5, path };
  });

  for (let i = 0; i < projections.length; i++) {
    for (let j = i + 1; j < projections.length; j++) {
      const pA = projections[i];
      const pB = projections[j];
      const threshold = pA.radius + pB.radius + WARNING_DIST;
      let minDist = Infinity;
      for (let step = 0; step < PREDICT_STEPS; step++) {
        const dx = pA.path[step].x - pB.path[step].x;
        const dy = pA.path[step].y - pB.path[step].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist) minDist = dist;
      }
      if (minDist < threshold) {
        const probability = Math.min(1 - minDist / threshold, 1);
        warnings.push({ idA: pA.id, idB: pB.id, probability });
      }
    }
  }

  return warnings;
}
