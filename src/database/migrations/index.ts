/**
 * Ordered schema migrations, applied by `PRAGMA user_version`. Never edit a shipped migration;
 * append a new one. Large audio is never stored in SQLite: only file paths and metadata.
 *
 * Table names map to the product spec as follows:
 *   translation_sessions  -> sessions          transcript_segments -> segments
 *   speaker_profiles / voice_mappings -> speakers (one row per session speaker with its voice)
 *   app_settings / language_preferences -> MMKV (lightweight preferences, see store/settings.ts)
 */
export const MIGRATIONS: string[] = [
  // v1
  `CREATE TABLE sessions (
     id TEXT PRIMARY KEY NOT NULL, uri TEXT NOT NULL, name TEXT NOT NULL, thumbnail TEXT,
     duration_ms INTEGER NOT NULL DEFAULT 0, source_lang TEXT NOT NULL, target_lang TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'new', processed_ms INTEGER NOT NULL DEFAULT 0, error TEXT,
     speaker_centroids TEXT, last_position_ms INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE segments (
     session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, id TEXT NOT NULL,
     start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, speaker INTEGER NOT NULL DEFAULT 0,
     register TEXT NOT NULL DEFAULT 'neutral', f0 REAL, source_text TEXT NOT NULL, source_lang TEXT NOT NULL,
     translated_text TEXT NOT NULL, audio_path TEXT, audio_ms INTEGER NOT NULL DEFAULT 0,
     speed REAL NOT NULL DEFAULT 1, error TEXT, PRIMARY KEY (session_id, id));
   CREATE INDEX segments_time ON segments(session_id, start_ms);
   CREATE TABLE speakers (
     session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, speaker INTEGER NOT NULL,
     label TEXT NOT NULL, voice_key TEXT, pitch REAL NOT NULL DEFAULT 0, speed REAL NOT NULL DEFAULT 1,
     PRIMARY KEY (session_id, speaker));
   CREATE TABLE metrics (
     session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, recorded_at INTEGER NOT NULL,
     realtime_factor REAL NOT NULL, perf_json TEXT NOT NULL);`,

  // v2: live dubbing ranges, track choice, richer segments, models, downloads, cache, progress, diagnostics
  `ALTER TABLE sessions ADD COLUMN covered_ranges TEXT;
   ALTER TABLE sessions ADD COLUMN audio_track INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE sessions ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE sessions ADD COLUMN mime_type TEXT;
   ALTER TABLE segments ADD COLUMN voice_id TEXT;
   ALTER TABLE segments ADD COLUMN overflow_ms INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE segments ADD COLUMN processing_state TEXT NOT NULL DEFAULT 'synthesized';
   ALTER TABLE segments ADD COLUMN edited INTEGER NOT NULL DEFAULT 0;
   CREATE INDEX sessions_updated ON sessions(updated_at DESC);
   CREATE INDEX segments_speaker ON segments(session_id, speaker);
   CREATE TABLE playback_progress (
     session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     position_ms INTEGER NOT NULL, duration_ms INTEGER NOT NULL, speed REAL NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL);
   CREATE TABLE ai_models (
     id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, version TEXT NOT NULL, sha256 TEXT, verified INTEGER NOT NULL DEFAULT 0,
     size_bytes INTEGER NOT NULL DEFAULT 0, installed_at INTEGER, last_used_at INTEGER, state TEXT NOT NULL);
   CREATE TABLE download_jobs (
     id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
     error TEXT, updated_at INTEGER NOT NULL);
   CREATE TABLE generated_audio_cache (
     path TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     segment_id TEXT NOT NULL, bytes INTEGER NOT NULL, created_at INTEGER NOT NULL);
   CREATE INDEX audio_cache_session ON generated_audio_cache(session_id, created_at);
   CREATE TABLE local_diagnostics (
     id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, level TEXT NOT NULL, code TEXT NOT NULL,
     message TEXT NOT NULL, context TEXT);
   CREATE INDEX diagnostics_at ON local_diagnostics(at DESC);`,
];
