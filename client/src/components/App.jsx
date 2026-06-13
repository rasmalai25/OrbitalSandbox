// components/App.jsx
// Phase 5 — analytics dashboard, gravity overlay, body inspector, orbital HUD wired in.
// Phase 7 — presets, challenges, save/share.
// Camera System — proper camera, selection, trajectory, mini-map.

import { useRef, useEffect, useState, useCallback } from 'react';
import Matter from 'matter-js';
import { useSimulation } from '../hooks/useSimulation.js';
import { useRoom } from '../hooks/useRoom.js';
import { useCamera } from '../hooks/useCamera.js';
import { connectSocket, getSocket } from '../socket/socketClient.js';
import { BODY_TYPES } from '../constants/bodyTypes.js';
import {
  pauseLoop, resumeLoop, isRunning, setOverlayCanvas, setSoundEnabled, setTrailStyle,
  setHoveredBodyId, setGhostPos, setGhostType,
  getCamera, setSelectedBodyId as setSimSelectedBodyId, setTrajectoryEnabled,
} from '../simulation/SimulationLoop.js';
import { screenToWorld } from '../canvas/camera.js';
import { clearHistory, rewindTo } from '../simulation/HistoryStore.js';
import { setOverlayEnabled } from '../canvas/GravityOverlay.js';
import { stopAllSound } from '../sound/ambientSound.js';
import { startChallenge, stopChallenge, CHALLENGES } from '../simulation/challengeEngine.js';
import { triggerShake } from '../canvas/CanvasRenderer.js';
import { resetBodyCounters } from '../physics/bodyFactory.js';
import Toolbar from './Toolbar.jsx';
import PropertyPanel from './PropertyPanel.jsx';
import PlaybackBar from './PlaybackBar.jsx';
import RoomPanel from './RoomPanel.jsx';
import EnergyDashboard from './EnergyDashboard.jsx';
import BodyInspector from './BodyInspector.jsx';
import OrbitalPeriodHUD from './OrbitalPeriodHUD.jsx';
import PresetMenu from './PresetMenu.jsx';
import ChallengePanel from './ChallengePanel.jsx';
import ShareModal, { tryRestoreSession } from './ShareModal.jsx';
import CameraModePill from './CameraModePill.jsx';
import MiniMap from './MiniMap.jsx';
import './App.css';

