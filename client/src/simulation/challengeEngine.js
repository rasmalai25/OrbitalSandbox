// simulation/challengeEngine.js
// Phase 7 — two challenge scenarios with per-second polling for success.

import Matter from 'matter-js';
import { onCollision } from '../physics/collisionHandler.js';

let _interval    = null;
let _offListener = null;
let _engine      = null;

// ── Challenge definitions ─────────────────────────────────────────────────────

export const CHALLENGES = {
  stabilize: {
    id:          'stabilize',
    label:       'Stabilize the System',
    emoji:       '🛸',
    description: 'A planet is escaping. Add one body to keep everything on-screen for 15 seconds.',
    initialBodies: [
      { type: 'STAR',   x: 640, y: 400, mass: 200000, velocityX: 0,     velocityY: 0     },
      { type: 'PLANET', x: 800, y: 400, mass: 600,    velocityX: 0,     velocityY: 0.55  }, // slightly over escape
      { type: 'MOON',   x: 715, y: 400, mass: 60,     velocityX: 0,     velocityY: 0.37  },
    ],
    // Passes when all bodies have been on-screen for 15 consecutive seconds
    check: (engine, ctx) => {
      const bodies = Matter.Composite.allBodies(engine.world);
      const pad    = 120;
      const allOn  = bodies.every(b =>
        b.position.x > -pad && b.position.x < ctx.W + pad &&
        b.position.y > -pad && b.position.y < ctx.H + pad
      );
      if (allOn) ctx.stableSecs++;
      else       ctx.stableSecs = 0;
      return ctx.stableSecs >= 15;
    },
    progressLabel: (ctx) => `Stable for ${ctx.stableSecs}s / 15s`,
  },

  controlled_collision: {
    id:          'controlled_collision',
    label:       'Controlled Collision',
    emoji:       '💥',
    description: 'Guide the two asteroids into each other using only gravity.',
    initialBodies: [
      { type: 'STAR',     x: 640, y: 400, mass: 200000, velocityX: 0,     velocityY: 0      },
      { type: 'ASTEROID', x: 440, y: 270, mass: 10,     velocityX: 0.38,  velocityY:  0.17  },
      { type: 'ASTEROID', x: 840, y: 530, mass: 10,     velocityX: -0.28, velocityY: -0.12  },
    ],
    check: (_engine, ctx) => ctx.collisionFired,
    progressLabel: () => 'Waiting for collision…',
  },
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start a challenge: load its bodies, then poll success every second.
 * @param {string} id  - key from CHALLENGES
 * @param {object} opts
 *   engine, placeBody, clearAll, clearHistory, emitBodyPlaced,
 *   onSuccess, onProgress, canvasWidth, canvasHeight
 * @returns {object} ctx — live progress object (read-only from outside)
 */
export function startChallenge(id, opts) {
  const ch = CHALLENGES[id];
  if (!ch) return null;

  stopChallenge();

  const {
    engine, placeBody, clearAll, clearHistory,
    emitBodyPlaced, onSuccess, onAbort, onProgress,
    canvasWidth = 1280, canvasHeight = 800,
  } = opts;

  _engine = engine;

  // Load initial state
  clearAll();
  clearHistory?.();
  ch.initialBodies.forEach(cfg => {
    const b = placeBody({ ...cfg, ownerId: 'challenge' });
    if (b) emitBodyPlaced?.(b);
  });

  const ctx = { stableSecs: 0, collisionFired: false, W: canvasWidth, H: canvasHeight };

  // Collision listener for the controlled_collision challenge.
  // Uses our custom pub/sub (Matter.js never fires collisionStart because
  // bodies have collisionFilter mask 0x0000).
  if (id === 'controlled_collision') {
    _offListener = onCollision(({ bodyA, bodyB }) => {
      // Only count asteroid-asteroid collisions, not asteroid-star
      if (bodyA.label === 'ASTEROID' && bodyB.label === 'ASTEROID') {
        ctx.collisionFired = true;
      }
    });
  }

  _interval = setInterval(() => {
    const currentBodies = Matter.Composite.allBodies(engine.world);

    // If the world was cleared externally, abort the challenge cleanly
    if (currentBodies.length === 0) {
      stopChallenge();
      onAbort?.();
      return;
    }

    const done = ch.check(engine, ctx);
    onProgress?.(ch.progressLabel(ctx));
    if (done) {
      stopChallenge();
      onSuccess?.();
    }
  }, 1000);

  return ctx;
}

/** Cancel the active challenge without firing onSuccess. */
export function stopChallenge() {
  if (_interval)    { clearInterval(_interval); _interval = null; }
  if (_offListener) { _offListener(); _offListener = null; }
  _engine = null;
}
