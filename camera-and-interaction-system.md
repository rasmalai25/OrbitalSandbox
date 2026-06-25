# Camera & Body Interaction System — Implementation Plan

> Extends the Phase 5/6 rendering layer of The Orbital Sandbox with a proper camera abstraction, selection/follow interactions, body naming, zoom-aware rendering, and supporting UI.

---

## Table of Contents

1. [Overview & Where This Fits](#overview--where-this-fits)
2. [Camera System](#camera-system)
3. [Body Interaction](#body-interaction)
4. [Body Naming](#body-naming)
5. [Zoom Polish](#zoom-polish)
6. [UI Changes](#ui-changes)
7. [State Shape Reference](#state-shape-reference)
8. [Render Loop Integration Order](#render-loop-integration-order)
9. [Socket/Sync Considerations](#socketsync-considerations)
10. [Suggested File Changes](#suggested-file-changes)

---

## Overview & Where This Fits

Today, `CanvasRenderer.js` likely does something like `ctx.translate(-com.x + width/2, -com.y + height/2)` to keep the system centered. This plan replaces that single translate with a real **camera object** that owns position, zoom, and mode, and is the single source of truth for the world-to-screen transform.

Everything else in this document — selection, hover labels, trajectory arcs, mini-map, zoom-aware stars/trails — is built **on top of** this camera. Build the camera first; it's the dependency for almost everything else.

```
camera.js              <- NEW: camera state + transform math
  ├── CanvasRenderer.js   <- uses camera transform instead of manual translate
  ├── useBodyPlacement.js <- click coords now go through camera.screenToWorld()
  ├── GravityOverlay.js   <- needs camera transform too (currently its own canvas)
  ├── TrailManager.js     <- trail stroke width must counter-scale with zoom
  └── components/
        ├── CameraModePill.jsx   <- NEW
        ├── FitAllButton.jsx     <- NEW
        ├── TrajectoryToggle.jsx <- NEW
        └── MiniMap.jsx          <- NEW
```

---

## Camera System

### 1. Camera object shape

Add a new module, `client/src/canvas/camera.js`. The camera is **not** a Zustand store on its own — it lives in `sessionStore` (or a new `cameraStore`) since multiple components need to read/write it (canvas, mini-map, mode pill, fit-all button).

```js
// canvas/camera.js

export function createCamera() {
  return {
    x: 0,          // world-space x the camera is centered on
    y: 0,          // world-space y the camera is centered on
    zoom: 1,       // 1 = 1 world unit per screen pixel
    mode: 'COM',   // 'COM' | 'LARGEST' | 'FOLLOW' | 'FREE'

    // internal: target values the camera lerps toward each frame
    targetX: 0,
    targetY: 0,
    targetZoom: 1,
  };
}
```

`x/y/zoom` are the **rendered** values (what's currently drawn). `targetX/targetY/targetZoom` are where the camera is heading. Every frame, `x/y/zoom` lerp toward the targets — this is what gives smooth movement for free.

### 2. Updating the camera each frame

```js
// canvas/camera.js

const LERP_FACTOR = 0.08; // tune for "smooth but responsive"; 0.08 ≈ 250ms settle

export function updateCamera(camera, dt) {
  // Frame-rate independent lerp: scale factor by dt relative to a 60fps baseline
  const t = 1 - Math.pow(1 - LERP_FACTOR, dt / 16.67);

  camera.x += (camera.targetX - camera.x) * t;
  camera.y += (camera.targetY - camera.y) * t;
  camera.zoom += (camera.targetZoom - camera.zoom) * t;
}
```

Call `updateCamera(camera, delta)` once per frame inside `SimulationLoop.js`'s `loop()`, **before** `render()`.

### 3. Setting camera targets per mode

This is the function that runs every frame to decide *where the camera should want to go*, based on the current mode. It only writes to `targetX/targetY/targetZoom` — the lerp in `updateCamera` handles the actual motion.

```js
// canvas/camera.js
import Matter from 'matter-js';

export function updateCameraTarget(camera, engine, canvas, selectedBodyId) {
  const bodies = Matter.Composite.allBodies(engine.world);
  if (bodies.length === 0) return;

  switch (camera.mode) {
    case 'COM': {
      const com = calculateCenterOfMass(bodies);
      camera.targetX = com.x;
      camera.targetY = com.y;
      // COM mode does not touch targetZoom — user's zoom level persists
      break;
    }

    case 'LARGEST': {
      const largest = bodies.reduce((a, b) => (b.mass > a.mass ? b : a));
      camera.targetX = largest.position.x;
      camera.targetY = largest.position.y;
      break;
    }

    case 'FOLLOW': {
      const target = bodies.find(b => b.customData.id === selectedBodyId);
      if (!target) {
        // Selected body was removed (collision/black hole) — fall back gracefully
        camera.mode = 'COM';
        return updateCameraTarget(camera, engine, canvas, null);
      }
      camera.targetX = target.position.x;
      camera.targetY = target.position.y;
      break;
    }

    case 'FREE':
      // User has full manual control — targets are set directly by
      // drag/scroll handlers, not by this function.
      break;
  }
}

function calculateCenterOfMass(bodies) {
  let totalMass = 0;
  let x = 0, y = 0;
  bodies.forEach(b => {
    totalMass += b.mass;
    x += b.position.x * b.mass;
    y += b.position.y * b.mass;
  });
  return { x: x / totalMass, y: y / totalMass };
}
```

**Important interaction with the FPS issue from the architecture doc:** `calculateCenterOfMass` is O(n) and trivial — this isn't the bottleneck. Don't add per-frame allocations here (no `.map()`/`.filter()` chains); keep this loop-based and allocation-free since it runs every frame regardless of mode.

### 4. World ↔ screen transform

```js
// canvas/camera.js

export function worldToScreen(camera, canvas, worldX, worldY) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  return {
    x: (worldX - camera.x) * camera.zoom + cx,
    y: (worldY - camera.y) * camera.zoom + cy,
  };
}

export function screenToWorld(camera, canvas, screenX, screenY) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  return {
    x: (screenX - cx) / camera.zoom + camera.x,
    y: (screenY - cy) / camera.zoom + camera.y,
  };
}
```

### 5. Applying the transform in CanvasRenderer

Replace the existing manual translate with:

```js
// canvas/CanvasRenderer.js
import { worldToScreen } from './camera';

export function render(canvas, engine, camera, /* ...other args */) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  // Single combined transform: translate to center, scale by zoom, offset by camera position
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  // ... draw bodies, trails, annotations using raw world coordinates ...
  // Matter.js positions are now drawn directly — no per-body math needed

  ctx.restore();

  // Anything drawn AFTER restore() is in screen space (HUD, mini-map, labels)
}
```

Using `ctx.save()/scale()/translate()/restore()` means every existing draw call that uses `body.position.x/y` directly **continues to work unchanged** — the canvas transform handles world→screen for you. This is the key reason to centralize this in the canvas matrix rather than converting every coordinate manually.

**Exception — constant-width strokes (trails, outlines):** `ctx.lineWidth` is also scaled by `ctx.scale()`. See [Zoom Polish §4](#4-trail-stroke-width-stays-constant) for the fix.

### 6. Scroll wheel zoom (centered on cursor)

```js
// hooks/useCamera.js (new hook)
import { screenToWorld } from '../canvas/camera';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const ZOOM_SENSITIVITY = 0.001;

export function attachZoomHandler(canvas, camera) {
  function onWheel(e) {
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // World point under the cursor BEFORE zoom changes
    const worldBefore = screenToWorld(camera, canvas, screenX, screenY);

    const zoomDelta = -e.deltaY * ZOOM_SENSITIVITY;
    const newZoom = clamp(camera.targetZoom * (1 + zoomDelta), MIN_ZOOM, MAX_ZOOM);
    camera.targetZoom = newZoom;
    camera.zoom = newZoom; // snap zoom immediately, no lerp — lerp is for x/y only

    // Re-derive camera target x/y so worldBefore stays under the cursor
    // (only meaningful in FREE mode; other modes will overwrite target next frame anyway)
    if (camera.mode === 'FREE') {
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      camera.targetX = worldBefore.x - (screenX - cx) / newZoom;
      camera.targetY = worldBefore.y - (screenY - cy) / newZoom;
      camera.x = camera.targetX;
      camera.y = camera.targetY;
    }

    // Any manual zoom switches mode to FREE, EXCEPT this is often desirable
    // even in COM/LARGEST/FOLLOW (user wants to zoom in while still tracking).
    // Decision: zoom does NOT force FREE mode. Only PAN (drag) forces FREE.
  }

  canvas.addEventListener('wheel', onWheel, { passive: false });
  return () => canvas.removeEventListener('wheel', onWheel);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
```

**Design decision called out explicitly:** zooming while in `COM`/`LARGEST`/`FOLLOW` keeps that mode active — only the zoom level changes, the camera continues tracking its target. This matches the natural feeling of "zoom in on the orbit I'm already following." Dragging the canvas (a new pan gesture) is what switches to `FREE`, since panning is an explicit "let me look somewhere else" action.

### 7. "Fit All" button

```js
// canvas/camera.js

const FIT_PADDING = 80; // px of padding around the bounding box

export function fitAll(camera, engine, canvas) {
  const bodies = Matter.Composite.allBodies(engine.world);
  if (bodies.length === 0) return;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  bodies.forEach(b => {
    minX = Math.min(minX, b.position.x - b.circleRadius);
    maxX = Math.max(maxX, b.position.x + b.circleRadius);
    minY = Math.min(minY, b.position.y - b.circleRadius);
    maxY = Math.max(maxY, b.position.y + b.circleRadius);
  });

  const worldWidth = maxX - minX;
  const worldHeight = maxY - minY;

  const availableWidth = canvas.width - FIT_PADDING * 2;
  const availableHeight = canvas.height - FIT_PADDING * 2;

  const zoomX = availableWidth / worldWidth;
  const zoomY = availableHeight / worldHeight;
  const newZoom = clamp(Math.min(zoomX, zoomY), MIN_ZOOM, MAX_ZOOM);

  camera.mode = 'FREE';
  camera.targetX = (minX + maxX) / 2;
  camera.targetY = (minY + maxY) / 2;
  camera.targetZoom = newZoom;
  // Note: x/y/zoom are NOT snapped here — they lerp to the target,
  // giving a smooth "zoom out to fit" animation per the no-snapping requirement.
}
```

**Edge case — single body:** `worldWidth`/`worldHeight` could be 0 (one body, or all bodies coincident). Guard against division producing `Infinity`:

```js
const zoomX = worldWidth > 0 ? availableWidth / worldWidth : MAX_ZOOM;
const zoomY = worldHeight > 0 ? availableHeight / worldHeight : MAX_ZOOM;
```

Fit All sets mode to `FREE` because after fitting, the camera should *stay* at that view — if it stayed in `COM` mode it would immediately start drifting back toward center-of-mass and undo the fit on the very next frame.

### 8. Camera mode pill — cycling behavior

Clicking the pill cycles `COM → LARGEST → FOLLOW → FREE → COM`. Two special cases:

- Cycling **into** `FOLLOW` with no body selected: fall back to `LARGEST`'s target (largest body) but keep mode label as `FOLLOW`... **actually, simpler and less surprising:** skip `FOLLOW` in the cycle if `selectedBodyId === null`. The pill cycles `COM → LARGEST → FREE → COM` until something is selected, at which point `FOLLOW` re-enters the cycle. This avoids a `FOLLOW` mode with nothing to follow.
- Cycling **out of** `FOLLOW` (to `FREE`): keep the current camera position as the new `FREE` target (don't snap anywhere) — set `targetX/targetY/targetZoom = x/y/zoom` (current rendered values) so there's no jump.

```js
// canvas/camera.js

export function cycleCameraMode(camera, selectedBodyId) {
  const order = selectedBodyId
    ? ['COM', 'LARGEST', 'FOLLOW', 'FREE']
    : ['COM', 'LARGEST', 'FREE'];

  const currentIndex = order.indexOf(camera.mode);
  // If current mode isn't in the available order (e.g. was FOLLOW, selection cleared),
  // treat as if we were at FREE so the next mode is COM.
  const nextIndex = currentIndex === -1
    ? 0
    : (currentIndex + 1) % order.length;

  const nextMode = order[nextIndex];

  if (nextMode === 'FREE' && camera.mode !== 'FREE') {
    camera.targetX = camera.x;
    camera.targetY = camera.y;
    camera.targetZoom = camera.zoom;
  }

  camera.mode = nextMode;
}
```

---

## Body Interaction

### 1. Click body → select + FOLLOW

This extends `useBodyPlacement.js`'s existing click handler. The existing handler places a new body when a body type is selected in the toolbar; this adds a **selection path** for clicks that land on an existing body when no placement is pending (or as a higher-priority check before placement).

```js
// hooks/useBodyPlacement.js (excerpt)
import { screenToWorld } from '../canvas/camera';

function onCanvasClick(e, engine, camera, canvas, sessionStore) {
  const rect = canvas.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;
  const world = screenToWorld(camera, canvas, screenX, screenY);

  const bodies = Matter.Composite.allBodies(engine.world);
  const hit = findBodyAtPoint(bodies, world.x, world.y);

  if (hit) {
    // Select this body, switch camera to FOLLOW
    sessionStore.setSelectedBody(hit.customData.id);
    camera.mode = 'FOLLOW';
    return; // do NOT also place a new body on the same click
  }

  if (sessionStore.selectedBody !== null) {
    // Clicked empty space WHILE a body was selected → deselect, return to COM
    sessionStore.setSelectedBody(null);
    camera.mode = 'COM';
    return; // empty-space click while something selected does not place a body
  }

  // ... existing body-placement logic (no selection active, empty space) ...
}

function findBodyAtPoint(bodies, x, y) {
  // Iterate in reverse so top-rendered (last-drawn) bodies are hit-tested first
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i];
    const dx = x - b.position.x;
    const dy = y - b.position.y;
    if (dx * dx + dy * dy <= b.circleRadius * b.circleRadius) return b;
  }
  return null;
}
```

**Behavioral note worth flagging to the user:** "click empty space → deselect + new placement" used to be a single action (place a body). Now, *if a body is selected*, the first empty-space click only deselects — placement requires a second click. This is the correct reading of the spec ("click empty space → deselect, return to COM mode" is listed as its own bullet, separate from placement), but it's a behavior change worth confirming feels right in testing — some users may expect the deselect+place to happen on the same click.

### 2. Hover → outline + label

Hover detection runs on `mousemove`, separately from click handling, and **does not** require selection state.

```js
// hooks/useBodyPlacement.js (or new useHover.js)

let hoveredBodyId = null; // module-level or in uiStore

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const world = screenToWorld(camera, canvas, e.clientX - rect.left, e.clientY - rect.top);
  const bodies = Matter.Composite.allBodies(engine.world);
  const hit = findBodyAtPoint(bodies, world.x, world.y);
  hoveredBodyId = hit ? hit.customData.id : null;
});
```

Render pass (after the world transform, since the outline is drawn in world space but the label needs careful zoom handling):

```js
// canvas/CanvasRenderer.js

export function renderHoverEffects(ctx, bodies, hoveredBodyId, camera) {
  if (!hoveredBodyId) return;
  const body = bodies.find(b => b.customData.id === hoveredBodyId);
  if (!body) return;

  // Outline — drawn in world space (inside the camera transform),
  // but lineWidth must be counter-scaled (see Zoom Polish)
  ctx.save();
  ctx.lineWidth = 2 / camera.zoom;
  ctx.strokeStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(body.position.x, body.position.y, body.circleRadius + 2 / camera.zoom, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Label — drawn in world space too, but font size counter-scaled so text
  // doesn't balloon when zoomed in
  ctx.save();
  ctx.font = `${12 / camera.zoom}px monospace`;
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  const labelY = body.position.y - body.circleRadius - 10 / camera.zoom;
  ctx.fillText(body.customData.name, body.position.x, labelY);
  ctx.restore();
}
```

Call `renderHoverEffects` **inside** the `ctx.save()/restore()` transform block from [Camera §5](#5-applying-the-transform-in-canvasrenderer), after bodies/trails are drawn (so the outline sits on top).

### 3. Selected body — highlighted trail, others dimmed

This is a `TrailManager.renderTrails` change. Pass `selectedBodyId` down and branch on it:

```js
// canvas/TrailManager.js

export function renderTrails(ctx, bodies, trailStyle, selectedBodyId, camera) {
  bodies.forEach(body => {
    const cd = body.customData;
    if (!cd || !cd.trailPoints || cd.trailPoints.length < 2) return;

    const isSelected = cd.id === selectedBodyId;
    const hasSelection = selectedBodyId !== null;

    ctx.save();
    ctx.globalAlpha = hasSelection && !isSelected ? 0.25 : 1.0;

    const strokeColor = isSelected ? '#FFFFFF' : BODY_TYPES[cd.type].trailColor;
    // ... existing trail drawing logic using strokeColor ...

    ctx.restore();
  });
}
```

"Dim slightly" → `globalAlpha: 0.25` is a starting point; this is a design/feel value, easy to tune without touching logic.

### 4. Future trajectory arc

This is a **prediction**, conceptually similar to `collisionPredictor.js` (Phase 5.4) but rendered as a visible dashed line for the *selected* body only, not used for warnings.

```js
// physics/trajectoryPredictor.js
const TRAJECTORY_STEPS = 200;

export function predictTrajectory(body, allBodies, G = 0.0001) {
  // Clone position/velocity — do NOT mutate the real body
  let x = body.position.x;
  let y = body.position.y;
  let vx = body.velocity.x;
  let vy = body.velocity.y;

  const path = [{ x, y }];

  for (let step = 0; step < TRAJECTORY_STEPS; step++) {
    let fx = 0, fy = 0;

    allBodies.forEach(other => {
      if (other === body) return;
      const dx = other.position.x - x;
      const dy = other.position.y - y;
      const distSq = dx * dx + dy * dy;
      const safeDist = Math.max(Math.sqrt(distSq), 10);
      const force = (G * body.mass * other.mass) / (safeDist * safeDist);
      fx += force * (dx / safeDist);
      fy += force * (dy / safeDist);
    });

    // Simple Euler step — matches the precision level of collisionPredictor.js,
    // sufficient for a visual guide (not a physics guarantee)
    vx += (fx / body.mass);
    vy += (fy / body.mass);
    x += vx;
    y += vy;

    path.push({ x, y });
  }

  return path;
}
```

**Performance note:** this is O(steps × bodies) = `200 × n` per frame, *only when a body is selected and the trajectory toggle is on*. For `n = 15`, that's 3000 force calculations per frame — comparable to one extra `applyGravitationalForces` pass (which is O(n²) = 225 for n=15, but trajectory is O(200·15)=3000, ~13x more). **Recommendation:** recompute the trajectory every **6th frame** (same cadence as `sim_tick` emission in Phase 4.4), not every frame — the arc doesn't need to update at 60fps to look smooth, and this keeps the cost in line with the rest of the system's tick-based update pattern.

```js
// SimulationLoop.js (excerpt)
if (tickFrame % 6 === 0 && selectedBodyId && trajectoryEnabled) {
  const selected = bodies.find(b => b.customData.id === selectedBodyId);
  if (selected) {
    cachedTrajectory = predictTrajectory(selected, bodies);
  }
}
```

Rendering (dashed line, world space, inside camera transform):

```js
// canvas/CanvasRenderer.js
export function renderTrajectory(ctx, path, camera) {
  if (!path || path.length < 2) return;
  ctx.save();
  ctx.setLineDash([6 / camera.zoom, 4 / camera.zoom]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 1 / camera.zoom;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  path.forEach(pt => ctx.lineTo(pt.x, pt.y));
  ctx.stroke();
  ctx.restore();
}
```

---

## Body Naming

### 1. Auto-naming on creation

`bodyFactory.createBody` needs a per-type counter. Store counters in `sessionStore` (per-session, shared across host/observer via existing sync) rather than a module-level variable, so names stay consistent if the page reloads or the observer creates bodies too.

```js
// store/sessionStore.js (additions)
const typeCounters = { STAR: 0, PLANET: 0, MOON: 0, ASTEROID: 0, BLACK_HOLE: 0 };

export function nextBodyName(type) {
  typeCounters[type] += 1;
  const label = BODY_TYPES[type].label; // "Star", "Planet", etc.
  return `${label}-${typeCounters[type]}`;
}
```

```js
// physics/bodyFactory.js (modify createBody)
import { nextBodyName } from '../store/sessionStore';

export function createBody({ type, x, y, mass, velocityX, velocityY, ownerId }) {
  // ... existing setup ...

  body.customData = {
    id: nanoid(),
    name: nextBodyName(type), // NEW
    type,
    ownerId,
    trailPoints: [],
    // ... existing fields ...
  };

  return body;
}
```

**Collaboration consideration:** in the real-time multi-user setup, if both host and observer call `createBody` independently using local counters, two clients could both produce "Planet-3". Since `body_placed` events carry the full `bodyData` (Phase 4.2), **the name should be assigned once — by whichever client calls `createBody` — and travel as part of `bodyData`**, not be regenerated on the receiving end. `syncEngine`'s `applySyncedTick` and the `body_placed` handler should preserve `customData.name` from the incoming payload rather than calling `nextBodyName` again. This is already implicitly true if `customData` is serialized wholesale, but worth calling out so nobody "helpfully" re-derives the name on sync.

### 2. Editable via double-click in property panel

```jsx
// components/PropertyPanel.jsx (excerpt)
import { useState } from 'react';

function NameField({ body, onRename }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body.customData.name);

  if (!editing) {
    return (
      <div onDoubleClick={() => { setDraft(body.customData.name); setEditing(true); }}>
        {body.customData.name}
      </div>
    );
  }

  return (
    <input
      autoFocus
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => commit()}
      onKeyDown={e => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );

  function commit() {
    const trimmed = draft.trim();
    if (trimmed) {
      body.customData.name = trimmed;
      onRename(body.customData.id, trimmed); // emits body_updated to sync rename
    }
    setEditing(false);
  }
}
```

`onRename` should emit the existing `body_updated` socket event (Phase 4.2's `socketHandlers.js` already relays `body_updated` to the partner) with `{ id, name: trimmed }`. The handler on the receiving end needs a small addition since currently `body_updated` documents `{ id, mass, vx, vy }` — add `name` as an optional field:

```js
// socket/syncEngine.js — body_updated handler (extend existing)
socket.on('body_updated', (update) => {
  const body = findBodyById(update.id);
  if (!body) return;
  if (update.mass !== undefined) body.mass = update.mass;
  if (update.vx !== undefined) Matter.Body.setVelocity(body, { x: update.vx, y: body.velocity.y });
  if (update.vy !== undefined) Matter.Body.setVelocity(body, { x: body.velocity.x, y: update.vy });
  if (update.name !== undefined) body.customData.name = update.name; // NEW
});
```

---

## Zoom Polish

### 1. Background stars scale inversely to zoom

The background star field is presumably a fixed array of `{x, y, size}` points drawn in **screen space** today (so it looks static regardless of camera). To make stars feel like a backdrop at a fixed world distance (parallax-ish, without full parallax complexity), draw them in **world space** but counter-scale their size:

```js
// canvas/CanvasRenderer.js (or a new starfield.js)

export function renderStarfield(ctx, stars, camera) {
  ctx.save();
  stars.forEach(star => {
    const screenSize = star.size; // size is defined in SCREEN pixels, constant
    const worldSize = screenSize / camera.zoom; // counter-scale so it stays `screenSize` px on screen
    ctx.beginPath();
    ctx.arc(star.x, star.y, worldSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = star.color || '#FFFFFF';
    ctx.fill();
  });
  ctx.restore();
}
```

Stars need **world-space coordinates** now (not screen-space), since they're drawn inside the camera transform — otherwise zooming would make them drift relative to bodies. If stars are currently generated as screen-space points, regenerate them once at startup as world-space points covering a large area (e.g. `[-5000, 5000] × [-5000, 5000]`), so panning/zooming reveals "more sky" rather than the same fixed set re-positioning.

### 2. Auto-hide stars below 0.3× zoom

```js
// canvas/CanvasRenderer.js

export function renderStarfield(ctx, stars, camera, manualToggleOn) {
  const shouldShow = manualToggleOn && camera.zoom >= 0.3;
  if (!shouldShow) return;
  // ... existing drawing ...
}
```

Two independent conditions, both must hold: the manual toggle (kept per spec) AND zoom ≥ 0.3. **This means the manual toggle's tooltip/label should probably indicate the auto-hide behavior** (e.g. "Stars (auto-hidden when zoomed out)") so it's not confusing when the toggle is "on" but nothing shows.

### 3. Hover label & outline scale (already covered)

Already handled in [Body Interaction §2](#2-hover--outline--label) via `font` and `lineWidth` division by `camera.zoom`.

### 4. Trail stroke width stays constant

Every place `ctx.lineWidth` is set for trails (in `TrailManager.renderTrails`) needs to divide by `camera.zoom`:

```js
// canvas/TrailManager.js — apply to ALL trail styles (line, gradient, dotted)

const BASE_TRAIL_WIDTH = 1; // existing constant, currently hardcoded as literal `1`

ctx.lineWidth = BASE_TRAIL_WIDTH / camera.zoom;
```

For the `dotted` style, the dot radius (`ctx.arc(pt.x, pt.y, 1, ...)`) similarly needs `1 / camera.zoom` so dots don't visually grow when zoomed in.

**Same applies to:**
- Collision-warning pulsing circles (Phase 5.4) — `ctx.shadowBlur` and circle radius
- Annotation strokes (Phase 8.3) — `ctx.lineWidth = 2` → `2 / camera.zoom`
- Live cursor dot (Phase 8.1) — radius `5` → should this scale? **Recommendation: no** — cursors represent screen-space pointer positions and should stay screen-space-sized regardless of zoom (draw them *after* `ctx.restore()`, in screen space, converting their world coordinates via `worldToScreen` first). This is a meaningful change: cursor rendering moves from "inside the transform" to "after restore, manually projected."

```js
// canvas/CanvasRenderer.js — cursor rendering after restore()
import { worldToScreen } from './camera';

// ... after ctx.restore() ...
if (partnerCursorWorld) {
  const screenPos = worldToScreen(camera, canvas, partnerCursorWorld.x, partnerCursorWorld.y);
  renderPartnerCursor(ctx, screenPos, partnerName); // existing function, now fed screen coords
}
```

This also means `cursor_move` events should probably transmit **world coordinates**, not screen coordinates — otherwise two clients with different zoom/pan states would see the cursor in the wrong relative position. Convert at the source:

```js
// hooks/useSocket.js (modify existing cursor_move emit)
const world = screenToWorld(camera, canvas, screenX, screenY);
socket.emit('cursor_move', { x: world.x, y: world.y }); // was screen coords, now world
```

---

## UI Changes

### 1. Camera mode pill

```jsx
// components/CameraModePill.jsx
import { cycleCameraMode } from '../canvas/camera';

const MODE_LABELS = {
  COM: 'Center of Mass',
  LARGEST: 'Largest Body',
  FOLLOW: 'Following',
  FREE: 'Free Camera',
};

export default function CameraModePill({ camera, selectedBodyId, onCycle }) {
  return (
    <button className="camera-mode-pill" onClick={onCycle} title="Click to change camera mode">
      {MODE_LABELS[camera.mode]}
      {camera.mode === 'FOLLOW' && selectedBodyId && ` — ${getBodyName(selectedBodyId)}`}
    </button>
  );
}
```

Placement: top bar, near the existing `Bodies: N` / body-type indicator cluster shown in the architecture's UI (next to the "1-5 · Space · ..." hotkey hint row).

### 2. "Fit All" button

Placed near `PlaybackBar.jsx`, alongside speed controls:

```jsx
// components/PlaybackBar.jsx (addition)
import { fitAll } from '../canvas/camera';

// inside the playback bar JSX:
<button onClick={() => fitAll(camera, engine, canvasRef.current)} title="Fit all bodies in view">
  Fit All
</button>
```

### 3. Trajectory toggle

A simple boolean in `uiStore`:

```js
// store/uiStore.js (addition)
trajectoryEnabled: false,
toggleTrajectory: () => set(s => ({ trajectoryEnabled: !s.trajectoryEnabled })),
```

```jsx
// components/Toolbar.jsx (addition, alongside existing Energy/Gravity/Orbits/Sound/Trails toggles)
<ToggleButton
  active={trajectoryEnabled}
  onClick={toggleTrajectory}
  label="Trajectory"
/>
```

Note the toolbar row in the architecture screenshots already has a pattern of pill-style toggles (`Energy`, `Gravity`, `Orbits`, `Sound`, `Trails: <style>`) — this slots in as one more of the same component, e.g. `Trajectory`.

### 4. Mini-map

Rendered as a separate small canvas (or an overlay `<div>` with its own `<canvas>`) in the bottom corner, **only visible when `camera.mode === 'FOLLOW'`** and a separate toggle is on.

```jsx
// components/MiniMap.jsx
import { useEffect, useRef } from 'react';
import Matter from 'matter-js';

const MINIMAP_SIZE = 150; // px
const MINIMAP_WORLD_RANGE = 4000; // world units shown across the minimap's width

export default function MiniMap({ engine, camera, visible }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    function draw() {
      ctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

      const bodies = Matter.Composite.allBodies(engine.world);
      const scale = MINIMAP_SIZE / MINIMAP_WORLD_RANGE;
      const cx = MINIMAP_SIZE / 2;
      const cy = MINIMAP_SIZE / 2;

      // Center the minimap on the CAMERA's current target (i.e. center-of-mass-ish),
      // not on the followed body, so the followed body's position relative to
      // the rest of the system is visible.
      const originX = camera.x;
      const originY = camera.y;

      bodies.forEach(b => {
        const mx = cx + (b.position.x - originX) * scale;
        const my = cy + (b.position.y - originY) * scale;
        if (mx < 0 || mx > MINIMAP_SIZE || my < 0 || my > MINIMAP_SIZE) return; // out of range

        ctx.beginPath();
        ctx.arc(mx, my, 2, 0, Math.PI * 2);
        ctx.fillStyle = BODY_TYPES[b.label].color;
        ctx.fill();

        if (b.customData.id === /* selectedBodyId, passed as prop */ null) {
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      });

      // Viewport rectangle — what the main camera currently sees
      const viewWPx = (canvas.parentElement.clientWidth / camera.zoom) * scale;
      const viewHPx = (canvas.parentElement.clientHeight / camera.zoom) * scale;
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.strokeRect(cx - viewWPx / 2, cy - viewHPx / 2, viewWPx, viewHPx);
    }

    let raf;
    function loop() { draw(); raf = requestAnimationFrame(loop); }
    loop();
    return () => cancelAnimationFrame(raf);
  }, [visible, engine, camera]);

  if (!visible) return null;

  return <canvas ref={canvasRef} width={MINIMAP_SIZE} height={MINIMAP_SIZE} className="minimap" />;
}
```

**`MINIMAP_WORLD_RANGE = 4000`** is a placeholder — this should probably be **dynamic**, computed similarly to `fitAll`'s bounding box (so the mini-map always shows "everything" regardless of how spread out the system is). A static range works for the default presets but will clip an asteroid field that's spread wider than 4000 units. Suggested refinement: recompute the bounding box of all bodies (same logic as `fitAll`) once every ~30 frames and use that as the mini-map range, with some padding multiplier (e.g. 1.5×).

**Toggle visibility logic** — "toggleable" + "only in FOLLOW mode" means two states combine:

```jsx
<MiniMap engine={engine} camera={camera} visible={miniMapEnabled && camera.mode === 'FOLLOW'} />
```

`miniMapEnabled` is a separate `uiStore` boolean, defaulting to `true` — so the *first* time a user enters FOLLOW mode, the mini-map appears automatically, and the toggle lets them hide it if they find it distracting.

---

## State Shape Reference

Summary of all new/changed state, for reference when wiring this into `sessionStore`/`uiStore`:

```
sessionStore (additions)
─────────────────────────────────────────
camera: {
  x, y, zoom, mode,
  targetX, targetY, targetZoom
}
selectedBodyId: string | null
typeCounters: { STAR, PLANET, MOON, ASTEROID, BLACK_HOLE } -> number

uiStore (additions)
─────────────────────────────────────────
trajectoryEnabled: boolean   (default false)
miniMapEnabled: boolean      (default true)
hoveredBodyId: string | null (transient, may not need to be in the store
                               at all if only the renderer reads it —
                               consider a plain ref instead of store state
                               to avoid re-render churn on every mousemove)

body.customData (additions)
─────────────────────────────────────────
name: string   -- e.g. "Planet-3", set once at creation, travels with
                   body_placed payload, editable via property panel
```

**On `hoveredBodyId`:** mousemove fires far more often than React should re-render. Strongly recommend keeping hover state in a plain mutable ref/module variable read directly by the canvas render loop, rather than `uiStore` — putting it in Zustand will cause every subscribed component to re-render on every mouse pixel of movement.

---

## Render Loop Integration Order

Putting it together, here's the per-frame order inside `SimulationLoop.js`'s `loop()`:

```js
function loop(timestamp) {
  if (!running) return;

  const delta = lastTime ? (timestamp - lastTime) * speedMultiplier : 16.67;
  lastTime = timestamp;

  const bodies = Matter.Composite.allBodies(engine.world);

  // 1. Physics (unchanged from architecture doc)
  applyGravitationalForces(bodies);
  Matter.Engine.update(engine, delta);

  // 2. Camera target + lerp (NEW)
  updateCameraTarget(camera, engine, canvas, selectedBodyId);
  updateCamera(camera, delta);

  // 3. Trajectory recompute, every 6th frame, only if enabled+selected (NEW)
  tickFrame++;
  if (tickFrame % 6 === 0 && selectedBodyId && trajectoryEnabled) {
    const selected = bodies.find(b => b.customData.id === selectedBodyId);
    if (selected) cachedTrajectory = predictTrajectory(selected, bodies);
  }

  // 4. Render — camera transform applied inside render()
  render(canvas, engine, camera, {
    selectedBodyId,
    hoveredBodyId: hoveredBodyIdRef.current,
    trajectoryEnabled,
    cachedTrajectory,
  });

  recordSnapshot(engine);

  if (tickFrame % 6 === 0) {
    onTick(engine); // existing sim_tick emission, unchanged
  }

  rafId = requestAnimationFrame(loop);
}
```

And inside `render()`, the draw order (everything except cursors/HUD happens **inside** the `ctx.save()/scale/translate(...)` block from Camera §5):

```
render(canvas, engine, camera, opts):
  clearRect
  save() + apply camera transform
    renderStarfield(camera, manualStarToggle)     <- respects 0.3x auto-hide
    renderGravityOverlay (if enabled)              <- needs camera transform too
    renderTrails(selectedBodyId)                    <- dims non-selected
    [draw bodies]
    renderTrajectory(cachedTrajectory)              <- if enabled + selected
    renderHoverEffects(hoveredBodyId)               <- outline + label
    renderAnnotations
    renderSpaghettification / particles
  restore()
  [screen-space from here on]
    renderPartnerCursor(worldToScreen(...))         <- moved outside transform
    [existing HUD elements]
```

---

## Socket/Sync Considerations

Two existing sync paths are touched by this plan:

1. **`body_placed`** — `bodyData.customData.name` now exists and must be preserved end-to-end (host generates it once; observer must not regenerate).
2. **`body_updated`** — gains an optional `name` field for renames via the property panel double-click.

**Camera state is explicitly NOT synced.** Each user's camera (mode, position, zoom, selection) is local-only — host and observer can independently select different bodies, follow different things, and zoom independently, exactly as they could already scroll/pan a normal webpage independently. This is consistent with the architecture's existing separation of "shared simulation state" vs. "local viewing state" (e.g. trail style, sound toggle are already local-only per the Socket Event Reference table — camera joins that category).

**One coupling to double check:** `cursor_move` now sends **world coordinates** (changed in [Zoom Polish §4](#4-trail-stroke-width-stays-constant)) instead of screen coordinates. This is a payload format change to an existing event — both clients need updating together, or the mini-map/cursor will misplace until both are on the new version. Not a backend/DB concern (no schema change to `sessions` table), but worth noting as a "deploy both sides together" item.

---

## Suggested File Changes

| File | Change |
|---|---|
| `canvas/camera.js` | **NEW** — camera object, lerp, transforms, fitAll, mode cycling |
| `hooks/useCamera.js` | **NEW** — wheel zoom handler, attaches to canvas |
| `components/CameraModePill.jsx` | **NEW** |
| `components/MiniMap.jsx` | **NEW** |
| `physics/trajectoryPredictor.js` | **NEW** — adapted from `collisionPredictor.js` |
| `canvas/CanvasRenderer.js` | Apply camera transform; add `renderHoverEffects`, `renderTrajectory`, `renderStarfield`; move cursor rendering outside transform |
| `canvas/TrailManager.js` | Counter-scale `lineWidth`/dot radius by `camera.zoom`; dim non-selected trails; highlight selected trail |
| `canvas/GravityOverlay.js` | Apply camera transform (currently likely a separate fixed canvas — needs to move into the transformed render or receive `camera` to redraw on pan/zoom) |
| `physics/bodyFactory.js` | Call `nextBodyName(type)`, store as `customData.name` |
| `hooks/useBodyPlacement.js` | Add hit-testing for selection; click routing (select vs. deselect vs. place); hover tracking |
| `hooks/useSocket.js` | `cursor_move` emits world coords via `screenToWorld` |
| `socket/syncEngine.js` | Preserve `customData.name` on `body_placed`; handle `name` in `body_updated` |
| `components/PropertyPanel.jsx` | Double-click-to-edit name field |
| `components/PlaybackBar.jsx` | "Fit All" button |
| `components/Toolbar.jsx` | Trajectory toggle button |
| `store/sessionStore.js` | `camera`, `selectedBodyId`, `typeCounters` |
| `store/uiStore.js` | `trajectoryEnabled`, `miniMapEnabled` |

---

*This document assumes the Phase 0–10 architecture in the main technical architecture doc as a baseline. Build order recommendation: camera object + transform first (everything depends on it) → selection/hover → naming → trajectory → mini-map/UI polish last, since it's the most purely additive piece.*
