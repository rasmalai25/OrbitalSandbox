// sound/ambientSound.js
// Phase 6 — Web Audio API ambient tones, one oscillator per body.
// Stars hum deep (~40 Hz), asteroids ring high (~800 Hz).
// No external library — uses the browser's built-in AudioContext.

let audioCtx = null;
const bodyOscillators = new Map(); // bodyId → { oscillator, gainNode }

const MIN_FREQ  = 40;    // Hz — massive bodies (stars, black holes)
const MAX_FREQ  = 800;   // Hz — tiny bodies (asteroids, moons)
const MAX_MASS  = 50000; // Mass at which freq saturates to MIN_FREQ
const GAIN_BASE = 0.018; // Master volume per oscillator — very quiet

// Lazy-init so AudioContext is only created after a user gesture.
function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function massToFreq(mass) {
  const t = Math.min(mass / MAX_MASS, 1); // 0 (tiny) → 1 (massive)
  return MIN_FREQ + (MAX_FREQ - MIN_FREQ) * (1 - t);
}

/**
 * Synchronise oscillators with the current body list.
 * Safe to call every tick — AudioParam ops are very cheap.
 * @param {Array}   bodies  - Matter.js bodies
 * @param {boolean} enabled - false → ramp all gains to 0
 */
export function syncSound(bodies, enabled) {
  const ctx = getAudioCtx();

  if (!enabled) {
    // Smoothly silence all oscillators (don't stop them — avoids click on re-enable)
    bodyOscillators.forEach(({ gainNode }) => {
      gainNode.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    });
    return;
  }

  // Browser autoplay policy may suspend the context — resume on first user-gesture call
  if (ctx.state === 'suspended') ctx.resume();

  const activeIds = new Set(
    bodies.map(b => b.customData?.id).filter(Boolean)
  );

  // Fade out + stop oscillators for bodies that have been removed
  bodyOscillators.forEach(({ gainNode, oscillator }, id) => {
    if (!activeIds.has(id)) {
      gainNode.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      setTimeout(() => {
        try { oscillator.stop(); } catch (_) { /* already stopped */ }
        bodyOscillators.delete(id);
      }, 400);
    }
  });

  // Create or update oscillators for active bodies
  bodies.forEach(body => {
    const id = body.customData?.id;
    if (!id) return;

    const freq = massToFreq(body.mass);

    if (!bodyOscillators.has(id)) {
      // New body — create oscillator and fade in
      const oscillator = ctx.createOscillator();
      const gainNode   = ctx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(freq, ctx.currentTime);

      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.gain.setTargetAtTime(GAIN_BASE, ctx.currentTime, 0.3); // 0.3s fade-in

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.start();

      bodyOscillators.set(id, { oscillator, gainNode });
    } else {
      // Existing body — smoothly update frequency if mass changed
      const { oscillator, gainNode } = bodyOscillators.get(id);
      oscillator.frequency.setTargetAtTime(freq, ctx.currentTime, 0.3);
      gainNode.gain.setTargetAtTime(GAIN_BASE, ctx.currentTime, 0.2);
    }
  });
}

/**
 * Immediately silence and stop all oscillators.
 * Call when clearing all bodies or unmounting.
 */
export function stopAllSound() {
  if (!audioCtx) return;
  bodyOscillators.forEach(({ gainNode, oscillator }) => {
    gainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
    setTimeout(() => { try { oscillator.stop(); } catch (_) {} }, 200);
  });
  bodyOscillators.clear();
}
