// components/BodyInspector.jsx
// Phase 5 — floating tooltip showing speed, distance, orbit state for hovered body.

import { useMemo } from 'react';
import Matter from 'matter-js';
import { classifyOrbit } from '../physics/orbitAnalyzer.js';
import './BodyInspector.css';

const ORBIT_LABELS = {
  stable:   { label: 'Stable orbit',   color: '#00E676' },
  unstable: { label: 'Unstable orbit', color: '#FFD700' },
  escape:   { label: 'Escape traj.',   color: '#FF4466' },
  pinned:   { label: 'Pinned',         color: '#a64dff' },
  free:     { label: 'Free body',      color: '#7878a0' },
};

export default function BodyInspector({ hoveredBody, allBodies, mousePos }) {
  const info = useMemo(() => {
    if (!hoveredBody) return null;
    const b = hoveredBody;
    const speed = Math.sqrt(b.velocity.x ** 2 + b.velocity.y ** 2);

    // Distance to nearest massive body
    let nearestDist = null;
    let nearestName = null;
    let maxMass = 0;
    allBodies.forEach(other => {
      if (other === b) return;
      if (other.mass > maxMass) {
        maxMass = other.mass;
        const dx = b.position.x - other.position.x;
        const dy = b.position.y - other.position.y;
        nearestDist = Math.sqrt(dx * dx + dy * dy);
        nearestName = other.label || 'body';
      }
    });

    const orbit = classifyOrbit(b, allBodies);
    const cd = b.customData || {};

    return {
      type: b.label,
      speed: speed.toFixed(2),
      orbits: cd.fullOrbitsCompleted || 0,
      period: cd.orbitalPeriod ? `${cd.orbitalPeriod} ticks` : '—',
      nearestDist: nearestDist ? nearestDist.toFixed(0) + ' px' : '—',
      orbit,
      mass: b.mass.toFixed(0),
    };
  }, [hoveredBody, allBodies]);

  if (!info || !mousePos) return null;

  const orbitMeta = ORBIT_LABELS[info.orbit] || ORBIT_LABELS.free;

  // Clamp tooltip so it doesn't overflow screen edges
  const tx = Math.min(mousePos.x + 14, window.innerWidth - 200);
  const ty = Math.max(mousePos.y - 10, 8);

  return (
    <div
      className="body-inspector glass-panel"
      style={{ left: tx, top: ty }}
      aria-label="Body inspector tooltip"
    >
      <div className="bi-header">
        <span className="bi-type">{info.type}</span>
        <span className="bi-orbit" style={{ color: orbitMeta.color }}>
          {orbitMeta.label}
        </span>
      </div>
      <div className="bi-rows">
        <div className="bi-row"><span>Speed</span><span>{info.speed} u/t</span></div>
        <div className="bi-row"><span>Mass</span><span>{info.mass}</span></div>
        <div className="bi-row"><span>Dist to attractor</span><span>{info.nearestDist}</span></div>
        <div className="bi-row"><span>Orbits completed</span><span>{info.orbits}</span></div>
        <div className="bi-row"><span>Period</span><span>{info.period}</span></div>
      </div>
    </div>
  );
}
