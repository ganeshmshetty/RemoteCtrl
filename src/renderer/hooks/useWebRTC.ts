import { useEffect, useRef, useState } from 'react';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export type WebRTCStatus = 'idle' | 'launching' | 'capturing' | 'connecting' | 'streaming' | 'error';

// ─── Host-side WebRTC hook ─────────────────────────────────────────────────────

export function useHostWebRTC(isSessionActive: boolean) {
  const [status, setStatus] = useState<WebRTCStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!isSessionActive) return;

    let cancelled = false;

    async function startWebRTC() {
      try {
        setStatus('launching');

        // 1. Launch Playwright browser and get unique window title
        const windowTitle = await window.remconAPI.browser.launch();

        if (cancelled) return;

        // 2. Wait briefly for window to be visible to desktopCapturer
        await new Promise((r) => setTimeout(r, 1500));

        setStatus('capturing');

        // 3. Get all available capture sources from main process
        const sources = await window.remconAPI.browser.getSources();
        const source =
          sources.find((s) => s.name.includes(windowTitle)) ??  // exact title match
          sources.find((s) => s.name.toLowerCase().includes('chromium')) ??
          sources.find((s) => s.name.toLowerCase().includes('chrome')) ??
          sources.find((s) => s.id.startsWith('screen:')); // fallback: primary screen

        if (!source) throw new Error('Could not find browser capture source');

        // 4. Capture the window via getUserMedia (Electron-specific API)
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

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        setStatus('connecting');

        // 5. Create WebRTC peer connection
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;

        // Add tracks
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        // ICE candidates → relay via main → socket
        pc.onicecandidate = (e) => {
          if (e.candidate) {
            window.remconAPI.webrtc.sendSignal({
              type: 'ice-candidate',
              candidate: e.candidate.toJSON(),
            });
          }
        };

        // 6. Listen for answer + remote ICE from controller
        const cleanup = window.remconAPI.on.webrtcSignal(async (raw) => {
          const signal = raw as { type: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
          try {
            if (signal.type === 'answer' && signal.sdp) {
              await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
              setStatus('streaming');
            } else if (signal.type === 'ice-candidate' && signal.candidate) {
              await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            }
          } catch (err) {
            console.error('[host-webrtc] signal error', err);
          }
        });

        // 7. Create offer
        const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
        await pc.setLocalDescription(offer);

        window.remconAPI.webrtc.sendSignal({ type: 'offer', sdp: pc.localDescription });

        return cleanup;
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          setStatus('error');
          console.error('[host-webrtc]', msg);
        }
      }
    }

    let cleanupFn: (() => void) | undefined;
    startWebRTC().then((fn) => { cleanupFn = fn; });

    return () => {
      cancelled = true;
      cleanupFn?.();
      pcRef.current?.close();
      pcRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      window.remconAPI.browser.close().catch(() => {});
      setStatus('idle');
    };
  }, [isSessionActive]);

  return { status, error };
}

// ─── Controller-side WebRTC hook ───────────────────────────────────────────────

export function useControllerWebRTC(isSessionActive: boolean) {
  const [status, setStatus] = useState<WebRTCStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  useEffect(() => {
    if (!isSessionActive) return;

    let cancelled = false;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;
    setStatus('connecting');

    // Remote track → attach to video element
    pc.ontrack = (e) => {
      if (cancelled) return;
      if (videoRef.current) {
        videoRef.current.srcObject = e.streams[0];
        videoRef.current.play().catch(() => {});
      }
      setStatus('streaming');
    };

    // ICE candidates → relay via main → socket
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        window.remconAPI.webrtc.sendSignal({
          type: 'ice-candidate',
          candidate: e.candidate.toJSON(),
        });
      }
    };

    // Listen for offer + remote ICE from host
    const cleanupSignal = window.remconAPI.on.webrtcSignal(async (raw) => {
      const signal = raw as { type: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
      try {
        if (signal.type === 'offer' && signal.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          window.remconAPI.webrtc.sendSignal({ type: 'answer', sdp: pc.localDescription });
        } else if (signal.type === 'ice-candidate' && signal.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          setStatus('error');
        }
      }
    });

    return () => {
      cancelled = true;
      cleanupSignal();
      pc.close();
      pcRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setStatus('idle');
    };
  }, [isSessionActive]);

  return { videoRef, status, error };
}
