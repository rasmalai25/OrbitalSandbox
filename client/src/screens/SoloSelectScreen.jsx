// screens/SoloSelectScreen.jsx
// Frontend §3.4 — Sandbox vs Challenges. Both land in SIMULATION; only the
// simContext differs. SimulationScreen reads simContext to decide whether to
// auto-open the challenge picker.

import { useEffect } from 'react';
import { useNavStore, SCREENS } from '../store/navStore.js';
import { setScreenAudio } from '../audio/AudioManager.js';
import './SelectScreens.css';

export default function SoloSelectScreen() {
  const go = useNavStore(s => s.go);
  useEffect(() => { setScreenAudio(SCREENS.SOLO_SELECT); }, []);

  return (
    <div className="select-screen">
      <h2 className="select-screen__title">Solo</h2>

      <div className="select-screen__cards">
        <button
          className="select-card"
          onClick={() => go(SCREENS.SIMULATION, {
            simContext: 'sandbox',
            transitionKind: 'card-expand',
          })}
        >
          <div className="select-card__emoji">🌌</div>
          <div className="select-card__title">Sandbox</div>
          <div className="select-card__sub">Empty canvas, place anything</div>
        </button>

        <button
          className="select-card"
          onClick={() => go(SCREENS.SIMULATION, {
            simContext: 'challenges',
            transitionKind: 'card-expand',
          })}
        >
          <div className="select-card__emoji">🎯</div>
          <div className="select-card__title">Challenges</div>
          <div className="select-card__sub">Goal-driven scenarios</div>
        </button>
      </div>

      <button
        className="select-screen__back"
        onClick={() => go(SCREENS.MODE_SELECT)}
      >
        ← Back
      </button>
    </div>
  );
}
