import { createMMKV } from 'react-native-mmkv';

import type { CaptionMode, SubtitleSize } from '@/domain/captions';
import type { HinglishStyle } from '@/domain/hinglish';
import type { PerformanceProfile } from '@/domain/performance';
import type { SilenceTrim } from '@/domain/sync';
import type { ThemeMode } from '@/theme/colors';

import { createStore } from './createStore';

/**
 * Lightweight preferences: Zustand store persisted to MMKV (synchronous, survives restarts).
 * Sessions, segments, voice mappings and model state live in SQLite.
 */
export type Settings = {
  /** Schema revision of the stored settings, for one-time migrations. */
  rev: number;
  onboardingDone: boolean;
  themeMode: ThemeMode;
  sourceLang: string;
  targetLang: string;
  hinglishStyle: HinglishStyle;
  asrModelId: string | null;
  performanceProfile: PerformanceProfile | 'auto';
  speakerDetection: boolean;
  maxSpeakers: number;
  captionMode: CaptionMode;
  subtitleSize: SubtitleSize;
  subtitleBackground: boolean;
  originalVolume: number;
  dubVolume: number;
  dubEnabled: boolean;
  originalMuted: boolean;
  playbackSpeed: number;
  /** prepare = analyse the whole movie first; live = dub while watching with a bounded lead */
  dubMode: 'prepare' | 'live';
  liveLeadSec: number;
  /** pause the video when playback catches up with live dubbing */
  waitForDubbing: boolean;
  syncOffsetMs: number;
  autoSync: boolean;
  voiceSpeed: number;
  maxStretch: number;
  spillMs: number;
  silenceTrim: SilenceTrim;
  duckWhileDubbing: boolean;
  duckLevel: number;
  wifiOnlyDownloads: boolean;
  autoDeleteUnusedDays: number;
  audioCacheLimitMb: number;
  /** mic = microphone, playback = other apps' audio, screen = other apps' on-screen subtitles */
  liveSource: 'mic' | 'playback' | 'screen';
  /** Boost for the translated voice in live modes (dB), so it stays audible over the app's audio. */
  voiceGainDb: number;
  /** Local movies: dub from speech recognition or from subtitles. */
  dubSource: 'speech' | 'subtitles';
  liveSpeak: boolean;
  liveCaptions: boolean;
  liveOverlay: boolean;
  defaultVoiceKey: string | null;
};

export const SETTINGS_REV = 2;

export const DEFAULT_SETTINGS: Settings = {
  rev: SETTINGS_REV,
  onboardingDone: false,
  themeMode: 'light',
  sourceLang: 'auto',
  targetLang: 'hi',
  hinglishStyle: 'hinglish',
  asrModelId: null,
  performanceProfile: 'auto',
  speakerDetection: true,
  maxSpeakers: 6,
  captionMode: 'translated',
  subtitleSize: 'm',
  subtitleBackground: true,
  originalVolume: 0.6,
  dubVolume: 1,
  dubEnabled: true,
  originalMuted: false,
  playbackSpeed: 1,
  dubMode: 'live',
  liveLeadSec: 90,
  waitForDubbing: true,
  syncOffsetMs: 0,
  autoSync: true,
  voiceSpeed: 1,
  maxStretch: 1.25,
  spillMs: 300,
  silenceTrim: 'light',
  duckWhileDubbing: true,
  duckLevel: 0.6,
  // Models download over Wi-Fi or mobile data by default; users can restrict to Wi-Fi.
  wifiOnlyDownloads: false,
  autoDeleteUnusedDays: 30,
  audioCacheLimitMb: 2048,
  liveSource: 'mic',
  voiceGainDb: 6,
  dubSource: 'speech',
  liveSpeak: true,
  liveCaptions: true,
  liveOverlay: false,
  defaultVoiceKey: null,
};

const KEY = 'settings.v1';
const storage = createMMKV({ id: 'dubix-settings' });

function load(): Settings {
  try {
    const raw = storage.getString(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const stored = JSON.parse(raw) as Partial<Settings>;
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    // rev 2: Wi-Fi-only downloads became opt-in (it blocked downloads on mobile data).
    if ((stored.rev ?? 1) < 2) merged.wifiOnlyDownloads = false;
    merged.rev = SETTINGS_REV;
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const settingsStore = createStore<Settings>(load());

export function getSettings(): Settings {
  return settingsStore.get();
}

export function updateSettings(patch: Partial<Settings>): void {
  settingsStore.set(patch);
  storage.set(KEY, JSON.stringify(settingsStore.get()));
}

export function resetSettings(): void {
  storage.remove(KEY);
  settingsStore.set({ ...DEFAULT_SETTINGS });
}

export function useSettings(): Settings {
  return settingsStore.useValue();
}

export function useSetting<K extends keyof Settings>(key: K): Settings[K] {
  return settingsStore.useValue((s) => s[key]);
}
