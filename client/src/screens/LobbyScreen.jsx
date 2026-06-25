// screens/LobbyScreen.jsx
// Frontend §3.6 — Animated waiting state. The host (created above) waits
// here for an observer to join; both clients then jump into SIMULATION.
//
// We listen for `partner_joined` (already emitted by server socketHandlers.js
// inside join_room) so both sides advance simultaneously.

import { useEffect, useState } from 'react';
import { useNavStore, SCREENS } from '../store/navStore.js';
import { getSocket } from '../socket/socketClient.js';
import { setScreenAudio, playSfx } from '../audio/AudioManager.js';
import './LobbyScreen.css';

export default function LobbyScreen() {
  const go = useNavStore(s => s.go);
  const [copied, setCopied] = useState(false);
  const roomId = sessionStorage.getItem('orbital_room_id') || '—';
  const role   = sessionStorage.getItem('orbital_room_role') || 'host';

  useEffect(() => { setScreenAudio(SCREENS.LOBBY); }, []);

  useEffect(() => {
    const socket = getSocket();
    const onPartnerJoined = () => {
      playSfx('partner_join');
      go(SCREENS.SIMULATION, { simContext: 'multiplayer' });
    };
    socket.on('partner_joined', onPartnerJoined);
    return () => { socket.off('partner_joined', onPartnerJoined); };
  }, [go]);

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(roomId); setCopied(true); }
    catch { /* clipboard unavailable */ }
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="lobby">
      <h2 className="lobby__title">Waiting for partner…</h2>

      {/* Two orbiting dots: host = filled, partner = ghosted until joined */}
      <div className="lobby__orbit">
        <div className="lobby__dot lobby__dot--host"    title="You" />
        <div className="lobby__dot lobby__dot--partner" title="Partner (not joined)" />
      </div>

      <div className="lobby__code-row">
        <span className="lobby__code-label">Room code</span>
        <code className="lobby__code">{roomId}</code>
        <button className="lobby__copy" onClick={handleCopy}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>

      <p className="lobby__hint">
        You're the <strong>{role}</strong>. Share the code with your partner.
      </p>

      <button
        className="lobby__back"
        onClick={() => {
          sessionStorage.removeItem('orbital_room_id');
          sessionStorage.removeItem('orbital_room_role');
          go(SCREENS.MP_SELECT);
        }}
      >
        ← Back
      </button>
    </div>
  );
}
