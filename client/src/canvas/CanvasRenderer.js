// canvas/CanvasRenderer.js
// Phase 1   — draws bodies onto the canvas each frame.
// Phase 5   — collision warning rings.
// Phase 6   — trail rendering, spaghettification, collision particles.
// Visual Overhaul — gradient bodies, accretion disk, nebula, ghost preview, screen shake.
// Camera System — proper 3-step camera transform, world-space stars, hover label,
//                 trajectory arc, zoom-aware stroke widths.

import Matter from 'matter-js';
import { getSocket } from '../socket/socketClient.js';
import { renderTrails } from './TrailManager.js';
import { worldToScreen } from './camera.js';

// ── Planet color palette ──────────────────────────────────────────────────────
const PLANET_PALETTE = ['#4a9eff', '#7fff6e', '#ff6eb4', '#ffa05a', '#c679ff'];
function getPlanetColor(bodyId) {
  const idx = parseInt((bodyId || '0').replace(/\D/g, '') || '0');
  return PLANET_PALETTE[idx % PLANET_PALETTE.length];
}

// ── Body type visual config ───────────────────────────────────────────────────
const BODY_VISUALS = {
  STAR:       { glowColor: 'rgba(255,157,0,0.5)',   glowRadius: 2.2, strokeColor: 'rgba(255,157,0,0.7)' },
  PLANET:     { glowColor: null,                    glowRadius: 1.6, strokeColor: null },
  MOON:       { glowColor: 'rgba(200,200,220,0.2)', glowRadius: 1.1, strokeColor: 'rgba(220,220,240,0.5)' },
  ASTEROID:   { glowColor: 'rgba(160,130,90,0.2)',  glowRadius: 0.9, strokeColor: 'rgba(160,130,90,0.4)' },
  BLACK_HOLE: { glowColor: 'rgba(123,0,255,0.7)',   glowRadius: 3.0, strokeColor: '#7B00FF' },
  DEFAULT:    { glowColor: 'rgba(255,255,255,0.3)', glowRadius: 1.3, strokeColor: 'rgba(255,255,255,0.5)' },
};

// ── Screen shake ──────────────────────────────────────────────────────────────
let _shake = { dx: 0, dy: 0, ttl: 0 };
export function triggerShake(intensity = 1) {
  _shake = {
    dx:  (Math.random() - 0.5) * 6 * intensity,
    dy:  (Math.random() - 0.5) * 6 * intensity,
    ttl: 9,
  };
}

// ── Stars (world-space, large extent so panning reveals more sky) ─────────────
let _starCache = null;
function getStarLayers(seed) {
  if (_starCache) return _starCache;
  const rng = mulberry32(seed);
  const range = 6000;
  const half  = range / 2;
  const layers = [
    Array.from({ length: 400 }, () => ({ x: rng()*range-half, y: rng()*range-half, r: rng()*0.5+0.15, a: rng()*0.4+0.1,  phase: rng()*Math.PI*2 })),
    Array.from({ length: 150 }, () => ({ x: rng()*range-half, y: rng()*range-half, r: rng()*0.8+0.3,  a: rng()*0.5+0.2,  phase: rng()*Math.PI*2 })),
    Array.from({ length: 50  }, () => ({ x: rng()*range-half, y: rng()*range-half, r: rng()*1.2+0.5,  a: rng()*0.55+0.3, phase: rng()*Math.PI*2 })),
  ];
  _starCache = layers;
  return layers;
}

