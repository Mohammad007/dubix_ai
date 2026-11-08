import {
  DubixNative,
  type AudioRouteEvent,
  type DeviceInfo,
  type DownloadProgressEvent,
  type InstalledModel,
  type JobProgressEvent,
  type LiveSegmentEvent,
  type LiveStateEvent,
  type SystemVoice,
  type SystemWarningEvent,
} from 'dubix-native';

import { logDiagnostic, saveDownloadJob, saveModelState } from '@/database';
import { createStore } from '@/store/createStore';

export type Warning = SystemWarningEvent & { at: number };

export type EngineState = {
  available: boolean;
  device: DeviceInfo | null;
  installed: InstalledModel[];
  installedIds: Set<string>;
  translationPacks: Set<string>;
  /** null until ML Kit answers */
  translatable: Set<string> | null;
  systemVoices: SystemVoice[];
  downloads: Record<string, DownloadProgressEvent>;
  modelsBytes: number;
  warnings: Warning[];
  route: AudioRouteEvent | null;
  live: LiveStateEvent;
  liveLines: LiveSegmentEvent[];
  liveLevel: number;
  /** VAD currently hears speech (real, not simulated) */
  liveSpeech: boolean;
  jobProgress: Record<string, JobProgressEvent>;
};

export const engine = createStore<EngineState>({
  available: DubixNative !== null,
  device: null,
  installed: [],
  installedIds: new Set(),
  translationPacks: new Set(),
  translatable: null,
  systemVoices: [],
  downloads: {},
  modelsBytes: 0,
  warnings: [],
  route: null,
  live: { state: 'idle' },
  liveLines: [],
  liveLevel: 0,
  liveSpeech: false,
  jobProgress: {},
});

/** Languages ML Kit can translate on-device (ML Kit's published list). */
const MLKIT_LANGS = [
  'af', 'ar', 'be', 'bg', 'bn', 'ca', 'cs', 'cy', 'da', 'de', 'el', 'en', 'eo', 'es', 'et', 'fa', 'fi', 'fr', 'ga', 'gl', 'gu', 'he',
  'hi', 'hr', 'ht', 'hu', 'id', 'is', 'it', 'ja', 'ka', 'kn', 'ko', 'lt', 'lv', 'mk', 'mr', 'ms', 'mt', 'nl', 'no', 'pl', 'pt', 'ro',
  'ru', 'sk', 'sl', 'sq', 'sv', 'sw', 'ta', 'te', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'zh',
];

let booted = false;

export function bootEngine(): void {
  if (booted || !DubixNative) return;
  booted = true;
  const n = DubixNative;
  engine.set({ translatable: new Set(MLKIT_LANGS), live: n.getLiveState(), route: n.getAudioRoute() });
  refreshDevice();
  refreshModels();
  refreshTranslationPacks();
  refreshSystemVoices();

  n.addListener('onDownloadProgress', (e) => {
    engine.set((s) => ({ downloads: { ...s.downloads, [e.id]: e } }));
    if (e.state !== 'downloading') saveDownloadJob(e).catch(() => undefined);
    if (e.state === 'error') logDiagnostic('error', 'download_failed', e.error ?? 'download failed', { id: e.id }).catch(() => undefined);
    if (e.state === 'installed' || e.state === 'error' || e.state === 'cancelled') {
      if (e.id.startsWith('mlkit-')) refreshTranslationPacks();
      else refreshModels();
      refreshDevice();
    }
  });
  n.addListener('onSystemWarning', (e) => pushWarning(e));
  n.addListener('onAudioRoute', (e) => engine.set({ route: e }));
  n.addListener('onLiveState', (e) => engine.set({ live: e }));
  n.addListener('onLiveLevel', (e) => engine.set({ liveLevel: e.level, liveSpeech: e.speech }));
  n.addListener('onLiveSegment', (e) => engine.set((s) => ({ liveLines: [...s.liveLines.slice(-49), e] })));
  n.addListener('onJobProgress', (e) => engine.set((s) => ({ jobProgress: { ...s.jobProgress, [e.sessionId]: e } })));
}

export function pushWarning(e: SystemWarningEvent): void {
  logDiagnostic('warning', e.code, e.message).catch(() => undefined);
  engine.set((s) => ({ warnings: [...s.warnings.filter((w) => w.code !== e.code).slice(-4), { ...e, at: Date.now() }] }));
}

export function dismissWarning(code: string): void {
  engine.set((s) => ({ warnings: s.warnings.filter((w) => w.code !== code) }));
}

export function refreshDevice(): void {
  if (!DubixNative) return;
  engine.set({ device: DubixNative.getDeviceInfo() });
}

export function refreshModels(): void {
  if (!DubixNative) return;
  const installed = DubixNative.getInstalledModels();
  engine.set({ installed, installedIds: new Set(installed.map((m) => m.id)), modelsBytes: DubixNative.getModelsSizeBytes() });
  saveModelState(installed).catch(() => undefined);
}

export async function refreshTranslationPacks(): Promise<void> {
  if (!DubixNative) return;
  try {
    const packs = await DubixNative.getTranslationPacks();
    engine.set({ translationPacks: new Set(packs) });
  } catch (e) {
    pushWarning({ code: 'mlkit_unavailable', message: `Offline translation is unavailable on this device: ${(e as Error).message}` });
  }
}

export async function refreshSystemVoices(): Promise<void> {
  if (!DubixNative) return;
  try {
    engine.set({ systemVoices: await DubixNative.getSystemVoices(null) });
  } catch {
    engine.set({ systemVoices: [] });
  }
}

export function clearLiveLines(): void {
  engine.set({ liveLines: [] });
}
