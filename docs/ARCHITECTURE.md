# Architecture

## Layers

```
┌──────────────────────────── React Native (TypeScript) ────────────────────────────┐
│ src/app (Expo Router screens) → src/components (flat UI kit)                      │
│ src/services: engine (native state + events) · dubbing (sessions/jobs/player)     │
│               live (capture) · models (packs) · permissions                       │
│ src/domain:   pure, unit-tested logic (languages, Hinglish, captions, sync, …)    │
│ src/storage:  SQLite (sessions, segments, speakers, metrics) · MMKV (settings)    │
└───────────────────────────────┬───────────────────────────────────────────────────┘
                                │ Expo Modules API (JSI), events
┌───────────────────────────────▼──────────── Kotlin: ai.dubix.engine ──────────────┐
│ DubixModule ── DubixEvents (event bus to JS)                                      │
│ pipeline/DubbingJob   audio/AudioDecoder → ml/VadEngine → ml/AsrEngine            │
│                       → ml/SpeakerEmbedder+SpeakerClusterer → ml/TranslationEngine│
│                       → ml/TtsEngine → audio/SilenceTrimmer → audio/TimeStretcher │
│ player/PlayerManager  Media3 ExoPlayer + DubPlaybackEngine (AudioTrack scheduler) │
│ live/LiveCaptureService  MediaProjection + AudioPlaybackCapture / mic → LiveSession│
│ models/ModelStore + ModelDownloader                                               │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## Replaceable engines

The pipeline depends on interfaces in `ml/Engines.kt`, so engines can be swapped (for example
whisper.cpp for ASR) by adding an adapter:

- `SpeechSegmenter` (Silero VAD)
- `SpeechRecognizerEngine` (Whisper via sherpa-onnx)
- `TextTranslator` (ML Kit, with a 512-entry LRU cache)
- `SpeechSynthesizer` (Piper/VITS via sherpa-onnx, or Android offline TTS)

`StreamingRecognition` exposes the `initialize → start → feedAudio → partial/final → stop → release`
lifecycle on top of a segmenter and a recognizer. Whisper is not a streaming model, so the
"partial" result is the VAD's *speech in progress* flag, never invented text.

## Prepare vs. live dubbing

| | Prepare | Live |
|---|---|---|
| Starts at | first undubbed range from 0 | first undubbed position at/after the playhead |
| Lead over playback | unbounded | `liveLeadSec` (default 90 s). The job blocks in `waitForPlayhead()` and reports `waiting` |
| Seek | n/a | seeking into undubbed media restarts the job there (`onPlayerTick`) |
| Playback gating | none | optional: video pauses with "Preparing dubbing…" when less than 1.5 s is dubbed ahead, and resumes at more than 8 s |

Dubbed coverage is stored per session as merged `[start, end)` ranges (`domain/ranges.ts`). When a
job reaches a range that was dubbed earlier, it restarts after that range instead of redoing it.
Playback speed changes are applied to the dub track with `AudioTrack.setPlaybackParams` (pitch
preserved). The scheduler records each line's start error, and Audio Sync shows the moving
average as *drift*.

## Errors

Every native and JS failure code maps to `domain/errors.ts`, which gives a title, what happened,
what to do, whether retry helps, and a navigation action. `ErrorState` renders it consistently.
Warnings and errors are also written to the local-only `local_diagnostics` table (Privacy screen).

## Local movie dubbing (Phase 1 + 2)

1. **Open.** The system picker (`ACTION_OPEN_DOCUMENT`) returns a content URI; DubiX takes a
   persistable *read* grant for that file only (no storage permission). `getMediaInfo` reads
   duration, audio track info and writes a thumbnail. A `sessions` row is created.
2. **Decode (streamed).** `AudioDecoder` uses `MediaExtractor` + `MediaCodec`, downmixes to mono and
   resamples to 16 kHz in chunks. A two-hour film is never fully in memory. Decoding starts at the
   session's `processedMs`, so jobs resume after pause, crash or app restart.
3. **VAD.** Silero VAD (512-sample windows, 12 s maximum segment) splits dialogue.
4. **ASR.** Whisper (tiny/base/small, multilingual). `language=""` means auto-detect per segment.
   Output is cleaned (`[Music]`, `♪`, Whisper tags) and rejected if it looks hallucinated
   (runaway repetition, impossible characters per second).
5. **Speakers (optional).** A CAM++ speaker embedding per segment feeds an **online cosine
   clusterer** (bounded `maxSpeakers`). Centroids are saved on pause/stop, so resumed jobs keep the
   same speaker numbers. Without the model, everything is Speaker 1.
6. **Voice register.** YIN pitch estimation gives a low/high/neutral register that is used only to
   *suggest* a voice. Users override it in the Voice Studio.
7. **Translate.** ML Kit on-device translation. Missing packs fail the job with
   `translation_pack_missing`; a job never downloads anything implicitly. Language-specific
   punctuation is applied (Hindi `।`, Urdu/Arabic `؟ ،`).
8. **Synthesize.** Piper/VITS voice packs via sherpa-onnx, or an *installed offline* Android
   system voice (network voices are filtered out). Output is normalised to 24 kHz mono. Pitch
   override uses resample + WSOLA, so duration is preserved.
9. **Fit.** Silence trimming, then WSOLA time-stretch to the dialogue window plus a 300 ms
   allowance, bounded by the user's maximum stretch (default 1.25×). Short fades prevent clicks.
   Each segment is written as `files/sessions/<id>/seg_<startMs>.wav`.
10. **Persist + play progressively.** Segments stream to JS (`onJobSegment`), are batched into SQLite
    every 800 ms, and pushed into the active player so playback can start before the whole film is
    processed.

### Hinglish

Hinglish is a **style layer**, not a model: translate to Hindi with ML Kit, synthesize with the Hindi
voice (from Devanagari text, which Hindi voices read correctly), and render captions through
`domain/hinglish.ts`, a deterministic transliterator with schwa deletion and a lexicon that restores
common English loanwords (`स्टेशन` → *station*).

## Synchronized playback

- ExoPlayer plays the original file with audio focus handling and "becoming noisy" pause.
- `DubPlaybackEngine` runs a 20 ms tick on the main thread. It reads the player's audio-clock
  position and adds the **measured** output latency of the dub `AudioTrack`. It measures this
  from `AudioTrack.getTimestamp()` at each segment start, and resets it when the audio route changes
  (Bluetooth). It also adds the user offset, then calls `SegmentFit.decide` to choose between
  play, play-from-offset (after a seek or when late), skip, and wait.
- A dedicated writer thread streams PCM float into one `AudioTrack`. Pause/seek flush it.
- **Ducking** lowers ExoPlayer volume only while a dub line plays. The UI states that this also
  lowers music and effects, because the source is a single mixed track.
- Captions are rendered in React Native over the native `PlayerView`, using binary search over
  segments (`findActiveSegment`), a 600 ms hold, and the same offset as the audio.

## Live translation and external capture (Phase 3)

- `LiveCaptureService` is a foreground service with type `microphone` or `mediaProjection`.
  For app audio, the MediaProjection consent result is passed in, the service is promoted
  *before* `getMediaProjection` (Android 14 rule), and a `MediaProjection.Callback` reports revocation.
- Capture config matches `USAGE_MEDIA | USAGE_GAME | USAGE_UNKNOWN` and **excludes DubiX's own
  UID**. All DubiX output tracks also set `ALLOW_CAPTURE_BY_SYSTEM`. Together these prevent
  recursive capture of our own synthesized speech. On the microphone path, input is half-duplex
  gated while we speak, plus 250 ms of tail (the acoustic echo canceller is enabled when available).
- `LiveSession` has a reader thread (20 ms frames, level meter, VAD, silence watchdog) and a worker
  (ASR → MT → caption → optional TTS). The backlog is bounded at 4 utterances, and stale lines are
  captioned without voice so latency stays bounded.
- States reported to JS: `listening`, `paused`, `capture_silent` (more than 6 s of digital silence
  from playback capture, usually an app that blocks capture or DRM content), `mic_silent`,
  `projection_stopped`, `error`.
- `FloatingController` is a `TYPE_APPLICATION_OVERLAY` view: pause/resume, captions, voice,
  minimize to bubble, drag, close. Every control has a content description.

## Resource management

- `EngineHub` shares loaded models between the job, live session and previews. It keeps at most two
  TTS voices resident and releases them on `onTrimMemory(RUNNING_LOW)`.
- Thread budget: 4/2/1 inference threads by core count. It drops to 1 in battery saver, at moderate
  thermal status, or at 15% battery or less when not charging. Jobs sleep when thermal status is
  severe and back off when the battery is critical.
- Jobs hold a partial wake lock while running. Live capture never auto-restarts
  (`START_NOT_STICKY`), because consent must be fresh.
- Cleanup: deleting a session removes its WAV directory and releases the URI grant. At startup,
  orphaned session directories are purged and unused optional packs are auto-deleted (configurable).

## Storage

| Store | Contents |
|-------|----------|
| SQLite `dubix.db` (WAL, FK cascade, `user_version` migrations) | `sessions` (translation sessions + covered ranges + audio track), `segments` (transcript segments: times, texts, speaker, voice id, audio path/duration, overflow, processing state), `speakers` (speaker profiles + voice mappings), `playback_progress`, `ai_models`, `download_jobs`, `generated_audio_cache`, `local_diagnostics`, `metrics` |
| MMKV `dubix-settings` | settings / language preferences (Zustand store persisted as JSON) |
| `files/models/<id>/` | extracted model packs + `dubix-manifest.json` (version, sha256, verified flag) |
| `files/sessions/<id>/` | generated WAV segments |
| `cache/thumbs/` | video thumbnails |

## Threads

| Thread | Work |
|--------|------|
| main | ExoPlayer, dub scheduler tick, overlay UI |
| `dubix-job-*` | decode + VAD + ASR + MT + TTS for one session |
| `dubix-dub-writer` | dub AudioTrack writes, latency measurement |
| `dubix-live-reader` / `dubix-live-worker` | capture + VAD / ASR + MT + TTS |
| `dubix-download` | serialized model downloads and extraction |
