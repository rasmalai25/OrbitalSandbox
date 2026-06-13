// hooks/useSimulation.js
// Phase 3 — engine lifecycle, slow-motion proximity trigger, black hole capture.

import { useEffect, useRef, useCallback } from 'react';
import { initEngine } from '../physics/engineSetup.js';
import {
  startLoop, pauseLoop, resumeLoop, setSpeed, isRunning, triggerSlowMotion,
} from '../simulation/SimulationLoop.js';
import { registerCollisionHandlers, checkBlackHoleCaptures } from '../physics/collisionHandler.js';
import { createBody } from '../physics/bodyFactory.js';
import Matter from 'matter-js';

// Minimum distance between body surfaces that triggers slow-motion (px)
const CLOSE_APPROACH_THRESHOLD = 8;
// Cooldown so we don't spam slow-mo every frame
let slowMoCooldown = 0;

export function useSimulation(canvasRef) {
  const engineRef = useRef(null);
  const stopLoopRef = useRef(null);
  const emitTickRef = useRef(() => {}); // injected by App after room is set up

  // ── Init on mount ──────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const engine = initEngine();
    engineRef.current = engine;

    // Physical collisionStart won't fire (mask:0x0000) but keep handler for future
    registerCollisionHandlers(engine, () => {});

    // ── Per-tick logic ─────────────────────────────────
    const onTick = (eng) => {
      const bodies = Matter.Composite.allBodies(eng.world);

      // Black hole captures
      checkBlackHoleCaptures(eng, body => {
        console.log('[Black hole] captured:', body.customData?.id);
      });

      // Close-approach slow-motion trigger
      if (slowMoCooldown > 0) {
        slowMoCooldown--;
      } else {
        const nonStatic = bodies.filter(b => !b.isStatic);
        outer: for (let i = 0; i < nonStatic.length; i++) {
          for (let j = i + 1; j < nonStatic.length; j++) {
            const a = nonStatic[i];
            const b = nonStatic[j];
            const dx = b.position.x - a.position.x;
            const dy = b.position.y - a.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const surfaceDist = dist - (a.circleRadius || 5) - (b.circleRadius || 5);
            if (surfaceDist < CLOSE_APPROACH_THRESHOLD) {
              triggerSlowMotion(2500);
              slowMoCooldown = 200;
              break outer;
            }
          }
        }
      }

      // Phase 4: emit tick to partner (no-op if not in room)
      emitTickRef.current(eng);
    };

    stopLoopRef.current = startLoop(engine, canvas, onTick);

    return () => {
      stopLoopRef.current?.();
      window.removeEventListener('resize', resize);
    };
  }, [canvasRef]);

  // ── Place body ─────────────────────────────────────────
  const placeBody = useCallback((opts) => {
    const engine = engineRef.current;
    if (!engine) return null;
    const body = createBody(opts);
    Matter.Composite.add(engine.world, body);
    return body;
  }, []);

  // ── Remove body by id ──────────────────────────────────
  const removeBody = useCallback((id) => {
    const engine = engineRef.current;
    if (!engine) return;
    const bodies = Matter.Composite.allBodies(engine.world);
    const target = bodies.find(b => b.customData?.id === id);
    if (target) Matter.Composite.remove(engine.world, target);
  }, []);

  // ── Clear all bodies ───────────────────────────────────
  const clearAll = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    // Clear all bodies from the world
    Matter.Composite.clear(engine.world, false);
    // Flush engine's internal pair/broadphase caches so no stale
    // references can resurrect cleared bodies on the next tick
    Matter.Engine.clear(engine);
    slowMoCooldown = 0;
  }, []);

  return {
    engine: engineRef,
    placeBody,
    removeBody,
    clearAll,
    pause: pauseLoop,
    resume: resumeLoop,
    setSpeed,
    isRunning,
    setEmitTick: (fn) => { emitTickRef.current = fn; },
  };
}
