// components/ShareModal.jsx
// Phase 7 — save/share session state via localStorage + URL param.
// Full cross-device sharing via PostgreSQL is wired in Phase 9.

import { useState, useEffect, useRef } from 'react';
import './ShareModal.css';

const LS_PREFIX = 'orbital_session_';

/**
 * Serialise current bodies into a storable plain-object array.
 * Strips Matter.js internals — keeps only what bodyFactory.createBody() needs.
 */
function serialiseBodies(matterBodies) {
  return matterBodies.map(b => ({
    type:      b.label || 'PLANET',
    x:         Math.round(b.position.x),
    y:         Math.round(b.position.y),
    mass:      b.mass,
    velocityX: parseFloat(b.velocity.x.toFixed(4)),
    velocityY: parseFloat(b.velocity.y.toFixed(4)),
    ownerId:   b.customData?.ownerId || 'local',
  }));
}

/** Generate a short alphanumeric share ID. */
function makeShareId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * @param {object}   props
 * @param {boolean}  props.visible
 * @param {function} props.onClose
 * @param {Array}    props.bodies      - live Matter.js bodies array
 * @param {function} props.onLoad      - (bodyConfigs) => void — restore a session
 */
export default function ShareModal({ visible, onClose, bodies, onLoad }) {
  const [shareUrl,   setShareUrl]   = useState('');
  const [copied,     setCopied]     = useState(false);
  const [loadInput,  setLoadInput]  = useState('');
  const [loadError,  setLoadError]  = useState('');
  const urlInputRef = useRef(null);

  // Build share URL whenever the modal opens
  useEffect(() => {
    if (!visible) return;
    const serialised = serialiseBodies(bodies);
    const shareId    = makeShareId();
    try {
      localStorage.setItem(LS_PREFIX + shareId, JSON.stringify(serialised));
    } catch {
      // localStorage full or unavailable — graceful degradation
    }
    const url = `${window.location.origin}${window.location.pathname}?session=${shareId}`;
    setShareUrl(url);
    setCopied(false);
    setLoadInput('');
    setLoadError('');
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      urlInputRef.current?.select();
    }
  };

  const handleLoad = () => {
    setLoadError('');
    const raw = loadInput.trim();
    // Accept full URL or just the shareId
    const id = raw.includes('?session=') ? raw.split('?session=')[1].split('&')[0] : raw;
    const stored = localStorage.getItem(LS_PREFIX + id);
    if (!stored) {
      setLoadError('Session not found in this browser. Share links only work on the same device until Phase 9 (database).');
      return;
    }
    try {
      const configs = JSON.parse(stored);
      onLoad(configs);
      onClose();
    } catch {
      setLoadError('Failed to parse session data.');
    }
  };

  const bodyCount = bodies.length;
  const typeCount = new Set(bodies.map(b => b.label)).size;

  return (
    <div className="share-modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="share-modal" role="dialog" aria-modal="true" aria-label="Save and share session">

        <div className="share-modal__header">
          <h2 className="share-modal__title">💾 Save &amp; Share</h2>
          <button className="share-modal__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="share-modal__body">

          {/* Session stats */}
          <div className="share-modal__stats">
            <div className="share-modal__stat">
              <div className="share-modal__stat-value">{bodyCount}</div>
              <div className="share-modal__stat-label">Bodies</div>
            </div>
            <div className="share-modal__stat">
              <div className="share-modal__stat-value">{typeCount}</div>
              <div className="share-modal__stat-label">Types</div>
            </div>
          </div>

          {/* Share URL */}
          <div>
            <p className="share-modal__section-label">Share link</p>
            <div className="share-modal__url-row">
              <input
                ref={urlInputRef}
                id="share-url-input"
                className="share-modal__url-input"
                readOnly
                value={shareUrl}
                onClick={e => e.target.select()}
              />
              <button
                id="btn-copy-share"
                className={`share-modal__copy-btn${copied ? ' share-modal__copy-btn--copied' : ''}`}
                onClick={handleCopy}
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <p className="share-modal__note">
              ⚠️ This link works only on the same browser/device until Phase 9 (PostgreSQL) is implemented.
            </p>
          </div>

          <div className="share-modal__divider" />

          {/* Load session */}
          <div>
            <p className="share-modal__section-label">Load a session</p>
            <div className="share-modal__load-row">
              <input
                id="load-session-input"
                className="share-modal__load-input"
                placeholder="Paste a share link or session ID…"
                value={loadInput}
                onChange={e => setLoadInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLoad()}
              />
              <button
                id="btn-load-session"
                className="share-modal__load-btn"
                onClick={handleLoad}
              >
                Load
              </button>
            </div>
            {loadError && (
              <p className="share-modal__note" style={{ color: 'var(--color-red)', marginTop: 8 }}>
                {loadError}
              </p>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

/** Called on app mount — reads ?session= URL param and returns body configs if present. */
export function tryRestoreSession() {
  const params = new URLSearchParams(window.location.search);
  const id     = params.get('session');
  if (!id) return null;
  try {
    const stored = localStorage.getItem(LS_PREFIX + id);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}
