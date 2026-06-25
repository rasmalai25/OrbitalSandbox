// components/ScreenTransition.jsx
// Frontend §4 — Plays the exit animation, commits the screen swap on
// animationend, then plays the new screen's enter animation.
//
// Spine pass: fade only. warp / card-expand keyframes can be added later in
// the visual-polish pass — extra transitionKind values will inherit the same
// onAnimationEnd commit hook.

import { useNavStore } from '../store/navStore.js';
import './ScreenTransition.css';

export default function ScreenTransition({ children }) {
  const transitioning  = useNavStore(s => s.transitioning);
  const transitionKind = useNavStore(s => s.transitionKind);
  const commit         = useNavStore(s => s.commit);

  const className = transitioning
    ? `screen-layer exit-${transitionKind}`
    : `screen-layer enter-${transitionKind}`;

  return (
    <div
      className={className}
      onAnimationEnd={(e) => {
        // Only react to OUR animation, not child anims that bubble up.
        if (e.target !== e.currentTarget) return;
        if (transitioning && e.animationName.startsWith('exit')) commit();
      }}
    >
      {children}
    </div>
  );
}
