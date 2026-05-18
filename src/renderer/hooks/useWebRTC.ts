import { useEffect, useRef, useState } from 'react';
import type { DataChannelMessage } from '../../shared/types';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export type WebRTCStatus = 'idle' | 'launching' | 'capturing' | 'connecting' | 'streaming' | 'error';

// ─── Shared helper ─────────────────────────────────────────────────────────────

/**
 * Queue-flushing wrapper around addIceCandidate.
 * ICE candidates that arrive before setRemoteDescription must be buffered
 * and applied once the remote description is present.
 */
function makeIceQueue(pc: RTCPeerConnection) {
  const queue: RTCIceCandidateInit[] = [];
  let remoteSet = false;

  async function flush() {
    while (queue.length) {
      const c = queue.shift()!;
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { console.warn('[webrtc] addIceCandidate after flush failed', e); }
    }
  }

  return {
    async markRemoteSet() {
      remoteSet = true;
      await flush();
    },
    async add(candidate: RTCIceCandidateInit) {
      if (!remoteSet) {
        queue.push(candidate);
      } else {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { console.warn('[webrtc] addIceCandidate failed', e); }
      }
    },
  };
}

// ─── Host-side WebRTC hook ─────────────────────────────────────────────────────
// Uses the modern getDisplayMedia() approach. The main process intercepts this
// via session.setDisplayMediaRequestHandler and selects the Playwright window.

