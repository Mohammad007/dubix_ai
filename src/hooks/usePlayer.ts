import { useEffect, useState } from 'react';

import { DubixNative, type PlayerStateEvent } from 'dubix-native';

export type PlayerSnapshot = { positionMs: number; durationMs: number; isPlaying: boolean; state: PlayerStateEvent['state']; message?: string };

/** Live position/state of a native player (≈10 Hz updates from Kotlin). */
export function usePlayerState(playerId: string | null): PlayerSnapshot {
  const [snap, setSnap] = useState<PlayerSnapshot>({ positionMs: 0, durationMs: 0, isPlaying: false, state: 'idle' });
  useEffect(() => {
    if (!playerId || !DubixNative) return;
    const sub = DubixNative.addListener('onPlayerState', (e) => {
      if (e.playerId !== playerId) return;
      setSnap((p) => ({
        positionMs: e.positionMs ?? p.positionMs,
        durationMs: e.durationMs || p.durationMs,
        isPlaying: e.isPlaying ?? (e.state === 'error' ? false : p.isPlaying),
        state: e.state,
        message: e.message,
      }));
    });
    return () => sub.remove();
  }, [playerId]);
  return snap;
}
