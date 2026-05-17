import { io, Socket } from 'socket.io-client';
import { BrowserWindow } from 'electron';
import type { HostSessionState, ControllerSessionState } from '../shared/types.js';

function generatePin(): string {
  return String(Math.floor(100_000_000 + Math.random() * 900_000_000));
}

/**
 * Manages the Socket.io connection to the signaling server.
 * Lives in the Electron main process. Pushes all state changes
 * to the renderer via win.webContents.send().
 */
export class SignalingClient {
  private socket: Socket | null = null;
  private role: 'host' | 'controller' | null = null;

  constructor(private readonly win: BrowserWindow) {}

  getRole() { return this.role; }

  // ─── Push helpers ────────────────────────────────────────────────────────

  private send(channel: string, ...args: unknown[]) {
    if (!this.win.isDestroyed()) {
      this.win.webContents.send(channel, ...args);
    }
  }

  private pushHostState(s: HostSessionState) { this.send('host:stateChange', s); }
  private pushCtrlState(s: ControllerSessionState) { this.send('controller:stateChange', s); }
  private pushError(msg: string) { this.send('app:error', msg); }

  // ─── Host mode ───────────────────────────────────────────────────────────

  async startHost(signalingUrl: string): Promise<void> {
    this.role = 'host';
    this.pushHostState('REGISTERING_PIN');

    const pin = generatePin();
    const socket = this.createSocket(signalingUrl);
    this.socket = socket;

    return new Promise((resolve, reject) => {
      socket.once('connect', () => {
        socket.emit(
          'host:register',
          { pin, capabilities: { version: '0.1.0', platform: process.platform } },
          (ack: { success: boolean; error?: string }) => {
            if (!ack.success) {
              this.pushError(`PIN registration failed: ${ack.error}`);
              this.pushHostState('DISCONNECTED');
              socket.disconnect();
              return reject(new Error(ack.error));
            }
            this.send('host:pin', pin);
            this.pushHostState('WAITING_FOR_CONTROLLER');
            resolve();
          }
        );
      });

      socket.once('connect_error', (err) => {
        this.pushError(`Cannot reach signaling server: ${err.message}`);
        this.pushHostState('DISCONNECTED');
        reject(err);
      });

      // Auto-forward WebRTC signals from socket to renderer
      socket.on('webrtc:signal', (payload: { signal: unknown }) => {
        const t = (payload.signal as any)?.type ?? '?';
        console.log(`[signaling] ${this.role} received webrtc:signal (${t}), pushing to renderer`);
        this.send('webrtc:signal', payload.signal);
      });

      // Controller joined → show approval modal
      socket.on('controller:joined', ({ controllerId }: { controllerId: string }) => {
        this.pushHostState('AWAITING_HOST_APPROVAL');
        this.send('controller:joinRequest', controllerId);
      });

      // Controller left
      socket.on('peer:disconnected', () => {
        this.pushHostState('WAITING_FOR_CONTROLLER');
        this.pushError('Controller disconnected');
      });

      socket.on('disconnect', (reason) => {
        if (reason !== 'io client disconnect') {
          this.pushHostState('DISCONNECTED');
          this.pushError('Lost connection to signaling server');
        }
      });
    });
  }

  approveController(controllerId: string) {
    this.socket?.emit('host:approve', { controllerId });
    this.pushHostState('SESSION_ACTIVE');
  }

  rejectController(controllerId: string) {
    this.socket?.emit('host:reject', { controllerId });
    this.pushHostState('WAITING_FOR_CONTROLLER');
  }

  // ─── Controller mode ─────────────────────────────────────────────────────

  async connectAsController(signalingUrl: string, pin: string): Promise<void> {
    this.role = 'controller';
    this.pushCtrlState('SIGNALING_CONNECTING');

    const socket = this.createSocket(signalingUrl);
    this.socket = socket;

    return new Promise((resolve, reject) => {
      socket.once('connect', () => {
        socket.emit(
          'controller:join',
          { pin },
          (ack: { success: boolean; error?: string }) => {
            if (!ack.success) {
              const msg = ack.error ?? 'Failed to join session';
              this.pushError(msg);
              this.pushCtrlState('DISCONNECTED');
              socket.disconnect();
              return reject(new Error(msg));
            }
            this.pushCtrlState('WAITING_FOR_HOST_APPROVAL');
            resolve();
          }
        );
      });

      socket.once('connect_error', (err) => {
        this.pushError(`Cannot reach signaling server: ${err.message}`);
        this.pushCtrlState('DISCONNECTED');
        reject(err);
      });

      // Auto-forward WebRTC signals from socket to renderer
      socket.on('webrtc:signal', (payload: { signal: unknown }) => {
        const t = (payload.signal as any)?.type ?? '?';
        console.log(`[signaling] ${this.role} received webrtc:signal (${t}), pushing to renderer`);
        this.send('webrtc:signal', payload.signal);
      });

      socket.on('host:approved', () => {
        this.pushCtrlState('SESSION_ACTIVE');
      });

      socket.on('host:rejected', () => {
        this.pushCtrlState('DISCONNECTED');
        this.pushError('Host rejected your connection request');
      });

      socket.on('room:error', ({ message }: { message: string }) => {
        this.pushError(message);
        this.pushCtrlState('DISCONNECTED');
      });

      socket.on('peer:disconnected', () => {
        this.pushCtrlState('DISCONNECTED');
        this.pushError('Host disconnected');
      });

      socket.on('disconnect', (reason) => {
        if (reason !== 'io client disconnect') {
          this.pushCtrlState('DISCONNECTED');
          this.pushError('Lost connection to signaling server');
        }
      });
    });
  }

  // ─── Phase 2 hook ────────────────────────────────────────────────────────

  sendSignal(sender: 'host' | 'controller', signal: unknown) {
    this.socket?.emit('webrtc:signal', { sender, signal });
  }

  onSignal(cb: (payload: { sender: string; signal: unknown }) => void) {
    this.socket?.on('webrtc:signal', cb);
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
    const wasRole = this.role;
    this.role = null;
    if (wasRole === 'host') this.pushHostState('IDLE');
    else if (wasRole === 'controller') this.pushCtrlState('IDLE');
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private createSocket(url: string): Socket {
    return io(url, {
      reconnection: false,   // manual reconnect only — keeps state machine simple
      timeout: 8000,
      transports: ['websocket', 'polling'],
    });
  }
}
