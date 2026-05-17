import { useEffect, useRef, useState } from 'react';

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

    async function startWebRTC() {
      try {
        setStatus('launching');

        // 1. Launch Playwright browser (reuses if already running)
        await window.remconAPI.browser.launch();
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

        // Outgoing ICE → relay to controller via signaling
        pc.onicecandidate = (e) => {
          if (e.candidate) {
            window.remconAPI.webrtc.sendSignal({
              type: 'ice-candidate',
              candidate: e.candidate.toJSON(),
            });
          }
        };

        pc.onconnectionstatechange = () => {
          console.log('[host-webrtc] Connection state:', pc?.connectionState);
        };

        // 5. Listen for controller's answer and ICE candidates
        cleanupSignal = window.remconAPI.on.webrtcSignal(async (raw) => {
          if (cancelled || !pc) return;
          const signal = raw as { type: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
          try {
            if (signal.type === 'answer' && signal.sdp) {
              console.log('[host-webrtc] Got answer from controller');
              await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
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
        window.remconAPI.webrtc.sendSignal({ type: 'offer', sdp: pc.localDescription });

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

export function useControllerWebRTC(isSessionActive: boolean) {
  const [status, setStatus] = useState<WebRTCStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!isSessionActive) return;

    let cancelled = false;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    setStatus('connecting');

    const iceQueue = makeIceQueue(pc);

    // Remote video track → play in video element
    pc.ontrack = (e) => {
      if (cancelled) return;
      console.log('[ctrl-webrtc] Got remote track:', e.track.kind);
      if (videoRef.current) {
        videoRef.current.srcObject = e.streams[0];
        videoRef.current.play().catch(() => {});
      }
      setStatus('streaming');
    };

    pc.onconnectionstatechange = () => {
      console.log('[ctrl-webrtc] Connection state:', pc.connectionState);
    };

    // Outgoing ICE → relay to host via signaling
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        window.remconAPI.webrtc.sendSignal({
          type: 'ice-candidate',
          candidate: e.candidate.toJSON(),
        });
      }
    };

    // Receive offer + ICE from host
    const cleanupSignal = window.remconAPI.on.webrtcSignal(async (raw) => {
      if (cancelled) return;
      const signal = raw as { type: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
      try {
        if (signal.type === 'offer' && signal.sdp) {
          console.log('[ctrl-webrtc] Got offer, creating answer');
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          await iceQueue.markRemoteSet();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          console.log('[ctrl-webrtc] Sending answer');
          window.remconAPI.webrtc.sendSignal({ type: 'answer', sdp: pc.localDescription });
        } else if (signal.type === 'ice-candidate' && signal.candidate) {
          await iceQueue.add(signal.candidate);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          setStatus('error');
          console.error('[ctrl-webrtc]', msg);
        }
      }
    });

    return () => {
      cancelled = true;
      cleanupSignal();
      pc.close();
      if (videoRef.current) videoRef.current.srcObject = null;
      setStatus('idle');
      setError(null);
    };
  }, [isSessionActive]);

  return { videoRef, status, error };
}
