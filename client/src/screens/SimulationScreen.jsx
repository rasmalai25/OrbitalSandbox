// screens/SimulationScreen.jsx
// Frontend §2 + §3.7 — Owns the physics engine, the simulation canvas, and
// every in-sim UI surface. The engine + rAF loop init in useSimulation's
// useEffect, which now fires only when this screen mounts (i.e. when the
// user has actually entered SIMULATION). Unmounting tears the loop down,
// stops oscillators, and frees Matter bodies.
//
// This file is the old App.jsx body. App.jsx is now a thin screen router.

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
import { resetBodyCounters } from '../physics/bodyFactory.js';
import Toolbar from '../components/Toolbar.jsx';
import PropertyPanel from '../components/PropertyPanel.jsx';
import PlaybackBar from '../components/PlaybackBar.jsx';
import RoomPanel from '../components/RoomPanel.jsx';
import EnergyDashboard from '../components/EnergyDashboard.jsx';
import BodyInspector from '../components/BodyInspector.jsx';
import OrbitalPeriodHUD from '../components/OrbitalPeriodHUD.jsx';
import PresetMenu from '../components/PresetMenu.jsx';
import ChallengePanel from '../components/ChallengePanel.jsx';
import ShareModal, { tryRestoreSession } from '../components/ShareModal.jsx';
import CameraModePill from '../components/CameraModePill.jsx';
import MiniMap from '../components/MiniMap.jsx';
import { useNavStore, SCREENS } from '../store/navStore.js';
import { setScreenAudio } from '../audio/AudioManager.js';
import { applyRemoteBodyPlaced, applySyncedTick } from '../socket/syncEngine.js';
import '../components/App.css';

