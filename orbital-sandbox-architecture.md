# The Orbital Sandbox — Full Technical Architecture

> A phase-by-phase implementation guide for a real-time collaborative gravity simulation built with React, Matter.js, Chart.js, HTML Canvas, Socket.io, Node.js/Express, and PostgreSQL.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Repository & Project Structure](#repository--project-structure)
3. [Phase 0 — Project Scaffolding & Environment Setup](#phase-0--project-scaffolding--environment-setup)
4. [Phase 1 — The Canvas & Physics Engine](#phase-1--the-canvas--physics-engine)
5. [Phase 2 — Celestial Body System](#phase-2--celestial-body-system)
6. [Phase 3 — Simulation Controls & Playback](#phase-3--simulation-controls--playback)
7. [Phase 4 — Real-Time Collaboration (WebSockets)](#phase-4--real-time-collaboration-websockets)
8. [Phase 5 — Analytics, Overlays & Dashboards](#phase-5--analytics-overlays--dashboards)
9. [Phase 6 — Visuals, Trails & Sound](#phase-6--visuals-trails--sound)
10. [Phase 7 — Scenarios, Presets & Save/Share](#phase-7--scenarios-presets--saveshare)
11. [Phase 8 — Collaboration UX Features](#phase-8--collaboration-ux-features)
12. [Phase 9 — Database Layer](#phase-9--database-layer)
13. [Phase 10 — Deployment](#phase-10--deployment)
14. [Data Flow Reference](#data-flow-reference)
15. [Socket Event Reference](#socket-event-reference)
16. [Database Schema Reference](#database-schema-reference)

---

## System Overview

The Orbital Sandbox is a two-layer application: a **stateful physics simulation** running inside a browser canvas, and a **real-time sync layer** that keeps two users in the same shared state at all times.

The most important architectural decision is **where truth lives**. In this system:

- The **server holds the canonical session state** (body positions, velocities, simulation timestamp, ownership map).
- Each client runs its own **local physics loop** for smooth rendering, but reconciles with server state on every tick broadcast.
- The server does **not** run physics — it trusts the host client to emit ticks and rebroadcasts them. This is a deliberate tradeoff: it avoids server-side Matter.js overhead but means one client (the "host") is authoritative for the simulation. The non-host client renders received state.

```
┌────────────────────────────────────────────────────────────┐
│                        BROWSER (User A — Host)             │
│  React UI  ──►  Canvas + Matter.js  ──►  Socket.io Client  │
└─────────────────────────────────────────────────────────────┘
                              │  emit: tick, bodyPlaced,
                              │  bodyUpdated, collision, etc.
                              ▼
┌────────────────────────────────────────────────────────────┐
│                  NODE.JS / EXPRESS SERVER                   │
│  Socket.io Server  ──►  Room Manager  ──►  State Store     │
│                                  │                         │
│                          (broadcast to room)               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│                        BROWSER (User B — Observer)         │
│  Socket.io Client  ──►  Canvas Renderer  ──►  React UI     │
└─────────────────────────────────────────────────────────────┘
                              │
                     (on save/share)
                              ▼
                   ┌─────────────────┐
                   │   PostgreSQL     │
                   │  (Supabase)      │
                   └─────────────────┘
```

---

## Repository & Project Structure

Use a **monorepo** with two packages: `client` and `server`. This keeps shared types in one place and simplifies deployment.

```
orbital-sandbox/
├── client/                          # React frontend
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── canvas/
│   │   │   ├── CanvasRenderer.js    # Draws bodies, trails, overlays on <canvas>
│   │   │   ├── TrailManager.js      # Stores and paints orbital trails
│   │   │   └── GravityOverlay.js    # Renders the gravitational field gradient
│   │   ├── physics/
│   │   │   ├── engineSetup.js       # Initializes Matter.js engine and world
│   │   │   ├── bodyFactory.js       # Creates Matter.js bodies from body configs
│   │   │   ├── collisionHandler.js  # Collision event logic (merge, explode)
│   │   │   └── orbitAnalyzer.js     # Classifies orbits, calculates periods
│   │   ├── simulation/
│   │   │   ├── SimulationLoop.js    # requestAnimationFrame loop + tick emission
│   │   │   ├── HistoryStore.js      # Circular buffer of simulation snapshots
│   │   │   └── energyCalculator.js  # Kinetic + potential energy per tick
│   │   ├── socket/
│   │   │   ├── socketClient.js      # Socket.io client, event bindings
│   │   │   └── syncEngine.js        # Applies incoming server state to local engine
│   │   ├── components/
│   │   │   ├── App.jsx
│   │   │   ├── Toolbar.jsx          # Body type selector, trail style picker
│   │   │   ├── PropertyPanel.jsx    # Mass / velocity / direction inputs
│   │   │   ├── PlaybackBar.jsx      # Run, Pause, Rewind, Speed slider
│   │   │   ├── EnergyDashboard.jsx  # Chart.js live energy graph
│   │   │   ├── BodyInspector.jsx    # Tooltip: speed, distance, orbit state
│   │   │   ├── ChatPanel.jsx        # Side chat with simulation timestamps
│   │   │   ├── PresetMenu.jsx       # Load preset configurations
│   │   │   ├── ChallengePanel.jsx   # Challenge scenarios and success detection
│   │   │   ├── CollisionMeter.jsx   # Soft probability warning overlays
│   │   │   ├── OrbitalPeriodHUD.jsx # Per-planet orbit counter
│   │   │   └── ShareModal.jsx       # Save session, copy link
│   │   ├── store/
│   │   │   ├── sessionStore.js      # Zustand store: bodies, ownership, simState
│   │   │   └── uiStore.js           # Zustand store: panel open states, overlays
│   │   ├── hooks/
│   │   │   ├── useSimulation.js     # Attaches loop, exposes run/pause/rewind
│   │   │   ├── useSocket.js         # Connects socket, subscribes to events
│   │   │   └── useBodyPlacement.js  # Click-to-place logic on canvas
│   │   ├── constants/
│   │   │   ├── bodyTypes.js         # Mass presets, visuals per type
│   │   │   └── presets.js           # Solar system, binary star, asteroid field
│   │   └── utils/
│   │       ├── colorUtils.js        # Ownership color assignment
│   │       └── vectorUtils.js       # 2D vector helpers
│   ├── package.json
│   └── vite.config.js
│
├── server/
│   ├── src/
│   │   ├── index.js                 # Express app + Socket.io bootstrap
│   │   ├── roomManager.js           # Create, join, destroy rooms
│   │   ├── sessionState.js          # In-memory state per room
│   │   ├── socketHandlers.js        # All Socket.io event handlers
│   │   ├── db/
│   │   │   ├── pool.js              # PostgreSQL connection pool (pg)
│   │   │   └── queries.js           # Save session, load session, delete session
│   │   └── middleware/
│   │       └── rateLimiter.js       # Prevent event flooding
│   └── package.json
│
├── shared/
│   └── eventTypes.js                # Canonical list of socket event name strings
│
└── package.json                     # Workspace root
```

---

## Phase 0 — Project Scaffolding & Environment Setup

**Goal:** A running dev environment with hot-reload on both client and server before a single feature is built.

### 0.1 Initialize the monorepo

```bash
mkdir orbital-sandbox && cd orbital-sandbox
npm init -y
# In root package.json, add workspaces: ["client", "server", "shared"]
```

### 0.2 Scaffold the client with Vite

```bash
cd client
npm create vite@latest . -- --template react
npm install
```

Vite is used over Create React App because it has significantly faster HMR and produces smaller production bundles. The `vite.config.js` needs a proxy entry to forward `/socket.io` requests to the local server during development.

```js
// client/vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,           // <-- critical: enables WebSocket proxying
        changeOrigin: true,
      },
    },
  },
});
```

### 0.3 Install all client dependencies

```bash
npm install matter-js chart.js react-chartjs-2 socket.io-client zustand
```

- `matter-js` — physics engine
- `chart.js` + `react-chartjs-2` — energy dashboard
- `socket.io-client` — real-time connection to server
- `zustand` — lightweight global state (avoids Redux complexity for a project this size)

### 0.4 Scaffold the server

```bash
cd ../server
npm init -y
npm install express socket.io pg cors dotenv
npm install -D nodemon
```

Add to `server/package.json` scripts:
```json
"scripts": {
  "dev": "nodemon src/index.js",
  "start": "node src/index.js"
}
```

### 0.5 Environment variables

```bash
# server/.env
PORT=4000
DATABASE_URL=postgresql://user:password@host:5432/orbitalsandbox
CLIENT_ORIGIN=http://localhost:5173

# client/.env
VITE_SERVER_URL=http://localhost:4000
```

Never commit `.env` files. Add them to `.gitignore` from day one.

### 0.6 Verify the handshake

Write the minimal viable server — an Express app that says "ok" on `GET /health` — and the minimal viable client that connects a socket and logs `"connected"` to the console. This is the checkpoint: if the WebSocket handshake works in development, all subsequent features can be built on top of it.

---

## Phase 1 — The Canvas & Physics Engine

**Goal:** A dark canvas renders on screen. Matter.js is initialized. A body placed by clicking produces a visible circle that falls under gravity.

### 1.1 Canvas setup in React

The canvas element is a raw `<canvas>` DOM node managed by a `useRef`. React does not own anything that happens inside it — Matter.js and the custom renderer own it entirely. React's job is to mount it and pass events into the physics layer.

```jsx
// App.jsx (simplified)
import { useRef, useEffect } from 'react';
import { initEngine } from '../physics/engineSetup';
import { startRenderLoop } from '../canvas/CanvasRenderer';

export default function App() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const engine = initEngine();
    const stopLoop = startRenderLoop(canvas, engine);
    return () => stopLoop(); // cleanup on unmount
  }, []);

  return (
    <div className="app-shell">
      <canvas ref={canvasRef} width={1280} height={800} />
      {/* UI panels rendered as React siblings, positioned over canvas via CSS */}
    </div>
  );
}
```

The UI panels (toolbar, property panel, playback bar) are React components absolutely positioned over the canvas using CSS. This means React handles all interactive UI while the canvas is a pure drawing surface.

### 1.2 Matter.js engine initialization

Matter.js needs three things set up: an `Engine`, a `World`, and a `Runner`. In this project the `Runner` is **not used** — the built-in runner is replaced with a custom `requestAnimationFrame` loop so precise control over speed, pause, and rewind is possible.

```js
// physics/engineSetup.js
import Matter from 'matter-js';

export function initEngine() {
  const engine = Matter.Engine.create({
    gravity: { x: 0, y: 0 }, // gravity is off at the world level
    // Each body exerts force on every other body manually — see Phase 2
  });

  return engine;
}
```

**Why disable world gravity?** Matter.js has a single downward gravity vector by default. For orbital mechanics, every body needs to attract every other body with forces proportional to both masses and inversely proportional to distance squared (Newton's law of gravitation). This must be implemented manually in the simulation loop — Matter.js's built-in gravity cannot model multi-body attraction.

### 1.3 Custom gravitational force application

On every simulation tick, before Matter.js updates positions, the following runs:

```js
// physics/engineSetup.js
import Matter from 'matter-js';

const G = 0.0001; // Gravitational constant — tuned for canvas scale

export function applyGravitationalForces(bodies) {
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];

      const dx = b.position.x - a.position.x;
      const dy = b.position.y - a.position.y;
      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq);

      // Clamp minimum distance to avoid singularity (division by near-zero)
      const safeDist = Math.max(dist, 10);

      const force = (G * a.mass * b.mass) / (safeDist * safeDist);

      const fx = force * (dx / safeDist);
      const fy = force * (dy / safeDist);

      // Apply equal and opposite forces (Newton's third law)
      Matter.Body.applyForce(a, a.position, { x: fx, y: fy });
      Matter.Body.applyForce(b, b.position, { x: -fx, y: -fy });
    }
  }
}
```

This runs O(n²) per tick. For a typical session with 5–20 bodies, this is trivially fast. The minimum distance clamp prevents the simulation from exploding when two bodies overlap just before collision detection fires.

### 1.4 The render loop

```js
// simulation/SimulationLoop.js
import Matter from 'matter-js';
import { applyGravitationalForces } from '../physics/engineSetup';
import { render } from '../canvas/CanvasRenderer';
import { recordSnapshot } from './HistoryStore';

let rafId = null;
let lastTime = null;
let speedMultiplier = 1;
let running = false;

export function startLoop(engine, canvas, onTick) {
  running = true;

  function loop(timestamp) {
    if (!running) return;

    const delta = lastTime ? (timestamp - lastTime) * speedMultiplier : 16.67;
    lastTime = timestamp;

    const bodies = Matter.Composite.allBodies(engine.world);

    applyGravitationalForces(bodies);
    Matter.Engine.update(engine, delta);

    render(canvas, engine);       // draw current state
    recordSnapshot(engine);        // push to history buffer
    onTick(engine);               // emit state via socket

    rafId = requestAnimationFrame(loop);
  }

  rafId = requestAnimationFrame(loop);

  return () => {
    running = false;
    cancelAnimationFrame(rafId);
  };
}

export function setSpeed(multiplier) {
  speedMultiplier = multiplier;
}

export function pause() { running = false; }
export function resume() {
  running = true;
  lastTime = null;
  rafId = requestAnimationFrame(/* loop ref */);
}
```

`speedMultiplier` scales the `delta` passed to `Matter.Engine.update`. At 50x, each frame advances the simulation by 50 frames worth of time. This is the speed control slider's backend.

---

## Phase 2 — Celestial Body System

**Goal:** Five body types can be placed. Each has distinct mass, appearance, and behavior. The property panel lets users configure mass, velocity, and launch direction before placing.

### 2.1 Body type configuration

```js
// constants/bodyTypes.js
export const BODY_TYPES = {
  STAR: {
    label: 'Star',
    defaultMass: 50000,
    defaultRadius: 40,
    color: '#FFD700',
    isStatic: false,        // stars can move, just rarely do
    trailColor: '#FFD70055',
  },
  PLANET: {
    label: 'Planet',
    defaultMass: 1000,
    defaultRadius: 14,
    color: '#4A90E2',
    isStatic: false,
    trailColor: '#4A90E255',
  },
  MOON: {
    label: 'Moon',
    defaultMass: 50,
    defaultRadius: 6,
    color: '#C8C8C8',
    isStatic: false,
    trailColor: '#C8C8C855',
  },
  ASTEROID: {
    label: 'Asteroid',
    defaultMass: 5,
    defaultRadius: 3,
    color: '#8B7355',
    isStatic: false,
    trailColor: '#8B735555',
  },
  BLACK_HOLE: {
    label: 'Black Hole',
    defaultMass: 500000,
    defaultRadius: 20,
    color: '#1A0030',
    glowColor: '#7B00FF',
    isStatic: true,         // black holes are pinned in place
    trailColor: null,       // black holes don't leave trails
    warpsNearbyTrails: true,
  },
};
```

### 2.2 Body factory

The factory creates a Matter.js body from a user-defined config and attaches metadata (type, owner, id) as custom properties.

```js
// physics/bodyFactory.js
import Matter from 'matter-js';
import { BODY_TYPES } from '../constants/bodyTypes';
import { nanoid } from 'nanoid';

export function createBody({ type, x, y, mass, velocityX, velocityY, ownerId }) {
  const config = BODY_TYPES[type];

  // Radius scales with cube root of mass for visual plausibility
  const radius = config.defaultRadius * Math.cbrt(mass / config.defaultMass);

  const body = Matter.Bodies.circle(x, y, radius, {
    mass,
    restitution: 0.2,         // slight bounce on collision
    frictionAir: 0,           // no air resistance in space
    isStatic: config.isStatic,
    label: type,
  });

  Matter.Body.setVelocity(body, { x: velocityX, y: velocityY });

  // Attach metadata — Matter.js bodies can hold arbitrary custom properties
  body.customData = {
    id: nanoid(),
    type,
    ownerId,
    trailPoints: [],
    orbitalPeriodStart: null,
    lastAngle: null,
    fullOrbitsCompleted: 0,
  };

  return body;
}
```

### 2.3 The property panel

Before placing a body, the user sets three values in the `PropertyPanel` component:

- **Mass** — a numeric input, pre-filled with the type default
- **Initial Velocity** — magnitude slider (0 to max depending on type)
- **Launch Direction** — a circular dial component. The user clicks and drags to point an arrow in the direction they want the body to travel

The direction dial is a small SVG element. On `mousedown`, it records the starting angle. On `mousemove`, it updates a visible arrow. On `mouseup`, it commits the angle to the component state.

After filling the panel, the user clicks the canvas. The click coordinates become the placement position. At that moment, `bodyFactory.createBody` is called with all parameters, the body is added to the Matter.js world, and an event is emitted to the server.

### 2.4 Black hole special behavior

Black holes are `isStatic: true`, so Matter.js never moves them. Their gravitational force still applies normally (the force calculation in Phase 1 includes them). However, they need a custom event listener for bodies that get too close:

```js
// physics/collisionHandler.js (excerpt)
const BLACK_HOLE_CAPTURE_RADIUS = 25; // px

export function checkBlackHoleCaptures(engine) {
  const bodies = Matter.Composite.allBodies(engine.world);
  const blackHoles = bodies.filter(b => b.label === 'BLACK_HOLE');
  const others = bodies.filter(b => b.label !== 'BLACK_HOLE');

  blackHoles.forEach(bh => {
    others.forEach(body => {
      const dx = body.position.x - bh.position.x;
      const dy = body.position.y - bh.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < BLACK_HOLE_CAPTURE_RADIUS + body.circleRadius) {
        // Trigger spaghettification animation, then remove
        triggerSpaghettification(body);
        Matter.Composite.remove(engine.world, body);
      }
    });
  });
}
```

The spaghettification animation (see Phase 6) stretches and distorts the body's visual representation over ~1 second before removing it from the world.

---

## Phase 3 — Simulation Controls & Playback

**Goal:** Run, Pause, Rewind, and Speed Control all work. The entire simulation history can be scrubbed.

### 3.1 History store

The history store is a **circular buffer** — it holds the last N snapshots (default 3600, covering one hour at 60fps). Each snapshot is a serialized copy of all body positions and velocities at that moment.

```js
// simulation/HistoryStore.js
const MAX_SNAPSHOTS = 3600;
const snapshots = [];
let cursor = 0; // current playback position

export function recordSnapshot(engine) {
  const bodies = Matter.Composite.allBodies(engine.world);
  const snapshot = {
    timestamp: Date.now(),
    simTime: cursor,
    bodies: bodies.map(b => ({
      id: b.customData.id,
      x: b.position.x,
      y: b.position.y,
      vx: b.velocity.x,
      vy: b.velocity.y,
      angle: b.angle,
    })),
  };

  snapshots[cursor % MAX_SNAPSHOTS] = snapshot;
  cursor++;
}

export function getSnapshot(index) {
  return snapshots[index % MAX_SNAPSHOTS];
}

export function rewindTo(targetCursor, engine) {
  const snapshot = getSnapshot(targetCursor);
  if (!snapshot) return;

  const bodies = Matter.Composite.allBodies(engine.world);
  snapshot.bodies.forEach(snap => {
    const body = bodies.find(b => b.customData.id === snap.id);
    if (!body) return;
    Matter.Body.setPosition(body, { x: snap.x, y: snap.y });
    Matter.Body.setVelocity(body, { x: snap.vx, y: snap.vy });
    Matter.Body.setAngle(body, snap.angle);
  });

  cursor = targetCursor;
}
```

### 3.2 Playback bar component

```jsx
// components/PlaybackBar.jsx
import { useSimulation } from '../hooks/useSimulation';

export default function PlaybackBar() {
  const { isRunning, speed, cursor, maxCursor, run, pause, rewindTo, setSpeed } = useSimulation();

  return (
    <div className="playback-bar">
      <button onClick={isRunning ? pause : run}>
        {isRunning ? '⏸' : '▶'}
      </button>

      <input
        type="range"
        min={0}
        max={maxCursor}
        value={cursor}
        onChange={e => rewindTo(Number(e.target.value))}
      />

      <select value={speed} onChange={e => setSpeed(Number(e.target.value))}>
        <option value={1}>1×</option>
        <option value={5}>5×</option>
        <option value={50}>50×</option>
      </select>
    </div>
  );
}
```

When the user drags the scrub bar, the simulation is paused and `rewindTo` is called with the slider value. The canvas re-renders the historical state. When they release and hit play, the simulation resumes from that point forward, discarding any snapshots after the rewind point.

### 3.3 Slow-motion collision trigger

In `collisionHandler.js`, register a listener on Matter.js's built-in collision events:

```js
// physics/collisionHandler.js
import Matter from 'matter-js';
import { setSpeed } from '../simulation/SimulationLoop';

export function registerCollisionHandlers(engine) {
  Matter.Events.on(engine, 'collisionStart', event => {
    const pairs = event.pairs;

    pairs.forEach(pair => {
      const { bodyA, bodyB } = pair;

      // Drop to 0.1x for 3 seconds (180 frames at 60fps)
      setSpeed(0.1);
      setTimeout(() => setSpeed(/* restore previous speed */), 3000);

      handleMerge(bodyA, bodyB, engine);
    });
  });
}
```

The `setTimeout` restores the previous speed. Store the previous speed in a module-level variable before overwriting it.

---

## Phase 4 — Real-Time Collaboration (WebSockets)

**Goal:** Two users in the same room see each other's actions in real time. One is the host (runs physics), one is the observer (receives state).

### 4.1 Server: Room manager

```js
// server/src/roomManager.js
const rooms = new Map(); // roomId -> { hostId, observerId, state }

export function createRoom(roomId) {
  rooms.set(roomId, {
    hostId: null,
    observerId: null,
    bodies: [],
    simRunning: false,
    simTime: 0,
    chatHistory: [],
  });
}

export function joinRoom(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  if (!room.hostId) {
    room.hostId = socketId;
    return { role: 'host' };
  }
  if (!room.observerId) {
    room.observerId = socketId;
    return { role: 'observer' };
  }
  return { error: 'Room full' };
}

export function getRoomBySocket(socketId) {
  for (const [roomId, room] of rooms) {
    if (room.hostId === socketId || room.observerId === socketId) {
      return { roomId, room };
    }
  }
  return null;
}

export function removeFromRoom(socketId) {
  const result = getRoomBySocket(socketId);
  if (!result) return;
  const { room } = result;
  if (room.hostId === socketId) room.hostId = null;
  if (room.observerId === socketId) room.observerId = null;
}
```

### 4.2 Server: Socket.io event handlers

```js
// server/src/socketHandlers.js
import { createRoom, joinRoom, getRoomBySocket, removeFromRoom } from './roomManager.js';
import { nanoid } from 'nanoid';

export function registerHandlers(io, socket) {

  // --- Room Lifecycle ---

  socket.on('create_room', (callback) => {
    const roomId = nanoid(8);
    createRoom(roomId);
    const { role } = joinRoom(roomId, socket.id);
    socket.join(roomId);
    callback({ roomId, role });
  });

  socket.on('join_room', ({ roomId }, callback) => {
    const result = joinRoom(roomId, socket.id);
    if (result.error) return callback(result);
    socket.join(roomId);
    // Send current room state to the joining client
    const { room } = getRoomBySocket(socket.id);
    callback({ role: result.role, initialState: room });
  });

  socket.on('disconnect', () => {
    const result = getRoomBySocket(socket.id);
    if (result) {
      const { roomId } = result;
      removeFromRoom(socket.id);
      socket.to(roomId).emit('partner_disconnected');
    }
  });

  // --- Physics State Sync ---

  socket.on('sim_tick', ({ bodies, simTime }) => {
    const result = getRoomBySocket(socket.id);
    if (!result) return;
    const { roomId, room } = result;
    // Only the host can emit ticks
    if (room.hostId !== socket.id) return;
    room.bodies = bodies;
    room.simTime = simTime;
    socket.to(roomId).emit('sim_tick', { bodies, simTime });
  });

  socket.on('body_placed', (bodyData) => {
    const result = getRoomBySocket(socket.id);
    if (!result) return;
    const { roomId, room } = result;
    room.bodies.push(bodyData);
    socket.to(roomId).emit('body_placed', bodyData);
  });

  socket.on('body_updated', (update) => {
    const result = getRoomBySocket(socket.id);
    if (!result) return;
    const { roomId } = result;
    socket.to(roomId).emit('body_updated', update);
  });

  socket.on('body_removed', ({ bodyId }) => {
    const result = getRoomBySocket(socket.id);
    if (!result) return;
    const { roomId, room } = result;
    room.bodies = room.bodies.filter(b => b.id !== bodyId);
    socket.to(roomId).emit('body_removed', { bodyId });
  });

  socket.on('sim_control', ({ action, speed }) => {
    // run | pause | rewind | setSpeed
    const result = getRoomBySocket(socket.id);
    if (!result) return;
    const { roomId, room } = result;
    if (room.hostId !== socket.id) return; // only host controls sim
    socket.to(roomId).emit('sim_control', { action, speed });
  });

  // --- Collaboration Features ---

  socket.on('cursor_move', ({ x, y }) => {
    const result = getRoomBySocket(socket.id);
    if (!result) return;
    socket.to(result.roomId).emit('partner_cursor', { x, y });
  });

  socket.on('annotation_draw', (annotationData) => {
    const result = getRoomBySocket(socket.id);
    if (!result) return;
    socket.to(result.roomId).emit('annotation_draw', annotationData);
  });

  socket.on('chat_message', ({ text }) => {
    const result = getRoomBySocket(socket.id);
    if (!result) return;
    const { roomId, room } = result;
    const msg = { text, simTime: room.simTime, senderId: socket.id, id: nanoid() };
    room.chatHistory.push(msg);
    io.to(roomId).emit('chat_message', msg); // broadcast to BOTH users including sender
  });

  socket.on('tug_of_war', ({ bodyId, force }) => {
    const result = getRoomBySocket(socket.id);
    if (!result) return;
    socket.to(result.roomId).emit('tug_of_war', { bodyId, force, fromId: socket.id });
  });
}
```

### 4.3 Client: Socket connection and sync engine

```js
// socket/socketClient.js
import { io } from 'socket.io-client';

const socket = io(import.meta.env.VITE_SERVER_URL, {
  autoConnect: false,
});

export default socket;
export function connect() { socket.connect(); }
```

```js
// socket/syncEngine.js
import Matter from 'matter-js';

// Called on every 'sim_tick' received from server (observer only)
export function applySyncedTick(engine, serverBodies) {
  const localBodies = Matter.Composite.allBodies(engine.world);

  serverBodies.forEach(serverBody => {
    const local = localBodies.find(b => b.customData?.id === serverBody.id);
    if (!local) return;

    // Lerp toward server position to avoid jitter
    const lerpFactor = 0.3;
    Matter.Body.setPosition(local, {
      x: local.position.x + (serverBody.x - local.position.x) * lerpFactor,
      y: local.position.y + (serverBody.y - local.position.y) * lerpFactor,
    });
    Matter.Body.setVelocity(local, { x: serverBody.vx, y: serverBody.vy });
  });
}
```

**Interpolation note:** The observer client applies linear interpolation toward the server's authoritative position rather than snapping directly. This hides network jitter (which would otherwise cause visible teleporting) at the cost of very slight visual lag (~50ms at typical latency). For a physics sandbox, this tradeoff is correct.

### 4.4 Tick emission rate

The host client emits a `sim_tick` event **every 6 frames** (10 times per second), not every frame. Full 60fps tick emission would flood the server and saturate the observer's event queue. The observer interpolates between received states for smooth visuals.

```js
// SimulationLoop.js (excerpt)
let tickFrame = 0;

function loop(timestamp) {
  // ... physics update, render ...

  tickFrame++;
  if (tickFrame % 6 === 0) {
    onTick(engine); // triggers socket emit
  }

  rafId = requestAnimationFrame(loop);
}
```

---

## Phase 5 — Analytics, Overlays & Dashboards

**Goal:** Energy graph, gravitational field overlay, collision probability meter, orbital period tracker, and body inspector all work in real time.

### 5.1 Energy calculator

```js
// simulation/energyCalculator.js
const G = 0.0001;

export function calculateEnergy(bodies) {
  let ke = 0;
  let pe = 0;

  bodies.forEach(body => {
    const speed = Math.sqrt(body.velocity.x ** 2 + body.velocity.y ** 2);
    ke += 0.5 * body.mass * speed * speed;
  });

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      const dx = b.position.x - a.position.x;
      const dy = b.position.y - a.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      pe -= (G * a.mass * b.mass) / dist; // potential energy is always negative
    }
  }

  return { ke, pe, total: ke + pe };
}
```

### 5.2 Energy dashboard (Chart.js)

```jsx
// components/EnergyDashboard.jsx
import { Line } from 'react-chartjs-2';
import { useEffect, useRef, useState } from 'react';
import { Chart, LineElement, PointElement, LinearScale, CategoryScale } from 'chart.js';

Chart.register(LineElement, PointElement, LinearScale, CategoryScale);

const MAX_POINTS = 200;

export default function EnergyDashboard({ engine }) {
  const [keData, setKeData] = useState([]);
  const [peData, setPeData] = useState([]);

  useEffect(() => {
    const interval = setInterval(() => {
      const bodies = Matter.Composite.allBodies(engine.world);
      const { ke, pe } = calculateEnergy(bodies);
      setKeData(prev => [...prev.slice(-MAX_POINTS), ke]);
      setPeData(prev => [...prev.slice(-MAX_POINTS), pe]);
    }, 100); // update 10 times per second

    return () => clearInterval(interval);
  }, [engine]);

  const data = {
    labels: keData.map((_, i) => i),
    datasets: [
      { label: 'Kinetic Energy', data: keData, borderColor: '#FF6B35', tension: 0.3 },
      { label: 'Potential Energy', data: peData, borderColor: '#4ECDC4', tension: 0.3 },
    ],
  };

  return (
    <div className="energy-dashboard">
      <Line data={data} options={{ animation: false, responsive: true }} />
    </div>
  );
}
```

`animation: false` on the Chart.js options is critical — without it, Chart.js runs its own transition animation on every update, which produces a nauseating flicker when data updates 10 times per second.

### 5.3 Gravitational field overlay

The gravity overlay is rendered on a **separate `<canvas>` element** layered behind the main canvas using CSS `position: absolute`. It is redrawn only when bodies are added or removed (not every tick), because computing per-pixel gravity strength is expensive.

```js
// canvas/GravityOverlay.js
export function renderGravityOverlay(overlayCanvas, bodies) {
  const ctx = overlayCanvas.getContext('2d');
  const { width, height } = overlayCanvas;

  // Sample gravity strength on a coarse grid (every 20px)
  const gridSize = 20;
  const cols = Math.ceil(width / gridSize);
  const rows = Math.ceil(height / gridSize);

  ctx.clearRect(0, 0, width, height);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const px = col * gridSize + gridSize / 2;
      const py = row * gridSize + gridSize / 2;

      let totalForce = 0;
      bodies.forEach(body => {
        const dx = body.position.x - px;
        const dy = body.position.y - py;
        const distSq = dx * dx + dy * dy;
        totalForce += (0.0001 * body.mass) / Math.max(distSq, 100);
      });

      // Map force to a color (near-black to deep purple)
      const intensity = Math.min(totalForce * 5000, 1);
      ctx.fillStyle = `rgba(120, 0, 200, ${intensity * 0.6})`;
      ctx.fillRect(col * gridSize, row * gridSize, gridSize, gridSize);
    }
  }
}
```

### 5.4 Collision probability meter

On every tick, project each body's position forward by 60 simulation steps. If any two projected paths pass within a threshold distance, compute a collision probability and attach it to those bodies' `customData`.

```js
// simulation/collisionPredictor.js
const PREDICT_STEPS = 60;
const WARNING_DIST = 30;

export function predictCollisions(bodies) {
  const warnings = [];

  // Project positions forward (simplified Euler integration, no forces — just velocity)
  const projections = bodies.map(body => {
    const path = [{ x: body.position.x, y: body.position.y }];
    let x = body.position.x;
    let y = body.position.y;
    for (let i = 0; i < PREDICT_STEPS; i++) {
      x += body.velocity.x;
      y += body.velocity.y;
      path.push({ x, y });
    }
    return { id: body.customData.id, path };
  });

  for (let i = 0; i < projections.length; i++) {
    for (let j = i + 1; j < projections.length; j++) {
      let minDist = Infinity;
      for (let step = 0; step < PREDICT_STEPS; step++) {
        const a = projections[i].path[step];
        const b = projections[j].path[step];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist) minDist = dist;
      }
      if (minDist < WARNING_DIST) {
        const probability = Math.min(1 - minDist / WARNING_DIST, 1);
        warnings.push({ idA: projections[i].id, idB: projections[j].id, probability });
      }
    }
  }

  return warnings;
}
```

The warnings are passed down to `CanvasRenderer.js`, which draws a soft pulsing circle around the affected bodies using an animated `ctx.shadowBlur`.

### 5.5 Orbital period tracker

```js
// physics/orbitAnalyzer.js
export function updateOrbitalPeriods(bodies, deltaT) {
  // Find the dominant attractor for each body
  bodies.forEach(body => {
    if (body.isStatic) return;

    // Find nearest massive body
    let maxMass = 0;
    let attractor = null;
    bodies.forEach(other => {
      if (other === body) return;
      if (other.mass > maxMass) { maxMass = other.mass; attractor = other; }
    });

    if (!attractor) return;

    // Track angle relative to attractor
    const dx = body.position.x - attractor.position.x;
    const dy = body.position.y - attractor.position.y;
    const currentAngle = Math.atan2(dy, dx);

    const cd = body.customData;
    if (cd.lastAngle !== null) {
      let angleDelta = currentAngle - cd.lastAngle;
      // Normalize to [-π, π]
      if (angleDelta > Math.PI) angleDelta -= 2 * Math.PI;
      if (angleDelta < -Math.PI) angleDelta += 2 * Math.PI;

      cd.angleAccumulated = (cd.angleAccumulated || 0) + angleDelta;

      // Full orbit completed
      if (Math.abs(cd.angleAccumulated) >= 2 * Math.PI) {
        cd.fullOrbitsCompleted++;
        cd.orbitalPeriod = cd.simTimeAtLastOrbit
          ? (body.customData.currentSimTime - cd.simTimeAtLastOrbit)
          : null;
        cd.simTimeAtLastOrbit = cd.currentSimTime;
        cd.angleAccumulated = 0;
      }
    }

    cd.lastAngle = currentAngle;
  });
}
```

### 5.6 Body inspector

The `BodyInspector` component listens for click events on the canvas. On click, it finds the nearest body using a distance check, then displays a tooltip with current speed, distance from nearest massive body, and orbit classification.

Orbit classification:
- **Stable orbit** — angular momentum is consistent and distance from attractor is bounded
- **Unstable orbit** — distance from attractor is growing monotonically (escape trajectory)
- **Escape trajectory** — total orbital energy > 0 (kinetic energy exceeds potential binding energy)

---

## Phase 6 — Visuals, Trails & Sound

**Goal:** Trails, collision animations, spaghettification, and ambient sound all work.

### 6.1 Trail manager

```js
// canvas/TrailManager.js
const TRAIL_MAX_POINTS = 300;
const TRAIL_STYLES = ['line', 'gradient', 'dotted'];

export function updateTrails(bodies) {
  bodies.forEach(body => {
    const cd = body.customData;
    if (!cd || cd.type === 'BLACK_HOLE') return;

    cd.trailPoints = cd.trailPoints || [];
    cd.trailPoints.push({ x: body.position.x, y: body.position.y });

    if (cd.trailPoints.length > TRAIL_MAX_POINTS) {
      cd.trailPoints.shift();
    }
  });
}

export function renderTrails(ctx, bodies, trailStyle) {
  bodies.forEach(body => {
    const cd = body.customData;
    if (!cd || !cd.trailPoints || cd.trailPoints.length < 2) return;

    const points = cd.trailPoints;
    const config = BODY_TYPES[cd.type];

    ctx.save();

    if (trailStyle === 'gradient') {
      for (let i = 1; i < points.length; i++) {
        const alpha = i / points.length;
        ctx.beginPath();
        ctx.strokeStyle = config.trailColor.replace('55', Math.floor(alpha * 255).toString(16));
        ctx.lineWidth = 1;
        ctx.moveTo(points[i - 1].x, points[i - 1].y);
        ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();
      }
    } else if (trailStyle === 'dotted') {
      points.forEach((pt, i) => {
        if (i % 4 !== 0) return;
        const alpha = i / points.length;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 1, 0, Math.PI * 2);
        ctx.fillStyle = config.trailColor.replace('55', Math.floor(alpha * 200).toString(16));
        ctx.fill();
      });
    } else {
      // Default: clean line
      ctx.beginPath();
      ctx.strokeStyle = config.trailColor;
      ctx.lineWidth = 1;
      ctx.moveTo(points[0].x, points[0].y);
      points.forEach(pt => ctx.lineTo(pt.x, pt.y));
      ctx.stroke();
    }

    ctx.restore();
  });
}
```

### 6.2 Spaghettification animation

When a body is captured by a black hole, instead of disappearing instantly, it stretches toward the black hole over ~60 frames.

```js
// canvas/CanvasRenderer.js (spaghettification)
const spaghettifying = new Map(); // bodyId -> { body, bhX, bhY, progress }

export function triggerSpaghettification(body, bh) {
  spaghettifying.set(body.customData.id, {
    body,
    startX: body.position.x,
    startY: body.position.y,
    bhX: bh.position.x,
    bhY: bh.position.y,
    progress: 0,
  });
}

// Called during render loop
export function renderSpaghettification(ctx) {
  spaghettifying.forEach((state, id) => {
    state.progress += 0.02; // ~50 frames to complete

    const t = state.progress;
    const x = state.startX + (state.bhX - state.startX) * t;
    const y = state.startY + (state.bhY - state.startY) * t;

    ctx.save();
    ctx.translate(x, y);

    // Rotate to point toward black hole
    const angle = Math.atan2(state.bhY - y, state.bhX - x);
    ctx.rotate(angle);

    // Stretch horizontally, compress vertically
    ctx.scale(1 + t * 4, 1 - t * 0.8);

    ctx.beginPath();
    ctx.arc(0, 0, 5 * (1 - t), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(180, 100, 255, ${1 - t})`;
    ctx.fill();
    ctx.restore();

    if (state.progress >= 1) spaghettifying.delete(id);
  });
}
```

### 6.3 Collision animation

```js
// canvas/CanvasRenderer.js (explosion particles)
const particles = [];

export function spawnCollisionParticles(x, y, massA, massB) {
  const count = Math.min(20, Math.floor(Math.sqrt(massA + massB) / 5));
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 3;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.0,
      radius: 1 + Math.random() * 3,
    });
  }
}

export function renderAndTickParticles(ctx) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 0.03;
    if (p.life <= 0) { particles.splice(i, 1); continue; }

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 200, 80, ${p.life})`;
    ctx.fill();
  }
}
```

### 6.4 Ambient sound layer

The Web Audio API generates tones without any external library. Each body gets an `OscillatorNode` whose frequency is inversely proportional to its mass — massive stars hum low, small asteroids ring high.

```js
// sound/ambientSound.js
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const bodyOscillators = new Map(); // bodyId -> { oscillator, gainNode }

const MIN_FREQ = 40;   // Hz — deep hum for stars
const MAX_FREQ = 800;  // Hz — faint ring for asteroids
const MAX_MASS = 50000;

export function syncSound(bodies, enabled) {
  if (!enabled) {
    bodyOscillators.forEach(({ oscillator, gainNode }) => {
      gainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
    });
    return;
  }

  const activeIds = new Set(bodies.map(b => b.customData.id));

  // Remove oscillators for removed bodies
  bodyOscillators.forEach((nodes, id) => {
    if (!activeIds.has(id)) {
      nodes.oscillator.stop();
      bodyOscillators.delete(id);
    }
  });

  bodies.forEach(body => {
    const id = body.customData.id;
    const freq = MIN_FREQ + (MAX_FREQ - MIN_FREQ) * (1 - Math.min(body.mass / MAX_MASS, 1));

    if (!bodyOscillators.has(id)) {
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gainNode.gain.setValueAtTime(0.02, audioCtx.currentTime); // very quiet
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.start();
      bodyOscillators.set(id, { oscillator, gainNode });
    } else {
      const { oscillator } = bodyOscillators.get(id);
      oscillator.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.3);
    }
  });
}
```

When two bodies are close together, their gain is slightly increased, causing their tones to blend in the listener's ear.

---

## Phase 7 — Scenarios, Presets & Save/Share

**Goal:** Preset systems load instantly. Challenge scenarios detect success. Sessions save and load via shareable links.

### 7.1 Preset definitions

```js
// constants/presets.js
export const PRESETS = {
  solar_system: {
    label: 'Solar System',
    bodies: [
      { type: 'STAR', x: 640, y: 400, mass: 50000, vx: 0, vy: 0 },
      { type: 'PLANET', x: 780, y: 400, mass: 500, vx: 0, vy: 3.5 },
      { type: 'PLANET', x: 900, y: 400, mass: 800, vx: 0, vy: 2.8 },
      { type: 'PLANET', x: 1050, y: 400, mass: 300, vx: 0, vy: 2.2 },
    ],
  },
  binary_star: {
    label: 'Binary Stars',
    bodies: [
      { type: 'STAR', x: 500, y: 400, mass: 30000, vx: 0, vy: 1.5 },
      { type: 'STAR', x: 780, y: 400, mass: 30000, vx: 0, vy: -1.5 },
    ],
  },
  asteroid_field: {
    label: 'Asteroid Field',
    bodies: Array.from({ length: 15 }, (_, i) => ({
      type: 'ASTEROID',
      x: 200 + Math.random() * 880,
      y: 100 + Math.random() * 600,
      mass: 2 + Math.random() * 8,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
    })),
  },
};
```

Loading a preset calls `loadBodies(preset.bodies)`, which iterates through the body configs, creates each one via `bodyFactory`, adds it to the engine, and emits a `body_placed` event for each to the server.

### 7.2 Challenge scenario engine

```js
// simulation/challengeEngine.js
export const CHALLENGES = {
  stabilize: {
    label: 'Stabilize the System',
    description: 'Add exactly one body to prevent the outer planet from escaping.',
    initialState: PRESETS.unstable_two_body,
    successCondition: (engine, addedBodiesCount) => {
      if (addedBodiesCount !== 1) return false;
      const bodies = Matter.Composite.allBodies(engine.world);
      // All bodies must be within canvas bounds after 500 sim ticks
      return bodies.every(b =>
        b.position.x > 0 && b.position.x < 1280 &&
        b.position.y > 0 && b.position.y < 800
      );
    },
  },
  controlled_collision: {
    label: 'Controlled Collision',
    description: 'Cause the two asteroids to collide without disturbing the outer planet.',
    initialState: PRESETS.collision_setup,
    successCondition: (engine, collisionLog, bodiesBeforeCount) => {
      const outerPlanet = /* find by id */ null;
      const collisionHappened = collisionLog.length > 0;
      const outerUndisturbed = outerPlanet && /* velocity change < threshold */ true;
      return collisionHappened && outerUndisturbed;
    },
  },
};
```

The challenge engine polls `successCondition` on every 60th tick. When it returns `true`, a CSS class is added to the canvas wrapper that triggers a keyframe animation (starfield sparkle effect).

### 7.3 Save session to PostgreSQL

```js
// server/src/db/queries.js
import { pool } from './pool.js';
import { nanoid } from 'nanoid';

export async function saveSession(roomState) {
  const shareId = nanoid(12);
  const result = await pool.query(
    `INSERT INTO sessions (share_id, state_json, created_at)
     VALUES ($1, $2, NOW())
     RETURNING share_id`,
    [shareId, JSON.stringify(roomState)]
  );
  return result.rows[0].share_id;
}

export async function loadSession(shareId) {
  const result = await pool.query(
    `SELECT state_json FROM sessions WHERE share_id = $1`,
    [shareId]
  );
  return result.rows[0]?.state_json ?? null;
}
```

The `state_json` column stores a complete snapshot of the session: all body configs, simulation time, trail data, and chat history.

### 7.4 Share link flow

1. User clicks "Save & Share" in `ShareModal`.
2. Client emits `save_session` event to server with current body states.
3. Server calls `saveSession`, gets back a `shareId`.
4. Server emits `session_saved` with the `shareId`.
5. Client constructs URL: `https://orbital-sandbox.vercel.app/session/{shareId}`.
6. URL is displayed in the modal. User copies it.

When another user opens that URL, the frontend parses the `shareId` from the path, fetches the session state via `GET /api/session/:shareId`, loads it into the engine, and sets the simulation to paused at the saved timestamp.

---

## Phase 8 — Collaboration UX Features

**Goal:** Live cursors, tug-of-war, annotation mode, and the timestamped chat all work.

### 8.1 Live cursor presence

On `mousemove` over the canvas, throttle to 30fps and emit `cursor_move`:

```js
// hooks/useSocket.js (excerpt)
let lastCursorEmit = 0;

canvas.addEventListener('mousemove', e => {
  const now = Date.now();
  if (now - lastCursorEmit < 33) return; // 30fps throttle
  lastCursorEmit = now;

  const rect = canvas.getBoundingClientRect();
  socket.emit('cursor_move', {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  });
});
```

In `CanvasRenderer.js`, a separate draw pass renders the partner's cursor as a small colored dot with a name label:

```js
export function renderPartnerCursor(ctx, cursor, partnerName) {
  if (!cursor) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cursor.x, cursor.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#FF8C00';
  ctx.fill();
  ctx.font = '11px monospace';
  ctx.fillStyle = '#FF8C00';
  ctx.fillText(partnerName, cursor.x + 8, cursor.y - 5);
  ctx.restore();
}
```

### 8.2 Object tug of war

During a paused simulation, both users can `mousedown` on the same body. The client emits `tug_of_war` events with the local drag force vector. Each client receives the other's force vector and applies a weighted average:

```js
// hooks/useBodyPlacement.js (tug of war logic)
let myTugForce = null;
let partnerTugForce = null;
let tugBodyId = null;

function onTugStart(bodyId, e) {
  tugBodyId = bodyId;
  // Track drag vector as mouse moves
}

function onTugMove(e) {
  if (!tugBodyId) return;
  myTugForce = { x: e.movementX, y: e.movementY };
  socket.emit('tug_of_war', { bodyId: tugBodyId, force: myTugForce });
  applyTugResult();
}

socket.on('tug_of_war', ({ bodyId, force }) => {
  if (bodyId === tugBodyId) {
    partnerTugForce = force;
    applyTugResult();
  }
});

function applyTugResult() {
  const body = findBodyById(tugBodyId);
  if (!body) return;
  const combined = {
    x: ((myTugForce?.x || 0) + (partnerTugForce?.x || 0)) / 2,
    y: ((myTugForce?.y || 0) + (partnerTugForce?.y || 0)) / 2,
  };
  Matter.Body.setPosition(body, {
    x: body.position.x + combined.x,
    y: body.position.y + combined.y,
  });
}
```

### 8.3 Annotation mode

Each annotation is an array of `{x, y}` points drawn with a freehand stroke. Annotations have a 5-second TTL.

```js
// Emit during draw
socket.emit('annotation_draw', { points, color: myOwnerColor, ttl: 5000 });

// Receive and store
const annotations = [];
socket.on('annotation_draw', (annotation) => {
  annotations.push({ ...annotation, createdAt: Date.now() });
});

// Render in canvas loop
export function renderAnnotations(ctx, annotations) {
  const now = Date.now();
  annotations.forEach(ann => {
    const age = now - ann.createdAt;
    if (age > ann.ttl) return;
    const alpha = 1 - age / ann.ttl; // fade out as TTL expires
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = ann.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ann.points.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
    ctx.restore();
  });
}
```

### 8.4 Timestamped chat

Each chat message stores the `simTime` (simulation tick count) at the moment it was sent. Clicking a timestamp in the chat calls `rewindTo(message.simTime)`, snapping the canvas back to exactly that moment.

```jsx
// components/ChatPanel.jsx (message render)
{messages.map(msg => (
  <div key={msg.id} className="chat-message">
    <span className="sender">{msg.senderId === myId ? 'You' : 'Partner'}</span>
    <span className="text">{msg.text}</span>
    <button
      className="timestamp"
      onClick={() => rewindTo(msg.simTime)}
    >
      T+{formatSimTime(msg.simTime)}
    </button>
  </div>
))}
```

---

## Phase 9 — Database Layer

**Goal:** PostgreSQL is connected, sessions save and load reliably, and the share link survives server restarts.

### 9.1 Schema

```sql
-- Run this once against your Supabase database

CREATE TABLE sessions (
  id           SERIAL PRIMARY KEY,
  share_id     VARCHAR(12) UNIQUE NOT NULL,
  state_json   JSONB NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  last_accessed TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_share_id ON sessions(share_id);

-- Auto-delete sessions older than 30 days (run as a cron job or Supabase scheduled function)
-- DELETE FROM sessions WHERE created_at < NOW() - INTERVAL '30 days';
```

### 9.2 Connection pool

```js
// server/src/db/pool.js
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // required for Supabase
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});
```

### 9.3 Express REST endpoints for sessions

These exist alongside the Socket.io server, on the same Express app:

```js
// server/src/index.js (REST endpoints)
app.post('/api/session', async (req, res) => {
  const { state } = req.body;
  const shareId = await saveSession(state);
  res.json({ shareId });
});

app.get('/api/session/:shareId', async (req, res) => {
  const state = await loadSession(req.params.shareId);
  if (!state) return res.status(404).json({ error: 'Session not found' });
  res.json({ state });
});
```

---

## Phase 10 — Deployment

### 10.1 Frontend — Vercel

Vercel auto-deploys from a GitHub repository. The only configuration needed is:

```json
// vercel.json (in /client or repo root)
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

The `rewrites` rule ensures that direct navigation to `/session/abc123` is handled by React Router rather than returning a 404.

Set environment variables in the Vercel dashboard:
- `VITE_SERVER_URL` — the Render/Railway URL of the backend (e.g. `https://orbital-sandbox-server.onrender.com`)

### 10.2 Backend — Render

Create a Web Service on Render pointing to the `/server` directory. Start command: `node src/index.js`.

Set environment variables:
- `DATABASE_URL` — the Supabase connection string (from Supabase dashboard → Settings → Database → Connection String → URI)
- `CLIENT_ORIGIN` — the Vercel frontend URL (for CORS)
- `PORT` — set by Render automatically; read with `process.env.PORT || 4000`

**Important:** Render's free tier spins down after 15 minutes of inactivity. The first request after spin-down takes ~30 seconds. For this project, add a simple `/health` ping from the frontend on app load to wake the server before the user tries to connect.

### 10.3 Database — Supabase

Create a new project. Navigate to the SQL Editor and run the schema from Phase 9. Copy the connection string from the dashboard and add it to Render's environment variables.

Supabase's free tier pauses projects after 7 days of inactivity. This is fine for a portfolio/demo project — manually unpause from the dashboard before a demo.

### 10.4 CORS configuration

```js
// server/src/index.js
import cors from 'cors';

app.use(cors({
  origin: process.env.CLIENT_ORIGIN,
  methods: ['GET', 'POST'],
}));

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
  },
});
```

Both Express and Socket.io need CORS configured independently — they run different CORS middleware.

---

## Data Flow Reference

### Placing a body (host)

```
User clicks canvas
  └─► useBodyPlacement captures click coords
      └─► PropertyPanel values (mass, velocity, direction) read from uiStore
          └─► bodyFactory.createBody() → Matter.Body added to engine.world
              └─► sessionStore.addBody(bodyData)
                  └─► socket.emit('body_placed', bodyData)
                      └─► Server broadcasts to room
                          └─► Observer receives 'body_placed'
                              └─► syncEngine adds body to observer's engine.world
```

### Simulation tick (host → observer)

```
requestAnimationFrame fires
  └─► applyGravitationalForces(bodies)
      └─► Matter.Engine.update(engine, delta)
          └─► HistoryStore.recordSnapshot(engine)
              └─► CanvasRenderer.render(canvas, engine)
                  └─► [every 6th frame] socket.emit('sim_tick', serializedBodies)
                      └─► Server logs simTime, broadcasts to room
                          └─► Observer receives 'sim_tick'
                              └─► syncEngine.applySyncedTick(engine, bodies)
                                  └─► Observer's canvas re-renders with lerped state
```

---

## Socket Event Reference

| Event | Direction | Payload | Description |
|---|---|---|---|
| `create_room` | Client → Server | — | Creates a new room, caller becomes host |
| `join_room` | Client → Server | `{ roomId }` | Joins existing room as observer |
| `sim_tick` | Host → Server → Observer | `{ bodies[], simTime }` | Physics state sync (10/sec) |
| `body_placed` | Client → Server → Partner | `bodyData` | New body added to world |
| `body_updated` | Client → Server → Partner | `{ id, mass, vx, vy }` | Body property changed |
| `body_removed` | Client → Server → Partner | `{ bodyId }` | Body removed |
| `sim_control` | Host → Server → Observer | `{ action, speed }` | Run/pause/rewind/speed |
| `cursor_move` | Client → Server → Partner | `{ x, y }` | Cursor position (30/sec) |
| `tug_of_war` | Client → Server → Partner | `{ bodyId, force }` | Drag force on shared body |
| `annotation_draw` | Client → Server → Partner | `{ points[], color, ttl }` | Freehand annotation |
| `chat_message` | Client → Server → Both | `{ text, simTime }` | Chat with sim timestamp |
| `save_session` | Client → Server | `roomState` | Trigger DB save |
| `session_saved` | Server → Client | `{ shareId }` | Confirm save with link ID |
| `partner_disconnected` | Server → Client | — | Partner left the room |

---

## Database Schema Reference

```
sessions
────────────────────────────────────────
id            SERIAL PRIMARY KEY
share_id      VARCHAR(12) UNIQUE NOT NULL    -- URL slug (e.g. "xK9mP2aLqR7v")
state_json    JSONB NOT NULL                 -- full session snapshot
created_at    TIMESTAMPTZ DEFAULT NOW()
last_accessed TIMESTAMPTZ DEFAULT NOW()

state_json shape:
{
  "bodies": [
    {
      "id": "abc",
      "type": "PLANET",
      "x": 640, "y": 400,
      "mass": 1000,
      "vx": 0, "vy": 3.5,
      "ownerId": "socket-id-1",
      "trailStyle": "gradient"
    }
  ],
  "simTime": 4821,
  "chatHistory": [
    { "id": "msg1", "text": "try this", "simTime": 1200, "senderId": "socket-id-1" }
  ],
  "speed": 1,
  "isRunning": false
}
```

---

*End of architecture document. Each phase is independently shippable — the project is functional after Phase 4, and every subsequent phase adds features on top of a working foundation.*