export function useHostWebRTC(isSessionActive: boolean) {
  const [status, setStatus] = useState<WebRTCStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSessionActive) return;

    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let stream: MediaStream | null = null;
    let cleanupSignal: (() => void) | undefined;
    let cleanupAgentStatus: (() => void) | undefined;
    let cleanupAgentLog: (() => void) | undefined;
    let cleanupWorkflowRunStatus: (() => void) | undefined;
    let cleanupWorkflowStepStatus: (() => void) | undefined;

    async function startWebRTC() {
      try {
        setStatus('launching');

        // 1. Launch Playwright browser (reuses if already running)
        await window.RemoteCtrlAPI.browser.launch();
        if (cancelled) return;

        // 2. Brief wait for OS window to become visible
        await new Promise((r) => setTimeout(r, 1500));
        if (cancelled) return;

        setStatus('capturing');

        // 3. Use getDisplayMedia — main process intercepts this via
        //    setDisplayMediaRequestHandler and selects the Playwright window
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        });

        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }

        console.log('[host-webrtc] Got display stream, tracks:', stream.getTracks().length);

        setStatus('connecting');

        // 4. Create peer connection and add tracks
        pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        stream.getTracks().forEach((track) => pc!.addTrack(track, stream!));

        const iceQueue = makeIceQueue(pc);

        // Data Channels
        const reliableChannel = pc.createDataChannel('RemoteCtrl-reliable', { ordered: true });
        const inputChannel = pc.createDataChannel('RemoteCtrl-input', { ordered: false, maxRetransmits: 0 });

        const handleDataMessage = async (event: MessageEvent) => {
          try {
            const msg = JSON.parse(event.data) as DataChannelMessage;
            if (msg.type === 'REMOTE_INPUT_MOUSE') {
              await window.RemoteCtrlAPI.browser.injectMouse(msg.payload as any);
            } else if (msg.type === 'REMOTE_INPUT_KEYBOARD') {
              await window.RemoteCtrlAPI.browser.injectKeyboard(msg.payload as any);
            } else if (msg.type === 'AGENT_PROMPT') {
              const res = await window.RemoteCtrlAPI.browser.startAgent(msg.payload as any);
              if (!res.ok) {
                const errMsg: DataChannelMessage = {
                  type: 'AGENT_STATUS_UPDATE',
                  version: '1.0',
                  timestamp: Date.now(),
                  payload: {
                    commandId: (msg.payload as any).commandId ?? 'unknown',
                    state: 'failed',
                    error: res.error,
                  },
                };
                reliableChannel.send(JSON.stringify(errMsg));
              }
            } else if (msg.type === 'AGENT_WORKFLOW_BATCH') {
              const res = await window.RemoteCtrlAPI.browser.startWorkflow(msg.payload as any);
              if (!res.ok) {
                const errMsg: DataChannelMessage = {
                  type: 'WORKFLOW_RUN_STATUS',
                  version: '1.0',
                  timestamp: Date.now(),
                  payload: {
                    workflowRunId: (msg.payload as any).workflowRunId ?? 'unknown',
                    state: 'failed',
                    error: res.error,
                  },
                };
                reliableChannel.send(JSON.stringify(errMsg));
              }
            } else if (msg.type === 'WORKFLOW_CANCEL') {
              await window.RemoteCtrlAPI.browser.cancelWorkflow();
            }
          } catch (err) {
            console.error('[host-webrtc] Error handling data channel message:', err);
          }
        };

        reliableChannel.onmessage = handleDataMessage;
        inputChannel.onmessage = handleDataMessage;

        // Forward agent status/log events from Main process back to Controller
        cleanupAgentStatus = window.RemoteCtrlAPI.on.agentStatus((payload) => {
          if (reliableChannel.readyState === 'open') {
            reliableChannel.send(JSON.stringify({
              type: 'AGENT_STATUS_UPDATE',
              version: '1.0',
              timestamp: Date.now(),
              payload,
            } satisfies DataChannelMessage));
          }
        });
        cleanupAgentLog = window.RemoteCtrlAPI.on.agentLog((payload) => {
          if (reliableChannel.readyState === 'open') {
            reliableChannel.send(JSON.stringify({
              type: 'AGENT_LOG',
              version: '1.0',
              timestamp: Date.now(),
              payload,
            } satisfies DataChannelMessage));
          }
        });

        // Relay workflow status events back to Controller
        cleanupWorkflowRunStatus = window.RemoteCtrlAPI.on.workflowRunStatus((payload) => {
          if (reliableChannel.readyState === 'open') {
            reliableChannel.send(JSON.stringify({
              type: 'WORKFLOW_RUN_STATUS',
              version: '1.0',
              timestamp: Date.now(),
              payload,
            } satisfies DataChannelMessage));
          }
        });
        cleanupWorkflowStepStatus = window.RemoteCtrlAPI.on.workflowStepStatus((payload) => {
          if (reliableChannel.readyState === 'open') {
            reliableChannel.send(JSON.stringify({
              type: 'WORKFLOW_STEP_STATUS',
              version: '1.0',
              timestamp: Date.now(),
              payload,
            } satisfies DataChannelMessage));
          }
        });

        // Outgoing ICE → relay to controller via signaling
        pc.onicecandidate = (e) => {
          if (e.candidate) {
            window.RemoteCtrlAPI.webrtc.sendSignal({
              type: 'ice-candidate',
              candidate: e.candidate.toJSON(),
            });
          }
        };

        pc.onconnectionstatechange = () => {
          console.log('[host-webrtc] Connection state:', pc?.connectionState);
        };

        // 5. Listen for controller's answer and ICE candidates
        cleanupSignal = window.RemoteCtrlAPI.on.webrtcSignal(async (raw) => {
          if (cancelled || !pc) return;
          const signal = raw as { type: string; sdpType?: string; sdpStr?: string; candidate?: RTCIceCandidateInit };
          try {
            if (signal.type === 'answer' && signal.sdpStr) {
              console.log('[host-webrtc] Got answer from controller');
              await pc.setRemoteDescription(new RTCSessionDescription({
                type: (signal.sdpType ?? 'answer') as RTCSdpType,
                sdp: signal.sdpStr,
              }));
              await iceQueue.markRemoteSet();
              setStatus('streaming');
            } else if (signal.type === 'ice-candidate' && signal.candidate) {
              await iceQueue.add(signal.candidate);
            }
          } catch (err) {
            console.error('[host-webrtc] signal handling error', err);
          }
        });

        // 6. Create and send offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log('[host-webrtc] Sending offer');
        // Send plain JSON with SDP as flat strings — nested objects get stripped in socket.io relay
        window.RemoteCtrlAPI.webrtc.sendSignal({
          type: 'offer',
          sdpType: pc.localDescription!.type,
          sdpStr: pc.localDescription!.sdp,
        });

      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          setStatus('error');
          console.error('[host-webrtc]', msg);
        }
      }
    }

    startWebRTC();

    return () => {
      cancelled = true;
      cleanupSignal?.();
      cleanupAgentStatus?.();
      cleanupAgentLog?.();
      cleanupWorkflowRunStatus?.();
      cleanupWorkflowStepStatus?.();
      stream?.getTracks().forEach((t) => t.stop());
      pc?.close();
      pc = null;
      setStatus('idle');
      setError(null);
    };
  }, [isSessionActive]);

  return { status, error };
}

