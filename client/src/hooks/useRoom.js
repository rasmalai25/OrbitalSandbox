// hooks/useRoom.js
// Phase 4 — room creation/joining + socket→engine wiring.
// Phase 8 — chat history, partner cursor, annotations, tug-of-war.

import { useState, useEffect, useCallback, useRef } from 'react';
import { getSocket } from '../socket/socketClient.js';
import {
  applySyncedTick, applyRemoteBodyPlaced, applyRemoteBodyRemoved,
  applyRemoteBodyUpdated,
} from '../socket/syncEngine.js';
import { resumeLoop, pauseLoop, setSpeed } from '../simulation/SimulationLoop.js';
import {
  setPartnerCursor, addAnnotation, applyPartnerTug,
} from '../simulation/SimulationLoop.js';
import Matter from 'matter-js';

export function useRoom(engineRef, onBodyCountChange) {
  const [roomId, setRoomId]                 = useState(null);
  const [role, setRole]                     = useState(null);  // 'host' | 'observer' | null
  const [partnerOnline, setPartnerOnline]   = useState(false);
  const [chatMessages, setChatMessages]     = useState([]);
  const [hostSimTime, setHostSimTime]       = useState(null);
  const tickFrameRef = useRef(0);

  const roleRef = useRef(role);
  useEffect(() => { roleRef.current = role; }, [role]);

  // ── Wire socket events once on mount ─────────────────────
  useEffect(() => {
    const socket = getSocket();

    socket.on('partner_joined', () => setPartnerOnline(true));
    socket.on('partner_disconnected', () => {
      setPartnerOnline(false);
      setPartnerCursor(null);
    });

    socket.on('sim_tick', ({ bodies, simTime }) => {
      if (roleRef.current === 'host') return;
      const engine = engineRef.current;
      if (!engine) return;
      applySyncedTick(engine, bodies);
      if (simTime != null) setHostSimTime(simTime);
    });

    socket.on('body_placed', (bodyData) => {
      const engine = engineRef.current;
      if (!engine) return;
      applyRemoteBodyPlaced(engine, bodyData);
      onBodyCountChange?.(prev => prev + 1);
    });

    socket.on('body_updated', (update) => {
      const engine = engineRef.current;
      if (!engine) return;
      applyRemoteBodyUpdated(engine, update);
    });

    socket.on('body_removed', ({ bodyId }) => {
      const engine = engineRef.current;
      if (!engine) return;
      applyRemoteBodyRemoved(engine, bodyId);
      onBodyCountChange?.(prev => Math.max(0, prev - 1));
    });

    socket.on('sim_control', ({ action, speed }) => {
      if (roleRef.current === 'host') return;
      if (action === 'pause')    pauseLoop();
      if (action === 'resume')   resumeLoop();
      if (action === 'setSpeed') setSpeed(speed);
    });

    socket.on('partner_cursor', ({ x, y }) => {
      // World-space coords (camera doc §socket-sync). Renderer projects to screen.
      setPartnerCursor({ x, y });
    });

    socket.on('chat_message', (msg) => {
      setChatMessages(prev => [...prev, msg]);
    });

    socket.on('annotation_draw', (annotation) => {
      addAnnotation(annotation);
    });

    socket.on('tug_of_war', ({ bodyId, force, fromId }) => {
      applyPartnerTug({ bodyId, force, fromId });
    });

    return () => {
      socket.off('partner_joined');
      socket.off('partner_disconnected');
      socket.off('body_placed');
      socket.off('body_updated');
      socket.off('sim_tick');
      socket.off('body_removed');
      socket.off('sim_control');
      socket.off('partner_cursor');
      socket.off('chat_message');
      socket.off('annotation_draw');
      socket.off('tug_of_war');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Adopt a room that was created/joined on a prior screen ────────
  // Frontend §1: when SimulationScreen mounts after MP_SELECT/LOBBY, the
  // socket is still in the room on the server but the React state has
  // reset (the hook just remounted). Re-emitting create_room/join_room
  // would either fail or assign the wrong role. adoptRoom restores the
  // React state without any server traffic.
  const adoptRoom = useCallback((id, r) => {
    if (!id || !r) return;
    setRoomId(id);
    setRole(r);
    setPartnerOnline(true); // we got here, both sides connected
  }, []);

  // ── Create a new room ──────────────────────────────────
  const createRoom = useCallback(() => {
    const socket = getSocket();
    socket.emit('create_room', ({ roomId: id, role: r }) => {
      setRoomId(id);
      setRole(r);
    });
  }, []);

  // ── Join an existing room ──────────────────────────────
  const joinRoom = useCallback((id) => {
    const socket = getSocket();
    socket.emit('join_room', { roomId: id }, ({ error, role: r, initialState }) => {
      if (error) { console.error('[Room] Join error:', error); return; }
      setRoomId(id);
      setRole(r);

      const engine = engineRef.current;
      if (engine && initialState) {
        // Apply existing bodies via the host's metadata; if a lastTick is
        // present, also apply it so the observer sees current positions
        // (not stale placement positions).
        initialState.bodies?.forEach(b => applyRemoteBodyPlaced(engine, b));
        if (initialState.lastTick?.bodies) {
          applySyncedTick(engine, initialState.lastTick.bodies);
        }
        onBodyCountChange?.(initialState.bodies?.length || 0);
      }

      // Surface existing chat history so a late observer sees what was said
      if (initialState?.chatHistory?.length) {
        setChatMessages(initialState.chatHistory);
      }
    });
  }, [engineRef, onBodyCountChange]);

  // ── Emit body placement (includes name so partner stays in sync) ─────
  const emitBodyPlaced = useCallback((body) => {
    if (!roomId) return;
    getSocket().emit('body_placed', {
      id:        body.customData.id,
      type:      body.customData.type,
      name:      body.customData.name,
      x:         body.position.x,
      y:         body.position.y,
      mass:      body.mass,
      velocityX: body.velocity.x,
      velocityY: body.velocity.y,
      ownerId:   body.customData.ownerId,
    });
  }, [roomId]);

  // ── Emit body update (rename, mass change, velocity tweak) ─────
  const emitBodyUpdated = useCallback((update) => {
    if (!roomId) return;
    getSocket().emit('body_updated', update);
  }, [roomId]);

  // ── Emit sim_tick (host only, every 6 frames) ──────────
  const emitTickIfHost = useCallback((engine) => {
    if (role !== 'host' || !roomId) return;
    tickFrameRef.current++;
    if (tickFrameRef.current % 6 !== 0) return;

    const bodies = Matter.Composite.allBodies(engine.world).map(b => ({
      id:    b.customData?.id,
      x:     b.position.x,
      y:     b.position.y,
      vx:    b.velocity.x,
      vy:    b.velocity.y,
      angle: b.angle,
    }));

    getSocket().emit('sim_tick', { bodies, simTime: tickFrameRef.current });
  }, [role, roomId]);

  // ── Emit sim_control (host only) ───────────────────────
  const emitSimControl = useCallback((action, speed) => {
    if (role !== 'host' || !roomId) return;
    getSocket().emit('sim_control', { action, speed });
  }, [role, roomId]);

  // ── Send chat ──────────────────────────────────────────
  const sendChat = useCallback((text) => {
    if (!roomId || !text?.trim()) return;
    getSocket().emit('chat_message', { text: text.trim() });
  }, [roomId]);

  // ── Emit cursor (world coords) ─────────────────────────
  const emitCursor = useCallback((x, y) => {
    if (!roomId) return;
    getSocket().emit('cursor_move', { x, y });
  }, [roomId]);

  // ── Emit annotation stroke ─────────────────────────────
  const emitAnnotation = useCallback((annotation) => {
    if (!roomId) return;
    getSocket().emit('annotation_draw', annotation);
  }, [roomId]);

  // ── Emit tug-of-war force vector ───────────────────────
  const emitTug = useCallback((bodyId, force) => {
    if (!roomId) return;
    getSocket().emit('tug_of_war', { bodyId, force });
  }, [roomId]);

  return {
    roomId, role, partnerOnline,
    chatMessages, hostSimTime,
    createRoom, joinRoom, adoptRoom,
    emitBodyPlaced, emitBodyUpdated,
    emitTickIfHost, emitSimControl,
    sendChat, emitCursor,
    emitAnnotation, emitTug,
  };
}
