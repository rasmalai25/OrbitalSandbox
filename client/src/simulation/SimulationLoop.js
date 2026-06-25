// simulation/SimulationLoop.js
// Phase 3   — rAF loop with full pause/resume/speed/rewind support.
// Phase 5   — orbital period tracking, collision prediction, gravity overlay.
// Phase 6   — orbital trails, ambient sound.
// Phase 8   — partner cursor, annotations, tug-of-war (module state shared with renderer).
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
import { checkCustomCollisions, checkBlackHoleCaptures } from '../physics/collisionHandler.js';

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

// ── Phase 8 collab state ─────────────────────────────────────────────────────
let _partnerCursor   = null;  // { x, y } in WORLD coords (renderer projects to screen)
let _annotations     = [];    // [{ id, points:[{x,y}], color, ttl, createdAt, senderId? }]
let _localTugTarget   = null; // { bodyId, x, y } — world pos this client is dragging to
let _partnerTugTarget = null; // { bodyId, x, y } — partner's drag target

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

  // 1b. Custom collision detection (Matter.js doesn't fire collisionStart
  //     because bodies have collisionFilter mask 0x0000). This dispatches
  //     particle bursts, screen shake, slow-mo, and challenge listeners.
  checkCustomCollisions(_engine);
  checkBlackHoleCaptures(_engine);

  // 1c. Tug-of-war — apply combined drag targets BEFORE rendering so the
  //     body appears where the players are pulling it (not where physics
  //     would have moved it).
  applyTugTargets(_engine);

  // 2. Trails
  updateTrails(bodies);

  // 3. Camera
  updateCameraTarget(_camera, _engine, _canvas, _selectedBodyId);
  updateCamera(_camera, dt);

  // 4. Trajectory recompute every 6th frame
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
    partnerCursor:     _partnerCursor,
    annotations:       _annotations,
  });

  // 6. Overlay (cheap — internally throttled)
  if (_overlayCanvas) renderGravityOverlay(_overlayCanvas, bodies);

  // 7. Snapshots — every frame so rewind/scrub is smooth.
  recordSnapshot(_engine);

  // 8. Heavy analytics — every 6th frame to keep CPU in line. The frame
  //    cadence matches the tick-emission cadence in useRoom.emitTickIfHost.
  if (_tickFrame % 6 === 0) {
    updateOrbitalPeriods(bodies, _tickFrame);
    _collisionWarnings = predictCollisions(bodies);
    syncSound(bodies, _soundEnabled);
    pruneExpiredAnnotations();
  }

  // 9. Per-frame tick emission to partner (useRoom internally throttles to 6)
  _onTick(_engine);

  rafId = requestAnimationFrame(loop);
}

// ── Tug-of-war application ────────────────────────────────────────────────────

function applyTugTargets(engine) {
  if (!_localTugTarget && !_partnerTugTarget) return;

  // Different bodies (one local, one partner): apply each independently
  if (_localTugTarget && _partnerTugTarget &&
      _localTugTarget.bodyId !== _partnerTugTarget.bodyId) {
    applySingleTug(engine, _localTugTarget.bodyId, _localTugTarget, null);
    applySingleTug(engine, _partnerTugTarget.bodyId, null, _partnerTugTarget);
    return;
  }

  // Same body (or only one side active): combine targets
  const bodyId = _localTugTarget?.bodyId || _partnerTugTarget?.bodyId;
  applySingleTug(engine, bodyId, _localTugTarget, _partnerTugTarget);
}

function applySingleTug(engine, bodyId, local, partner) {
  if (!bodyId) return;
  const body = Matter.Composite.allBodies(engine.world)
    .find(b => b.customData?.id === bodyId);
  if (!body || body.isStatic) return;

  let tx, ty;
  if (local && partner) {
    tx = (local.x + partner.x) / 2;
    ty = (local.y + partner.y) / 2;
  } else if (local)   { tx = local.x;   ty = local.y; }
  else if (partner)   { tx = partner.x; ty = partner.y; }
  else return;

  Matter.Body.setPosition(body, { x: tx, y: ty });
  Matter.Body.setVelocity(body, { x: 0, y: 0 });
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startLoop(engine, canvas, onTick = () => {}) {
  _engine       = engine;
  _canvas       = canvas;
  _onTick       = onTick;
  _tickFrame    = 0;
  _collisionWarnings = [];
  _cachedTrajectory  = null;
  _annotations       = [];
  _localTugTarget   = null;
  _partnerTugTarget = null;

  _camera.mode    = 'COM';
  _camera.targetX = 0;
  _camera.targetY = 0;

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

// ── Slow-motion ───────────────────────────────────────────────────────────────

let _slowMoTimer = null;
let _inSlowMo    = false;

/**
 * Drop to 0.1× speed for durationMs, then restore the pre-slow-mo speed.
 * Re-entrant: if already in slow-mo, EXTENDS the duration instead of
 * locking prevSpeed at 0.1.
 */
export function triggerSlowMotion(durationMs = 3000) {
  if (!_inSlowMo) {
    prevSpeed = speedMultiplier;
    _inSlowMo = true;
  }
  setSpeed(0.1);
  if (_slowMoTimer) clearTimeout(_slowMoTimer);
  _slowMoTimer = setTimeout(() => {
    setSpeed(prevSpeed);
    _slowMoTimer = null;
    _inSlowMo    = false;
  }, durationMs);
}

export function resetTickCounter() {
  _tickFrame = 0;
}

export function getTickFrame() { return _tickFrame; }

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

// ── Phase 8 — partner cursor / annotations / tug-of-war ──────────────────────

export function setPartnerCursor(pos) { _partnerCursor = pos; }
export function getPartnerCursor()    { return _partnerCursor; }

export function addAnnotation(annotation) {
  // createdAt may come from partner's timestamp; default to our local clock
  // (TTL is computed relative to local performance.now() either way — partners
  // see roughly synchronised fades)
  _annotations.push({
    ...annotation,
    createdAt: typeof annotation?.createdAt === 'number'
      ? annotation.createdAt
      : performance.now(),
  });
}

export function clearAnnotations() { _annotations = []; }
export function getAnnotations()   { return _annotations; }

function pruneExpiredAnnotations() {
  const now = performance.now();
  _annotations = _annotations.filter(a => {
    const ttl = a.ttl || 5000;
    return now - a.createdAt < ttl;
  });
}

/** Set this client's tug target. Pass null bodyId or null force to clear. */
export function setLocalTug(bodyId, worldX, worldY) {
  if (!bodyId)     { _localTugTarget = null; return; }
  if (worldX == null || worldY == null) { _localTugTarget = null; return; }
  _localTugTarget = { bodyId, x: worldX, y: worldY };
}

export function getLocalTug() { return _localTugTarget; }

/** Apply partner's tug payload (target world pos via `force` field per spec). */
export function applyPartnerTug({ bodyId, force }) {
  if (!bodyId || !force) { _partnerTugTarget = null; return; }
  _partnerTugTarget = { bodyId, x: force.x, y: force.y };
}
