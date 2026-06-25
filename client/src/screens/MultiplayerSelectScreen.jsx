// screens/MultiplayerSelectScreen.jsx
// Frontend §3.5 — Create or join a room.
//
// Spine pass: leverages the existing useRoom hook for create/join. The socket
// is currently auto-connected at module-load via socketClient.js — moving that
// to "on demand here" is a separate optimisation pass (see frontend.md §3.5).

import { useState, useEffect } from 'react';
import { useNavStore, SCREENS } from '../store/navStore.js';
import { getSocket } from '../socket/socketClient.js';
import { setScreenAudio } from '../audio/AudioManager.js';
import './SelectScreens.css';

export default function MultiplayerSelectScreen() {
  const go = useNavStore(s => s.go);
  useEffect(() => { setScreenAudio(SCREENS.MP_SELECT); }, []);
  const [mode, setMode]   = useState(null); // null | 'join'
  const [code, setCode]   = useState('');
  const [error, setError] = useState('');
  const [busy,  setBusy]  = useState(false);

  const handleCreate = () => {
    setError(''); setBusy(true);
    const socket = getSocket();
    socket.emit('create_room', ({ roomId, role }) => {
      setBusy(false);
      if (!roomId) { setError('Could not create room'); return; }
      // Store the room id so LobbyScreen can show it. Use sessionStorage
      // for a single-tab handoff — App-level useRoom will adopt it.
      sessionStorage.setItem('orbital_room_id', roomId);
      sessionStorage.setItem('orbital_room_role', role || 'host');
      go(SCREENS.LOBBY);
    });
  };

  const handleJoin = () => {
    setError(''); setBusy(true);
    const trimmed = code.trim();
    if (!trimmed) { setError('Enter a room code'); setBusy(false); return; }
    const socket = getSocket();
    socket.emit('join_room', { roomId: trimmed }, (result) => {
      setBusy(false);
      if (result?.error) { setError(result.error); return; }
      sessionStorage.setItem('orbital_room_id', trimmed);
      sessionStorage.setItem('orbital_room_role', result.role || 'observer');
      // Stash the host's existing bodies / chat history so SimulationScreen
      // can replay them when it mounts (it owns the engine ref).
      if (result.initialState) {
        try {
          sessionStorage.setItem(
            'orbital_room_initial_state',
            JSON.stringify(result.initialState),
          );
        } catch { /* quota — fall through, world will sync via sim_tick anyway */ }
      }
      // Observer always goes straight to simulation — the lobby is just the
      // host's waiting room. Server emits partner_joined to the host so they
      // exit lobby too. Going to lobby here would race the listener-register
      // against the partner_joined event that's already in flight.
      go(SCREENS.SIMULATION, { simContext: 'multiplayer' });
    });
  };

  return (
    <div className="select-screen">
      <h2 className="select-screen__title">Multiplayer</h2>

      <div className="select-screen__cards">
        <button
          className="select-card"
          onClick={handleCreate}
          disabled={busy}
        >
          <div className="select-card__emoji">➕</div>
          <div className="select-card__title">Create Room</div>
          <div className="select-card__sub">You'll be the host</div>
        </button>

        <button
          className="select-card"
          onClick={() => setMode('join')}
          disabled={busy}
        >
          <div className="select-card__emoji">🔑</div>
          <div className="select-card__title">Join Room</div>
          <div className="select-card__sub">Enter a code</div>
        </button>
      </div>

      {mode === 'join' && (
        <div className="select-screen__join">
          <input
            className="select-screen__code-input"
            placeholder="Room code"
            value={code}
            maxLength={20}
            onChange={e => setCode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleJoin()}
            autoFocus
          />
          <button
            className="select-screen__cta"
            onClick={handleJoin}
            disabled={busy}
          >
            {busy ? '…' : 'Join'}
          </button>
        </div>
      )}

      {error && <p className="select-screen__error">{error}</p>}

      <button
        className="select-screen__back"
        onClick={() => go(SCREENS.MODE_SELECT)}
      >
        ← Back
      </button>
    </div>
  );
}
