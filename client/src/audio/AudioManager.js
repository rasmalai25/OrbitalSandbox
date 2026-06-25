// audio/AudioManager.js
// Frontend §5 — screen-aware ambient beds + one-shot SFX.
//
// The Web Audio context cannot start until a user gesture resumes it; the
// ENTER button on LandingScreen is the canonical first-gesture moment.
// All public functions are no-ops if unlockAudio() hasn't been called yet,
// so calling them from screen mount effects is safe.
//
// Shares the same AudioContext as the per-body oscillator layer in
// sound/ambientSound.js — both modules consult window.__orbitalAudioCtx so
// the SIMULATION screen's per-body audio plays through the same graph
// without doubling up.

const SCREEN_BEDS = {
  LANDING:     'drone',
  MODE_SELECT: 'bright',
  SOLO_SELECT: 'bright',
  MP_SELECT:   'bright',
  LOBBY:       'pulse',
  SIMULATION:  null,         // per-body oscillators take over
};

let ctx = null;
let masterGain = null;       // for global ducking later if needed
let currentBed = null;       // { stop(): void } | null
let currentScreen = null;

/**
 * Resolve the AudioContext, creating it if needed. MUST be called from a
 * user gesture (e.g. ENTER button) — browsers keep the context suspended
 * until then.
 */
export function unlockAudio() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    // Stash on window so ambientSound.js (per-body oscillators on SIMULATION)
    // can reuse this instance instead of creating a parallel context.
    window.__orbitalAudioCtx = ctx;
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.6;
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Returns true after the first user gesture has unlocked audio. */
export function isAudioUnlocked() { return !!ctx && ctx.state === 'running'; }

/**
 * Crossfade to a new bed. Pass null to fade out without starting anything
 * new (used for the SIMULATION screen which has its own per-body layer).
 */
export function setScreenAudio(screen) {
  currentScreen = screen;
  if (!ctx) return;

  const bedKind = SCREEN_BEDS[screen] ?? null;
  const next    = bedKind ? buildBed(ctx, masterGain, bedKind) : null;
  crossfade(currentBed, next, 0.8);
  currentBed = next;
}

/**
 * Play a one-shot SFX. Known names: 'partner_join', 'collision', 'capture'.
 * Inert until audio is unlocked.
 */
export function playSfx(name) {
  if (!ctx || !masterGain) return;
  const now = ctx.currentTime;

  switch (name) {
    case 'partner_join': {
      // Soft major-third chime
      [659.25, 880.0].forEach((freq, i) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.15, now + 0.04 + i * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9 + i * 0.05);
        osc.connect(gain).connect(masterGain);
        osc.start(now + i * 0.05);
        osc.stop(now + 1.2);
      });
      break;
    }

    case 'collision': {
      // Whoosh = filtered white-noise burst
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src    = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain   = ctx.createGain();
      src.buffer = buf;
      filter.type = 'bandpass';
      filter.frequency.value = 800;
      filter.Q.value = 0.7;
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
      src.connect(filter).connect(gain).connect(masterGain);
      src.start(now);
      src.stop(now + 0.26);
      break;
    }

    case 'capture': {
      // Black-hole capture: downward swept tone + low rumble
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.8);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 500;
      osc.connect(filter).connect(gain).connect(masterGain);
      osc.start(now);
      osc.stop(now + 1);
      break;
    }

    default:
      console.warn('[AudioManager] Unknown SFX:', name);
  }
}

// ── Bed builders ─────────────────────────────────────────────────────────────
// Each builder returns an object exposing `gain` (input we crossfade) and
// `stop()` so the manager can tear it down. Beds are intentionally minimal —
// the goal is atmosphere, not music.

function buildBed(ctx, dest, kind) {
  if (kind === 'drone')  return buildDrone(ctx, dest);
  if (kind === 'bright') return buildBrightPad(ctx, dest);
  if (kind === 'pulse')  return buildPulse(ctx, dest);
  return null;
}

function buildDrone(ctx, dest) {
  // Two low sine oscillators slightly detuned = subtle binaural shimmer
  const oscs = [55, 55.5].map(f => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; return o; });
  const gain = ctx.createGain();
  gain.gain.value = 0;
  oscs.forEach(o => o.connect(gain));
  gain.connect(dest);
  oscs.forEach(o => o.start());
  return { gain, stop: () => oscs.forEach(o => { try { o.stop(); } catch {} }) };
}

function buildBrightPad(ctx, dest) {
  const oscs = [220, 277.18, 329.63].map(f => { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; return o; });
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1200;
  oscs.forEach(o => o.connect(filter));
  filter.connect(gain).connect(dest);
  oscs.forEach(o => o.start());
  return { gain, stop: () => oscs.forEach(o => { try { o.stop(); } catch {} }) };
}

function buildPulse(ctx, dest) {
  // Slow LFO-modulated sine — the "waiting for partner" heartbeat
  const osc  = ctx.createOscillator();
  const lfo  = ctx.createOscillator();
  const lfoG = ctx.createGain();
  const gain = ctx.createGain();
  osc.type = 'sine'; osc.frequency.value = 110;
  lfo.type = 'sine'; lfo.frequency.value = 0.6;          // 0.6 Hz pulse
  lfoG.gain.value = 0.07;                                 // depth
  lfo.connect(lfoG).connect(gain.gain);
  gain.gain.value = 0;
  osc.connect(gain).connect(dest);
  osc.start(); lfo.start();
  return { gain, stop: () => { try { osc.stop(); lfo.stop(); } catch {} } };
}

// ── Crossfade ──
// Ramps the outgoing bed's gain to 0 and the incoming to its target over
// `seconds`, then stops the old oscillators on a small post-fade delay so the
// ramp completes audibly first.

function crossfade(outBed, inBed, seconds = 0.8) {
  if (!ctx) return;
  const now = ctx.currentTime;

  if (outBed) {
    outBed.gain.gain.cancelScheduledValues(now);
    outBed.gain.gain.setValueAtTime(outBed.gain.gain.value, now);
    outBed.gain.gain.linearRampToValueAtTime(0.0001, now + seconds);
    setTimeout(() => outBed.stop?.(), (seconds + 0.05) * 1000);
  }

  if (inBed) {
    inBed.gain.gain.cancelScheduledValues(now);
    inBed.gain.gain.setValueAtTime(0.0001, now);
    inBed.gain.gain.linearRampToValueAtTime(0.18, now + seconds);
  }
}
