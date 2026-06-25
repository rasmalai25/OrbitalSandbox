// simulation/energyCalculator.js
// Phase 5 — calculates kinetic + potential energy of the system each tick.

const G = 0.0001;

export function calculateEnergy(bodies) {
  let ke = 0;
  let pe = 0;

  bodies.forEach(body => {
    const speed = Math.sqrt(body.velocity.x ** 2 + body.velocity.y ** 2);
    ke += 0.5 * body.mass * speed * speed;
  });

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      const dx = b.position.x - a.position.x;
      const dy = b.position.y - a.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      pe -= (G * a.mass * b.mass) / dist;
    }
  }

  return { ke, pe, total: ke + pe };
}
