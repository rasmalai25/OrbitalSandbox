// store/navStore.js
// Frontend §1.1 — Screen state machine.
// The legal transition map FLOW is the single source of truth for "where can
// I go from here?" — `go()` warns and refuses any move not declared here.

import { create } from 'zustand';

export const SCREENS = {
  LANDING:     'LANDING',
  MODE_SELECT: 'MODE_SELECT',
  SOLO_SELECT: 'SOLO_SELECT',
  MP_SELECT:   'MP_SELECT',
  LOBBY:       'LOBBY',
  SIMULATION:  'SIMULATION',
};

// Allowed forward/back transitions per screen.
const FLOW = {
  LANDING:     ['MODE_SELECT'],
  MODE_SELECT: ['SOLO_SELECT', 'MP_SELECT', 'LANDING'],
  SOLO_SELECT: ['SIMULATION', 'MODE_SELECT'],
  MP_SELECT:   ['LOBBY', 'SIMULATION', 'MODE_SELECT'],
  LOBBY:       ['SIMULATION', 'MP_SELECT'],
  SIMULATION:  ['MODE_SELECT'],
};

export const useNavStore = create((set, get) => ({
  screen: SCREENS.LANDING,
  simContext: null,            // 'sandbox' | 'challenges' | 'multiplayer'
  transitioning: false,
  transitionKind: 'fade',      // 'warp' | 'card-expand' | 'fade'
  pendingNext: null,
  pendingSimContext: null,

  // Begin a transition: starts the exit animation. ScreenTransition's
  // onAnimationEnd calls commit() when that animation completes.
  go(next, opts = {}) {
    const current = get().screen;
    if (!FLOW[current]?.includes(next)) {
      console.warn(`[navStore] Illegal screen transition ${current} → ${next}`);
      return;
    }
    set({
      transitioning: true,
      transitionKind: opts.transitionKind ?? 'fade',
      pendingNext: next,
      pendingSimContext: opts.simContext ?? null,
    });
  },

  // Commit the pending screen swap. Called by ScreenTransition once the
  // exit animation finishes (so the layer fade-out is visible).
  commit() {
    const { pendingNext, pendingSimContext, simContext } = get();
    if (!pendingNext) return;
    set({
      screen: pendingNext,
      simContext: pendingSimContext ?? simContext,
      transitioning: false,
      pendingNext: null,
      pendingSimContext: null,
    });
  },

  // Deep-link entry — set the screen directly without walking the flow.
  // Used at startup for /session/:shareId and /room/:roomId style entries.
  bootInto(screen, simContext = null) {
    set({
      screen,
      simContext,
      transitioning: false,
      pendingNext: null,
      pendingSimContext: null,
    });
  },
}));
