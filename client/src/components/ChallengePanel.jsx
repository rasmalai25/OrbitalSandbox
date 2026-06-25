// components/ChallengePanel.jsx
// Phase 7 — shows active challenge status and a victory overlay on success.

import { useEffect } from 'react';
import './ChallengePanel.css';

/**
 * @param {object}   props
 * @param {object}   props.challenge   - CHALLENGES[id] object, or null
 * @param {string}   props.progress    - live progress label string
 * @param {boolean}  props.success     - true = show victory screen
 * @param {function} props.onClose     - dismiss (also called after auto-dismiss)
 */
export default function ChallengePanel({ challenge, progress, success, onClose }) {
  // Auto-dismiss victory screen after 3.5 s
  useEffect(() => {
    if (!success) return;
    const id = setTimeout(onClose, 3500);
    return () => clearTimeout(id);
  }, [success, onClose]);

  if (success) {
    return (
      <div className="victory-overlay" role="status" aria-live="assertive">
        <div className="victory-overlay__emoji">🏆</div>
        <h1 className="victory-overlay__title">Challenge Complete!</h1>
        <p className="victory-overlay__sub">Dismissing in 3 seconds…</p>
      </div>
    );
  }

  if (!challenge) return null;

  return (
    <div className="challenge-panel">
      <div className="challenge-panel__card glass-panel">
        <div className="challenge-panel__header">
          <span className="challenge-panel__title">
            <span>{challenge.emoji}</span>
            {challenge.label}
          </span>
          <button className="challenge-panel__close" onClick={onClose} title="Abandon challenge">✕</button>
        </div>
        <p className="challenge-panel__desc">{challenge.description}</p>
        <p className="challenge-panel__progress">{progress || 'Initialising…'}</p>
      </div>
    </div>
  );
}
