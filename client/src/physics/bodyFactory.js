// physics/bodyFactory.js
// Phase 2        — creates Matter.js bodies from user config.
// Camera System  — auto-names each body (Planet-1, Star-2, etc.)

import Matter from 'matter-js';
import { nanoid } from 'nanoid';
import { BODY_TYPES } from '../constants/bodyTypes.js';

// Per-session counters — increment on every createBody call, reset on page load.
// Names are assigned once at creation and travel with body_placed payloads.
const typeCounters = { STAR: 0, PLANET: 0, MOON: 0, ASTEROID: 0, BLACK_HOLE: 0 };

export function nextBodyName(type) {
  typeCounters[type] = (typeCounters[type] || 0) + 1;
  const label = BODY_TYPES[type]?.label || type;
  return `${label}-${typeCounters[type]}`;
}

export function resetBodyCounters() {
  Object.keys(typeCounters).forEach(k => { typeCounters[k] = 0; });
}

/**
 * Create a Matter.js body from a config object.
 *
 * @param {object} opts
 * @param {string} opts.type         - key from BODY_TYPES (e.g. 'STAR', 'PLANET')
 * @param {number} opts.x            - canvas X position
 * @param {number} opts.y            - canvas Y position
 * @param {number} [opts.mass]       - override default mass
 * @param {number} [opts.velocityX]  - initial X velocity
 * @param {number} [opts.velocityY]  - initial Y velocity
 * @param {string} [opts.ownerId]    - socket id of placing user
 */
export function createBody({ type = 'PLANET', x, y, mass, velocityX = 0, velocityY = 0, ownerId = 'local' }) {
  const config = BODY_TYPES[type];
  if (!config) throw new Error(`Unknown body type: ${type}`);

  const bodyMass = mass ?? config.defaultMass;

  // Radius scales with cube-root of mass relative to the type default
  // so a heavier planet looks bigger but not absurdly so
  const radius = config.defaultRadius * Math.cbrt(bodyMass / config.defaultMass);

  const body = Matter.Bodies.circle(x, y, radius, {
    mass: bodyMass,
    restitution: 0,       // no bounce
    frictionAir: 0,       // no drag in space
    friction: 0,
    frictionStatic: 0,
    isStatic: config.isStatic,
    label: type,
    // Disable physical collision between all bodies — they interact
    // gravitationally only. Black hole captures are handled by our
    // custom distance check in collisionHandler.js.
    collisionFilter: {
      category: 0x0001,
      mask: 0x0000,       // collide with nothing
    },
  });

  // Prevent rotation — bodies in space don't spin from gravitational nudges
  Matter.Body.setInertia(body, Infinity);

  // Apply initial velocity (from the direction dial + speed slider)
  Matter.Body.setVelocity(body, { x: velocityX, y: velocityY });

  // Attach metadata — Matter.js bodies can carry arbitrary custom properties
  body.customData = {
    id:   nanoid(),
    name: nextBodyName(type),  // e.g. "Planet-3" — editable via PropertyPanel
    type,
    ownerId,
    trailPoints: [],          // filled by TrailManager in Phase 6
    orbitalPeriodStart: null, // filled by orbitAnalyzer in Phase 2
    lastAngle: null,
    fullOrbitsCompleted: 0,
  };

  return body;
}
