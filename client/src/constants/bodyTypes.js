// constants/bodyTypes.js
// Phase 2 — full body type registry.
// Used by bodyFactory, CanvasRenderer, and Toolbar.

export const BODY_TYPES = {
  STAR: {
    label: 'Star',
    defaultMass: 50000,
    defaultRadius: 40,
    color: '#FFD700',
    isStatic: false,
    trailColor: '#FFD70055',
    emoji: '⭐',
    description: 'Massive luminous body — high gravity well',
  },
  PLANET: {
    label: 'Planet',
    defaultMass: 1000,
    defaultRadius: 14,
    color: '#4A90E2',
    isStatic: false,
    trailColor: '#4A90E255',
    emoji: '🌍',
    description: 'Orbits stars, may capture moons',
  },
  MOON: {
    label: 'Moon',
    defaultMass: 50,
    defaultRadius: 6,
    color: '#C8C8C8',
    isStatic: false,
    trailColor: '#C8C8C855',
    emoji: '🌙',
    description: 'Small body — orbits planets or stars',
  },
  ASTEROID: {
    label: 'Asteroid',
    defaultMass: 5,
    defaultRadius: 3,
    color: '#8B7355',
    isStatic: false,
    trailColor: '#8B735555',
    emoji: '☄️',
    description: 'Tiny rocky body — chaotic trajectories',
  },
  BLACK_HOLE: {
    label: 'Black Hole',
    defaultMass: 500000,
    defaultRadius: 20,
    color: '#1A0030',
    glowColor: '#7B00FF',
    isStatic: true,
    trailColor: null,
    emoji: '🕳️',
    description: 'Pinned singularity — captures nearby bodies',
    warpsNearbyTrails: true,
  },
};

export const BODY_TYPE_KEYS = Object.keys(BODY_TYPES);
