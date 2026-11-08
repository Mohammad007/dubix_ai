import type { DubConfig } from 'dubix-native';

export type SilenceTrim = 'off' | 'light' | 'aggressive';

/** Max internal pause kept in synthesized speech for each trimming mode. */
export function maxPauseSec(mode: SilenceTrim): number {
  return mode === 'off' ? 0 : mode === 'light' ? 0.3 : 0.6;
}

export const OFFSET_RANGE = { min: -1000, max: 1000, step: 20 } as const;
export const SPEED_RANGE = { min: 0.8, max: 1.2 } as const;

export function clampOffset(ms: number): number {
  return Math.max(OFFSET_RANGE.min, Math.min(OFFSET_RANGE.max, Math.round(ms / OFFSET_RANGE.step) * OFFSET_RANGE.step));
}

export function speedPreset(speed: number): 'slower' | 'normal' | 'faster' {
  if (speed < 0.97) return 'slower';
  if (speed > 1.03) return 'faster';
  return 'normal';
}

export type PlaybackMix = {
  dubEnabled: boolean;
  offsetMs: number;
  autoSync: boolean;
  /** measured output latency of the dub track (Bluetooth adds ~100-300 ms) */
  measuredLatencyMs: number;
  originalVolume: number;
  dubVolume: number;
  duckWhileDubbing: boolean;
  duckLevel: number;
};

/**
 * Native dub configuration. With automatic sync the scheduler already compensates the measured
 * output latency, so only the user's manual offset is applied on top.
 */
export function toDubConfig(m: PlaybackMix): DubConfig {
  return {
    enabled: m.dubEnabled,
    offsetMs: m.autoSync ? m.offsetMs : m.offsetMs - m.measuredLatencyMs,
    dubVolume: clamp01(m.dubVolume),
    originalVolume: clamp01(m.originalVolume),
    duckWhileDubbing: m.duckWhileDubbing,
    duckLevel: clamp01(m.duckLevel),
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Honest warning shown whenever the original track is lowered or muted. */
export const ORIGINAL_AUDIO_WARNING =
  'The original soundtrack is a single mixed track. Lowering or muting it also lowers background music and sound effects. ' +
  'Separating dialogue from music is not available on-device in this version.';
