// components/App.jsx
// Frontend §1.2 — Screen router. App was previously the simulation host;
// the canvas + every in-sim UI has moved into screens/SimulationScreen.jsx
// and lives behind the navStore's screen state machine.
//
// Deep-link entry (?session=<id>) boots straight into SIMULATION so a shared
// link still opens the loaded sandbox without forcing the user through the
// landing → mode flow.

import { useEffect } from 'react';
import { useNavStore, SCREENS } from '../store/navStore.js';
import { useAuthStore } from '../store/authStore.js';
import ScreenTransition from './ScreenTransition.jsx';
import LandingScreen           from '../screens/LandingScreen.jsx';
import ModeSelectScreen        from '../screens/ModeSelectScreen.jsx';
import SoloSelectScreen        from '../screens/SoloSelectScreen.jsx';
import MultiplayerSelectScreen from '../screens/MultiplayerSelectScreen.jsx';
import LobbyScreen             from '../screens/LobbyScreen.jsx';
import SimulationScreen        from '../screens/SimulationScreen.jsx';
import './App.css';

const SCREEN_COMPONENTS = {
  [SCREENS.LANDING]:     LandingScreen,
  [SCREENS.MODE_SELECT]: ModeSelectScreen,
  [SCREENS.SOLO_SELECT]: SoloSelectScreen,
  [SCREENS.MP_SELECT]:   MultiplayerSelectScreen,
  [SCREENS.LOBBY]:       LobbyScreen,
  [SCREENS.SIMULATION]:  SimulationScreen,
};

export default function App() {
  const screen   = useNavStore(s => s.screen);
  const bootInto = useNavStore(s => s.bootInto);
  const authInit = useAuthStore(s => s.init);

  // Deep-link: a share URL (?session=…) must drop straight into SIMULATION;
  // SimulationScreen's tryRestoreSession effect picks up the param. We only
  // run this once on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('session')) {
      bootInto(SCREENS.SIMULATION, 'sandbox');
    }
  }, [bootInto]);

  // Wire Supabase auth — no-op when env vars are missing.
  useEffect(() => {
    const unsub = authInit();
    return unsub;
  }, [authInit]);

  const Current = SCREEN_COMPONENTS[screen] || LandingScreen;

  return (
    <div className="app-shell">
      <ScreenTransition>
        <Current key={screen} />
      </ScreenTransition>
    </div>
  );
}
