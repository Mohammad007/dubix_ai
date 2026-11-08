/** Types shared between the Kotlin bridge (ai.dubix.engine.DubixModule) and the app. */

export type DeviceInfo = {
  apiLevel: number;
  release: string;
  manufacturer: string;
  model: string;
  abis: string[];
  cpuCores: number;
  totalRamMb: number;
  availRamMb: number;
  lowRamDevice: boolean;
  storageTotalBytes: number;
  storageFreeBytes: number;
  playbackCaptureSupported: boolean;
  canDrawOverlays: boolean;
  powerSaveMode: boolean;
  thermalStatus: number;
  batteryPct: number;
  charging: boolean;
};

export type PickedVideo = { uri: string; name: string; size: number; mimeType: string | null };

export type MediaInfo = PickedVideo & {
  durationMs: number;
  title: string | null;
  width: number;
  height: number;
  hasAudio: boolean;
  audioTracks: number;
  audioMime: string | null;
  sampleRate: number;
  channels: number;
  thumbnail: string | null;
};

export type ModelKind = 'vad' | 'asr' | 'tts' | 'speaker';

export type ModelDownloadDescriptor = {
  id: string;
  version: string;
  kind: ModelKind;
  url: string;
  sha256: string | null;
  sizeBytes: number;
  archive: 'tar.bz2' | 'none';
  fileName?: string;
  wifiOnly: boolean;
};

export type InstalledModel = {
  id: string;
  version: string;
  kind: ModelKind;
  installedAt: number;
  sha256: string;
  verified: boolean;
  sizeOnDisk: number;
  sourceUrl: string;
};

export type VoiceSpec = {
  engine: 'sherpa' | 'system';
  modelId?: string | null;
  speakerId?: number;
  systemVoice?: string | null;
  language: string;
  /** semitones, -6..+6 */
  pitch: number;
  /** base speaking rate 0.5..2 */
  speed: number;
};

export type SystemVoice = { name: string; language: string; quality: number; latency: number; offline: boolean };

export type DubSegmentRef = { id: string; startMs: number; endMs: number; path: string };

export type DubConfig = {
  enabled: boolean;
  offsetMs: number;
  dubVolume: number;
  originalVolume: number;
  duckWhileDubbing: boolean;
  /** fraction (0..1) removed from the original track while dub speech plays */
  duckLevel: number;
};

export type DubbingJobParams = {
  jobId: string;
  sessionId: string;
  uri: string;
  startMs: number;
  durationMs: number;
  sourceLang: string;
  translateTarget: string;
  vadModelId: string;
  asrModelId: string;
  speakerModelId: string | null;
  maxSpeakers: number;
  /** keys: default | speaker:<n> (manual mappings) */
  voices: Record<string, VoiceSpec>;
  /** Installed voices by published character; each detected speaker gets one voice matching its pitch. */
  voicePools: VoicePools;
  userSpeed: number;
  maxSpeed: number;
  maxPauseSec: number;
  speakerCentroids?: number[][];
  /** Live dubbing: max lead over the playhead (0 = prepare the whole movie). */
  maxLeadMs: number;
  /** How far a dubbed line may spill past its dialogue window before being stretched. */
  spillMs: number;
  /** Ordinal of the audio track (container order) to dub. */
  audioTrack: number;
  /** Subtitle mode: dub these timed lines instead of running speech recognition. */
  cues?: Cue[];
};

export type Cue = { startMs: number; endMs: number; text: string };
export type SubtitleTrack = { index: number; mime: string; language: string | null };

export type AudioTrackInfo = {
  ordinal: number;
  language: string | null;
  label: string | null;
  channels: number;
  mimeType: string | null;
  selected: boolean;
  supported: boolean;
};

export type VoicePools = { male: VoiceSpec[]; female: VoiceSpec[]; neutral: VoiceSpec[] };

