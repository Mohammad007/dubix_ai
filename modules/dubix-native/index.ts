import { NativeModule, requireNativeView, requireOptionalNativeModule } from 'expo';
import { Platform, type ViewProps } from 'react-native';

import type {
  AudioTrackInfo,
  Cue,
  SubtitleTrack,
  AudioRouteEvent,
  DeviceInfo,
  DubConfig,
  DubixEvents,
  DubSegmentRef,
  DubbingJobParams,
  InstalledModel,
  LiveConfig,
  LiveStateEvent,
  MediaInfo,
  ModelDownloadDescriptor,
  PerfStat,
  PickedVideo,
  SystemVoice,
  VoiceSpec,
} from './src/types';

export * from './src/types';

declare class DubixNativeModule extends NativeModule<DubixEvents> {
  getDeviceInfo(): DeviceInfo;
  canDrawOverlays(): boolean;
  openOverlaySettings(): void;
  openAppSettings(): void;
  getAudioRoute(): AudioRouteEvent;
  getPerfSnapshot(): Record<string, PerfStat>;
  resetPerf(): void;

  pickVideo(): Promise<PickedVideo | null>;
  getMediaInfo(uri: string): Promise<MediaInfo>;
  getSubtitleTracks(uri: string): Promise<SubtitleTrack[]>;
  /** From an embedded track (videoUri + trackIndex) or a subtitle file (fileUri). */
  loadSubtitleCues(videoUri: string | null, trackIndex: number | null, fileUri: string | null): Promise<Cue[]>;
  pickSubtitleFile(): Promise<PickedVideo | null>;
  releaseUri(uri: string): void;
  computeWaveform(uri: string, startMs: number, endMs: number, buckets: number): Promise<number[]>;
  dubWaveform(segments: { startMs: number; path: string }[], startMs: number, endMs: number, buckets: number): Promise<number[]>;

  getInstalledModels(): InstalledModel[];
  getModelsSizeBytes(): number;
  downloadModel(d: ModelDownloadDescriptor): void;
  cancelDownload(id: string): void;
  deleteModel(id: string): Promise<boolean>;
  getTranslationPacks(): Promise<string[]>;
  downloadTranslationPack(lang: string, wifiOnly: boolean): Promise<void>;
  deleteTranslationPack(lang: string): Promise<void>;
  getSystemVoices(lang: string | null): Promise<SystemVoice[]>;

  createPlayer(uri: string): Promise<string>;
  releasePlayer(id: string): Promise<void>;
  play(id: string): Promise<void>;
  pause(id: string): Promise<void>;
  seekTo(id: string, ms: number): Promise<void>;
  setDubSegments(id: string, segments: DubSegmentRef[]): Promise<void>;
  addDubSegments(id: string, segments: DubSegmentRef[]): Promise<void>;
  setDubConfig(id: string, config: DubConfig): Promise<void>;
  setPlaybackSpeed(id: string, speed: number): Promise<void>;
  getAudioTracks(id: string): Promise<AudioTrackInfo[]>;
  selectAudioTrack(id: string, ordinal: number): Promise<void>;
  enterPictureInPicture(width: number, height: number): Promise<boolean>;
  isInPictureInPicture(): boolean;

  getSessionsDir(): string;
  startDubbingJob(params: DubbingJobParams): void;
  pauseJob(id: string): void;
  resumeJob(id: string): void;
  cancelJob(id: string): void;
  setJobPlayhead(id: string, ms: number): void;
  synthesize(p: {
    text: string;
    voice: VoiceSpec;
    windowMs?: number;
    userSpeed?: number;
    maxSpeed?: number;
    maxPauseSec?: number;
    outPath?: string;
    spillMs?: number;
  }): Promise<{ path: string; durationMs: number; speed: number; overflowMs: number }>;
  playPreview(path: string): Promise<void>;
  stopPreview(): Promise<void>;
  deleteSessionFiles(sessionId: string): boolean;
  getSessionStorage(): Record<string, number>;
  purgeSessionFiles(keepSessionIds: string[]): void;
  releaseEngines(): void;

  startLiveSession(config: LiveConfig, showOverlay: boolean): Promise<'started' | 'consent_denied' | 'cancelled'>;
  stopLiveSession(): void;
  pauseLiveSession(): void;
  resumeLiveSession(): void;
  setLiveOptions(speak: boolean | null, captions: boolean | null): void;
  setFloatingControllerVisible(visible: boolean): Promise<void>;
  getLiveState(): LiveStateEvent;
}

/**
 * The native module exists only in Android dev/production builds (not Expo Go, not web).
 * `null` lets the UI render an explicit "native engine unavailable" state instead of crashing.
 */
export const DubixNative: DubixNativeModule | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<DubixNativeModule>('DubixNative') : null;

export function requireDubix(): DubixNativeModule {
  if (!DubixNative) {
    throw new Error('DubiX native engine is not available in this build. Use an Android development build (npx expo run:android).');
  }
  return DubixNative;
}

export type DubixPlayerViewProps = ViewProps & {
  playerId: string | null;
  resizeMode?: 'contain' | 'cover' | 'stretch';
};

export const DubixPlayerView: React.ComponentType<DubixPlayerViewProps> | null = DubixNative
  ? requireNativeView<DubixPlayerViewProps>('DubixNative')
  : null;
