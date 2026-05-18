import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';

const PORT = Number(process.env.PORT ?? 3001);
const PIN_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface Room {
  pin: string;
  hostSocketId: string;
  controllerSocketId: string | null;
  createdAt: number;
  ttlTimer: ReturnType<typeof setTimeout>;
}

const rooms = new Map<string, Room>();

// ─── Server Setup ─────────────────────────────────────────────────────────────

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

// ─── Room Helpers ─────────────────────────────────────────────────────────────

function deleteRoom(pin: string, reason = 'Session expired') {
  const room = rooms.get(pin);
  if (!room) return;
  clearTimeout(room.ttlTimer);
  if (room.controllerSocketId) {
    io.to(room.controllerSocketId).emit('room:error', { message: reason });
  }
  io.in(pin).socketsLeave(pin);
  rooms.delete(pin);
  console.log(`[server] Room ${pin} deleted — ${reason}`);
}

// ─── Socket Handlers ──────────────────────────────────────────────────────────

io.on('connection', (socket: Socket) => {
  console.log(`[server] Connected: ${socket.id}`);

  // ── Host: register PIN ──────────────────────────────────────────────────
  socket.on('host:register', (payload: { pin: string }, ack: (r: object) => void) => {
    const { pin } = payload ?? {};
    if (!pin || !/^\d{9}$/.test(pin)) {
      return ack({ success: false, error: 'Invalid PIN format' });
    }
    if (rooms.has(pin)) {
      return ack({ success: false, error: 'PIN already in use, try again' });
    }

    const ttlTimer = setTimeout(() => deleteRoom(pin), PIN_TTL_MS);
    rooms.set(pin, {
      pin,
      hostSocketId: socket.id,
      controllerSocketId: null,
      createdAt: Date.now(),
      ttlTimer,
    });

    socket.join(pin);
    console.log(`[server] Host ${socket.id} registered PIN ${pin}`);
    ack({ success: true });
  });

  // ── Controller: join PIN room ───────────────────────────────────────────
  socket.on('controller:join', (payload: { pin: string }, ack: (r: object) => void) => {
    const { pin } = payload ?? {};
    const room = rooms.get(pin);

    if (!room) return ack({ success: false, error: 'Session not found or expired' });
    if (room.controllerSocketId) return ack({ success: false, error: 'Session already has a controller' });

    room.controllerSocketId = socket.id;
    socket.join(pin);

    // Notify host
    io.to(room.hostSocketId).emit('controller:joined', { controllerId: socket.id });
    console.log(`[server] Controller ${socket.id} joined room ${pin}`);
    ack({ success: true, controllerId: socket.id });
  });

  // ── Host: approve controller ────────────────────────────────────────────
  socket.on('host:approve', (payload: { controllerId: string }) => {
    const { controllerId } = payload ?? {};
    io.to(controllerId).emit('host:approved');
    console.log(`[server] Host approved ${controllerId}`);
  });

  // ── Host: reject controller ─────────────────────────────────────────────
  socket.on('host:reject', (payload: { controllerId: string }) => {
    const { controllerId } = payload ?? {};
    io.to(controllerId).emit('host:rejected');
    // Remove controller from room so another can join
    for (const room of rooms.values()) {
      if (room.controllerSocketId === controllerId) {
        room.controllerSocketId = null;
      }
    }
    console.log(`[server] Host rejected ${controllerId}`);
  });

  // ── WebRTC signal relay ─────────────────────────────────────────────────
  socket.on('webrtc:signal', (payload: { sender: string; signal: unknown }) => {
    // Find the room this socket is in and relay to the other peer
    for (const room of rooms.values()) {
      if (room.hostSocketId === socket.id && room.controllerSocketId) {
        io.to(room.controllerSocketId).emit('webrtc:signal', payload);
        return;
      }
      if (room.controllerSocketId === socket.id) {
        io.to(room.hostSocketId).emit('webrtc:signal', payload);
        return;
      }
    }
  });

  // ── Disconnect cleanup ──────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[server] Disconnected: ${socket.id}`);

    for (const [pin, room] of rooms.entries()) {
      if (room.hostSocketId === socket.id) {
        // Host left — kill the room, notify controller
        if (room.controllerSocketId) {
          io.to(room.controllerSocketId).emit('peer:disconnected');
        }
        deleteRoom(pin, 'Host disconnected');
        return;
      }
      if (room.controllerSocketId === socket.id) {
        // Controller left — notify host, keep room alive
        room.controllerSocketId = null;
        io.to(room.hostSocketId).emit('peer:disconnected');
        console.log(`[server] Controller left room ${pin}`);
        return;
      }
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[server] RemoteCtrl signaling server running on port ${PORT}`);
});
