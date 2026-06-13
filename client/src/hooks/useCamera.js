// hooks/useCamera.js
// Camera & Body Interaction System — wheel zoom + canvas pan handlers.
// Attaches to the canvas element imperatively (passive:false required for wheel).

import { useEffect, useRef } from 'react';
import { screenToWorld, MIN_ZOOM, MAX_ZOOM, clamp } from '../canvas/camera.js';
import { getCamera } from '../simulation/SimulationLoop.js';

/**
 * Attaches wheel-zoom and middle-mouse-drag pan handlers to the canvas.
 * Also provides helpers for left-button pan (drag without body hit).
 *
 * @param {React.RefObject} canvasRef
 * @returns {{ isPanningRef, onMouseDown, onMouseMove, onMouseUp }}
 *   The returned handlers should be spread onto the canvas element in App.jsx.
 *   isPanningRef is a ref the click handler can check to suppress click-on-drag.
 */
export function useCamera(canvasRef) {
  const isPanningRef  = useRef(false);
  const panStartRef   = useRef(null);
  const hasDraggedRef = useRef(false);

  // ── Wheel zoom ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function onWheel(e) {
      e.preventDefault();
      const camera = getCamera();
      const rect   = canvas.getBoundingClientRect();
      const sx     = (e.clientX - rect.left) * (canvas.width  / rect.width);
      const sy     = (e.clientY - rect.top)  * (canvas.height / rect.height);

      // World point under cursor BEFORE zoom changes
      const worldBefore = screenToWorld(camera, canvas, sx, sy);

      const SENSITIVITY = 0.0012;
      const factor      = 1 - e.deltaY * SENSITIVITY;
      const newZoom     = clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);

      camera.targetZoom = newZoom;
      camera.zoom       = newZoom; // snap immediately, per spec

      // In FREE mode: adjust target so worldBefore stays under cursor
      if (camera.mode === 'FREE') {
        const cx = canvas.width  / 2;
        const cy = canvas.height / 2;
        camera.targetX = worldBefore.x - (sx - cx) / newZoom;
        camera.targetY = worldBefore.y - (sy - cy) / newZoom;
        camera.x = camera.targetX;
        camera.y = camera.targetY;
      }
      // Other modes: zoom changes but camera keeps tracking its target
    }

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [canvasRef]);

  // ── Pan drag (left mouse in FREE mode; also switches to FREE) ──────────────
  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    panStartRef.current = {
      x: (e.clientX - rect.left) * (canvas.width  / rect.width),
      y: (e.clientY - rect.top)  * (canvas.height / rect.height),
    };
    hasDraggedRef.current = false;
    isPanningRef.current  = false;
  };

  const onMouseMove = (e) => {
    if (!panStartRef.current || e.buttons !== 1) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (canvas.width  / rect.width);
    const cy = (e.clientY - rect.top)  * (canvas.height / rect.height);

    const dx = cx - panStartRef.current.x;
    const dy = cy - panStartRef.current.y;

    // Threshold: 5px before we commit to a pan
    if (!hasDraggedRef.current && Math.sqrt(dx*dx + dy*dy) < 5) return;

    hasDraggedRef.current = true;
    isPanningRef.current  = true;

    const camera = getCamera();
    // Any drag switches to FREE mode
    if (camera.mode !== 'FREE') {
      camera.targetX = camera.x;
      camera.targetY = camera.y;
      camera.mode    = 'FREE';
    }

    const worldDx = dx / camera.zoom;
    const worldDy = dy / camera.zoom;
    camera.targetX -= worldDx;
    camera.targetY -= worldDy;
    camera.x = camera.targetX;
    camera.y = camera.targetY;

    panStartRef.current = { x: cx, y: cy };
  };

  const onMouseUp = () => {
    panStartRef.current   = null;
    // isPanningRef stays true briefly so the click handler can check it;
    // App.jsx resets it after the click event fires.
    setTimeout(() => { isPanningRef.current = false; }, 0);
  };

  return { isPanningRef, hasDraggedRef, onMouseDown, onMouseMove, onMouseUp };
}
