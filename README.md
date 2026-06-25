# Orbital Sandbox

> A real-time collaborative gravity simulation — place stars, planets, black holes, and watch orbital mechanics unfold with a friend.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, HTML Canvas |
| Physics | Matter.js (custom gravitational forces) |
| Charts | Chart.js + react-chartjs-2 |
| State | Zustand |
| Realtime | Socket.io |
| Backend | Node.js, Express |
| Database | PostgreSQL (Supabase) — Phase 9 |

## Project Structure

```
orbital-sandbox/
├── client/    # React + Vite frontend
├── server/    # Express + Socket.io backend
└── shared/    # Shared event type constants
```

## Getting Started

**Prerequisites:** Node.js 18+

```bash
# Install all dependencies
npm install

# Start both client and server in development
npm run dev

# Or start individually
npm run dev:client   # http://localhost:5173
npm run dev:server   # http://localhost:4000
```

## Phase Status

| Phase | Description | Status |
|---|---|---|
| 0 | Project Scaffolding & Environment Setup | ✅ Complete |
| 1 | Canvas & Physics Engine | ✅ Complete |
| 2 | Celestial Body System | ✅ Complete |
| 3 | Simulation Controls & Playback | ✅ Complete |
| 4 | Real-Time Collaboration (WebSockets) | ✅ Complete |
| 5 | Analytics, Overlays & Dashboards | ✅ Complete |
| 6 | Visuals, Trails & Sound | ✅ Complete |
| 7 | Scenarios, Presets & Save/Share | ✅ Complete |
| 8 | Collaboration UX Features | ✅ Complete |
| 9 | Database Layer | ✅ Complete |
| 10 | Deployment | ✅ Complete |

## Frontend Plan (post-architecture)

| Section | Description | Status |
|---|---|---|
| §1–3 | Screen-flow spine + state machine + non-sim screens | ✅ Complete |
| §4 | Cinematic transitions (warp + card-expand) | ✅ Complete |
| §5 | Screen-aware audio (beds + SFX) | ✅ Complete |
| §6 | Camera/Body/Zoom corrections | ✅ Complete |
| §7 | Visual polish (radial bodies, glow trails, parallax, nebula, accretion, shake, ghost, glassmorphism) | ✅ Complete |
| §8 | Lightweight auth (Supabase Google OAuth) | ✅ Skeleton — activates when env vars set |

## Environment Variables

```bash
# server/.env
PORT=4000
DATABASE_URL=postgresql://user:password@host:5432/orbitalsandbox
CLIENT_ORIGIN=http://localhost:5173      # CORS origin (Vercel URL in prod)
DATABASE_SSL=off                          # set to 'off' for local Postgres; omit on Supabase

# client/.env
VITE_SERVER_URL=http://localhost:4000     # leave empty in dev — vite proxies /api & /socket.io
VITE_SUPABASE_URL=https://xxxx.supabase.co        # optional — enables Sign in with Google
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...              # optional — enables Sign in with Google
```

> ⚠️ Never commit `.env` files — they are already in `.gitignore`. Without
> `VITE_SUPABASE_*` the app stays fully usable; the "Sign in with Google"
> button just hides.

## Deployment

| Layer | Host | Notes |
|---|---|---|
| Frontend | **Vercel** | Reads `vercel.json` at repo root. Set `VITE_SERVER_URL` in the Vercel dashboard pointing to your Render URL. |
| Backend | **Render** | Web Service on the `/server` workspace, start command `node src/index.js`. Set `DATABASE_URL` (Supabase URI), `CLIENT_ORIGIN` (Vercel URL). |
| Database | **Supabase** | Run `server/migrations/001_sessions.sql` once via the SQL Editor. `ensureSchema()` also runs at boot as a backstop. |

**CSRF (frontend §8.2):** the only state-changing REST endpoint (`POST /api/session`) accepts JSON only and is the place to add a double-submit CSRF token in production. The current implementation relies on CORS + `SameSite=Lax` cookies; for higher-stakes deployments wire the [`csrf-csrf`](https://www.npmjs.com/package/csrf-csrf) middleware around the route handler.