export default function SimulationScreen() {
  const canvasRef  = useRef(null);
  const overlayRef = useRef(null);

  // Read sim context + nav controls from the screen state machine
  const simContext = useNavStore(s => s.simContext);
  const go         = useNavStore(s => s.go);

  // Audio: fade out the menu bed so per-body oscillators (Phase 6) own
  // the soundscape on this screen.
  useEffect(() => { setScreenAudio(SCREENS.SIMULATION); }, []);

  // Socket auto-connects at module load (socketClient.js), so by the time
  // this component mounts the 'connect' event has usually already fired.
  // Read socket.connected synchronously so we don't get stuck on "Connecting…".
  const [socketStatus, setSocketStatus] = useState(
    () => (getSocket()?.connected ? 'connected' : 'connecting')
  );
  const [selectedType, setSelectedType] = useState('PLANET');

  // HUD: collapse the analytics row + hotkey hint behind a chevron.
  const [hudCollapsed, setHudCollapsed] = useState(false);
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
  // simContext === 'challenges' auto-opens the picker on entry.
  const [showPresets,      setShowPresets]      = useState(simContext === 'challenges');
  const [showShare,        setShowShare]        = useState(false);
  const [activeChallenge,  setActiveChallenge]  = useState(null);  // CHALLENGES[id] or null
  const [challengeProgress,setChallengeProgress]= useState('');
  const [challengeSuccess, setChallengeSuccess] = useState(false);

  // ── Camera & selection state (React state for UI components) ───
  const [cameraMode,     setCameraMode]    = useState('COM');
  const [selectedBodyId, setSelectedBodyIdState] = useState(null);
  const [showTrajectory, setShowTrajectory] = useState(false);
  const [showMiniMap,    setShowMiniMap]    = useState(true);

  // ── Camera hook (wheel zoom + pan drag) ───────────────────────────
  const { hasDraggedRef, onMouseDown: camMouseDown,
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

  // ── Physics — engine lifecycle is tied to this component's mount ─
  const { placeBody, clearAll, engine, setEmitTick } = useSimulation(canvasRef);

  // ── Room / collaboration ───────────────────────────────
  const {
    roomId, role, partnerOnline,
    createRoom, joinRoom, adoptRoom,
    emitBodyPlaced, emitBodyUpdated,
    emitTickIfHost, emitSimControl, emitCursor,
    hostSimTime, chatMessages, sendChat,
  } = useRoom(engine, setBodyCount);

  // ── Multiplayer context: adopt the room created in MP_SELECT/LOBBY ───
  // The socket is still in the room server-side; we just restore the
  // React state so the HUD pill and host/observer behaviour show up,
  // then replay any bodies the host already placed (the observer's
  // join_room callback received them but MP_SELECT had no engine to
  // apply them against).
  useEffect(() => {
    if (simContext !== 'multiplayer') return;
    if (roomId) return;
    const storedId   = sessionStorage.getItem('orbital_room_id');
    const storedRole = sessionStorage.getItem('orbital_room_role');
    if (storedId && storedRole) adoptRoom(storedId, storedRole);

    const stashedInitial = sessionStorage.getItem('orbital_room_initial_state');
    if (stashedInitial) {
      try {
        const initial = JSON.parse(stashedInitial);
        const eng = engine?.current;
        if (eng && initial?.bodies?.length) {
          initial.bodies.forEach(b => applyRemoteBodyPlaced(eng, b));
          if (initial.lastTick?.bodies) applySyncedTick(eng, initial.lastTick.bodies);
          setBodyCount(initial.bodies.length);
        }
      } catch (err) {
        console.warn('[multiplayer] could not apply stashed initial state', err);
      }
      sessionStorage.removeItem('orbital_room_initial_state');
    }
    // Run once per SimulationScreen mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simContext]);

  // ── C5: rename a selected body and sync to partner ─────
  const renameSelectedBody = useCallback((newName) => {
    if (!selectedBodyId) return;
    const trimmed = (newName || '').trim();
    if (!trimmed) return;
    const eng = engine?.current;
    if (!eng) return;
    const body = Matter.Composite.allBodies(eng.world)
      .find(b => b.customData?.id === selectedBodyId);
    if (!body) return;
    body.customData.name = trimmed;
    emitBodyUpdated?.({ id: selectedBodyId, name: trimmed });
  }, [selectedBodyId, engine, emitBodyUpdated]);

  const selectedBody = (() => {
    if (!selectedBodyId) return null;
    const eng = engine?.current;
    if (!eng) return null;
    const b = Matter.Composite.allBodies(eng.world)
      .find(b => b.customData?.id === selectedBodyId);
    return b ? { id: selectedBodyId, name: b.customData?.name, type: b.label } : null;
  })();

  // ── Sync trajectory toggle into SimulationLoop ─────────────────
  useEffect(() => { setTrajectoryEnabled(showTrajectory); }, [showTrajectory]);

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

  // ── Phase 7/9: restore session from URL param on first mount ────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const configs = await tryRestoreSession();
      if (cancelled || !configs || !configs.length) return;
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
    })();
    return () => { cancelled = true; };
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
    // Re-check synchronously in case 'connect' fired between component init
    // and effect run.
    if (socket.connected) setSocketStatus('connected');

    const onConnect    = () => setSocketStatus('connected');
    const onDisconnect = () => setSocketStatus('disconnected');
    const onError      = () => setSocketStatus('disconnected');

    socket.on('connect',       onConnect);
    socket.on('disconnect',    onDisconnect);
    socket.on('connect_error', onError);
    return () => {
      socket.off('connect',       onConnect);
      socket.off('disconnect',    onDisconnect);
      socket.off('connect_error', onError);
    };
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
    if (hasDraggedRef.current) { hasDraggedRef.current = false; return; }

    const canvasCoords = getCanvasCoords(e);
    if (!canvasCoords) return;

    const camera = getCamera();
    const canvas = canvasRef.current;
    const worldCoords = screenToWorld(camera, canvas, canvasCoords.x, canvasCoords.y);

    const eng = engine?.current;
    if (eng) {
      const bodies = Matter.Composite.allBodies(eng.world);
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

    if (selectedBodyId) {
      selectBody(null);
      return;
    }

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
  }, [getCanvasCoords, engine, selectedBodyId, selectBody, placeBody, selectedType, placeConfig, emitBodyPlaced, hasDraggedRef]);

  // ── Mouse move — ghost + hover + cursor sharing + pan pass-through ───
  const handleCanvasMouseMove = useCallback((e) => {
    camMouseMove(e);

    const canvasCoords = getCanvasCoords(e);
    if (!canvasCoords) return;

    setGhostPos(canvasCoords);
    setGhostType(selectedType);

    const camera = getCamera();
    const canvas = canvasRef.current;
    const worldCoords = screenToWorld(camera, canvas, canvasCoords.x, canvasCoords.y);
    emitCursor(worldCoords.x, worldCoords.y);

    const eng = engine?.current;
    if (!eng) return;

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

  const handleCanvasMouseDown = useCallback((e) => { camMouseDown(e); }, [camMouseDown]);
  const handleCanvasMouseUp   = useCallback((e) => { camMouseUp(e); },   [camMouseUp]);

  // ── Keyboard shortcuts ─────────────────────────────────
  useEffect(() => {
    const typeKeys = { '1': 'STAR', '2': 'PLANET', '3': 'MOON', '4': 'ASTEROID', '5': 'BLACK_HOLE' };
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.key === 'c' || e.key === 'C') {
        clearAll(); clearHistory(); setBodyCount(0);
        resetBodyCounters();
        selectBody(null);
        stopAllSound();
        getCamera().mode = 'COM';
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
      if (e.key === 'e' || e.key === 'E') setShowEnergy(p => !p);
      if (e.key === 'g' || e.key === 'G') setShowOverlay(p => !p);
      if (e.key === 'o' || e.key === 'O') setShowOrbits(p => !p);
      if (e.key === 's' || e.key === 'S') setSoundOn(p => !p);
      if (e.key === 't' || e.key === 'T') setTrailIdx(p => (p + 1) % TRAIL_STYLES.length);
      if (e.key === 'f' || e.key === 'F') setShowTrajectory(p => !p);
      if (e.key === 'm' || e.key === 'M') setShowMiniMap(p => !p);
      if (e.key === 'Escape') selectBody(null);
      if (e.key === 'p' || e.key === 'P') setShowPresets(p => !p);
      if (e.key === 'n' || e.key === 'N') setShowShare(p => !p);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearAll, emitSimControl, selectBody]);

  // ── Exit to menu (frontend §3.7) ───────────────────────
  const exitToMenu = useCallback(() => {
    // Stop sound/challenge before unmounting so we don't leak audio nodes
    stopAllSound();
    stopChallenge();
    sessionStorage.removeItem('orbital_room_id');
    sessionStorage.removeItem('orbital_room_role');
    go(SCREENS.MODE_SELECT);
  }, [go]);

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

      {/* Top-left — exit to main menu (frontend §3.7) */}
      <button
        className="hud-menu-btn glass-panel"
        onClick={exitToMenu}
        title="Exit to main menu"
      >
        ← Menu
      </button>

      {/* Top-right — connection status (just the dot + label, no overlap with menu) */}
      <div className="status-banner">
        <span className={`status-dot ${socketStatus}`} />
        <span>{statusLabel}</span>
      </div>

      {/* Top HUD — compact pills + collapse chevron */}
      <div className="phase1-hud">
        <div className="hud-pill glass-panel">
          <span className="hud-label">Bodies</span>
          <span className="hud-value">{bodyCount}</span>
        </div>
        <div className="hud-pill glass-panel" style={{ borderColor: cfg.color }}>
          <span className="hud-emoji">{cfg.emoji}</span>
          <span className="hud-value" style={{ color: cfg.color }}>{cfg.label}</span>
        </div>
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
        {roomId && (
          <div className="hud-pill glass-panel hud-room-indicator">
            <span className={`status-dot ${partnerOnline ? 'connected' : 'connecting'}`} />
            <span className="hud-label">{role}</span>
            <span className="hud-value" style={{ fontFamily: 'var(--font-display)' }}>{roomId}</span>
          </div>
        )}

        {/* Collapse / expand chevron — hides the analytics row + hint */}
        <button
          className="hud-collapse-btn glass-panel"
          onClick={() => setHudCollapsed(v => !v)}
          title={hudCollapsed ? 'Show toolbar' : 'Hide toolbar'}
          aria-expanded={!hudCollapsed}
        >
          <span className={`hud-chevron ${hudCollapsed ? 'is-collapsed' : ''}`}>▾</span>
        </button>
      </div>

      {/* Room panel & Chat */}
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

      {/* Analytics toggle buttons — collapsed when the chevron is folded.
          Hotkeys shown in title= tooltips so the row stays scannable. */}
      {!hudCollapsed && (
        <div className="analytics-toggles">
          <button id="btn-toggle-energy"  className={`analytics-btn glass-panel${showEnergy  ? ' analytics-btn--active' : ''}`} onClick={() => setShowEnergy(p => !p)}  title="Toggle energy graph (E)">⚡ Energy</button>
          <button id="btn-toggle-overlay" className={`analytics-btn glass-panel${showOverlay ? ' analytics-btn--active' : ''}`} onClick={() => setShowOverlay(p => !p)} title="Toggle gravity overlay (G)">🌌 Gravity</button>
          <button id="btn-toggle-orbits"  className={`analytics-btn glass-panel${showOrbits  ? ' analytics-btn--active' : ''}`} onClick={() => setShowOrbits(p => !p)}  title="Toggle orbital period HUD (O)">🔄 Orbits</button>
          <button id="btn-toggle-sound"   className={`analytics-btn glass-panel${soundOn ? ' analytics-btn--active' : ''}`}     onClick={() => setSoundOn(p => !p)}    title="Toggle ambient sound (S)">{soundOn ? '🔊' : '🔇'} Sound</button>
          <button id="btn-toggle-trails"  className={`analytics-btn glass-panel${trailStyle !== 'off' ? ' analytics-btn--active' : ''}`} onClick={() => setTrailIdx(p => (p + 1) % TRAIL_STYLES.length)} title="Cycle trail style (T)">✨ Trails: {trailStyle}</button>
          <button id="btn-toggle-trajectory" className={`analytics-btn glass-panel${showTrajectory ? ' analytics-btn--active' : ''}`} onClick={() => setShowTrajectory(p => !p)} title="Toggle trajectory preview (F)" disabled={!selectedBodyId}>📡 Trajectory</button>
          <button id="btn-toggle-minimap"  className={`analytics-btn glass-panel${showMiniMap ? ' analytics-btn--active' : ''}`}   onClick={() => setShowMiniMap(p => !p)}    title="Toggle mini-map (M)">🗺️ Map</button>
          <button id="btn-toggle-presets"  className={`analytics-btn glass-panel${showPresets ? ' analytics-btn--active' : ''}`}   onClick={() => setShowPresets(p => !p)}    title="Preset configurations (P)">🎯 Presets</button>
          <button id="btn-save-share"      className={`analytics-btn glass-panel${showShare ? ' analytics-btn--active' : ''}`}     onClick={() => setShowShare(p => !p)}      title="Save &amp; Share session (N)">💾 Share</button>
        </div>
      )}

      <Toolbar selectedType={selectedType} onSelectType={setSelectedType} />

      <PropertyPanel
        selectedType={selectedType}
        onConfigChange={setPlaceConfig}
        selectedBody={selectedBody}
        onRename={renameSelectedBody}
      />

      <EnergyDashboard engineRef={engine} visible={showEnergy} />
      <OrbitalPeriodHUD bodies={allBodies} visible={showOrbits} />

      <PlaybackBar
        engineRef={engine}
        canvasRef={canvasRef}
        camera={getCamera()}
        onBodyCountChange={setBodyCount}
        role={role}
        hostSimTime={hostSimTime}
      />

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

      <BodyInspector
        hoveredBody={hoveredBody}
        allBodies={allBodies}
        mousePos={inspectorPos}
      />

      <MiniMap
        engineRef={engine}
        camera={getCamera()}
        selectedBodyId={selectedBodyId}
        visible={showMiniMap && cameraMode === 'FOLLOW'}
      />

      <button
        className={`room-toggle-btn glass-panel${roomId && partnerOnline ? ' room-toggle-btn--online' : ''}`}
        onClick={() => setShowRoomPanel(p => !p)}
        title={showRoomPanel ? 'Close room panel' : 'Open room panel (R)'}
        aria-label="Toggle collaboration room panel"
      >
        👥 {roomId ? (partnerOnline ? 'Online' : 'Waiting') : 'Collab'}
      </button>

      {showPresets && (
        <PresetMenu
          onLoadPreset={loadPreset}
          onStartChallenge={handleStartChallenge}
          onClose={() => setShowPresets(false)}
        />
      )}

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

      <ShareModal
        visible={showShare}
        onClose={() => setShowShare(false)}
        bodies={allBodies}
        onLoad={loadSession}
      />

    </div>
  );
}
