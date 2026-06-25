// components/PropertyPanel.jsx
// Phase 2 — mass input, velocity slider, and direction dial before placing a body.

import { useState, useRef, useEffect, useCallback } from 'react';
import { BODY_TYPES } from '../constants/bodyTypes.js';
import './PropertyPanel.css';

const TWO_PI = Math.PI * 2;

export default function PropertyPanel({ selectedType, onConfigChange, selectedBody, onRename }) {
  const config = BODY_TYPES[selectedType];

  const [mass, setMass] = useState(config.defaultMass);
  const [speed, setSpeed] = useState(0);
  const [angle, setAngle] = useState(0); // radians, 0 = right

  // ── Rename state (camera doc C5) ──────────────────────
  // Double-clicking the body name flips it into an editable input;
  // Enter or blur commits; Escape cancels.
  const [renaming, setRenaming]   = useState(false);
  const [renameDraft, setRenameDraft] = useState('');

  // Drop edit mode whenever selection changes
  useEffect(() => {
    setRenaming(false);
    setRenameDraft(selectedBody?.name || '');
  }, [selectedBody?.id]);

  const commitRename = useCallback(() => {
    if (renaming && renameDraft.trim() && renameDraft.trim() !== selectedBody?.name) {
      onRename?.(renameDraft.trim());
    }
    setRenaming(false);
  }, [renaming, renameDraft, selectedBody?.name, onRename]);

  // Sync defaults when body type changes
  useEffect(() => {
    setMass(BODY_TYPES[selectedType].defaultMass);
    setSpeed(0);
    setAngle(0);
  }, [selectedType]);

  // Notify parent whenever any value changes
  useEffect(() => {
    onConfigChange({
      mass,
      velocityX: Math.cos(angle) * speed,
      velocityY: Math.sin(angle) * speed,
    });
  }, [mass, speed, angle, onConfigChange]);

  // ── Direction dial ────────────────────────────────────
  const dialRef = useRef(null);
  const dragging = useRef(false);

  const getAngleFromEvent = useCallback((e, dial) => {
    const rect = dial.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return Math.atan2(e.clientY - cy, e.clientX - cx);
  }, []);

  const onDialMouseDown = useCallback((e) => {
    dragging.current = true;
    setAngle(getAngleFromEvent(e, dialRef.current));
    e.preventDefault();
  }, [getAngleFromEvent]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current || !dialRef.current) return;
      setAngle(getAngleFromEvent(e, dialRef.current));
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [getAngleFromEvent]);

  // Arrow tip position inside the 60×60 SVG dial
  const DIAL_R = 24;
  const arrowX = 30 + Math.cos(angle) * DIAL_R;
  const arrowY = 30 + Math.sin(angle) * DIAL_R;

  const maxSpeed = selectedType === 'STAR' ? 3 : selectedType === 'BLACK_HOLE' ? 0 : 8;
  const isStaticType = BODY_TYPES[selectedType].isStatic;

  return (
    <aside className="property-panel glass-panel" aria-label="Body properties">
      <div className="pp-title">Properties</div>

      {/* Selected body — rename (camera doc C5). Double-click name to edit;
          Enter/blur commits, Escape cancels. Hidden when nothing is selected. */}
      {selectedBody && (
        <div className="pp-selected" style={{ marginBottom: 10 }}>
          <div className="pp-label" style={{ marginBottom: 4 }}>Selected</div>
          {renaming ? (
            <input
              autoFocus
              className="pp-input"
              value={renameDraft}
              maxLength={32}
              onChange={e => setRenameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter')  { e.preventDefault(); commitRename(); }
                if (e.key === 'Escape') { setRenaming(false); }
              }}
            />
          ) : (
            <div
              className="pp-type-badge"
              style={{ borderColor: BODY_TYPES[selectedBody.type]?.color || '#888', cursor: 'text' }}
              title="Double-click to rename"
              onDoubleClick={() => {
                setRenameDraft(selectedBody.name || '');
                setRenaming(true);
              }}
            >
              <span>{BODY_TYPES[selectedBody.type]?.emoji || '◯'}</span>
              <span>{selectedBody.name || '(unnamed)'}</span>
            </div>
          )}
        </div>
      )}

      {/* Type indicator */}
      <div className="pp-type-badge" style={{ borderColor: config.color }}>
        <span>{config.emoji}</span>
        <span>{config.label}</span>
      </div>

      {/* Mass */}
      <div className="pp-field">
        <label className="pp-label" htmlFor="pp-mass">Mass</label>
        <input
          id="pp-mass"
          type="number"
          className="pp-input"
          value={mass}
          min={1}
          max={1000000}
          step={config.defaultMass > 1000 ? 1000 : 10}
          onChange={e => setMass(Math.max(1, Number(e.target.value)))}
        />
        <button
          className="pp-reset-btn"
          onClick={() => setMass(config.defaultMass)}
          title="Reset to default"
        >↺</button>
      </div>

      {/* Velocity + direction — hidden for static bodies (black holes) */}
      {!isStaticType && (
        <>
          <div className="pp-field pp-field--col">
            <div className="pp-field-row">
              <label className="pp-label" htmlFor="pp-speed">Speed</label>
              <span className="pp-speed-val">{speed.toFixed(1)}</span>
            </div>
            <input
              id="pp-speed"
              type="range"
              className="pp-slider"
              min={0}
              max={maxSpeed}
              step={0.1}
              value={speed}
              style={{ '--fill': `${(speed / maxSpeed) * 100}%` }}
              onChange={e => setSpeed(Number(e.target.value))}
            />
          </div>

          <div className="pp-field pp-field--col">
            <label className="pp-label">Direction</label>
            <div
              ref={dialRef}
              className="pp-dial"
              onMouseDown={onDialMouseDown}
              title="Drag to set launch direction"
              role="slider"
              aria-label="Launch direction dial"
              aria-valuenow={Math.round((angle * 180) / Math.PI)}
            >
              <svg width="60" height="60" viewBox="0 0 60 60">
                {/* Dial ring */}
                <circle cx="30" cy="30" r="26" fill="rgba(122,0,255,0.08)" stroke="rgba(122,0,255,0.3)" strokeWidth="1.5" />
                {/* Center dot */}
                <circle cx="30" cy="30" r="3" fill="var(--color-accent-soft)" />
                {/* Direction arrow */}
                <line
                  x1="30" y1="30"
                  x2={arrowX} y2={arrowY}
                  stroke="var(--color-accent-soft)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                {/* Arrowhead */}
                <circle cx={arrowX} cy={arrowY} r="3.5" fill="var(--color-accent-soft)" />
              </svg>
            </div>
            <span className="pp-angle-val">{Math.round(((angle * 180) / Math.PI + 360) % 360)}°</span>
          </div>
        </>
      )}

      {isStaticType && (
        <p className="pp-static-note">Black holes are pinned — they don't move.</p>
      )}

      {/* Computed velocity preview */}
      {!isStaticType && speed > 0 && (
        <div className="pp-velocity-preview">
          <span>vx {(Math.cos(angle) * speed).toFixed(2)}</span>
          <span>vy {(Math.sin(angle) * speed).toFixed(2)}</span>
        </div>
      )}
    </aside>
  );
}