// ── Nebula (screen-space, static) ────────────────────────────────────────────
const NEBULAE = [
  { rx: 0.68, ry: 0.32, rr: 0.40, c0: 'rgba(26,10,58,0.07)',  c1: 'transparent' },
  { rx: 0.18, ry: 0.70, rr: 0.35, c0: 'rgba(5,26,42,0.06)',   c1: 'transparent' },
  { rx: 0.82, ry: 0.75, rr: 0.28, c0: 'rgba(30,5,60,0.05)',   c1: 'transparent' },
];
function drawNebula(ctx, w, h) {
  NEBULAE.forEach(n => {
    const cx = n.rx * w, cy = n.ry * h;
    const rad = n.rr * Math.max(w, h);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, n.c0);
    g.addColorStop(1, n.c1);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

// ── Main render entry ─────────────────────────────────────────────────────────

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Matter.Engine}     engine
 * @param {object}            camera  — from camera.js
 * @param {object}            opts
 *   collisionWarnings, trailStyle, hoveredBodyId, selectedBodyId,
 *   ghostPos ({x,y} canvas-space), ghostType, trajectoryPath
 */
export function render(canvas, engine, camera, opts = {}) {
  const {
    collisionWarnings = [],
    trailStyle        = 'line',
    hoveredBodyId     = null,
    selectedBodyId    = null,
    ghostPos          = null,
    ghostType         = null,
    trajectoryPath    = null,
  } = opts;

  const ctx = canvas.getContext('2d');
  const { width: W, height: H } = canvas;

  // 1. Clear
  ctx.fillStyle = '#05070f';
  ctx.fillRect(0, 0, W, H);

  // 2. Screen-space nebula (no zoom effect)
  drawNebula(ctx, W, H);

  // 3. Camera + shake transform
  let shakeX = 0, shakeY = 0;
  if (_shake.ttl > 0) {
    shakeX = _shake.dx; shakeY = _shake.dy;
    _shake.dx *= 0.65; _shake.dy *= 0.65; _shake.ttl--;
  }

  ctx.save();
  // 3-step camera matrix: screen-centre → scale → world offset
  ctx.translate(W / 2 + shakeX, H / 2 + shakeY);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  // 4. World-space stars (size counter-scaled so they stay visually constant)
  if (camera.zoom >= 0.3) {
    drawStarfieldWorld(ctx, camera);
  }

  const bodies = Matter.Composite.allBodies(engine.world);

  // 5. Trails
  renderTrails(ctx, bodies, trailStyle, selectedBodyId, camera);

  // 6. Bodies
  bodies.forEach(body => drawBody(ctx, body, hoveredBodyId, selectedBodyId, camera));
  drawCollisionWarnings(ctx, bodies, collisionWarnings, camera);

  // 7. Trajectory arc
  if (trajectoryPath) renderTrajectory(ctx, trajectoryPath, camera);

  // 8. Hover effects (outline + name label)
  renderHoverEffects(ctx, bodies, hoveredBodyId, selectedBodyId, camera);

  // 9. Phase 6 effects (world-space)
  renderSpaghettification(ctx);
  renderAndTickParticles(ctx);

  ctx.restore(); // ← everything below is SCREEN SPACE

  // 10. Ghost placement preview (screen-space, follows raw mouse)
  if (ghostPos && ghostType) drawGhostPreview(ctx, ghostPos.x, ghostPos.y, ghostType, camera);
}

// ── World-space starfield ─────────────────────────────────────────────────────

function drawStarfieldWorld(ctx, camera) {
  const [layerA, layerB, layerC] = getStarLayers(1337);
  const now = performance.now() * 0.001;
  const iz = 1 / camera.zoom; // counter-scale factor

  layerA.forEach(s => {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * iz, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(200,210,255,${s.a.toFixed(3)})`;
    ctx.fill();
  });
  layerB.forEach(s => {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * iz, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(230,235,255,${s.a.toFixed(3)})`;
    ctx.fill();
  });
  layerC.forEach(s => {
    const flicker = s.a + 0.15 * Math.sin(now * 1.5 + s.phase);
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * iz, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${Math.max(0, flicker).toFixed(3)})`;
    ctx.fill();
  });
}

// ── Hover effects ─────────────────────────────────────────────────────────────

function renderHoverEffects(ctx, bodies, hoveredBodyId, selectedBodyId, camera) {
  const iz = 1 / camera.zoom;

  bodies.forEach(body => {
    const id = body.customData?.id;
    const isHovered  = id === hoveredBodyId;
    const isSelected = id === selectedBodyId;
    if (!isHovered && !isSelected) return;

    const { x, y } = body.position;
    const r = body.circleRadius || 10;

    ctx.save();
    if (isSelected) {
      // Bright animated selection ring
      const t = performance.now() * 0.003;
      const pulse = 0.6 + 0.4 * Math.sin(t);
      ctx.beginPath();
      ctx.arc(x, y, r + 6 * iz, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${pulse})`;
      ctx.lineWidth = 2.5 * iz;
      ctx.stroke();
    } else if (isHovered) {
      // Soft white hover ring
      ctx.beginPath();
      ctx.arc(x, y, r + 4 * iz, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.5 * iz;
      ctx.stroke();
    }

    // Name label (only when hovered or selected)
    const name = body.customData?.name;
    if (name) {
      const fontSize = 12 * iz;
      ctx.font        = `500 ${fontSize}px 'Inter', sans-serif`;
      ctx.textAlign   = 'center';
      ctx.fillStyle   = isSelected ? '#ffffff' : 'rgba(255,255,255,0.75)';
      const labelY    = y - r - 10 * iz;
      // Drop shadow for readability
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur  = 4 * iz;
      ctx.fillText(name, x, labelY);
      ctx.shadowBlur  = 0;
    }

    ctx.restore();
  });
}

