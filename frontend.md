# Frontend Implementation Plan — Shell, Visual & Sound Layer

> Turns the current single-canvas app into a screen-driven application: Landing → Mode Select → (Solo | Multiplayer) → Lobby → Simulation, with cinematic transitions, a screen-aware sound layer, visual polish on the canvas, lightweight auth, and the camera/body/zoom work already specced separately.

---

## Table of Contents

1. [Scope & Relationship to Existing Plans](#0-scope--relationship-to-existing-plans)
2. [The Core Shift: From One Canvas to a Screen Flow](#1-the-core-shift-from-one-canvas-to-a-screen-flow)
3. [Engine Lifecycle Change (prerequisite)](#2-engine-lifecycle-change-prerequisite)
4. [Screens](#3-screens)
5. [Cinematic Transitions](#4-cinematic-transitions)
6. [Screen-Aware Audio](#5-screen-aware-audio)
7. [Camera / Body / Zoom](#6-camera--body--zoom)
8. [Visual Polish](#7-visual-polish)
9. [Auth (Lightweight) + Security](#8-auth-lightweight--security)
10. [Build Order](#9-build-order)
11. [New / Changed Files](#10-new--changed-files)

---

## 0. Scope & Relationship to Existing Plans

This document covers **only the front-end plan**. Three of its sections — Camera System, Body Interaction, Zoom Polish — are already specced in detail in the *Camera & Body Interaction System* plan. This doc does **not** re-derive them; it references that plan and lists the corrections to apply (see [§6](#6-camera--body--zoom)).

Everything else here is net-new frontend work, and the single most important piece is **§1**: the app stops being "one canvas mounted on load" and becomes a multi-screen flow. The simulation canvas becomes *one screen among several*. Build that spine first — every other new item hangs off it.

What this doc treats as new: the navigation shell, the screen state machine, the engine-lifecycle move, the five non-simulation screens, the logo, cinematic transitions, the screen-aware audio manager, all visual polish, and the thin auth/security touchpoints.

---

## 1. The Core Shift: From One Canvas to a Screen Flow

Today `App.jsx` mounts a `<canvas>` and initializes Matter.js in a `useEffect` on first render. That assumes the simulation *is* the app. It no longer is. We need a screen state machine that owns which screen is showing and renders the simulation only when the user has actually entered it.

### 1.1 Screen state machine (`navStore`)

Use a dedicated Zustand store. Encode the legal flow explicitly so accidental jumps are caught in dev, and so the flow is self-documenting.

```js
// store/navStore.js
import { create } from 'zustand';

export const SCREENS = {
  LANDING:     'LANDING',
  MODE_SELECT: 'MODE_SELECT',
  SOLO_SELECT: 'SOLO_SELECT',
  MP_SELECT:   'MP_SELECT',
  LOBBY:       'LOBBY',
  SIMULATION:  'SIMULATION',
};

// Allowed forward/back transitions per screen
const FLOW = {
  LANDING:     ['MODE_SELECT'],
  MODE_SELECT: ['SOLO_SELECT', 'MP_SELECT', 'LANDING'],
  SOLO_SELECT: ['SIMULATION', 'MODE_SELECT'],
  MP_SELECT:   ['LOBBY', 'SIMULATION', 'MODE_SELECT'],
  LOBBY:       ['SIMULATION', 'MP_SELECT'],
  SIMULATION:  ['MODE_SELECT'], // "exit to menu"
};

export const useNavStore = create((set, get) => ({
  screen: SCREENS.LANDING,
  simContext: null,            // 'sandbox' | 'challenges' | 'multiplayer'
  transitioning: false,
  transitionKind: 'fade',      // 'warp' | 'card-expand' | 'fade'
  pendingNext: null,
  pendingSimContext: null,

  // Begin a transition: starts the exit animation; the ScreenTransition
  // wrapper calls commit() when that animation ends.
  go(next, opts = {}) {
    const current = get().screen;
    if (!FLOW[current]?.includes(next)) {
      console.warn(`Illegal screen transition ${current} → ${next}`);
      return;
    }
    set({
      transitioning: true,
      transitionKind: opts.transitionKind ?? 'fade',
      pendingNext: next,
      pendingSimContext: opts.simContext ?? null,
    });
  },

  commit() {
    const { pendingNext, pendingSimContext, simContext } = get();
    if (!pendingNext) return;
    set({
      screen: pendingNext,
      simContext: pendingSimContext ?? simContext,
      transitioning: false,
      pendingNext: null,
      pendingSimContext: null,
    });
  },
}));
```

### 1.2 `App.jsx` becomes a router

```jsx
// components/App.jsx
import { useNavStore, SCREENS } from '../store/navStore';
import ScreenTransition from './ScreenTransition';
import LandingScreen from '../screens/LandingScreen';
import ModeSelectScreen from '../screens/ModeSelectScreen';
import SoloSelectScreen from '../screens/SoloSelectScreen';
import MultiplayerSelectScreen from '../screens/MultiplayerSelectScreen';
import LobbyScreen from '../screens/LobbyScreen';
import SimulationScreen from '../screens/SimulationScreen';

const SCREEN_COMPONENTS = {
  [SCREENS.LANDING]: LandingScreen,
  [SCREENS.MODE_SELECT]: ModeSelectScreen,
  [SCREENS.SOLO_SELECT]: SoloSelectScreen,
  [SCREENS.MP_SELECT]: MultiplayerSelectScreen,
  [SCREENS.LOBBY]: LobbyScreen,
  [SCREENS.SIMULATION]: SimulationScreen,
};

export default function App() {
  const screen = useNavStore(s => s.screen);
  const Current = SCREEN_COMPONENTS[screen];
  return (
    <div className="app-shell">
      <ScreenTransition>
        <Current key={screen} />
      </ScreenTransition>
    </div>
  );
}
```

### 1.3 State machine vs. React Router

Use the **in-app state machine above** for the linear flow (landing → mode → sim) — it pairs naturally with animated transitions and doesn't pollute the URL with intermediate screens. Keep **React Router only for deep-link entry points** that must survive a page load:

- `/session/:shareId` → boot straight into `SIMULATION` with the loaded session (the Vercel rewrite for this already exists in the deploy config).
- `/room/:roomId` → boot into `LOBBY`/`MP_SELECT` pre-filled with the room code.

On such a deep link, set `navStore.screen` directly at startup rather than walking the flow.

---

## 2. Engine Lifecycle Change (prerequisite)

Because the canvas is now one screen, the Matter.js engine and the `requestAnimationFrame` loop must **not** initialize until the user enters `SIMULATION`, and must tear down on exit. Move the init out of `App.jsx` (where it currently lives) into `SimulationScreen`.

```jsx
// screens/SimulationScreen.jsx
import { useEffect, useRef } from 'react';
import Matter from 'matter-js';
import { initEngine } from '../physics/engineSetup';
import { startLoop } from '../simulation/SimulationLoop';
import { useNavStore } from '../store/navStore';

export default function SimulationScreen() {
  const canvasRef = useRef(null);
  const simContext = useNavStore(s => s.simContext);

  useEffect(() => {
    const canvas = canvasRef.current;
    const engine = initEngine();

    if (simContext === 'challenges')   loadChallenge(engine);
    if (simContext === 'multiplayer')  attachSyncEngine(engine);
    // 'sandbox' starts empty

    const stopLoop = startLoop(engine, canvas, onTick);

    return () => {
      stopLoop();
      stopAllOscillators();          // tear down per-body audio (Phase 6.4)
      Matter.Engine.clear(engine);   // free bodies/constraints
    };
  }, [simContext]);

  return (
    <div className="sim-screen">
      <canvas ref={canvasRef} width={1280} height={800} />
      {/* gravity overlay canvas + Toolbar / PropertyPanel / PlaybackBar / pills */}
    </div>
  );
}
```

Consequence: the per-body oscillators and trail buffers no longer leak across sessions, and the landing/menu screens carry zero physics cost.

---

## 3. Screens

### 3.1 Landing (`LandingScreen.jsx`)

Full-screen, drifting star field behind the content. Centered: logo, tagline, single **ENTER** button. The ENTER click does three things in order: (1) unlock audio (`unlockAudio()` — must happen on a user gesture, see [§5](#5-screen-aware-audio)), (2) start the landing→mode `warp` transition, (3) `navStore.go(MODE_SELECT, { transitionKind: 'warp' })`.

The drifting star field here is a *standalone* lightweight animation (not the simulation's parallax system) — a small `<canvas>` or CSS, since the engine isn't running yet.

### 3.2 Logo (`Logo.jsx`)

Two orbital ellipses crossing at center with a star at the intersection.

```jsx
// components/Logo.jsx
export default function Logo({ size = 160 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label="Orbital Sandbox">
      <g fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.9">
        <ellipse cx="50" cy="50" rx="42" ry="15" transform="rotate(32 50 50)" />
        <ellipse cx="50" cy="50" rx="42" ry="15" transform="rotate(-32 50 50)" />
      </g>
      <circle cx="50" cy="50" r="6" fill="#FFD700">
        <animate attributeName="r" values="5;7;5" dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.8;1;0.8" dur="3s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}
```

`stroke="currentColor"` lets the logo inherit color so it can recolor per screen (dim on landing, accent in the header).

### 3.3 Mode Select (`ModeSelectScreen.jsx`)

Two large cards side by side: **Solo** and **Multiplayer**. Clicking a card runs a `card-expand` transition (the card scales toward full screen) into the next screen. Solo → `SOLO_SELECT`, Multiplayer → `MP_SELECT`. Include a back affordance to `LANDING`.

### 3.4 Solo Select (`SoloSelectScreen.jsx`)

Two choices: **Sandbox** and **Challenges**. Both go to `SIMULATION`, differing only in `simContext`:

```js
navStore.go(SCREENS.SIMULATION, { simContext: 'sandbox',    transitionKind: 'card-expand' });
navStore.go(SCREENS.SIMULATION, { simContext: 'challenges', transitionKind: 'card-expand' });
```

`SimulationScreen` reads `simContext` to decide whether to load a challenge preset.

### 3.5 Multiplayer Select (`MultiplayerSelectScreen.jsx`)

Two actions: **Create Room** and **Join Room**.

- **Create Room** → emit the existing `create_room` socket event; on the callback (`{ roomId, role: 'host' }`) store the room id and `navStore.go(LOBBY)`.
- **Join Room** → reveal a code input; on submit emit `join_room { roomId }`. On `{ role: 'observer', initialState }`, if the room already has an active host, go straight to `SIMULATION` with `simContext: 'multiplayer'` and hydrate from `initialState`; otherwise go to `LOBBY`. On `{ error }` (room not found / full) show inline error.

This screen is where the socket connection should be established (`connect()`), not earlier — solo play needs no socket.

### 3.6 Lobby (`LobbyScreen.jsx`)

Animated waiting state: two orbiting dots, one empty/ghosted until the partner joins. Show the room code with a copy button. The host waits here until `join_room` on the server fills the observer slot; the server should emit a `partner_joined` event (a small addition to the existing handlers) that both clients listen for, then both `navStore.go(SIMULATION, { simContext: 'multiplayer' })`. Play the `partner_join` chime on that event.

> Backend note: the current `socketHandlers.js` emits `partner_disconnected` but has no `partner_joined`. Add the symmetric emit inside `join_room` so the host learns the observer arrived.

### 3.7 Simulation (`SimulationScreen.jsx`)

The wrapper from [§2](#2-engine-lifecycle-change-prerequisite). Hosts the main canvas, the gravity-overlay canvas, and all in-sim UI (Toolbar, PropertyPanel, PlaybackBar, camera mode pill, Fit All, mini-map). An "exit to menu" control runs `navStore.go(MODE_SELECT)` and triggers the teardown in the effect cleanup.

---

## 4. Cinematic Transitions

Drive transitions off the `transitioning` / `transitionKind` flags in `navStore`. A single wrapper plays the **exit** animation on the current screen, commits the screen swap when that animation ends, then the new screen plays its **enter** animation.

```jsx
// components/ScreenTransition.jsx
import { useNavStore } from '../store/navStore';

export default function ScreenTransition({ children }) {
  const transitioning = useNavStore(s => s.transitioning);
  const transitionKind = useNavStore(s => s.transitionKind);
  const commit = useNavStore(s => s.commit);

  return (
    <div
      className={`screen-layer ${transitioning ? `exit-${transitionKind}` : 'enter-fade'}`}
      onAnimationEnd={(e) => {
        // Only react to the wrapper's own exit animation, not bubbled child anims
        if (e.target !== e.currentTarget) return;
        if (transitioning && e.animationName.startsWith('exit')) commit();
      }}
    >
      {children}
    </div>
  );
}
```

CSS keyframes to define: `exit-warp` / `enter-warp` (landing→mode: scale + blur + star streak), `exit-card-expand` / `enter-card-expand` (mode→sim: clicked card scales to fill), `exit-fade` / `enter-fade` (default). The `e.target !== e.currentTarget` guard is important — without it, any animated child (e.g. the logo's pulsing star) would fire `onAnimationEnd` and commit early.

Zero new dependencies with the CSS approach. If the warp/card-expand need physics-y easing or shared-element morphing that CSS can't express cleanly, add `framer-motion` and gate the swap on its `onAnimationComplete` instead — but try CSS first to stay consistent with the project's minimal-deps posture.

---

## 5. Screen-Aware Audio

Today sound is only per-body oscillators (Phase 6.4). The plan adds distinct beds per screen plus one-shot SFX. Centralize this in an `AudioManager` so screens don't each poke the Web Audio graph.

```js
// audio/AudioManager.js
let ctx = null;
let currentBed = null;

// MUST be called from a user gesture (the ENTER button) — browsers
// keep AudioContext suspended until a gesture resumes it.
export function unlockAudio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

const BED_BUILDERS = {
  LANDING:     buildDrone,      // deep ambient drone
  MODE_SELECT: buildBrightPad,  // brighter subtle melody
  LOBBY:       buildPulse,      // pulsing rhythmic waiting tone
  SIMULATION:  null,            // per-body oscillators take over
};

export function setScreenAudio(screen) {
  if (!ctx) return;                       // not unlocked yet
  const builder = BED_BUILDERS[screen] ?? null;
  crossfadeTo(builder ? builder(ctx) : null, 0.8); // ~800ms fade
  currentBed = builder;
}

export function playSfx(name) {
  if (!ctx) return;
  // 'partner_join' chime | 'collision' impact+whoosh | 'capture' rumble+distortion
}
```

Wiring:

- Call `unlockAudio()` in the ENTER `onClick` (the only reliable first gesture).
- Call `setScreenAudio(screen)` whenever the screen commits — simplest is inside each screen's mount `useEffect`, or subscribe once with `subscribeWithSelector`.
- `playSfx('partner_join')` on the lobby's `partner_joined` event; `playSfx('collision')` / `playSfx('capture')` from the existing collision and black-hole-capture handlers.
- On entering `SIMULATION`, the bed is `null` so the per-body oscillator layer (existing) owns the soundscape.

`crossfadeTo` ramps the outgoing bed's gain to 0 and the incoming to its target over the fade window, then stops the old oscillators — reuse the `setTargetAtTime` gain pattern already in `ambientSound.js`.

---

## 6. Camera / Body / Zoom

Implement these per the **Camera & Body Interaction System** plan — do not re-spec here. But fold in these corrections (each was a real defect or gap in that plan) as you build:

1. **Camera state shape.** Keep `x/y/zoom` and their lerp targets in a **plain mutable ref** owned by the render loop, not in a Zustand store mutated every frame. Put only the *discrete* display state (`mode`, `selectedBodyId`) in a store, updated via real setters on the events that change them. Otherwise the mode pill, mini-map visibility, and the FOLLOW→COM fallback won't reflect changes in the UI.
2. **Lerp uses real frame time.** Feed `updateCamera` the raw `timestamp - lastTime`, not the `speedMultiplier`-scaled `delta` — otherwise camera smoothing collapses to a near-snap at 5×/50× sim speed.
3. **Gravity overlay.** It's a separate, screen-space-sampled canvas redrawn only on add/remove. A per-frame pan/zoom breaks that. Resolve it explicitly: render the field to an offscreen world-space buffer once and apply the camera transform to the buffer, rather than recomputing the per-pixel grid every frame.
4. **Body naming across reload/load.** Derive each type's counter from the max existing suffix among live bodies (don't trust an in-memory counter to survive reload), and add a `name` field to the persisted `state_json` so saved sessions reload with their names instead of `undefined`.
5. **Starfield.** The single world-space starfield in that plan is superseded here by the parallax system in [§7](#7-visual-polish) — its nearest layer *is* that world-space starfield; the auto-hide-below-0.3×-zoom rule applies to all parallax layers.

---

## 7. Visual Polish

All canvas items draw **inside** the camera transform (so they live in world space and scale with zoom) unless noted. Counter-scale any constant-width stroke by `1 / camera.zoom`, per the camera plan.

### 7.1 Radial-gradient bodies

Replace flat fills with a radial gradient (offset highlight for a lit-sphere look):

```js
function fillBody(ctx, body, config) {
  const { x, y } = body.position;
  const r = body.circleRadius;
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  g.addColorStop(0, config.highlight ?? '#FFFFFF');
  g.addColorStop(0.4, config.color);
  g.addColorStop(1, shade(config.color, -40));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
```

Perf note: `createRadialGradient` per body per frame allocates. For large body counts, cache one gradient per type at unit radius and scale it, or accept the cost only for small `n`.

### 7.2 Glow trails (triple-layer)

Draw each trail polyline three times in one pass: wide + very transparent, medium, then thin + opaque. Width and dot radius divided by `camera.zoom`. Keep the existing `line`/`gradient`/`dotted` styles as the innermost (opaque) layer; the two outer layers are the glow.

### 7.3 Speed-tinted trails

Map per-segment speed to color, cool→hot: low speed → blue, high → white/yellow. Compute speed from the delta between consecutive trail points (or read `body.velocity` magnitude for the leading segment) and lerp through an HSL ramp.

### 7.4 Parallax star background (3 layers)

Three layers at parallax factors ~`0.2 / 0.5 / 1.0`:

- **Near layer (f = 1.0):** the world-space starfield from the camera plan — pans and zooms exactly with bodies.
- **Far layers (f < 1.0):** draw in screen space, offset by `-(camera.x, camera.y) * f * camera.zoom` (tiled so panning reveals more sky), with **constant dot size** (don't zoom-scale) so they read as effectively infinite distance.

All layers respect the auto-hide-below-0.3×-zoom toggle. The standalone landing star field (§3.1) is separate and unaffected.

### 7.5 Nebula blobs

Large, low-opacity radial gradients at fixed world positions, drawn behind the star layers on the slowest parallax layer. A handful (3–5) of big soft blobs in deep purples/blues; cache them to an offscreen canvas since they never change.

### 7.6 Accretion disk on black holes

For `BLACK_HOLE` bodies, draw a rotating elliptical gradient ring around the body before drawing the body itself. Advance a rotation accumulator each frame (real time, not sim time) so it spins independent of sim speed.

### 7.7 Screen shake on collision

On a collision event, set `shakeUntil = now + 150` and `shakeMag = 2–3px`. At the top of `render`, before the camera transform, apply a decaying random translate in **screen space** (wrap in `save()/restore()` so it never accumulates):

```js
if (now < shakeUntil) {
  const k = (shakeUntil - now) / 150;          // decays to 0
  ctx.translate((Math.random()*2-1)*shakeMag*k, (Math.random()*2-1)*shakeMag*k);
}
```

### 7.8 Ghost preview in placement mode

When a body type is selected in the toolbar and the cursor is over empty canvas, draw a semi-transparent circle of that type at the cursor's **world** position (inside the transform, so it previews true size at the current zoom). Drive it off the existing hover `mousemove`; clear it when a body type isn't selected or the cursor leaves the canvas.

### 7.9 Glassmorphism UI panels

CSS for Toolbar / PropertyPanel / PlaybackBar / pills:

```css
.glass {
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);   /* Safari */
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
}
```

Perf note: `backdrop-filter` is GPU-cheap for a few panels but expensive if applied to many large overlapping surfaces — keep it to the panel chrome, not the full canvas.

---

## 8. Auth (Lightweight) + Security

### 8.1 Auth — Supabase Google OAuth

Frontend scope is small: a single **Sign in with Google** button and an auth context.

- Add `@supabase/supabase-js`; env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- `supabase.auth.signInWithOAuth({ provider: 'google' })`; subscribe to `onAuthStateChange` to hold `session` in a small store/context.
- Gate **Save & Share** on `session?.user`; when saving, include `user_id` so sessions tie to the user. Anonymous play stays fully usable — only persistence requires sign-in.
- Skip the admin panel and subscriptions entirely (out of scope per the plan).

Backend touch (minimal): add a nullable `user_id` column to the `sessions` table and persist it on save.

### 8.2 Security

- **HTTPS:** free on Vercel + Render — nothing to implement.
- **CSRF:** the surface is the REST endpoints (`POST /api/session`), not the Socket.io channel. Note that the once-standard `csurf` package is deprecated — use a current approach instead: `SameSite=Lax/Strict` cookies plus a double-submit token (e.g. the `csrf-csrf` package) on the session-save route. It's still close to a drop-in, just not literally one line.

---

## 9. Build Order

1. **Screen shell + `navStore`** — the spine; nothing else lands cleanly without it.
2. **Engine lifecycle move** — make `SIMULATION` mountable/unmountable so screens can come and go.
3. **Screens + Logo + transitions** — Landing → Mode → Solo/MP → Lobby → Simulation, wired to the existing `create_room`/`join_room` events (+ new `partner_joined`).
4. **Audio manager** — can proceed in parallel with screens once `unlockAudio` is wired to ENTER.
5. **Camera / Body / Zoom** — per the camera plan, with the [§6](#6-camera--body--zoom) corrections.
6. **Visual polish** — purely additive; do it last so it layers onto a working camera + screen flow.
7. **Auth + Security** — thin; slot in near the end or in parallel with visual polish.

---

## 10. New / Changed Files

| File | Change |
|---|---|
| `store/navStore.js` | **NEW** — screen state machine, legal-flow guard, transition flags |
| `components/App.jsx` | Becomes a screen router; **removes** engine init from top-level mount |
| `components/ScreenTransition.jsx` | **NEW** — plays exit anim, commits screen swap on `animationend` |
| `components/Logo.jsx` | **NEW** — crossed-ellipse + star SVG |
| `screens/LandingScreen.jsx` | **NEW** — star field, logo, tagline, ENTER (unlocks audio) |
| `screens/ModeSelectScreen.jsx` | **NEW** — Solo / Multiplayer cards |
| `screens/SoloSelectScreen.jsx` | **NEW** — Sandbox / Challenges → `simContext` |
| `screens/MultiplayerSelectScreen.jsx` | **NEW** — Create / Join Room; opens the socket connection |
| `screens/LobbyScreen.jsx` | **NEW** — orbiting-dots waiting state, room code, `partner_joined` → sim |
| `screens/SimulationScreen.jsx` | **NEW** — owns engine init/teardown + in-sim UI (the old `App` canvas) |
| `audio/AudioManager.js` | **NEW** — `unlockAudio`, screen beds, crossfade, one-shot SFX |
| `canvas/CanvasRenderer.js` | Gradient bodies, glow trails, speed tint, accretion disk, screen shake, ghost preview |
| `canvas/starfield.js` | **NEW** — 3-layer parallax (near = world-space layer from camera plan) |
| `canvas/nebula.js` | **NEW** — cached low-opacity background blobs |
| `canvas/GravityOverlay.js` | Offscreen world-space buffer + camera transform (per §6.3) |
| `styles/glass.css` | **NEW** — glassmorphism panel chrome |
| `server/src/socketHandlers.js` | Add `partner_joined` emit inside `join_room` |
| `server/src/db/queries.js` + schema | Add nullable `user_id`; persist on save |
| `package.json` (client) | Add `@supabase/supabase-js` (+ `framer-motion` only if CSS transitions fall short) |

---

*Camera System, Body Interaction, and Zoom Polish are implemented from the separate Camera & Body Interaction System plan; this document specifies only how they slot into the new screen shell and which corrections to apply.*
