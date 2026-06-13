// components/Toolbar.jsx
// Phase 2 — body type selector strip on the left side of the screen.

import './Toolbar.css';
import { BODY_TYPES, BODY_TYPE_KEYS } from '../constants/bodyTypes.js';

export default function Toolbar({ selectedType, onSelectType }) {
  return (
    <aside className="toolbar glass-panel" role="toolbar" aria-label="Body type selector">
      <div className="toolbar-title">Place</div>

      {BODY_TYPE_KEYS.map(key => {
        const cfg = BODY_TYPES[key];
        const isSelected = selectedType === key;
        return (
          <button
            key={key}
            id={`toolbar-btn-${key.toLowerCase()}`}
            className={`toolbar-btn ${isSelected ? 'toolbar-btn--active' : ''}`}
            onClick={() => onSelectType(key)}
            title={cfg.description}
            aria-pressed={isSelected}
          >
            <span className="toolbar-emoji">{cfg.emoji}</span>
            <span className="toolbar-label">{cfg.label}</span>
            {isSelected && <span className="toolbar-active-dot" />}
          </button>
        );
      })}

      <div className="toolbar-divider" />
      <div className="toolbar-shortcut-hint">Click canvas to place</div>
    </aside>
  );
}
