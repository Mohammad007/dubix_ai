# Native bridge API (`dubix-native`)

Kotlin: `modules/dubix-native/android/src/main/java/ai/dubix/engine/DubixModule.kt`
TypeScript: `modules/dubix-native/index.ts` (types in `src/types.ts`)

`DubixNative` is `null` outside Android development or production builds (Expo Go, web, Jest). The
UI shows a "native engine not available" banner instead of failing.

## Device and permissions

| Function | Returns | Notes |
|----------|---------|-------|
| `getDeviceInfo()` | `DeviceInfo` | API level, ABIs, RAM, storage, overlay grant, capture support, battery, thermal |
| `canDrawOverlays()` | `boolean` | |
| `openOverlaySettings()` / `openAppSettings()` | `void` | |
| `getAudioRoute()` | `{ type: 'bluetooth'\|'wired'\|'speaker', name }` | |
| `getPerfSnapshot()` / `resetPerf()` | `Record<stage, PerfStat>` | stages: decode, vad, asr, speaker, translate, tts, stretch |

## Media

| Function | Notes |
|----------|-------|
| `pickVideo(): Promise<PickedVideo \| null>` | `ACTION_OPEN_DOCUMENT` + persistable read grant |
| `getMediaInfo(uri)` | duration, title, dimensions, audio tracks, thumbnail (`file://`) |
| `releaseUri(uri)` | drops the persisted grant |
| `computeWaveform(uri, startMs, endMs, buckets)` | peak envelope of the original track (8 kHz decode) |
| `dubWaveform(segments, startMs, endMs, buckets)` | peak envelope of generated segments |

## Model packs

| Function | Notes |
|----------|-------|
| `getInstalledModels(): InstalledModel[]` | manifests of verified installs |
| `getModelsSizeBytes()` | |
| `downloadModel(descriptor)` | queued, resumable, verified; progress via `onDownloadProgress` |
| `cancelDownload(id)` / `deleteModel(id)` | delete also unloads engines |
| `getTranslationPacks()` / `downloadTranslationPack(lang, wifiOnly)` / `deleteTranslationPack(lang)` | ML Kit |
| `getSystemVoices(lang \| null)` | installed **offline** Android TTS voices only |

## Player (main thread, all async)

| Function | Notes |
|----------|-------|
| `createPlayer(uri): Promise<string>` | Media3 ExoPlayer with audio focus + noisy handling |
| `releasePlayer(id)`, `play(id)`, `pause(id)`, `seekTo(id, ms)` | |
| `setDubSegments(id, DubSegmentRef[])` / `addDubSegments(id, …)` | replace / upsert scheduled lines |
| `setDubConfig(id, DubConfig)` | enabled, offsetMs, dubVolume, originalVolume, duckWhileDubbing, duckLevel |
| `<DubixPlayerView playerId resizeMode />` | native video surface (controls are drawn in RN) |

## Dubbing job

| Function | Notes |
|----------|-------|
| `getSessionsDir()` | `files/sessions` |
| `startDubbingJob(DubbingJobParams)` | one active job per session (a new start cancels the old one) |
| `pauseJob(id)` / `resumeJob(id)` / `cancelJob(id)` | |
| `synthesize({ text, voice, windowMs?, userSpeed?, maxSpeed?, maxPauseSec?, outPath? })` | preview and per-line regeneration; `outPath` must be inside app storage |
| `playPreview(path)` / `stopPreview()` | |
| `deleteSessionFiles(sessionId)` / `purgeSessionFiles(keepIds)` | |
| `releaseEngines()` | unload models when idle |

`DubbingJobParams.voices` keys: `default`, `low`, `high`, `neutral`, `speaker:<n>`. The lookup order for a
segment is `speaker:<n>`, then its pitch register, then `default`.

## Live

| Function | Notes |
|----------|-------|
| `startLiveSession(LiveConfig, showOverlay)` | resolves `'started'`, `'consent_denied'` or `'cancelled'`; playback source shows Android's consent dialog |
| `stopLiveSession()`, `pauseLiveSession()`, `resumeLiveSession()` | |
| `setLiveOptions(speak \| null, captions \| null)` | |
| `setFloatingControllerVisible(visible)` | |
| `getLiveState()` | last `onLiveState` payload (survives JS reloads) |

## Events

| Event | Payload |
|-------|---------|
| `onDownloadProgress` | `{ id, state: queued\|downloading\|installing\|installed\|cancelled\|error, bytes, total, error? }` |
| `onJobProgress` | `{ jobId, sessionId, processedMs, durationMs, segments, speakers, realtimeFactor, perf }` |
| `onJobSegment` | `{ id, startMs, endMs, speaker, register, f0, sourceText, sourceLang, translatedText, audioPath, audioDurationMs, speed, voiceEngine, error }` |
| `onJobState` | `{ state: loading\|running\|paused\|completed\|cancelled\|error, code, message, processedMs, speakerCentroids }` |
| `onPlayerState` | `{ playerId, state, isPlaying, positionMs, durationMs, bufferedMs }` (~10 Hz) |
| `onDubState` | `{ playerId, state, segmentId, outputLatencyMs, latencyMeasured }` |
| `onLiveState` | `{ state, message, source, speak, captions, overlay, paused }` |
| `onLiveSegment` | `{ id, sourceText, sourceLang, translatedText, latencyMs, avgLatencyMs, droppedAudio }` |
| `onLiveLevel` | `{ level, speaking }` (~10 Hz) |
| `onAudioRoute` | `{ type, name }` |
| `onSystemWarning` | `{ code, message }`: `low_memory`, `throttled_thermal`, `throttled_battery_critical`, `speaker_model_unavailable`, `overlay_denied`, `live_segment_failed`, … |

Job error codes: `no_audio`, `translation_pack_missing`, `pipeline_error`.

## Added in revision 2

| Function / field | Notes |
|------------------|-------|
| `setPlaybackSpeed(id, speed)` | 0.5–2×; the dub track follows the speed with pitch preserved |
| `getAudioTracks(id)` / `selectAudioTrack(id, ordinal)` | Container-order audio tracks; the dubbing job decodes the same ordinal (`DubbingJobParams.audioTrack`) |
| `enterPictureInPicture(w, h)` / `isInPictureInPicture()` | Requires the `withDubixAndroid` plugin (manifest flag) |
| `setJobPlayhead(jobId, ms)` | Live dubbing: the job waits while it is more than `maxLeadMs` ahead (`onJobState` → `waiting`) |
| `DubbingJobParams.maxLeadMs`, `spillMs`, `audioTrack` | Bounded live buffering, gap/spill allowance, track choice |
| `synthesize(...)` → `overflowMs` | How far a line still runs past its slot at the stretch limit |
| `getSessionStorage()` | Generated-audio bytes per session directory |
| `onJobSegment.voiceId`, `overflowMs` | Persisted in `segments` |
| `onDubState.startErrorMs`, `driftAvgMs` | Scheduling-drift monitoring |
| `onLiveLevel.speech` | VAD speech-in-progress flag, the "partial result" for non-streaming Whisper |
| Job error codes | `file_unreadable`, `decode_failed`, `out_of_memory`, in addition to `no_audio`, `translation_pack_missing`, `pipeline_error` |
| Notification actions | Pause / Resume / Stop, which work without the overlay permission |
