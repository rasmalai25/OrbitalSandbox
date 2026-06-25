// components/PlaybackBar.jsx
// Phase 3        — Run / Pause / Rewind / Speed controls.
// Camera System  — Fit All button.

import { useState, useEffect, useCallback, useRef } from 'react';
import Matter from 'matter-js';
import {
  pauseLoop, resumeLoop, setSpeed, getSpeed, isRunning as simIsRunning,
  resetTickCounter,
} from '../simulation/SimulationLoop.js';
import { getCursor, getTotalWritten, rewindTo, clearHistory } from '../simulation/HistoryStore.js';
import { clearCollisionState } from '../physics/collisionHandler.js';
import { clearAllVfx } from '../canvas/CanvasRenderer.js';
import { fitAll } from '../canvas/camera.js';
import './PlaybackBar.css';

const SPEED_OPTIONS = [
  { label: '0.1×', value: 0.1 },
  { label: '0.25×', value: 0.25 },
  { label: '0.5×', value: 0.5 },
  { label: '1×',   value: 1   },
  { label: '2×',   value: 2   },
  { label: '5×',   value: 5   },
  { label: '10×',  value: 10  },
  { label: '50×',  value: 50  },
];

export default function PlaybackBar({ engineRef, onBodyCountChange, role, hostSimTime, camera, canvasRef }) {
  const [running, setRunning] = useState(true);
  const [speed, setSpeedState] = useState(1);
  const [cursor, setCursor] = useState(0);
  const [maxCursor, setMaxCursor] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const rafRef = useRef(null);

  // Poll cursor/maxCursor from HistoryStore on every animation frame
  useEffect(() => {
    const poll = () => {
      if (!isScrubbing) {
        // Observer: show host's sim time instead of local drifting cursor
        const localCursor = getCursor();
        setCursor(role === 'observer' && hostSimTime != null ? hostSimTime : localCursor);
        setMaxCursor(getTotalWritten());
      }
      setRunning(simIsRunning());
      rafRef.current = requestAnimationFrame(poll);
    };
    rafRef.current = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isScrubbing, role, hostSimTime]);

  // ── Play / Pause ──────────────────────────────────────
  const togglePlayPause = useCallback(() => {
    if (simIsRunning()) {
      pauseLoop();
      setRunning(false);
    } else {
      resumeLoop();
      setRunning(true);
    }
  }, []);

  // ── Speed control ─────────────────────────────────────
  const handleSpeedChange = useCallback((val) => {
    const v = Number(val);
    setSpeed(v);
    setSpeedState(v);
  }, []);

  // ── Scrub bar ─────────────────────────────────────────
  const handleScrubStart = useCallback(() => {
    setIsScrubbing(true);
    pauseLoop();
    setRunning(false);
  }, []);

  const handleScrubChange = useCallback((e) => {
    const target = Number(e.target.value);
    setCursor(target);
    const engine = engineRef?.current;
    if (engine) rewindTo(target, engine);
  }, [engineRef]);

  const handleScrubEnd = useCallback(() => {
    setIsScrubbing(false);
    resumeLoop();
    setRunning(true);
  }, []);

  // ── Reset everything ──────────────────────────────────
  const handleReset = useCallback(() => {
    const engine = engineRef?.current;
    if (engine) {
      Matter.Composite.clear(engine.world, false);
      Matter.Engine.clear(engine);
    }
    clearHistory();
    resetTickCounter();
    clearCollisionState();
    clearAllVfx();
    setCursor(0);
    setMaxCursor(0);
    resumeLoop();
    setRunning(true);
    onBodyCountChange?.(0);
  }, [engineRef, onBodyCountChange]);

  // Format frame count as mm:ss
  const formatTime = (frames) => {
    const secs = Math.floor(frames / 60);
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  // The browser maps value→thumb-center over a range inset by thumbRadius on each side.
  // Standard formula: stopPx = pct * (trackW - thumbD) + thumbR
  // In pure CSS we express this as: calc(P% - P% * (14/trackW) + 7px)
  // Since trackW is unknown, the best cross-browser approach is a CSS custom property
  // --fill injected inline, consumed by the ::-webkit-slider-runnable-track rule.
  const pct = maxCursor > 0 ? (cursor / Math.max(maxCursor, 1)) * 100 : 0;
  const fillStyle = { '--fill': `${pct}%` };

  return (
    <div className="playback-bar glass-panel" role="toolbar" aria-label="Simulation playback controls">

      {/* ── Play / Pause ───────────────────────────────── */}
      <button
        id="btn-play-pause"
        className={`pb-btn pb-btn--primary ${running ? 'pb-btn--pause' : 'pb-btn--play'}`}
        onClick={togglePlayPause}
        title={running ? 'Pause (Space)' : 'Play (Space)'}
        aria-label={running ? 'Pause simulation' : 'Resume simulation'}
      >
        {running ? '⏸' : '▶'}
      </button>

      {/* ── Scrub timeline ─────────────────────────────── */}
      <div className="pb-timeline">
        <span className="pb-time">{formatTime(cursor)}</span>
        <div className="pb-scrub-track">
          <input
            id="scrub-bar"
            type="range"
            className="pb-scrub"
            min={0}
            max={Math.max(maxCursor, 1)}
            value={cursor}
            style={fillStyle}
            onMouseDown={handleScrubStart}
            onChange={handleScrubChange}
            onMouseUp={handleScrubEnd}
            onTouchStart={handleScrubStart}
            onTouchEnd={handleScrubEnd}
            aria-label="Simulation timeline"
          />
        </div>
        <span className="pb-time">{formatTime(maxCursor)}</span>
      </div>

      {/* ── Speed selector ─────────────────────────────── */}
      <div className="pb-speed-group">
        <span className="pb-speed-label">Speed</span>
        <div className="pb-speed-btns">
          {SPEED_OPTIONS.map(opt => (
            <button
              key={opt.value}
              id={`btn-speed-${String(opt.value).replace('.', '_')}`}
              className={`pb-speed-btn ${speed === opt.value ? 'pb-speed-btn--active' : ''}`}
              onClick={() => handleSpeedChange(opt.value)}
              title={`Set speed to ${opt.label}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Fit All button ──────────────────────── */}
      <button
        id="btn-fit-all"
        className="pb-btn"
        title="Fit all bodies in view"
        aria-label="Fit all bodies in view"
        onClick={() => {
          const canvas = canvasRef?.current;
          const engine = engineRef?.current;
          if (camera && engine && canvas) fitAll(camera, engine, canvas);
        }}
      >
        🎯
      </button>

      {/* ── Sim state badge ──────────────────────── */}
      <div className={`pb-state-badge ${running ? 'pb-state-badge--running' : 'pb-state-badge--paused'}`}>
        {running ? '● LIVE' : '⏸ PAUSED'}
      </div>

    </div>
  );
}
