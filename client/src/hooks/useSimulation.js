// hooks/useSimulation.js
// Phase 3 — engine lifecycle. Collision detection + black hole captures
// run from SimulationLoop directly (see collisionHandler.js).

import { useEffect, useRef, useCallback } from 'react';
import { initEngine } from '../physics/engineSetup.js';
import {
  startLoop, pauseLoop, resumeLoop, setSpeed, isRunning,
  resetTickCounter,
} from '../simulation/SimulationLoop.js';
import { clearCollisionState } from '../physics/collisionHandler.js';
import { createBody } from '../physics/bodyFactory.js';
import { clearAllVfx } from '../canvas/CanvasRenderer.js';
import Matter from 'matter-js';

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

    // Per-tick callback — currently just emits the host's sim_tick.
    // Slow-mo + particles + screen shake are dispatched by checkCustomCollisions
    // inside SimulationLoop, so this stays minimal.
    const onTick = (eng) => {
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
    // Drop any lingering VFX (spaghettification, particles, screen shake)
    // and active collision pairs so the first re-collision fires cleanly
    clearAllVfx();
    clearCollisionState();
    resetTickCounter();
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
