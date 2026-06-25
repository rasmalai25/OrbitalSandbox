// components/ShareModal.jsx
// Phase 7 — save/share session state via localStorage + URL param.
// Phase 9 — cross-device sharing via POST/GET /api/session. localStorage is
//           the offline / DB-unavailable fallback so the feature still works
//           when the server has no DATABASE_URL.

import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../store/authStore.js';
import { signInWithGoogle, signOut, isAuthConfigured } from '../auth/supabaseClient.js';
import './ShareModal.css';

const LS_PREFIX = 'orbital_session_';

/**
 * Serialise current bodies into a storable plain-object array.
 * Strips Matter.js internals; preserves the customData.name so a reloaded
 * session keeps the names players chose (camera doc §6.4 correction).
 */
function serialiseBodies(matterBodies) {
  return matterBodies.map(b => ({
    type:      b.label || 'PLANET',
    name:      b.customData?.name,
    x:         Math.round(b.position.x),
    y:         Math.round(b.position.y),
    mass:      b.mass,
    velocityX: parseFloat(b.velocity.x.toFixed(4)),
    velocityY: parseFloat(b.velocity.y.toFixed(4)),
    ownerId:   b.customData?.ownerId || 'local',
  }));
}

/** Generate a short alphanumeric share ID (used as a fallback when REST save fails). */
function makeLocalShareId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Try to persist a session via the server. Returns the server-assigned
 * shareId on success, or null on failure (e.g. DATABASE_URL not set).
 */
async function persistRemote(bodies, userId = null) {
  try {
    const res = await fetch('/api/session', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        state:  { bodies, savedAt: Date.now() },
        userId,                       // server stores in sessions.user_id when present
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.shareId || null;
  } catch {
    return null;
  }
}

/**
 * Try to load a session by shareId from the server. Returns the bodies
 * array on success, null otherwise.
 */
async function loadRemote(shareId) {
  try {
    const res = await fetch(`/api/session/${encodeURIComponent(shareId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.state?.bodies || null;
  } catch {
    return null;
  }
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
  const [saveMode,   setSaveMode]   = useState(null); // 'remote' | 'local' | null
  const [saving,     setSaving]     = useState(false);
  const urlInputRef = useRef(null);

  const user = useAuthStore(s => s.user);

  // Build share URL whenever the modal opens. Try the server first; on failure
  // fall back to a local-only share that still works in the same browser.
  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    setShareUrl('');
    setCopied(false);
    setLoadInput('');
    setLoadError('');
    setSaveMode(null);
    setSaving(true);

    const serialised = serialiseBodies(bodies);

    (async () => {
      const remoteId = await persistRemote(serialised, user?.id || null);
      if (cancelled) return;
      let id;
      let mode;
      if (remoteId) {
        id   = remoteId;
        mode = 'remote';
      } else {
        id   = makeLocalShareId();
        mode = 'local';
        try { localStorage.setItem(LS_PREFIX + id, JSON.stringify(serialised)); }
        catch { /* localStorage unavailable */ }
      }
      const url = `${window.location.origin}${window.location.pathname}?session=${id}`;
      setShareUrl(url);
      setSaveMode(mode);
      setSaving(false);
    })();

    return () => { cancelled = true; };
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

  const handleLoad = async () => {
    setLoadError('');
    const raw = loadInput.trim();
    if (!raw) return;
    // Accept full URL or just the shareId
    const id = raw.includes('?session=') ? raw.split('?session=')[1].split('&')[0] : raw;

    // Try remote first (works across devices), then local fallback
    let configs = await loadRemote(id);
    if (!configs) {
      const stored = localStorage.getItem(LS_PREFIX + id);
      if (stored) {
        try { configs = JSON.parse(stored); }
        catch { configs = null; }
      }
    }
    if (!configs) {
      setLoadError('Session not found. The link may have expired or the server may be unreachable.');
      return;
    }
    onLoad(configs);
    onClose();
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

          {/* Auth — only renders when Supabase is configured (env vars present).
              Sessions saved while signed in are tagged with user_id so the
              user can list / re-load them later. */}
          {isAuthConfigured && (
            <div className="share-modal__auth" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#9c8fc7' }}>
              {user ? (
                <>
                  <span>Signed in as <strong style={{ color: '#fff' }}>{user.email}</strong></span>
                  <button
                    onClick={signOut}
                    style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid rgba(255,255,255,0.18)', color: '#fff', padding: '4px 12px', borderRadius: 8, cursor: 'pointer' }}
                  >Sign out</button>
                </>
              ) : (
                <>
                  <span>Sign in to save sessions to your account.</span>
                  <button
                    onClick={signInWithGoogle}
                    style={{ marginLeft: 'auto', background: 'rgba(122,0,255,0.25)', border: '1px solid rgba(181,145,255,0.5)', color: '#fff', padding: '4px 12px', borderRadius: 8, cursor: 'pointer' }}
                  >Sign in with Google</button>
                </>
              )}
            </div>
          )}

          {/* Share URL */}
          <div>
            <p className="share-modal__section-label">Share link</p>
            <div className="share-modal__url-row">
              <input
                ref={urlInputRef}
                id="share-url-input"
                className="share-modal__url-input"
                readOnly
                value={saving ? 'Saving…' : shareUrl}
                onClick={e => e.target.select()}
              />
              <button
                id="btn-copy-share"
                className={`share-modal__copy-btn${copied ? ' share-modal__copy-btn--copied' : ''}`}
                onClick={handleCopy}
                disabled={saving || !shareUrl}
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <p className="share-modal__note">
              {saveMode === 'remote' && '✓ Saved to the server — this link works on any device.'}
              {saveMode === 'local'  && '⚠️ Saved locally — link only works in this browser (server DB unavailable).'}
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

/**
 * Called on app mount — reads ?session= URL param and returns body configs if present.
 * Async because it may need to fetch from the server (Phase 9). Falls back to
 * localStorage when the server is unreachable.
 */
export async function tryRestoreSession() {
  const params = new URLSearchParams(window.location.search);
  const id     = params.get('session');
  if (!id) return null;

  // Try server first
  try {
    const res = await fetch(`/api/session/${encodeURIComponent(id)}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.state?.bodies) return data.state.bodies;
    }
  } catch { /* fall through */ }

  // Local fallback
  try {
    const stored = localStorage.getItem(LS_PREFIX + id);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}