export default function App() {
  const canvasRef  = useRef(null);
  const overlayRef = useRef(null);

  const [socketStatus, setSocketStatus] = useState('connecting');
  const [selectedType, setSelectedType] = useState('PLANET');
  const [bodyCount,    setBodyCount]    = useState(0);
  const [placeConfig,  setPlaceConfig]  = useState({ mass: 1000, velocityX: 0, velocityY: 0 });
  const [showRoomPanel, setShowRoomPanel] = useState(false);

  // ── Phase 5 UI toggles ───────────────────────────────────────────
  const [showEnergy,  setShowEnergy]  = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [showOrbits,  setShowOrbits]  = useState(false);

  // ── Phase 6 UI toggles ───────────────────────────────────────────
  const [soundOn,    setSoundOn]    = useState(false);
  const TRAIL_STYLES = ['off', 'line', 'gradient', 'dotted'];
  const [trailIdx,   setTrailIdx]   = useState(1); // default 'line'
  const trailStyle = TRAIL_STYLES[trailIdx];

  // ── Phase 7 UI state ─────────────────────────────────────────────
  const [showPresets,      setShowPresets]      = useState(false);
  const [showShare,        setShowShare]        = useState(false);
  const [activeChallenge,  setActiveChallenge]  = useState(null);  // CHALLENGES[id] or null
  const [challengeProgress,setChallengeProgress]= useState('');
  const [challengeSuccess, setChallengeSuccess] = useState(false);

  // ── Camera & selection state (React state for UI components) ───
  // The actual camera object lives in SimulationLoop (module-level, updated every rAF).
  // We mirror mode + selectedBodyId here so HUD components re-render when they change.
  const [cameraMode,     setCameraMode]    = useState('COM');
  const [selectedBodyId, setSelectedBodyIdState] = useState(null);
  const [showTrajectory, setShowTrajectory] = useState(false);
  const [showMiniMap,    setShowMiniMap]    = useState(true);

  // ── Camera hook (wheel zoom + pan drag) ───────────────────────────
  const { isPanningRef, hasDraggedRef, onMouseDown: camMouseDown,
          onMouseMove: camMouseMove, onMouseUp: camMouseUp } = useCamera(canvasRef);

  // Helper: select a body and put camera into FOLLOW mode
  const selectBody = useCallback((bodyId) => {
    setSelectedBodyIdState(bodyId);
    setSimSelectedBodyId(bodyId);
    if (bodyId) {
      getCamera().mode = 'FOLLOW';
      setCameraMode('FOLLOW');
    } else {
      getCamera().mode = 'COM';
      setCameraMode('COM');
    }
  }, []);

  // ── Body inspector state ──────────────────────────────────────────
  const [hoveredBody,  setHoveredBody]  = useState(null);
  const [inspectorPos, setInspectorPos] = useState(null);
  const [allBodies,    setAllBodies]    = useState([]);

  // ── Physics ────────────────────────────────────────────
  const { placeBody, clearAll, engine, setEmitTick } = useSimulation(canvasRef);

  // ── Room / collaboration ───────────────────────────────
  const {
    roomId, role, partnerOnline,
    createRoom, joinRoom,
    emitBodyPlaced, emitTickIfHost, emitSimControl, emitCursor,
    hostSimTime, chatMessages, sendChat,
  } = useRoom(engine, setBodyCount);

  // ── Sync trajectory toggle into SimulationLoop ─────────────────
  useEffect(() => { setTrajectoryEnabled(showTrajectory); }, [showTrajectory]);

  // ── Collision screen shake ─────────────────────────────
  useEffect(() => {
    const eng = engine?.current;
    if (!eng) return;
    const onCollision = (event) => {
      if (event.pairs?.length) triggerShake(Math.min(event.pairs.length, 3));
    };
    Matter.Events.on(eng, 'collisionStart', onCollision);
    return () => Matter.Events.off(eng, 'collisionStart', onCollision);
  }, [engine]);

  // ── Wire overlay canvas into SimulationLoop ────────────
  useEffect(() => {
    if (overlayRef.current) setOverlayCanvas(overlayRef.current);
  }, []);

  // ── Keep overlay canvas sized to match the main canvas ─
  useEffect(() => {
    const sync = () => {
      const main    = canvasRef.current;
      const overlay = overlayRef.current;
      if (!main || !overlay) return;
      overlay.width  = main.offsetWidth;
      overlay.height = main.offsetHeight;
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  // ── Propagate overlay toggle into GravityOverlay module ─────────────────
  useEffect(() => {
    setOverlayEnabled(showOverlay);
  }, [showOverlay]);

  // ── Propagate Phase 6 toggles into SimulationLoop ──────────────────────
  useEffect(() => { setSoundEnabled(soundOn); }, [soundOn]);
  useEffect(() => { setTrailStyle(trailStyle); }, [trailStyle]);

  // ── Phase 7: restore session from URL param on first mount ──────────────
  useEffect(() => {
    const configs = tryRestoreSession();
    if (!configs || !configs.length) return;
    clearAll();
    clearHistory();
    setBodyCount(0);
    configs.forEach(cfg => {
      const b = placeBody(cfg);
      if (b) emitBodyPlaced?.(b);
    });
    setBodyCount(configs.length);
    // Strip the ?session= param without reloading
    const url = new URL(window.location.href);
    url.searchParams.delete('session');
    window.history.replaceState({}, '', url.toString());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Phase 7: load a preset ───────────────────────────────────────────────
  const loadPreset = useCallback((preset) => {
    stopChallenge();
    setActiveChallenge(null);
    setChallengeSuccess(false);
    setChallengeProgress('');
    clearAll();
    clearHistory();
    setBodyCount(0);
    let count = 0;
    preset.bodies.forEach(cfg => {
      const b = placeBody(cfg);
      if (b) { emitBodyPlaced?.(b); count++; }
    });
    setBodyCount(count);
  }, [clearAll, placeBody, emitBodyPlaced]);

  // ── Phase 7: load a saved session (from ShareModal) ──────────────────────
  const loadSession = useCallback((configs) => {
    stopChallenge();
    setActiveChallenge(null);
    setChallengeSuccess(false);
    setChallengeProgress('');
    clearAll();
    clearHistory();
    setBodyCount(0);
    let count = 0;
    configs.forEach(cfg => {
      const b = placeBody(cfg);
      if (b) { emitBodyPlaced?.(b); count++; }
    });
    setBodyCount(count);
  }, [clearAll, placeBody, emitBodyPlaced]);

  // ── Phase 7: start a challenge ───────────────────────────────────────────
  const handleStartChallenge = useCallback((id) => {
    const ch = CHALLENGES[id];
    if (!ch) return;
    setChallengeSuccess(false);
    setActiveChallenge(ch);
    setChallengeProgress('Initialising…');
    const canvas = canvasRef.current;
    startChallenge(id, {
      engine,
      placeBody,
      clearAll,
      clearHistory,
      emitBodyPlaced,
      canvasWidth:  canvas?.offsetWidth  || 1280,
      canvasHeight: canvas?.offsetHeight || 800,
      onProgress: (label) => setChallengeProgress(label),
      onSuccess:  () => { setChallengeSuccess(true); },
      onAbort:    () => { setActiveChallenge(null); setChallengeProgress(''); },
    });
  }, [engine, placeBody, clearAll, emitBodyPlaced]);

  // ── Socket status ──────────────────────────────────────
  useEffect(() => {
    const socket = connectSocket();
    socket.on('connect',       () => setSocketStatus('connected'));
    socket.on('disconnect',    () => setSocketStatus('disconnected'));
    socket.on('connect_error', () => setSocketStatus('disconnected'));
  }, []);

  // ── Inject tick emitter into simulation loop ───────────
  useEffect(() => {
    setEmitTick(emitTickIfHost);
  }, [emitTickIfHost, setEmitTick]);

  // ── Poll bodies for inspector + orbital HUD (10 Hz) ────
  useEffect(() => {
    const id = setInterval(() => {
      const eng = engine?.current;
      if (!eng) return;
      setAllBodies([...Matter.Composite.allBodies(eng.world)]);
    }, 100);
    return () => clearInterval(id);
  }, [engine]);

  // ── Canvas helpers ─────────────────────────────────────
  const getCanvasCoords = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width  / rect.width),
      y: (e.clientY - rect.top)  * (canvas.height / rect.height),
    };
  }, []);

  // ── Click handler: hit-test bodies → select/deselect/place ─────────
  const handleCanvasClick = useCallback((e) => {
    // If a drag just happened, suppress the click
    if (hasDraggedRef.current) { hasDraggedRef.current = false; return; }

    const canvasCoords = getCanvasCoords(e);
    if (!canvasCoords) return;

    const camera = getCamera();
    const canvas = canvasRef.current;
    const worldCoords = screenToWorld(camera, canvas, canvasCoords.x, canvasCoords.y);

    const eng = engine?.current;
    if (eng) {
      const bodies = Matter.Composite.allBodies(eng.world);
      // Reverse iterate: top-rendered (last-drawn) body hit-tested first
      for (let i = bodies.length - 1; i >= 0; i--) {
        const b  = bodies[i];
        const dx = b.position.x - worldCoords.x;
        const dy = b.position.y - worldCoords.y;
        const r  = b.circleRadius || 5;
        if (dx * dx + dy * dy <= r * r) {
          selectBody(b.customData?.id);
          return;
        }
      }
    }

    // Missed all bodies
    if (selectedBodyId) {
      // First empty-space click while selected → deselect only
      selectBody(null);
      return;
    }

    // No selection active → place a body
    const body = placeBody({
      type: selectedType,
      x: worldCoords.x, y: worldCoords.y,
      mass: placeConfig.mass,
      velocityX: placeConfig.velocityX,
      velocityY: placeConfig.velocityY,
      ownerId: getSocket().id || 'local',
    });
    if (body) {
      setBodyCount(prev => prev + 1);
      emitBodyPlaced(body);
    }
  }, [getCanvasCoords, engine, selectedBodyId, selectBody, placeBody, selectedType, placeConfig, emitBodyPlaced]);

  // ── Mouse move — ghost + hover + cursor sharing + pan pass-through ───
  const handleCanvasMouseMove = useCallback((e) => {
    // Forward to camera pan handler
    camMouseMove(e);

    const canvasCoords = getCanvasCoords(e);
    if (!canvasCoords) return;

    // Ghost preview (screen space)
    setGhostPos(canvasCoords);
    setGhostType(selectedType);

    // World-space cursor sharing (so partner sees correct position at any zoom)
    const camera = getCamera();
    const canvas = canvasRef.current;
    const worldCoords = screenToWorld(camera, canvas, canvasCoords.x, canvasCoords.y);
    emitCursor(worldCoords.x, worldCoords.y);

    const eng = engine?.current;
    if (!eng) return;

    // Hit-test for hover (world space)
    const bodies = Matter.Composite.allBodies(eng.world);
    let nearest = null, nearestDist = Infinity;
    bodies.forEach(b => {
      const dx = b.position.x - worldCoords.x;
      const dy = b.position.y - worldCoords.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const hitRadius = (b.circleRadius || 5) + 8 / camera.zoom;
      if (dist < hitRadius && dist < nearestDist) { nearestDist = dist; nearest = b; }
    });

    setHoveredBody(nearest);
    setHoveredBodyId(nearest?.customData?.id || null);
    setInspectorPos(nearest ? { x: e.clientX, y: e.clientY } : null);
  }, [getCanvasCoords, emitCursor, selectedType, engine, camMouseMove]);

  const handleCanvasLeave = useCallback(() => {
    setHoveredBody(null);
    setHoveredBodyId(null);
    setGhostPos(null);
    setGhostType(null);
    setInspectorPos(null);
  }, []);

  // Combined mouse down (camera pan start)
  const handleCanvasMouseDown = useCallback((e) => { camMouseDown(e); }, [camMouseDown]);
  const handleCanvasMouseUp   = useCallback((e) => { camMouseUp(e); },   [camMouseUp]);

  // ── Keyboard shortcuts ─────────────────────────────────
  useEffect(() => {
    const typeKeys = { '1': 'STAR', '2': 'PLANET', '3': 'MOON', '4': 'ASTEROID', '5': 'BLACK_HOLE' };
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.key === 'c' || e.key === 'C') {
        clearAll(); clearHistory(); setBodyCount(0);
        resetBodyCounters();        // reset name counters too
        selectBody(null);
        stopAllSound();
        getCamera().mode = 'COM';  // snap camera back to COM
        setCameraMode('COM');
      }
      if (e.key === ' ') {
        e.preventDefault();
        const r = isRunning();
        r ? pauseLoop() : resumeLoop();
        emitSimControl(r ? 'pause' : 'resume');
      }
      if (typeKeys[e.key]) setSelectedType(typeKeys[e.key]);
      if (e.key === 'r' || e.key === 'R') setShowRoomPanel(p => !p);
      // Phase 5
      if (e.key === 'e' || e.key === 'E') setShowEnergy(p => !p);
      if (e.key === 'g' || e.key === 'G') setShowOverlay(p => !p);
      if (e.key === 'o' || e.key === 'O') setShowOrbits(p => !p);
      // Phase 6
      if (e.key === 's' || e.key === 'S') setSoundOn(p => !p);
      if (e.key === 't' || e.key === 'T') setTrailIdx(p => (p + 1) % TRAIL_STYLES.length);
      // Camera system
      if (e.key === 'f' || e.key === 'F') setShowTrajectory(p => !p);
      if (e.key === 'm' || e.key === 'M') setShowMiniMap(p => !p);
      if (e.key === 'Escape') selectBody(null);
      // Phase 7
      if (e.key === 'p' || e.key === 'P') setShowPresets(p => !p);
      if (e.key === 'n' || e.key === 'N') setShowShare(p => !p);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearAll, emitSimControl, selectBody]);

  const statusLabel = { connecting: 'Connecting…', connected: 'Connected', disconnected: 'Disconnected' }[socketStatus];
  const cfg = BODY_TYPES[selectedType];

  return (
    <div className="app-shell">

      {/* Gravity field overlay — behind main canvas */}
      <canvas
        ref={overlayRef}
        className="gravity-overlay-canvas"
        aria-hidden="true"
      />

      {/* Connection status */}
      <div className="status-banner">
        <span className={`status-dot ${socketStatus}`} />
        <span>{statusLabel}</span>
      </div>

      {/* Top HUD */}
      <div className="phase1-hud">
        <div className="hud-pill glass-panel">
          <span className="hud-label">Bodies</span>
          <span className="hud-value">{bodyCount}</span>
        </div>
        <div className="hud-pill glass-panel" style={{ borderColor: cfg.color }}>
          <span className="hud-emoji">{cfg.emoji}</span>
          <span className="hud-value" style={{ color: cfg.color }}>{cfg.label}</span>
        </div>
        {/* Camera mode pill */}
        <CameraModePill
          mode={cameraMode}
          followName={selectedBodyId
            ? (() => {
                const eng = engine?.current;
                if (!eng) return null;
                const b = Matter.Composite.allBodies(eng.world).find(b => b.customData?.id === selectedBodyId);
                return b?.customData?.name || null;
              })()
            : null
          }
          onCycle={() => setCameraMode(getCamera().mode)}
        />
        <div className="hud-hint glass-panel">
          1-5 · Space · C · E · G · O · S · T trails · F traj · M map · P presets · N share
        </div>
        {roomId && (
          <div className="hud-pill glass-panel hud-room-indicator">
            <span className={`status-dot ${partnerOnline ? 'connected' : 'connecting'}`} />
            <span className="hud-label">{role}</span>
            <span className="hud-value" style={{ fontFamily: 'var(--font-display)' }}>{roomId}</span>
          </div>
        )}
      </div>

      {/* Phase 4/8 — Room panel & Chat */}
      {showRoomPanel && (
        <RoomPanel
          roomId={roomId}
          role={role}
          partnerOnline={partnerOnline}
          chatMessages={chatMessages}
          onSendChat={sendChat}
          onRewind={(simTime) => {
            if (engine.current) rewindTo(simTime, engine.current);
          }}
          onCreateRoom={() => createRoom()}
          onJoinRoom={(id) => joinRoom(id)}
          onClose={() => setShowRoomPanel(false)}
        />
      )}

      {/* Phase 5 — Analytics toggle buttons */}
      <div className="analytics-toggles">
        <button
          id="btn-toggle-energy"
          className={`analytics-btn glass-panel${showEnergy  ? ' analytics-btn--active' : ''}`}
          onClick={() => setShowEnergy(p => !p)}
          title="Toggle energy graph (E)"
        >
          ⚡ Energy
        </button>
        <button
          id="btn-toggle-overlay"
          className={`analytics-btn glass-panel${showOverlay ? ' analytics-btn--active' : ''}`}
          onClick={() => setShowOverlay(p => !p)}
          title="Toggle gravity overlay (G)"
        >
          🌌 Gravity
        </button>
        <button
          id="btn-toggle-orbits"
          className={`analytics-btn glass-panel${showOrbits  ? ' analytics-btn--active' : ''}`}
          onClick={() => setShowOrbits(p => !p)}
          title="Toggle orbital period HUD (O)"
        >
          🔄 Orbits
        </button>
        {/* Phase 6 toggles */}
        <button
          id="btn-toggle-sound"
          className={`analytics-btn glass-panel${soundOn ? ' analytics-btn--active' : ''}`}
          onClick={() => setSoundOn(p => !p)}
          title="Toggle ambient sound (S)"
        >
          {soundOn ? '🔊' : '🔇'} Sound
        </button>
        <button
          id="btn-toggle-trails"
          className={`analytics-btn glass-panel${trailStyle !== 'off' ? ' analytics-btn--active' : ''}`}
          onClick={() => setTrailIdx(p => (p + 1) % TRAIL_STYLES.length)}
          title="Cycle trail style (T): off → line → gradient → dotted"
        >
          ✨ Trails: {trailStyle}
        </button>
        {/* Camera system toggles */}
        <button
          id="btn-toggle-trajectory"
          className={`analytics-btn glass-panel${showTrajectory ? ' analytics-btn--active' : ''}`}
          onClick={() => setShowTrajectory(p => !p)}
          title="Toggle trajectory preview for selected body (F)"
          disabled={!selectedBodyId}
        >
          📡 Trajectory
        </button>
        <button
          id="btn-toggle-minimap"
          className={`analytics-btn glass-panel${showMiniMap ? ' analytics-btn--active' : ''}`}
          onClick={() => setShowMiniMap(p => !p)}
          title="Toggle mini-map (M)"
        >
          🗺️ Map
        </button>

        <button
          id="btn-toggle-presets"
          className={`analytics-btn glass-panel${showPresets ? ' analytics-btn--active' : ''}`}
          onClick={() => setShowPresets(p => !p)}
          title="Preset configurations (P)"
        >
          🎯 Presets
        </button>
        <button
          id="btn-save-share"
          className={`analytics-btn glass-panel${showShare ? ' analytics-btn--active' : ''}`}
          onClick={() => setShowShare(p => !p)}
          title="Save &amp; Share session (N)"
        >
          💾 Share
        </button>
      </div>

      {/* Left toolbar */}
      <Toolbar selectedType={selectedType} onSelectType={setSelectedType} />

      {/* Right property panel */}
      <PropertyPanel selectedType={selectedType} onConfigChange={setPlaceConfig} />

      {/* Phase 5 — Live energy chart */}
      <EnergyDashboard engineRef={engine} visible={showEnergy} />

      {/* Phase 5 — Orbital period tracker */}
      <OrbitalPeriodHUD bodies={allBodies} visible={showOrbits} />

      {/* Playback bar */}
      <PlaybackBar
        engineRef={engine}
        canvasRef={canvasRef}
        camera={getCamera()}
        onBodyCountChange={setBodyCount}
        role={role}
        hostSimTime={hostSimTime}
      />

      {/* Main simulation canvas */}
      <canvas
        ref={canvasRef}
        className="simulation-canvas"
        id="simulation-canvas"
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onClick={handleCanvasClick}
        onMouseLeave={handleCanvasLeave}
        aria-label="Orbital Sandbox simulation canvas"
      />

      {/* Phase 5 — Body inspector tooltip */}
      <BodyInspector
        hoveredBody={hoveredBody}
        allBodies={allBodies}
        mousePos={inspectorPos}
      />

      {/* Camera system — Mini-map */}
      <MiniMap
        engineRef={engine}
        camera={getCamera()}
        selectedBodyId={selectedBodyId}
        visible={showMiniMap && cameraMode === 'FOLLOW'}
      />

      {/* Collab toggle button */}
      <button
        className={`room-toggle-btn glass-panel${roomId && partnerOnline ? ' room-toggle-btn--online' : ''}`}
        onClick={() => setShowRoomPanel(p => !p)}
        title={showRoomPanel ? 'Close room panel' : 'Open room panel (R)'}
        aria-label="Toggle collaboration room panel"
      >
        👥 {roomId ? (partnerOnline ? 'Online' : 'Waiting') : 'Collab'}
      </button>

      {/* Phase 4 — Room panel */}
      {showRoomPanel && (
        <RoomPanel
          roomId={roomId}
          role={role}
          partnerOnline={partnerOnline}
          onCreateRoom={createRoom}
          onJoinRoom={joinRoom}
          onClose={() => setShowRoomPanel(false)}
        />
      )}

      {/* Phase 7 — Preset menu */}
      {showPresets && (
        <PresetMenu
          onLoadPreset={loadPreset}
          onStartChallenge={handleStartChallenge}
          onClose={() => setShowPresets(false)}
        />
      )}

      {/* Phase 7 — Active challenge panel */}
      <ChallengePanel
        challenge={activeChallenge}
        progress={challengeProgress}
        success={challengeSuccess}
        onClose={() => {
          stopChallenge();
          setActiveChallenge(null);
          setChallengeSuccess(false);
          setChallengeProgress('');
        }}
      />

      {/* Phase 7 — Save & Share modal */}
      <ShareModal
        visible={showShare}
        onClose={() => setShowShare(false)}
        bodies={allBodies}
        onLoad={loadSession}
      />

    </div>
  );
}
