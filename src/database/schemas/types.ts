export type SessionStatus = 'new' | 'processing' | 'paused' | 'ready' | 'error';

/** [startMs, endMs) ranges of the movie that have been dubbed. */
export type Range = [number, number];

export type SessionRow = {
  id: string;
  uri: string;
  name: string;
  thumbnail: string | null;
  durationMs: number;
  sourceLang: string;
  targetLang: string;
  status: SessionStatus;
  processedMs: number;
  error: string | null;
  speakerCentroids: number[][] | null;
  lastPositionMs: number;
  coveredRanges: Range[];
  audioTrack: number;
  sizeBytes: number;
  mimeType: string | null;
  createdAt: number;
  updatedAt: number;
};

export type SegmentState = 'transcribed' | 'translated' | 'synthesized' | 'failed';

export type SegmentRow = {
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
  audioMs: number;
  speed: number;
  voiceId: string | null;
  overflowMs: number;
  processingState: SegmentState;
  edited: boolean;
  error: string | null;
};

/** Speaker profile + its voice mapping for one session. */
export type SpeakerRow = { sessionId: string; speaker: number; label: string; voiceKey: string | null; pitch: number; speed: number };

export type ModelStateRow = {
  id: string;
  kind: string;
  version: string;
  sha256: string | null;
  verified: boolean;
  sizeBytes: number;
  installedAt: number | null;
  lastUsedAt: number | null;
  state: 'installed' | 'removed';
};

export type DownloadJobRow = { id: string; state: string; bytes: number; total: number; error: string | null; updatedAt: number };

export type DiagnosticRow = { id: number; at: number; level: 'info' | 'warning' | 'error'; code: string; message: string; context: string | null };