export type LiveConfig = {
  /** mic = microphone, playback = other apps' audio, screen = other apps' on-screen subtitles */
  source: 'mic' | 'playback' | 'screen';
  sourceLang: string;
  targetLang: string;
  translateTarget: string;
  vadModelId: string;
  asrModelId: string;
  voice: VoiceSpec | null;
  voicePools: VoicePools | null;
  speak: boolean;
  captions: boolean;
  /** 0..12 dB boost for the translated voice */
  voiceGainDb: number;
};

export type LiveStateName =
  | 'idle'
  | 'listening'
  | 'paused'
  | 'capture_silent'
  | 'mic_silent'
  | 'projection_stopped'
  | 'screen_blocked'
  | 'no_subtitles'
  | 'error'
  | 'stopped';

// ---------- events ----------

export type DownloadProgressEvent = {
  id: string;
  state: 'queued' | 'downloading' | 'installing' | 'installed' | 'cancelled' | 'error';
  bytes: number;
  total: number;
  error?: string | null;
};

export type JobProgressEvent = {
  jobId: string;
  sessionId: string;
  processedMs: number;
  durationMs: number;
  segments: number;
  speakers: number;
  realtimeFactor: number;
  perf: Record<string, PerfStat>;
};

export type JobSegmentEvent = {
  jobId: string;
  sessionId: string;
  id: string;
  startMs: number;
  endMs: number;
  speaker: number;
  register: 'low' | 'high' | 'neutral';
  f0: number | null;
  sourceText: string;
  sourceLang: string;
  translatedText: string;
  audioPath: string | null;
  audioDurationMs: number;
  speed: number;
  voiceEngine: string | null;
  voiceId: string | null;
  /** > 0 when the line still runs past its slot at the maximum stretch. */
  overflowMs: number;
  error: string | null;
};

export type JobStateEvent = {
  jobId: string;
  sessionId: string;
  state: 'loading' | 'running' | 'waiting' | 'paused' | 'completed' | 'cancelled' | 'error';
  code: string | null;
  message: string | null;
  processedMs: number;
  speakerCentroids: number[][] | null;
};

export type PlayerStateEvent = {
  playerId: string;
  state: 'idle' | 'buffering' | 'ready' | 'ended' | 'error';
  isPlaying?: boolean;
  positionMs?: number;
  durationMs?: number;
  bufferedMs?: number;
  speed?: number;
  message?: string;
};

export type DubStateEvent = {
  playerId: string;
  state: 'playing' | 'idle' | 'interrupted';
  segmentId: string | null;
  outputLatencyMs: number;
  latencyMeasured: boolean;
  /** scheduling error of the latest line (positive = late) */
  startErrorMs: number;
  driftAvgMs: number;
};

export type LiveStateEvent = {
  state: LiveStateName;
  message?: string | null;
  source?: 'mic' | 'playback' | 'screen' | null;
  speak?: boolean | null;
  captions?: boolean | null;
  overlay?: boolean;
  paused?: boolean;
};

export type LiveSegmentEvent = {
  id: string;
  atMs: number;
  sourceText: string;
  sourceLang: string;
  translatedText: string;
  latencyMs: number;
  avgLatencyMs: number;
  droppedAudio: number;
};

export type AudioRouteEvent = { type: 'bluetooth' | 'wired' | 'speaker'; name: string };
export type SystemWarningEvent = { code: string; message: string };
export type PerfStat = { count: number; avgMs: number; maxMs: number; lastMs: number; totalMs: number };

export type DubixEvents = {
  onDownloadProgress: (e: DownloadProgressEvent) => void;
  onJobProgress: (e: JobProgressEvent) => void;
  onJobSegment: (e: JobSegmentEvent) => void;
  onJobState: (e: JobStateEvent) => void;
  onPlayerState: (e: PlayerStateEvent) => void;
  onDubState: (e: DubStateEvent) => void;
  onLiveState: (e: LiveStateEvent) => void;
  onLiveSegment: (e: LiveSegmentEvent) => void;
  onLiveLevel: (e: { level: number; speaking: boolean; speech: boolean }) => void;
  onAudioRoute: (e: AudioRouteEvent) => void;
  onSystemWarning: (e: SystemWarningEvent) => void;
};
