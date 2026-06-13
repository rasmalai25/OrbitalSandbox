// components/PresetMenu.jsx
// Phase 7 — floating panel listing preset configurations and challenge scenarios.

import { PRESETS } from '../constants/presets.js';
import { CHALLENGES } from '../simulation/challengeEngine.js';
import './PresetMenu.css';

/**
 * @param {object}   props
 * @param {function} props.onLoadPreset    - (preset) => void
 * @param {function} props.onStartChallenge - (challengeId) => void
 * @param {function} props.onClose
 */
export default function PresetMenu({ onLoadPreset, onStartChallenge, onClose }) {
  return (
    <>
      {/* Transparent backdrop — click anywhere outside to close */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 79 }}
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="preset-menu" role="dialog" aria-label="Preset and challenge menu">

        <div className="preset-menu__header">
          <span>Presets &amp; Challenges</span>
          <button className="preset-menu__close" onClick={onClose} title="Close (P)">✕</button>
        </div>

        {PRESETS.map(preset => (
          <button
            key={preset.id}
            className="preset-card"
            id={`preset-${preset.id}`}
            onClick={() => { onLoadPreset(preset); onClose(); }}
            title={preset.description}
          >
            <div className="preset-card__top">
              <span className="preset-card__emoji">{preset.emoji}</span>
              <span className="preset-card__label">{preset.label}</span>
            </div>
            <p className="preset-card__desc">{preset.description}</p>
          </button>
        ))}

        <div className="preset-menu__divider" />
        <span className="preset-menu__section-label">⚔️ Challenges</span>

        {Object.values(CHALLENGES).map(ch => (
          <button
            key={ch.id}
            className="preset-card preset-card--challenge"
            id={`challenge-${ch.id}`}
            onClick={() => { onStartChallenge(ch.id); onClose(); }}
            title={ch.description}
          >
            <div className="preset-card__top">
              <span className="preset-card__emoji">{ch.emoji}</span>
              <span className="preset-card__label">{ch.label}</span>
            </div>
            <p className="preset-card__desc">{ch.description}</p>
          </button>
        ))}

      </div>
    </>
  );
}
