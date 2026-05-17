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
 * and applied once the remote description is present (standard race condition).
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
// Browser is launched by main process on host:start, so this hook only handles
// desktopCapturer + WebRTC offer. This keeps the browser alive across reconnects.

export function useHostWebRTC(isSessionActive: boolean, windowTitle: string) {
  const [status, setStatus] = useState<WebRTCStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSessionActive || !windowTitle) return;

    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let cleanupSignal: (() => void) | undefined;

    async function startWebRTC() {
      try {
        setStatus('capturing');

        // Brief wait to ensure window is visible to desktopCapturer
        await new Promise((r) => setTimeout(r, 1000));
        if (cancelled) return;

        // Get capture sources from main process
        const sources = await window.remconAPI.browser.getSources();
        const source =
          sources.find((s) => s.name.includes(windowTitle)) ??
          sources.find((s) => s.name.toLowerCase().includes('chromium')) ??
          sources.find((s) => s.name.toLowerCase().includes('chrome')) ??
          sources.find((s) => s.id.startsWith('screen:'));

        if (!source) throw new Error('Could not find browser capture source');
        if (cancelled) return;

        // Capture via Electron desktop extension
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            // @ts-expect-error — Electron-specific mandatory constraint
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: source.id,
              maxWidth: 1920,
              maxHeight: 1080,
              maxFrameRate: 30,
            },
          },
        });

        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }

        setStatus('connecting');

        pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        stream.getTracks().forEach((track) => pc!.addTrack(track, stream));

        const iceQueue = makeIceQueue(pc);

        pc.onicecandidate = (e) => {
          if (e.candidate) {
            window.remconAPI.webrtc.sendSignal({
              type: 'ice-candidate',
              candidate: e.candidate.toJSON(),
            });
          }
        };

        cleanupSignal = window.remconAPI.on.webrtcSignal(async (raw) => {
          if (cancelled || !pc) return;
          const signal = raw as { type: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
          try {
            if (signal.type === 'answer' && signal.sdp) {
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

        const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
        await pc.setLocalDescription(offer);
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
      pc?.close();
      pc = null;
      setStatus('idle');
      setError(null);
    };
  }, [isSessionActive, windowTitle]);

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
      if (videoRef.current) {
        videoRef.current.srcObject = e.streams[0];
        videoRef.current.play().catch(() => {});
      }
      setStatus('streaming');
    };

    // Outgoing ICE → relay to host via main → socket
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
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          await iceQueue.markRemoteSet();  // flush buffered ICE
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          window.remconAPI.webrtc.sendSignal({ type: 'answer', sdp: pc.localDescription });
        } else if (signal.type === 'ice-candidate' && signal.candidate) {
          await iceQueue.add(signal.candidate);  // buffer if SDP not yet set
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
