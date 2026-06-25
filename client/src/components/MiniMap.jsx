// components/MiniMap.jsx
// Camera & Body Interaction System — mini-map overlay.
// Visible only in FOLLOW mode. Shows all bodies + selected body + viewport rect.
// Bounding box is recomputed dynamically every 30 frames so it always fits.

import { useEffect, useRef } from 'react';
import Matter from 'matter-js';
import { BODY_TYPES } from '../constants/bodyTypes.js';
import './MiniMap.css';

const SIZE   = 150; // px — square mini-map canvas
const MARGIN = 16;  // world units of padding around bounding box

// Planet palette (mirrors CanvasRenderer.js)
const PLANET_PALETTE = ['#4a9eff', '#7fff6e', '#ff6eb4', '#ffa05a', '#c679ff'];
function planetColor(id) {
  const idx = parseInt((id || '0').replace(/\D/g, '') || '0');
  return PLANET_PALETTE[idx % PLANET_PALETTE.length];
}
function bodyColor(b) {
  if (b.label === 'PLANET') return planetColor(b.customData?.id);
  return BODY_TYPES[b.label]?.color || '#ffffff';
}

export default function MiniMap({ engineRef, camera, selectedBodyId, visible }) {
  const canvasRef  = useRef(null);
  const frameRef   = useRef(0);
  const boundsRef  = useRef({ minX: -500, maxX: 500, minY: -500, maxY: 500 });

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let rafId;

    function draw() {
      const engine = engineRef?.current;
      if (!engine) return;

      const bodies = Matter.Composite.allBodies(engine.world);
      frameRef.current++;

      // Recompute bounding box every 30 frames
      if (frameRef.current % 30 === 0 || bodies.length === 0) {
        if (bodies.length === 0) {
          boundsRef.current = { minX: -400, maxX: 400, minY: -400, maxY: 400 };
        } else {
          let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
          bodies.forEach(b => {
            const r = b.circleRadius || 5;
            mnX = Math.min(mnX, b.position.x - r);
            mxX = Math.max(mxX, b.position.x + r);
            mnY = Math.min(mnY, b.position.y - r);
            mxY = Math.max(mxY, b.position.y + r);
          });
          boundsRef.current = {
            minX: mnX - MARGIN, maxX: mxX + MARGIN,
            minY: mnY - MARGIN, maxY: mxY + MARGIN,
          };
        }
      }

      const { minX, maxX, minY, maxY } = boundsRef.current;
      const worldW = maxX - minX || 1;
      const worldH = maxY - minY || 1;
      const scaleX = SIZE / worldW;
      const scaleY = SIZE / worldH;
      const scale  = Math.min(scaleX, scaleY);
      const offX   = (SIZE - worldW * scale) / 2 - minX * scale;
      const offY   = (SIZE - worldH * scale) / 2 - minY * scale;

      // Background
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = 'rgba(5, 7, 15, 0.88)';
      ctx.fillRect(0, 0, SIZE, SIZE);

      // Bodies
      bodies.forEach(b => {
        const mx = b.position.x * scale + offX;
        const my = b.position.y * scale + offY;
        if (mx < 0 || mx > SIZE || my < 0 || my > SIZE) return;
        const mr = Math.max(2, (b.circleRadius || 5) * scale * 0.6);

        ctx.beginPath();
        ctx.arc(mx, my, mr, 0, Math.PI * 2);
        ctx.fillStyle = bodyColor(b);
        ctx.fill();

        if (b.customData?.id === selectedBodyId) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth   = 1.5;
          ctx.stroke();
        }
      });

      // Viewport rectangle showing what main camera sees
      if (camera && engineRef?.current) {
        const mainCanvas = document.querySelector('.simulation-canvas');
        if (mainCanvas) {
          const viewW = (mainCanvas.width  / camera.zoom) * scale;
          const viewH = (mainCanvas.height / camera.zoom) * scale;
          const vcx   = camera.x * scale + offX;
          const vcy   = camera.y * scale + offY;
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          ctx.lineWidth   = 1;
          ctx.strokeRect(vcx - viewW / 2, vcy - viewH / 2, viewW, viewH);
        }
      }

      // Border
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth   = 1;
      ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);

      rafId = requestAnimationFrame(draw);
    }

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [visible, engineRef, camera, selectedBodyId]);

  if (!visible) return null;

  return (
    <div className="minimap-container" role="img" aria-label="System mini-map">
      <div className="minimap-label">MAP</div>
      <canvas ref={canvasRef} width={SIZE} height={SIZE} className="minimap-canvas" />
    </div>
  );
}
