import type { DeviceInfo } from 'dubix-native';

import { wavBytes } from '@/database/repositories/segments';
import { errorInfo } from '@/domain/errors';
import { recommendProfile, resolveProfile } from '@/domain/performance';
import { addRange, coveredMs, leadAt, rangeAt, resumePoint } from '@/domain/ranges';
import { availableVoices } from '@/domain/voiceMapping';

const device: DeviceInfo = {
  apiLevel: 34, release: '14', manufacturer: 'T', model: 'P', abis: ['arm64-v8a'], cpuCores: 8, totalRamMb: 8192, availRamMb: 4000,
  lowRamDevice: false, storageTotalBytes: 128e9, storageFreeBytes: 40e9, playbackCaptureSupported: true, canDrawOverlays: false,
  powerSaveMode: false, thermalStatus: 0, batteryPct: 80, charging: false,
};

describe('covered ranges (live dubbing / seek resynchronisation)', () => {
  it('merges overlapping and nearly-touching ranges', () => {
    let r = addRange([], [0, 10_000]);
    r = addRange(r, [30_000, 40_000]);
    r = addRange(r, [10_500, 20_000]);
    expect(r).toEqual([[0, 20_000], [30_000, 40_000]]);
    expect(coveredMs(r)).toBe(30_000);
    expect(addRange(r, [5_000, 5_000])).toBe(r);
  });
  it('resumes dubbing after a seek at the end of the covered range, or at the seek point', () => {
    const r: [number, number][] = [[0, 20_000], [30_000, 40_000]];
    expect(resumePoint(r, 12_000)).toBe(20_000);
    expect(resumePoint(r, 25_000)).toBe(25_000);
    expect(rangeAt(r, 35_000)).toEqual([30_000, 40_000]);
    expect(leadAt(r, 35_000)).toBe(5_000);
    expect(leadAt(r, 25_000)).toBe(0);
  });
});

describe('performance profiles', () => {
  it('derives a profile from real device capabilities', () => {
    expect(recommendProfile(device)).toBe('high');
    expect(recommendProfile({ ...device, totalRamMb: 6000 })).toBe('balanced');
    expect(recommendProfile({ ...device, totalRamMb: 3000 })).toBe('light');
    expect(recommendProfile({ ...device, lowRamDevice: true })).toBe('light');
  });
  it('steps down when the measured real-time factor shows the device cannot keep up', () => {
    expect(recommendProfile(device, 1.6)).toBe('balanced');
    expect(recommendProfile({ ...device, totalRamMb: 6000 }, 1.6)).toBe('light');
    expect(resolveProfile('light', device, 0.3)).toBe('light');
  });
});

describe('error catalog', () => {
  it('explains what happened, what to do and whether retry helps', () => {
    const e = errorInfo('capture_silent');
    expect(e.retry).toBe(false);
    expect(e.what).toMatch(/DRM/);
    expect(errorInfo('translation_pack_missing').action).toBe('models');
    expect(errorInfo('weird_code', 'Boom').what).toBe('Boom');
  });
});

describe('voice catalogue labels', () => {
  it('lists only installed/offline voices with per-gender numbering and neutral system voices', () => {
    const v = availableVoices('hi', new Set(['tts-hi_IN-rohan-medium', 'tts-hi_IN-pratham-medium', 'tts-hi_IN-priyamvada-medium']), [
      { name: 'hi-in-x-hia-local', language: 'hi-IN', quality: 400, latency: 200, offline: true },
    ]);
    expect(v.map((x) => x.label)).toEqual([
      'Male Voice 1 · Rohan',
      'Female Voice 1 · Priyamvada',
      'Male Voice 2 · Pratham',
      'Neutral Voice 1 · Android system',
    ]);
    expect(availableVoices('hi', new Set(), [])).toEqual([]);
  });
  it('computes generated WAV size exactly from duration', () => {
    expect(wavBytes(1000)).toBe(48_044);
  });
});

describe('native error messages', () => {
  it('strips the Expo bridge and Java exception prefixes', () => {
    const { nativeErrorMessage } = require('@/utils/nativeError');
    expect(nativeErrorMessage(new Error("Call to function 'DubixNative.synthesize' has been rejected.\n→ Caused by: java.lang.IllegalStateException: synthesizer produced silence"))).toBe('synthesizer produced silence');
    expect(nativeErrorMessage(new Error('plain message'))).toBe('plain message');
  });
});
