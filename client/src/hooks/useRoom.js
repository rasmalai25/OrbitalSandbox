// hooks/useRoom.js
// Phase 4 — manages room creation/joining and wires socket events to the engine.

import { useState, useEffect, useCallback, useRef } from 'react';
import { getSocket } from '../socket/socketClient.js';
import { applySyncedTick, applyRemoteBodyPlaced, applyRemoteBodyRemoved } from '../socket/syncEngine.js';
import { resumeLoop, pauseLoop, setSpeed } from '../simulation/SimulationLoop.js';
import Matter from 'matter-js';

/**
 * @param {React.RefObject} engineRef  - from useSimulation
 * @param {function} onBodyCountChange - increments/decrements local counter
 */
export function useRoom(engineRef, onBodyCountChange) {
  const [roomId, setRoomId] = useState(null);
  const [role, setRole] = useState(null);    // 'host' | 'observer' | null
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [partnerCursor, setPartnerCursor] = useState(null); // { x, y }
  const [hostSimTime, setHostSimTime] = useState(null);     // observer tracks host's simTime
  const tickFrameRef = useRef(0);

  // ── Live ref so socket handlers always see the current role ─
  const roleRef = useRef(role);
  useEffect(() => { roleRef.current = role; }, [role]);

  // ── Wire socket events once on mount ─────────────────────
  // Using roleRef.current inside handlers prevents stale-closure bugs
  // (previously, role was captured at effect-registration time, so
  //  sim_tick would still see role=null after the observer joined).
  useEffect(() => {
    const socket = getSocket();

    socket.on('partner_joined', () => setPartnerOnline(true));
    socket.on('partner_disconnected', () => {
      setPartnerOnline(false);
      setPartnerCursor(null);
    });

    // Observer applies host ticks; host skips (it IS the source of truth).
    socket.on('sim_tick', ({ bodies, simTime }) => {
      if (roleRef.current === 'host') return;
      const engine = engineRef.current;
      if (!engine) return;
      applySyncedTick(engine, bodies);
      if (simTime != null) setHostSimTime(simTime);
    });

    // BOTH host AND observer receive body_placed from the other person.
    // Server uses socket.to() so you never receive your own emission.
    socket.on('body_placed', (bodyData) => {
      const engine = engineRef.current;
      if (!engine) return;
      applyRemoteBodyPlaced(engine, bodyData);
      onBodyCountChange?.(prev => prev + 1);
    });

    socket.on('body_removed', ({ bodyId }) => {
      const engine = engineRef.current;
      if (!engine) return;
      applyRemoteBodyRemoved(engine, bodyId);
      onBodyCountChange?.(prev => Math.max(0, prev - 1));
    });

    // Observer mirrors host sim_control; host ignores incoming controls.
    socket.on('sim_control', ({ action, speed }) => {
      if (roleRef.current === 'host') return;
      if (action === 'pause') pauseLoop();
      if (action === 'resume') resumeLoop();
      if (action === 'setSpeed') setSpeed(speed);
    });

    socket.on('partner_cursor', ({ x, y }) => setPartnerCursor({ x, y }));
    socket.on('chat_message', (msg) => setChatMessages(prev => [...prev, msg]));

    return () => {
      socket.off('partner_joined');
      socket.off('partner_disconnected');
      socket.off('body_placed');
      socket.off('sim_tick');
      socket.off('body_removed');
      socket.off('sim_control');
      socket.off('partner_cursor');
      socket.off('chat_message');
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only — role read via roleRef, engineRef is a stable ref

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
      // Materialize existing bodies from host
      const engine = engineRef.current;
      if (engine && initialState?.bodies) {
        initialState.bodies.forEach(b => applyRemoteBodyPlaced(engine, b));
        onBodyCountChange?.(initialState.bodies.length);
      }
    });
  }, [engineRef, onBodyCountChange]);

  // ── Emit a body placement to partner ──────────────────
  const emitBodyPlaced = useCallback((body) => {
    if (!roomId) return;
    const socket = getSocket();
    socket.emit('body_placed', {
      id: body.customData.id,
      type: body.customData.type,
      x: body.position.x,
      y: body.position.y,
      mass: body.mass,
      velocityX: body.velocity.x,
      velocityY: body.velocity.y,
      ownerId: body.customData.ownerId,
    });
  }, [roomId]);

  // ── Emit sim_tick (host only, every 6 frames) ──────────
  const emitTickIfHost = useCallback((engine) => {
    if (role !== 'host' || !roomId) return;
    tickFrameRef.current++;
    if (tickFrameRef.current % 6 !== 0) return;

    const bodies = Matter.Composite.allBodies(engine.world).map(b => ({
      id: b.customData?.id,
      x: b.position.x,
      y: b.position.y,
      vx: b.velocity.x,
      vy: b.velocity.y,
      angle: b.angle,
    }));

    getSocket().emit('sim_tick', { bodies, simTime: tickFrameRef.current });
  }, [role, roomId]);

  // ── Emit sim_control (host only) ───────────────────────
  const emitSimControl = useCallback((action, speed) => {
    if (role !== 'host' || !roomId) return;
    getSocket().emit('sim_control', { action, speed });
  }, [role, roomId]);

  // ── Send chat message ──────────────────────────────────
  const sendChat = useCallback((text) => {
    if (!roomId) return;
    getSocket().emit('chat_message', { text });
  }, [roomId]);

  // ── Emit cursor position ───────────────────────────────
  const emitCursor = useCallback((x, y) => {
    if (!roomId) return;
    getSocket().emit('cursor_move', { x, y });
  }, [roomId]);

  return {
    roomId,
    role,
    partnerOnline,
    chatMessages,
    partnerCursor,
    hostSimTime,
    createRoom,
    joinRoom,
    emitBodyPlaced,
    emitTickIfHost,
    emitSimControl,
    sendChat,
    emitCursor,
  };
}
