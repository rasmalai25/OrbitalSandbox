// screens/ModeSelectScreen.jsx
// Frontend §3.3 — Solo vs Multiplayer.

import { useEffect } from 'react';
import Logo from '../components/Logo.jsx';
import { useNavStore, SCREENS } from '../store/navStore.js';
import { setScreenAudio } from '../audio/AudioManager.js';
import './SelectScreens.css';

export default function ModeSelectScreen() {
  const go = useNavStore(s => s.go);
  useEffect(() => { setScreenAudio(SCREENS.MODE_SELECT); }, []);

  return (
    <div className="select-screen">
      <div className="select-screen__header">
        <Logo size={56} />
        <h2 className="select-screen__title">Choose a mode</h2>
      </div>

      <div className="select-screen__cards">
        <button
          className="select-card"
          onClick={() => go(SCREENS.SOLO_SELECT, { transitionKind: 'card-expand' })}
        >
          <div className="select-card__emoji">🧪</div>
          <div className="select-card__title">Solo</div>
          <div className="select-card__sub">Sandbox or Challenges</div>
        </button>

        <button
          className="select-card"
          onClick={() => go(SCREENS.MP_SELECT, { transitionKind: 'card-expand' })}
        >
          <div className="select-card__emoji">🤝</div>
          <div className="select-card__title">Multiplayer</div>
          <div className="select-card__sub">Create or join a room</div>
        </button>
      </div>

      <button
        className="select-screen__back"
        onClick={() => go(SCREENS.LANDING)}
      >
        ← Back
      </button>
    </div>
  );
}
