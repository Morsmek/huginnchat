/**
 * Zero-knowledge signaling.
 *
 * Cross-device: manual SDP copy-paste (same as Plinxx).
 * Same-browser: BroadcastChannel for instant tab-to-tab connection.
 *
 * NO servers. NO WebSockets. NO relay. Nothing is ever transmitted
 * outside the browser except what the user explicitly copies and pastes.
 *
 * The encryption key lives only in the URL fragment (#key=...) which
 * is never sent to any server by browsers.
 */

export type SignalMessage =
  | { type: 'join';   from: string; name: string }
  | { type: 'leave';  from: string }
  | { type: 'offer';  from: string; to: string; sdp: string; candidates: RTCIceCandidateInit[] }
  | { type: 'answer'; from: string; to: string; sdp: string; candidates: RTCIceCandidateInit[] };

export type SignalHandler = (msg: SignalMessage) => void;

/**
 * BroadcastChannel-based signaling for same-browser sessions.
 * Instant, zero-latency, completely serverless.
 */
export class LocalSignalingChannel {
  private channel: BroadcastChannel;
  private peerId: string;
  private handlers: SignalHandler[] = [];

  constructor(roomId: string, peerId: string) {
    this.peerId = peerId;
    this.channel = new BroadcastChannel(`huginn::${roomId}`);
    this.channel.onmessage = (e) => {
      if (e.data?.from !== this.peerId) {
        this.handlers.forEach(h => h(e.data));
      }
    };
  }

  send(msg: SignalMessage) {
    this.channel.postMessage(msg);
  }

  onMessage(handler: SignalHandler): () => void {
    this.handlers.push(handler);
    return () => { this.handlers = this.handlers.filter(h => h !== handler); };
  }

  close() {
    this.channel.close();
  }
}

/**
 * Manual SDP exchange — user copies offer text, pastes answer text.
 * Used for cross-device connections. Produces self-contained JSON blobs
 * that include all ICE candidates (gathered via trickle wait).
 */
export interface ManualOffer {
  type: 'offer';
  from: string;
  fromName: string;
  sdp: string;
  candidates: RTCIceCandidateInit[];
}

export interface ManualAnswer {
  type: 'answer';
  from: string;
  fromName: string;
  to: string;
  sdp: string;
  candidates: RTCIceCandidateInit[];
}

export function encodeSignal(data: ManualOffer | ManualAnswer): string {
  return btoa(JSON.stringify(data));
}

export function decodeSignal(encoded: string): ManualOffer | ManualAnswer | null {
  try {
    return JSON.parse(atob(encoded));
  } catch {
    return null;
  }
}

/**
 * Gather all ICE candidates and return them with the local description.
 * Waits for ICE gathering to complete (max 4s) so the blob is self-contained.
 */
export async function gatherCompleteDescription(
  pc: RTCPeerConnection
): Promise<{ sdp: string; candidates: RTCIceCandidateInit[] }> {
  const candidates: RTCIceCandidateInit[] = [];

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 4000);
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        candidates.push(candidate.toJSON());
      } else {
        clearTimeout(timeout);
        resolve();
      }
    };
  });

  return { sdp: pc.localDescription!.sdp, candidates };
}