// ─── Controller-side WebRTC hook ───────────────────────────────────────────────
// The PC and signal listener are created on mount (not gated by isSessionActive)
// so they're always ready when the offer arrives from the host.

export function useControllerWebRTC(_isSessionActive: boolean) {
  const [status, setStatus] = useState<WebRTCStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reliableChannelRef = useRef<RTCDataChannel | null>(null);
  const inputChannelRef = useRef<RTCDataChannel | null>(null);
  const onMessageRef = useRef<((msg: DataChannelMessage) => void) | null>(null);

  // Always-on: create PC and listen for signals on mount
  useEffect(() => {
    let cancelled = false;
    console.log('[ctrl-webrtc] Mounting, creating RTCPeerConnection');

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const iceQueue = makeIceQueue(pc);

    pc.ondatachannel = (e) => {
      const channel = e.channel;
      if (channel.label === 'RemoteCtrl-reliable') {
        reliableChannelRef.current = channel;
        channel.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data) as DataChannelMessage;
            onMessageRef.current?.(msg);
          } catch { /* ignore malformed */ }
        };
      } else if (channel.label === 'RemoteCtrl-input') {
        inputChannelRef.current = channel;
      }
    };

    pc.ontrack = (e) => {
      if (cancelled) return;
      console.log(`[ctrl-webrtc] Got remote track: ${e.track.kind}`);
      if (videoRef.current) {
        videoRef.current.srcObject = e.streams[0];
        videoRef.current.play().catch(() => { });
      }
      setStatus('streaming');
    };

    pc.onconnectionstatechange = () => {
      console.log(`[ctrl-webrtc] Connection state: ${pc.connectionState}`);
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        window.RemoteCtrlAPI.webrtc.sendSignal({
          type: 'ice-candidate',
          candidate: e.candidate.toJSON(),
        });
      }
    };

    const cleanupSignal = window.RemoteCtrlAPI.on.webrtcSignal(async (raw) => {
      if (cancelled) return;
      const signal = raw as {
        type: string;
        sdpType?: string; sdpStr?: string;  // flat SDP fields
        candidate?: RTCIceCandidateInit;
      };
      try {
        if (signal.type === 'offer' && signal.sdpStr) {
          console.log('[ctrl-webrtc] Got offer, calling setRemoteDescription');
          setStatus('connecting');
          await pc.setRemoteDescription(new RTCSessionDescription({
            type: (signal.sdpType ?? 'offer') as RTCSdpType,
            sdp: signal.sdpStr,
          }));
          console.log('[ctrl-webrtc] setRemoteDescription done, flushing ICE');
          await iceQueue.markRemoteSet();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          console.log('[ctrl-webrtc] Sending answer');
          window.RemoteCtrlAPI.webrtc.sendSignal({
            type: 'answer',
            sdpType: pc.localDescription!.type,
            sdpStr: pc.localDescription!.sdp,
          });
        } else if (signal.type === 'ice-candidate' && signal.candidate) {
          await iceQueue.add(signal.candidate);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[ctrl-webrtc] SIGNAL ERROR: ${msg}`);
          setError(msg);
          setStatus('error');
        }
      }
    });

    return () => {
      cancelled = true;
      cleanupSignal();
      pc.close();
      if (videoRef.current) videoRef.current.srcObject = null;
      reliableChannelRef.current = null;
      inputChannelRef.current = null;
      setStatus('idle');
      setError(null);
    };
  }, []); // <-- mount once, always listening

  const sendData = (msg: DataChannelMessage, reliable = true) => {
    const channel = reliable ? reliableChannelRef.current : inputChannelRef.current;
    if (channel && channel.readyState === 'open') {
      channel.send(JSON.stringify(msg));
    } else {
      console.warn('[ctrl-webrtc] Cannot send data, channel not open');
    }
  };

  const onMessage = (cb: (msg: DataChannelMessage) => void) => {
    onMessageRef.current = cb;
  };

  return { videoRef, status, error, sendData, onMessage };
}
