// components/CameraModePill.jsx
// Camera & Body Interaction System — pill button showing & cycling camera mode.

import { cycleCameraMode } from '../canvas/camera.js';
import { getCamera, getSelectedBodyId } from '../simulation/SimulationLoop.js';
import './CameraModePill.css';

const MODE_LABELS = {
  COM:     '⊕ Center of Mass',
  LARGEST: '★ Largest Body',
  FOLLOW:  '◎ Following',
  FREE:    '✥ Free Camera',
};

const MODE_KEYS = ['COM', 'LARGEST', 'FOLLOW', 'FREE'];

/**
 * @param {{ mode: string, followName: string|null, onCycle: function }} props
 *   mode        — current camera.mode string (updated by parent via rAF poll)
 *   followName  — name of the followed body when mode === 'FOLLOW'
 *   onCycle     — called after mode changes so parent can re-render
 */
export default function CameraModePill({ mode, followName, onCycle }) {
  const label = mode === 'FOLLOW' && followName
    ? `◎ ${followName}`
    : (MODE_LABELS[mode] ?? mode);

  function handleClick() {
    const camera         = getCamera();
    const selectedBodyId = getSelectedBodyId();
    cycleCameraMode(camera, selectedBodyId);
    onCycle();
  }

  return (
    <button
      id="camera-mode-pill"
      className={`camera-mode-pill camera-mode-pill--${(mode || 'COM').toLowerCase()}`}
      onClick={handleClick}
      title="Click to cycle camera mode"
      aria-label={`Camera mode: ${label}. Click to change.`}
    >
      {label}
    </button>
  );
}
