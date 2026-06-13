// simulation/SimulationLoop.js
// Phase 3   — rAF loop with full pause/resume/speed/rewind support.
// Phase 5   — orbital period tracking, collision prediction, gravity overlay.
// Phase 6   — orbital trails, ambient sound.
// Camera System — proper camera object, selection, trajectory prediction.

import Matter from 'matter-js';
import { applyGravitationalForces } from '../physics/engineSetup.js';
import { render } from '../canvas/CanvasRenderer.js';
import { recordSnapshot } from './HistoryStore.js';
import { updateOrbitalPeriods } from '../physics/orbitAnalyzer.js';
import { predictCollisions } from './collisionPredictor.js';
import { renderGravityOverlay } from '../canvas/GravityOverlay.js';
import { updateTrails } from '../canvas/TrailManager.js';
import { syncSound } from '../sound/ambientSound.js';
import {
  createCamera, updateCamera, updateCameraTarget,
} from '../canvas/camera.js';
import { predictTrajectory } from '../physics/trajectoryPredictor.js';

// ── Loop state ────────────────────────────────────────────────────────────────
let rafId         = null;
let lastTimestamp = null;
let speedMultiplier = 1;
let prevSpeed       = 1;
let running         = false;
let _tickFrame      = 0;

let _engine       = null;
let _canvas       = null;
let _onTick       = () => {};
let _overlayCanvas = null;

// ── Camera (single source of truth) ──────────────────────────────────────────
const _camera = createCamera();

// ── Per-frame render state (module vars avoid React re-renders) ───────────────
let _selectedBodyId    = null;
let _hoveredBodyId     = null;
let _ghostPos          = null;   // { x, y } in CANVAS/screen space
let _ghostType         = null;
let _collisionWarnings = [];
let _trailStyle        = 'line';
let _soundEnabled      = false;

// ── Trajectory cache ──────────────────────────────────────────────────────────
let _trajectoryEnabled = false;
let _cachedTrajectory  = null;

// ── Main loop ─────────────────────────────────────────────────────────────────

function loop(timestamp) {
  if (!running) return;

  const rawDelta  = lastTimestamp ? timestamp - lastTimestamp : 16.67;
  const dt        = Math.min(rawDelta, 50);          // raw ms, capped
  const simDelta  = dt * speedMultiplier;
  lastTimestamp = timestamp;

  const bodies = Matter.Composite.allBodies(_engine.world);

  // 1. Physics
  applyGravitationalForces(bodies);
  Matter.Engine.update(_engine, simDelta);

  // 2. Trails
  updateTrails(bodies);

  // 3. Camera
  updateCameraTarget(_camera, _engine, _canvas, _selectedBodyId);
  updateCamera(_camera, dt);

  // 4. Trajectory recompute every 6th frame (cheap enough to skip other frames)
  _tickFrame++;
  if (_tickFrame % 6 === 0 && _trajectoryEnabled && _selectedBodyId) {
    const sel = bodies.find(b => b.customData?.id === _selectedBodyId);
    if (sel) _cachedTrajectory = predictTrajectory(sel, bodies);
    else     _cachedTrajectory = null;
  }

  // 5. Render
  render(_canvas, _engine, _camera, {
    collisionWarnings: _collisionWarnings,
    trailStyle:        _trailStyle,
    hoveredBodyId:     _hoveredBodyId,
    selectedBodyId:    _selectedBodyId,
    ghostPos:          _ghostPos,
    ghostType:         _ghostType,
    trajectoryPath:    _trajectoryEnabled ? _cachedTrajectory : null,
  });

  // 6. Overlay
  if (_overlayCanvas) renderGravityOverlay(_overlayCanvas, bodies);

  // 7. Analytics / sound / history (every 6th frame for cost reasons)
  updateOrbitalPeriods(bodies, _tickFrame);
  _collisionWarnings = predictCollisions(bodies);
  syncSound(bodies, _soundEnabled);
  recordSnapshot(_engine);
  _onTick(_engine);

  rafId = requestAnimationFrame(loop);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startLoop(engine, canvas, onTick = () => {}) {
  _engine       = engine;
  _canvas       = canvas;
  _onTick       = onTick;
  _tickFrame    = 0;
  _collisionWarnings = [];
  _cachedTrajectory  = null;

  // Reset camera to COM centre (don't re-createCamera — preserves zoom level)
  _camera.mode      = 'COM';
  _camera.targetX   = 0;
  _camera.targetY   = 0;

  running       = true;
  lastTimestamp = null;
  rafId = requestAnimationFrame(loop);

  return () => stopLoop();
}

export function stopLoop() {
  running = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

export function pauseLoop() {
  if (!running) return;
  running = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

export function resumeLoop() {
  if (running) return;
  running       = true;
  lastTimestamp = null;
  rafId = requestAnimationFrame(loop);
}

export function setSpeed(multiplier) {
  speedMultiplier = Math.max(0.1, Math.min(multiplier, 100));
}

export function getSpeed()      { return speedMultiplier; }
export function isRunning()     { return running; }
export function setOverlayCanvas(canvas) { _overlayCanvas = canvas; }
export function getCollisionWarnings()   { return _collisionWarnings; }
export function getSimTick()    { return _tickFrame; }

export function triggerSlowMotion(durationMs = 3000) {
  prevSpeed = speedMultiplier;
  setSpeed(0.1);
  setTimeout(() => setSpeed(prevSpeed), durationMs);
}

// ── Phase 6 controls ──────────────────────────────────────────────────────────
export function setSoundEnabled(val) { _soundEnabled = val; }
export function getSoundEnabled()    { return _soundEnabled; }
export function setTrailStyle(style) { _trailStyle = style; }
export function getTrailStyle()      { return _trailStyle; }

// ── Camera & interaction controls ─────────────────────────────────────────────
export function getCamera()              { return _camera; }
export function setSelectedBodyId(id)    { _selectedBodyId = id; }
export function getSelectedBodyId()      { return _selectedBodyId; }
export function setHoveredBodyId(id)     { _hoveredBodyId = id; }
export function setGhostPos(pos)         { _ghostPos = pos; }
export function setGhostType(type)       { _ghostType = type; }
export function setTrajectoryEnabled(v)  { _trajectoryEnabled = v; if (!v) _cachedTrajectory = null; }
export function getTrajectoryEnabled()   { return _trajectoryEnabled; }
export function getCachedTrajectory()    { return _cachedTrajectory; }
