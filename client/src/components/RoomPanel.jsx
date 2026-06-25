// components/RoomPanel.jsx
// Phase 4 — create / join room UI + partner status indicator.

import { useState } from 'react';
import './RoomPanel.css';

export default function RoomPanel({ roomId, role, partnerOnline, onCreateRoom, onJoinRoom, onClose }) {
  const [joinInput, setJoinInput] = useState('');
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Already in a room
  if (roomId) {
    return (
      <div className="room-panel glass-panel" aria-label="Room info">
        <div className="rp-header">
          <span className="rp-title">Room</span>
          <span className={`rp-role-badge rp-role-badge--${role}`}>{role}</span>
          <button className="rp-close-btn" onClick={onClose} title="Close panel" aria-label="Close room panel">✕</button>
        </div>

        <div className="rp-id-row">
          <code className="rp-id">{roomId}</code>
          <button className="rp-copy-btn" onClick={handleCopy} title="Copy room ID">
            {copied ? '✓' : '⎘'}
          </button>
        </div>

        <div className={`rp-partner-status ${partnerOnline ? 'rp-partner--online' : 'rp-partner--offline'}`}>
          <span className="rp-partner-dot" />
          <span>{partnerOnline ? 'Partner online' : 'Waiting for partner…'}</span>
        </div>

        {role === 'host' && !partnerOnline && (
          <p className="rp-hint">Share the room ID above to invite someone</p>
        )}
        {role === 'observer' && (
          <p className="rp-hint">You're observing — host controls the sim</p>
        )}
      </div>
    );
  }

  // Not in a room yet
  return (
    <div className="room-panel glass-panel" aria-label="Create or join a room">
      <div className="rp-header">
        <span className="rp-title">Collaborate</span>
        <button className="rp-close-btn" onClick={onClose} title="Close panel" aria-label="Close room panel">✕</button>
      </div>

      <button id="btn-create-room" className="rp-btn rp-btn--primary" onClick={onCreateRoom}>
        ＋ Create Room
      </button>

      <div className="rp-divider">or join</div>

      <div className="rp-join-row">
        <input
          id="input-room-id"
          className="rp-input"
          placeholder="Room ID…"
          value={joinInput}
          onChange={e => setJoinInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && joinInput && onJoinRoom(joinInput.trim())}
        />
        <button
          id="btn-join-room"
          className="rp-btn rp-btn--secondary"
          disabled={!joinInput.trim()}
          onClick={() => onJoinRoom(joinInput.trim())}
        >
          Join
        </button>
      </div>
    </div>
  );
}
