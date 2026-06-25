// screens/LandingScreen.jsx
// Frontend §3.1 — Drifting star field + logo + ENTER button.
//
// ENTER is the user's first gesture and the only reliable moment to unlock
// the Web Audio context (per §5). The audio manager itself is deferred to the
// audio pass, so for now ENTER just navigates.

import { useEffect } from 'react';
import Logo from '../components/Logo.jsx';
import { useNavStore, SCREENS } from '../store/navStore.js';
import { unlockAudio, setScreenAudio } from '../audio/AudioManager.js';
import './LandingScreen.css';

export default function LandingScreen() {
  const go = useNavStore(s => s.go);

  // If audio was already unlocked on a prior visit (back-nav), restart the bed
  useEffect(() => { setScreenAudio(SCREENS.LANDING); }, []);

  return (
    <div className="landing">
      <div className="landing__stars" aria-hidden="true" />
      <div className="landing__content">
        <div className="landing__logo"><Logo size={180} /></div>
        <h1 className="landing__title">Orbital Sandbox</h1>
        <p  className="landing__tagline">Stars, gravity, collaboration.</p>
        <button
          className="landing__enter"
          onClick={() => {
            // ENTER is the user's first gesture — the only reliable moment to
            // wake the AudioContext. After this point, all subsequent
            // setScreenAudio() / playSfx() calls become audible.
            unlockAudio();
            setScreenAudio(SCREENS.MODE_SELECT);
            go(SCREENS.MODE_SELECT, { transitionKind: 'warp' });
          }}
        >
          ENTER
        </button>
      </div>
    </div>
  );
}