// ── Trajectory arc ────────────────────────────────────────────────────────────

function renderTrajectory(ctx, path, camera) {
  if (!path || path.length < 2) return;
  const iz = 1 / camera.zoom;

  ctx.save();
  ctx.setLineDash([6 * iz, 4 * iz]);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth   = 1.2 * iz;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ── Ghost placement preview (screen-space) ────────────────────────────────────

const GHOST_RADII = { STAR: 28, PLANET: 14, MOON: 8, ASTEROID: 5, BLACK_HOLE: 20 };

function drawGhostPreview(ctx, sx, sy, type, camera) {
  const r   = GHOST_RADII[type] || 12;
  const vis = BODY_VISUALS[type] || BODY_VISUALS.DEFAULT;

  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
  ctx.strokeStyle = vis.strokeColor || 'rgba(255,255,255,0.6)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  drawBodyFill(ctx, sx, sy, r, type, 'ghost-0');
  ctx.fill();
  ctx.restore();
}

// ── Collision warning rings ───────────────────────────────────────────────────

function drawCollisionWarnings(ctx, bodies, warnings, camera) {
  if (!warnings || warnings.length === 0) return;
  const iz = 1 / camera.zoom;
  const bodyMap = new Map(bodies.map(b => [b.customData?.id, b]));
  const t = performance.now() / 400;
  const pulse = 0.4 + 0.4 * Math.sin(t);

  warnings.forEach(({ idA, idB, probability }) => {
    [idA, idB].forEach(id => {
      const body = bodyMap.get(id);
      if (!body) return;
      const { x, y } = body.position;
      const r = body.circleRadius || 5;
      const alpha = probability * pulse;

      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r + (6 + pulse * 4) * iz, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,68,102,${alpha})`;
      ctx.lineWidth   = 2 * iz;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r + 2 * iz, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,68,102,${alpha * 0.15})`;
      ctx.fill();
      ctx.restore();
    });
  });
}

// ── Body drawing ──────────────────────────────────────────────────────────────

