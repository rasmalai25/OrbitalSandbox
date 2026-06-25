// canvas/camera.js
// Camera & Body Interaction System — core camera module.
//
// The camera is a plain object (NOT React state) to avoid re-render churn.
// It is updated every rAF frame by SimulationLoop and read directly by the
// renderer. UI components that need to display camera state (CameraModePill)
// should read it via getCamera() from SimulationLoop on each render.

import Matter from 'matter-js';

// ── Constants ─────────────────────────────────────────────────────────────────
const LERP_FACTOR    = 0.08;  // 0.08 ≈ 250ms settle time at 60fps
export const MIN_ZOOM = 0.08;
export const MAX_ZOOM = 8;
const FIT_PADDING    = 80;    // px of empty space around bounding box in Fit All

// ── Factory ───────────────────────────────────────────────────────────────────

export function createCamera() {
  return {
    x: 0,           // world-space point the camera is centred on (rendered)
    y: 0,
    zoom: 1,        // rendered scale
    mode: 'COM',    // 'COM' | 'LARGEST' | 'FOLLOW' | 'FREE'

    targetX: 0,     // where the camera wants to go (lerped toward each frame)
    targetY: 0,
    targetZoom: 1,
  };
}

// ── Per-frame update ──────────────────────────────────────────────────────────

/**
 * Lerp x/y toward targets. Zoom is snapped immediately (no lerp) so zooming
 * with the scroll wheel feels instant rather than sluggish.
 * @param {object} camera
 * @param {number} dt - milliseconds since last frame
 */
export function updateCamera(camera, dt) {
  // Frame-rate-independent lerp: same feel at 30fps and 144fps
  const t = 1 - Math.pow(1 - LERP_FACTOR, dt / 16.67);
  camera.x += (camera.targetX - camera.x) * t;
  camera.y += (camera.targetY - camera.y) * t;
  // Zoom is already snapped in the wheel handler — just sync rendered value
  camera.zoom = camera.targetZoom;
}

/**
 * Compute target position per camera mode.
 * Only writes targetX/targetY (and targetZoom for LARGEST).
 * Call every frame before updateCamera().
 */
export function updateCameraTarget(camera, engine, canvas, selectedBodyId) {
  const bodies = Matter.Composite.allBodies(engine.world);
  if (bodies.length === 0) return;

  switch (camera.mode) {
    case 'COM': {
      const com = calcCOM(bodies);
      camera.targetX = com.x;
      camera.targetY = com.y;
      break;
    }

    case 'LARGEST': {
      let largest = bodies[0];
      for (let i = 1; i < bodies.length; i++) {
        if (bodies[i].mass > largest.mass) largest = bodies[i];
      }
      camera.targetX = largest.position.x;
      camera.targetY = largest.position.y;
      break;
    }

    case 'FOLLOW': {
      const target = selectedBodyId
        ? bodies.find(b => b.customData?.id === selectedBodyId)
        : null;
      if (!target) {
        // Body was removed — fall back to COM gracefully
        camera.mode = 'COM';
        updateCameraTarget(camera, engine, canvas, null);
        return;
      }
      camera.targetX = target.position.x;
      camera.targetY = target.position.y;
      break;
    }

    case 'FREE':
      // Targets are set directly by drag/scroll handlers
      break;

    default:
      break;
  }
}

// ── Transform math ────────────────────────────────────────────────────────────

export function worldToScreen(camera, canvas, worldX, worldY) {
  const cx = canvas.width  / 2;
  const cy = canvas.height / 2;
  return {
    x: (worldX - camera.x) * camera.zoom + cx,
    y: (worldY - camera.y) * camera.zoom + cy,
  };
}

export function screenToWorld(camera, canvas, screenX, screenY) {
  const cx = canvas.width  / 2;
  const cy = canvas.height / 2;
  return {
    x: (screenX - cx) / camera.zoom + camera.x,
    y: (screenY - cy) / camera.zoom + camera.y,
  };
}

// ── Fit All ───────────────────────────────────────────────────────────────────

export function fitAll(camera, engine, canvas) {
  const bodies = Matter.Composite.allBodies(engine.world);
  if (bodies.length === 0) return;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  bodies.forEach(b => {
    const r = b.circleRadius || 5;
    minX = Math.min(minX, b.position.x - r);
    maxX = Math.max(maxX, b.position.x + r);
    minY = Math.min(minY, b.position.y - r);
    maxY = Math.max(maxY, b.position.y + r);
  });

  const worldWidth  = maxX - minX;
  const worldHeight = maxY - minY;

  const availW = canvas.width  - FIT_PADDING * 2;
  const availH = canvas.height - FIT_PADDING * 2;

  const zoomX = worldWidth  > 0 ? availW / worldWidth  : MAX_ZOOM;
  const zoomY = worldHeight > 0 ? availH / worldHeight : MAX_ZOOM;
  const newZoom = clamp(Math.min(zoomX, zoomY), MIN_ZOOM, MAX_ZOOM);

  camera.mode       = 'FREE';
  camera.targetX    = (minX + maxX) / 2;
  camera.targetY    = (minY + maxY) / 2;
  camera.targetZoom = newZoom;
  // x/y lerp to target for a smooth animated zoom-to-fit; zoom snaps
  camera.zoom = newZoom;
}

// ── Mode cycling ──────────────────────────────────────────────────────────────

export function cycleCameraMode(camera, selectedBodyId) {
  const order = selectedBodyId
    ? ['COM', 'LARGEST', 'FOLLOW', 'FREE']
    : ['COM', 'LARGEST', 'FREE'];

  const cur = order.indexOf(camera.mode);
  const nextIndex = cur === -1 ? 0 : (cur + 1) % order.length;
  const nextMode  = order[nextIndex];

  if (nextMode === 'FREE' && camera.mode !== 'FREE') {
    // Freeze current rendered position as new FREE target — no jump
    camera.targetX    = camera.x;
    camera.targetY    = camera.y;
    camera.targetZoom = camera.zoom;
  }

  camera.mode = nextMode;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function calcCOM(bodies) {
  let totalMass = 0, x = 0, y = 0;
  for (let i = 0; i < bodies.length; i++) {
    const m = bodies[i].mass;
    totalMass += m;
    x += bodies[i].position.x * m;
    y += bodies[i].position.y * m;
  }
  return { x: x / totalMass, y: y / totalMass };
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
