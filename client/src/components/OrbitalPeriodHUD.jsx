// components/OrbitalPeriodHUD.jsx
// Phase 5 — shows orbit count badges for bodies that have completed full orbits.

import './OrbitalPeriodHUD.css';

export default function OrbitalPeriodHUD({ bodies, visible }) {
  if (!visible) return null;

  const orbiting = bodies.filter(
    b => !b.isStatic && (b.customData?.fullOrbitsCompleted || 0) > 0
  );

  if (orbiting.length === 0) return null;

  return (
    <div className="orbital-hud" aria-label="Orbital period tracker">
      <div className="oh-title">Orbits</div>
      {orbiting.map(b => (
        <div key={b.customData.id} className="oh-row">
          <span className="oh-type">{b.label}</span>
          <span className="oh-count">{b.customData.fullOrbitsCompleted}×</span>
          {b.customData.orbitalPeriod && (
            <span className="oh-period">{b.customData.orbitalPeriod}t</span>
          )}
        </div>
      ))}
    </div>
  );
}
