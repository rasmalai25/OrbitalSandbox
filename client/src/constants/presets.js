// constants/presets.js
// Phase 7 — hand-tuned preset configurations with correct circular-orbit velocities.
// Velocity formula for stable orbit: v = sqrt(G * M_attractor / r)
// where G = 0.0001 and r = distance from star center to planet center.

// ── Helpers ──────────────────────────────────────────────────────────────────

/** LCG pseudo-random — seeded so the asteroid field is always identical. */
function makeLCG(seed) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223 >>> 0;
    return s / 0xffffffff;
  };
}

function buildAsteroidField() {
  const rand = makeLCG(31415);
  const bodies = [
    { type: 'STAR', x: 640, y: 400, mass: 50000, velocityX: 0, velocityY: 0 },
  ];
  const G = 0.0001;
  const M = 50000;
  for (let i = 0; i < 14; i++) {
    const angle = rand() * Math.PI * 2;
    const r     = 90 + rand() * 280;
    const x     = 640 + Math.cos(angle) * r;
    const y     = 400 + Math.sin(angle) * r;
    // Perpendicular to radius vector (counter-clockwise) + small perturbation
    const vOrbit    = Math.sqrt(G * M / r);
    const vPerturb  = (rand() - 0.5) * vOrbit * 0.35;
    const velocityX = -(Math.sin(angle)) * (vOrbit + vPerturb);
    const velocityY =  (Math.cos(angle)) * (vOrbit + vPerturb);
    bodies.push({
      type: 'ASTEROID',
      x: Math.round(x),
      y: Math.round(y),
      mass: 3 + rand() * 12,
      velocityX: parseFloat(velocityX.toFixed(4)),
      velocityY: parseFloat(velocityY.toFixed(4)),
    });
  }
  return bodies;
}

// ── Preset definitions ────────────────────────────────────────────────────────

export const PRESETS = [
  {
    id: 'solar_system',
    label: 'Solar System',
    emoji: '☀️',
    description: '3 planets in stable circular orbits — watch Mercury lap the outer worlds',
    // Star mass 200000 → v = sqrt(0.0001 * 200000 / r) = sqrt(20/r)
    bodies: [
      { type: 'STAR',   x: 640, y: 400, mass: 200000, velocityX: 0,    velocityY: 0     },
      { type: 'PLANET', x: 760, y: 400, mass: 300,    velocityX: 0,    velocityY:  0.408 }, // r=120
      { type: 'PLANET', x: 850, y: 400, mass: 600,    velocityX: 0,    velocityY:  0.316 }, // r=210
      { type: 'PLANET', x: 990, y: 400, mass: 250,    velocityX: 0,    velocityY:  0.243 }, // r=350
    ],
  },
  {
    id: 'binary_star',
    label: 'Binary Stars',
    emoji: '⭐',
    description: 'Two massive stars locked in a tight mutual orbit',
    // Mutual orbit: v = sqrt(G * M / (4 * d)) where d = half separation
    // M=300000, d=150 → v = sqrt(0.0001*300000/600) = sqrt(0.05) ≈ 0.224
    bodies: [
      { type: 'STAR', x: 490, y: 400, mass: 300000, velocityX: 0, velocityY: -0.224 },
      { type: 'STAR', x: 790, y: 400, mass: 300000, velocityX: 0, velocityY:  0.224 },
    ],
  },
  {
    id: 'asteroid_field',
    label: 'Asteroid Field',
    emoji: '☄️',
    description: 'A star encircled by 14 asteroids on near-circular orbital paths',
    bodies: buildAsteroidField(),
  },
  {
    id: 'three_body',
    label: 'Three-Body',
    emoji: '🌀',
    description: 'Three equal stars — chaotic, beautiful, and mathematically unsolvable',
    bodies: [
      { type: 'STAR', x: 640, y: 260, mass: 150000, velocityX:  0.28, velocityY:  0.12 },
      { type: 'STAR', x: 790, y: 520, mass: 150000, velocityX: -0.28, velocityY: -0.12 },
      { type: 'STAR', x: 490, y: 520, mass: 150000, velocityX:  0,    velocityY:  0.30 },
    ],
  },
];