function drawBody(ctx, body, hoveredBodyId, selectedBodyId, camera) {
  const { x, y } = body.position;
  const r    = body.circleRadius || 10;
  const type = body.label || 'DEFAULT';
  const vis  = BODY_VISUALS[type] || BODY_VISUALS.DEFAULT;
  const id   = body.customData?.id || '';
  const iz   = 1 / camera.zoom;

  ctx.save();

  // Accretion disk for black holes (behind body)
  if (type === 'BLACK_HOLE') drawAccretionDisk(ctx, x, y, r);

  // Outer glow halo
  let glowColor = vis.glowColor;
  if (type === 'PLANET') {
    const [pr, pg, pb] = hexToRgb(getPlanetColor(id));
    glowColor = `rgba(${pr},${pg},${pb},0.4)`;
  }
  const glowSize = Math.min(r * vis.glowRadius, r * 1.5);
  const gGlow = ctx.createRadialGradient(x, y, r * 0.3, x, y, r + glowSize);
  gGlow.addColorStop(0, glowColor);
  gGlow.addColorStop(1, 'transparent');
  ctx.fillStyle = gGlow;
  ctx.beginPath();
  ctx.arc(x, y, r + glowSize, 0, Math.PI * 2);
  ctx.fill();

  // Body fill
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  drawBodyFill(ctx, x, y, r, type, id);
  ctx.fill();

  // Rim stroke
  let strokeColor = vis.strokeColor;
  if (type === 'PLANET') {
    const [pr, pg, pb] = hexToRgb(getPlanetColor(id));
    strokeColor = `rgba(${pr},${pg},${pb},0.7)`;
  }
  ctx.strokeStyle = strokeColor || 'rgba(255,255,255,0.3)';
  ctx.lineWidth   = iz;
  ctx.stroke();

  // Black hole photon ring
  if (type === 'BLACK_HOLE') {
    ctx.beginPath();
    ctx.arc(x, y, r * 1.45, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(140,60,255,0.6)';
    ctx.lineWidth   = 2 * iz;
    ctx.stroke();
  }

  // Ownership ring
  const localId  = getSocket()?.id;
  const ownerId  = body.customData?.ownerId;
  if (ownerId && localId) {
    const isOwn     = ownerId === localId;
    const isPartner = !isOwn && ownerId !== 'local';
    if (isOwn || isPartner) {
      const ringColor = isOwn ? 'rgba(74,144,255,0.85)' : 'rgba(255,140,0,0.85)';
      const dotColor  = isOwn ? 'rgba(74,144,255,1)'    : 'rgba(255,140,0,1)';
      ctx.beginPath();
      ctx.arc(x, y, r + 3 * iz, 0, Math.PI * 2);
      ctx.strokeStyle = ringColor;
      ctx.lineWidth   = 1.5 * iz;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y - (r + 3 * iz), 2.5 * iz, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawBodyFill(ctx, x, y, r, type, id) {
  const hx = x - r * 0.35;
  const hy = y - r * 0.35;

  if (type === 'STAR') {
    const g = ctx.createRadialGradient(hx, hy, r * 0.05, x, y, r);
    g.addColorStop(0, '#fff9d0'); g.addColorStop(0.25, '#ffcc44');
    g.addColorStop(0.6, '#ff9d00'); g.addColorStop(1, '#cc3300');
    ctx.fillStyle = g;
  } else if (type === 'BLACK_HOLE') {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, '#000000'); g.addColorStop(0.6, '#0a0018');
    g.addColorStop(1, '#2a0055');
    ctx.fillStyle = g;
  } else if (type === 'PLANET') {
    const pc = getPlanetColor(id);
    const [pr, pg, pb] = hexToRgb(pc);
    const bright = `rgba(${Math.min(pr+80,255)},${Math.min(pg+80,255)},${Math.min(pb+80,255)},1)`;
    const dark   = `rgba(${Math.max(pr-60,0)},${Math.max(pg-60,0)},${Math.max(pb-60,0)},1)`;
    const g = ctx.createRadialGradient(hx, hy, r * 0.05, x, y, r);
    g.addColorStop(0, bright); g.addColorStop(0.45, pc); g.addColorStop(1, dark);
    ctx.fillStyle = g;
  } else if (type === 'MOON') {
    const g = ctx.createRadialGradient(hx, hy, r * 0.05, x, y, r);
    g.addColorStop(0, '#e8e8f5'); g.addColorStop(0.5, '#b0b0c8');
    g.addColorStop(1, '#606075');
    ctx.fillStyle = g;
  } else if (type === 'ASTEROID') {
    const g = ctx.createRadialGradient(hx, hy, r * 0.05, x, y, r);
    g.addColorStop(0, '#c4a87a'); g.addColorStop(0.5, '#8B7355');
    g.addColorStop(1, '#4a3820');
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = '#ffffff';
  }
}

function drawAccretionDisk(ctx, x, y, r) {
  const t = performance.now() * 0.0004;
  const disks = [
    { speed:  0.4,  scaleY: 0.28, color: 'rgba(120,20,255,0.35)', width: r * 0.5 },
    { speed: -0.25, scaleY: 0.22, color: 'rgba(60,90,220,0.25)',  width: r * 0.4 },
  ];
  disks.forEach(d => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * d.speed);
    ctx.scale(1, d.scaleY);
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.4, 0, Math.PI * 2);
    ctx.strokeStyle = d.color;
    ctx.lineWidth   = d.width;
    ctx.stroke();
    ctx.restore();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = hex.replace('#', '').slice(0, 6);
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Spaghettification ─────────────────────────────────────────────────────────

const spaghettifying = new Map();

export function triggerSpaghettification(body, bh) {
  spaghettifying.set(body.customData.id, {
    startX: body.position.x, startY: body.position.y,
    bhX: bh.position.x,      bhY: bh.position.y,
    radius: body.circleRadius || 5,
    progress: 0,
  });
}

export function renderSpaghettification(ctx) {
  spaghettifying.forEach((state, id) => {
    state.progress += 0.022;
    const t = state.progress;
    const x = state.startX + (state.bhX - state.startX) * t;
    const y = state.startY + (state.bhY - state.startY) * t;
    const angle = Math.atan2(state.bhY - state.startY, state.bhX - state.startX);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(1 + t * 5, Math.max(1 - t * 0.9, 0.04));
    ctx.beginPath();
    ctx.arc(0, 0, state.radius * Math.max(1 - t * 0.6, 0.1), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(180,100,255,${(1 - t).toFixed(3)})`;
    ctx.fill();
    ctx.restore();
    if (state.progress >= 1) spaghettifying.delete(id);
  });
}

// ── Collision particles ───────────────────────────────────────────────────────

const particles = [];

export function spawnCollisionParticles(x, y, massA, massB) {
  const count = Math.min(20, Math.floor(Math.sqrt(massA + massB) / 5) + 4);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.2 + Math.random() * 3.5;
    particles.push({ x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed, life: 1.0, radius: 1 + Math.random() * 2.5 });
  }
}

export function renderAndTickParticles(ctx) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.96; p.vy *= 0.96;
    p.life -= 0.03;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius * p.life, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,200,80,${p.life.toFixed(3)})`;
    ctx.fill();
  }
}
