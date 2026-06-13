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
| 8 | Collaboration UX Features | ⏳ Pending |
| 9 | Database Layer | ⏳ Pending |
| 10 | Deployment | ⏳ Pending |

## Environment Variables

```bash
# server/.env
PORT=4000
DATABASE_URL=postgresql://user:password@host:5432/orbitalsandbox
CLIENT_ORIGIN=http://localhost:5173

# client/.env
VITE_SERVER_URL=http://localhost:4000
```

> ⚠️ Never commit `.env` files — they are already in `.gitignore`.
