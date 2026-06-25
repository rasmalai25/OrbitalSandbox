// canvas/TrailManager.js
// Phase 6      — stores and paints orbital trails behind each celestial body.
// Visual Overhaul — 3-layer neon glow tube + speed-based colour shift.
// Camera System  — stroke widths counter-scaled by camera.zoom;
//                  non-selected trails dimmed when a body is selected.

import { BODY_TYPES } from '../constants/bodyTypes.js';

const TRAIL_MAX_POINTS = 250;

const PLANET_PALETTE = ['#4a9eff', '#7fff6e', '#ff6eb4', '#ffa05a', '#c679ff'];

function getBodyTrailColor(body) {
  if (body.label === 'PLANET') {
    const idx = parseInt(body.customData?.id?.replace(/\D/g, '') || '0');
    return PLANET_PALETTE[idx % PLANET_PALETTE.length];
  }
  const config = BODY_TYPES[body.label];
  return config?.trailColor?.slice(0, 7) || '#ffffff';
}

/**
 * Append current position + velocity to each body's trail buffer.
 * Call once per physics tick.
 */
export function updateTrails(bodies) {
  bodies.forEach(body => {
    const cd = body.customData;
    if (!cd || body.label === 'BLACK_HOLE') return;
    if (!cd.trailPoints) cd.trailPoints = [];
    cd.trailPoints.push({
      x: body.position.x,
      y: body.position.y,
      vx: body.velocity.x,
      vy: body.velocity.y,
    });
    if (cd.trailPoints.length > TRAIL_MAX_POINTS) cd.trailPoints.shift();
  });
}

/**
 * Render all trails with 3-layer neon glow.
 * @param {CanvasRenderingContext2D} ctx     — inside camera transform
 * @param {Array}  bodies
 * @param {string} trailStyle
 * @param {string|null} selectedBodyId
 * @param {object} camera
 */
export function renderTrails(ctx, bodies, trailStyle, selectedBodyId = null, camera = { zoom: 1 }) {
  if (trailStyle === 'off') return;

  const iz = 1 / camera.zoom;
  const hasSelection = selectedBodyId !== null;

  bodies.forEach(body => {
    const cd = body.customData;
    if (!cd || !cd.trailPoints || cd.trailPoints.length < 2) return;

    const isSelected = cd.id === selectedBodyId;
    const baseHex = getBodyTrailColor(body);
    const [br, bg, bb] = hexToRgb(baseHex);

    const points = cd.trailPoints;
    const n      = points.length;

    ctx.save();
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    // Dim non-selected trails when something is selected
    ctx.globalAlpha = hasSelection && !isSelected ? 0.2 : 1.0;

    if (trailStyle === 'dotted') {
      for (let i = 0; i < n; i += 3) {
        const t  = i / n;
        const pt = points[i];
        const speed = Math.sqrt(pt.vx * pt.vx + pt.vy * pt.vy);
        const [r, g, b] = speedLerpColor(br, bg, bb, speed);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 1.5 * t * iz, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${(t * 0.7).toFixed(3)})`;
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    if (trailStyle === 'gradient') {
      for (let i = 1; i < n; i++) {
        const t  = i / n;
        const p0 = points[i - 1], p1 = points[i];
        const speed = Math.sqrt(p1.vx * p1.vx + p1.vy * p1.vy);
        const [r, g, b] = speedLerpColor(br, bg, bb, speed);
        ctx.beginPath();
        ctx.strokeStyle = `rgba(${r},${g},${b},${(t * 0.75).toFixed(3)})`;
        ctx.lineWidth   = t * 2 * iz;
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    // ── 'line' → 3-layer neon glow tube ──────────────────────────────────
    const LAYERS = [
      { width: 8,  alphaScale: 0.12 },
      { width: 3,  alphaScale: 0.40 },
      { width: 1,  alphaScale: 0.90 },
    ];

    for (const layer of LAYERS) {
      for (let i = 1; i < n; i++) {
        const t  = i / n;
        const p0 = points[i - 1], p1 = points[i];
        const speed = Math.sqrt(p1.vx * p1.vx + p1.vy * p1.vy);
        const [r, g, b] = speedLerpColor(br, bg, bb, speed);
        ctx.beginPath();
        ctx.strokeStyle = `rgba(${r},${g},${b},${(t * layer.alphaScale).toFixed(3)})`;
        ctx.lineWidth   = layer.width * t * iz;
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
    }

    ctx.restore();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = hex.replace('#', '').slice(0, 6);
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

function speedLerpColor(br, bg, bb, speed) {
  const SLOW_R = 74,  SLOW_G = 158, SLOW_B = 255;
  const HOT_R  = 255, HOT_G  = 255, HOT_B  = 192;
  if (speed < 2) {
    const t = Math.min(speed / 2, 1);
    return [Math.round(lerp(SLOW_R,br,t)), Math.round(lerp(SLOW_G,bg,t)), Math.round(lerp(SLOW_B,bb,t))];
  }
  const t = Math.min((speed - 2) / 10, 1);
  return [Math.round(lerp(br,HOT_R,t)), Math.round(lerp(bg,HOT_G,t)), Math.round(lerp(bb,HOT_B,t))];
}

function lerp(a, b, t) { return a + (b - a) * t; }
