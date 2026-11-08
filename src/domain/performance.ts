import type { DeviceInfo } from 'dubix-native';

/**
 * Performance profiles. "auto" resolves from real device capabilities (RAM, cores, low-RAM flag)
 * and is refined by the measured real-time factor of the last completed job. No hardware
 * acceleration is claimed: all inference runs on CPU threads.
 */
export type PerformanceProfile = 'light' | 'balanced' | 'high';

export type ProfileSpec = {
  label: string;
  asrModelId: string;
  speakerDetection: boolean;
  dubMode: 'prepare' | 'live';
  description: string;
};

export const PROFILES: Record<PerformanceProfile, ProfileSpec> = {
  light: {
    label: 'Light',
    asrModelId: 'asr-whisper-tiny',
    speakerDetection: false,
    dubMode: 'prepare',
    description: 'Smallest speech model, single voice. Best for phones with less than 4 GB RAM.',
  },
  balanced: {
    label: 'Balanced',
    asrModelId: 'asr-whisper-base',
    speakerDetection: true,
    dubMode: 'live',
    description: 'Better recognition and per-speaker voices while you watch.',
  },
  high: {
    label: 'High quality',
    asrModelId: 'asr-whisper-small',
    speakerDetection: true,
    dubMode: 'prepare',
    description: 'Largest speech model. Prepares the whole movie before playback.',
  },
};

/**
 * @param lastRealtimeFactor measured wall/media time of the last job (null if none yet)
 */
export function recommendProfile(device: DeviceInfo | null, lastRealtimeFactor: number | null = null): PerformanceProfile {
  if (!device) return 'balanced';
  let p: PerformanceProfile = device.lowRamDevice || device.totalRamMb < 4000 ? 'light' : device.totalRamMb >= 7500 && device.cpuCores >= 8 ? 'high' : 'balanced';
  // A slower-than-real-time job means the device cannot sustain this tier for live dubbing.
  if (lastRealtimeFactor !== null && lastRealtimeFactor > 1.2) p = p === 'high' ? 'balanced' : 'light';
  return p;
}

export function resolveProfile(setting: PerformanceProfile | 'auto', device: DeviceInfo | null, lastRtf: number | null = null): PerformanceProfile {
  return setting === 'auto' ? recommendProfile(device, lastRtf) : setting;
}
