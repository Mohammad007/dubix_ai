# Testing and performance

## Automated

| Suite | Command | Covers |
|-------|---------|--------|
| Jest (26 tests, `tests/`) | `npm test` | Hinglish transliteration + the three output styles + English-name restoration, covered ranges / seek resume points, performance profiles from device + measured RTF, error catalog, voice labels (installed only, neutral system voices), caption lookup/hold/offset, caption modes, compatibility (RAM/storage/ABI), language availability (packs, system voices, unavailable), ASR recommendation, voice mapping (register→gender, pitch fallback, overrides), sync math, formatting, catalog integrity |
| TypeScript | `npm run typecheck` | whole app + bridge types |
| JUnit, JVM (9 tests) | `npm run test:native` (after `expo prebuild`) | streaming resampler (duration and pitch across chunk boundaries), WSOLA length and pitch preservation, YIN pitch and register, silence trimming, WAV round trip, online speaker clustering and cap, fit-speed bounds, scheduler decisions, ASR cleaning, hallucination guard, per-language punctuation |

Engines that need real models (VAD, Whisper, TTS, ML Kit) are covered by the on-device plan
below rather than mocked. There are no fake speech results anywhere in production code.

## On-device test plan

Run on at least: one low-end arm64 phone (3–4 GB RAM, Android 10–11), one current flagship
(Android 14/15), one tablet, and one Android 8/9 device (local mode only).

### Phase 1: local dubbing
1. Fresh install → onboarding checklist → Continue without permissions. Local mode must still work.
2. Models: download VAD + Whisper base + Hindi voice + EN/HI packs. Kill the app mid-download,
   relaunch, and confirm the download resumes. Toggle Wi-Fi only on mobile data and confirm the clear error.
3. Open an MP4 (AAC), an MKV (Opus/AC-3 if the device decodes it) and a file with no audio
   (expect a "no audio track" message).
4. Translate Audio → playback starts before completion; captions and dub appear progressively.
5. Seek forward past the processed area: the "playback ahead of dubbing" note shows and dubbing catches up.
6. Pause the job, kill the app, reopen, Continue dubbing → no duplicate or missing lines;
   speaker numbers are stable.
7. Change the target language → restart warning → re-dub from 0.
8. Delete a session and confirm `files/sessions/<id>` is removed (`adb shell run-as ai.dubix.app ls files/sessions`).

### Phase 2: speakers and sync
1. Two-speaker clip (male/female): two speakers appear with lower/higher estimates; auto voices differ.
2. Override a voice → Regenerate → only that speaker's lines change.
3. Bluetooth headphones: connect mid-playback → latency is re-measured (Audio Sync shows ≈150–300 ms) and dub stays aligned.
4. Offset ±500 ms is audible; captions move with it.
5. Ducking on/off; the warning about music is visible.
6. Incoming call / another media app takes focus → playback pauses (audio focus). Unplug wired headphones → pause.

### Phase 3: live and capture
1. Microphone mode: speak; the translation appears with latency shown; the TTS voice is not re-translated (half-duplex).
2. Playback mode on Android 10+: consent dialog → play audio in an app that allows capture
   (e.g. a local music/video player) → captions. Play in an app that blocks capture or DRM content
   → "No capturable audio" within about 6 s. Confirm DubiX's own speech is never captioned.
3. Revoke: stop casting from the system tile → "Capture ended". Revoke the mic permission in
   settings while running → error state and service stops.
4. Overlay: grant, show, drag, minimize to bubble, expand, toggle CC/voice, close.
5. Swipe the app away from recents during capture → the notification remains; Stop works.
6. TalkBack pass over every screen: labels, adjustable sliders, live regions for captions.

### Stress
- 2.5-hour film on the low-end device: memory stays flat (decoder streams, VAD segments ≤12 s),
  no ANR, thermal throttling message appears and recovers.
- `adb shell am send-trim-memory ai.dubix.app RUNNING_LOW` → `low_memory` warning, voices unload and reload.
- Battery saver on → fewer threads (higher real-time factor), no crash.

## Performance instrumentation

- Every stage is wrapped in `Perf.trace("<stage>")`, which emits `android.os.Trace` sections
  `dubix:decode|vad|asr|speaker|translate|tts|stretch`. Record with Perfetto
  (`adb shell perfetto … -c - --txt` with the `atrace` category `app`) or the Android Studio profiler.
- Aggregates (count/avg/max/last) are exposed through `getPerfSnapshot()`. They are shown in
  Settings › Performance and persisted per completed job in the `metrics` table along with the
  **real-time factor** (wall time / media time; below 1.0 means faster than real time).
- Live mode reports per-line latency (end of speech → translated text) and an EMA, plus how many
  lines were captioned without voice to keep up.

Suggested targets (validate on hardware): offline job RTF ≤ 1.0 on mid-range with Whisper base;
live latency ≤ 1.5 s on flagship with Whisper tiny/base.

## Required test matrix (spec §23)

| # | Scenario | How it is covered |
|---|----------|-------------------|
| 1–2 | First install, fresh onboarding | Device run: install APK, walk the 7 onboarding steps |
| 3 | No internet | Device run: airplane mode after packs installed; dub the sample clip |
| 4–5 | Missing / installed translation model | Language screen + Player "Offline packs needed" error state; `languageAvailability` unit tests |
| 6–7 | Local playback, English→Hindi dubbing | Device run with `dubix_sample_dialogue.mp4` (self-generated, see below) |
| 8 | Manual voice mapping | Voice Studio → Save → Regenerate |
| 9 | Sync after seeking | `ranges` unit tests + device run: seek back/forward during live dubbing |
| 10 | Pause/resume | Player + job pause/resume |
| 11 | Orientation | Fullscreen locks landscape; rotate on Home/Player |
| 12–13 | Bluetooth / wired headphones | Device run: connect mid-playback; Audio Sync shows re-measured delay |
| 14 | Background/foreground | Job continues with wake lock; player releases on blur and resumes at saved position |
| 15–17 | External capture allowed / denied / silent protected | Live Translator → Other apps; deny consent; play DRM content → "No capturable audio" |
| 18 | Permission revocation | Revoke mic in settings during live mode; stop casting from quick settings |
| 19 | On-screen subtitles | Live Translator → Subtitles; play a non-protected video with CC on and its volume at 0 → translated voice within ~0.5 s of the line appearing; open a DRM app → "Screen is protected"; turn CC off → "No subtitles on screen" after 20 s |
| 20 | Local movie from subtitles | Player → Dub from: Subtitles → choose embedded track or .srt → lines start at subtitle times; switching back to Speech re-dubs |
| 21 | Low-memory device | `adb shell am send-trim-memory ai.dubix.app RUNNING_LOW`; Light profile on <4 GB devices |
| 20 | Force close and restart | Kill during dubbing; reopen → "Partly dubbed", Continue resumes from covered range |
| 21 | SQLite persistence | Sessions, segments, voice mappings, progress survive restart |
| 22 | Cache cleanup | Privacy → clear audio/transcripts; audio cache limit eviction at startup |
| 23 | Tablet layout | Rail navigation + two-column screens (test on a 7"/10" emulator AVD) |
| 24 | Translation failure recovery | Delete a translation pack mid-session → `translation_pack_missing` → download → Continue |
| 25 | Long-video cancellation | Cancel during a long Prepare job; covered ranges kept |

### Sample clip

`dubix_sample_dialogue.mp4` (35 s, 1280×720 H.264 + AAC) is generated locally, not downloaded:
- **Speech:** a two-speaker English dialogue spoken by the Windows built-in voices (David, male; Zira, female).
- **Audio bed:** quiet brown-noise ambience, so the track is a realistic mix.
- **Picture:** an ffmpeg `testsrc2` pattern.

It contains no copyrighted material. Regenerate it with any TTS and ffmpeg:
`ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=25 -i dialogue.wav -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac out.mp4`.

## Device run log

### 2026-11-08 · Motorola edge 50 pro · Android 16 · arm64-v8a · debug build + Metro

| Check | Result |
|-------|--------|
| Debug APK build (arm64) and install | Passed |
| App launch, onboarding, navigation, light theme, Inter, Lucide icons | Passed after fixing a crash (below) |
| ML Kit translation packs (en, hi) | Downloaded and installed |
| Whisper tiny / base downloads | Downloaded (116 MB / 208 MB), extracted (245 MB / 432 MB on disk), manifest written |
| Transient network failure on the VAD download | Shown as an error with Retry; logged in `download_jobs` and `local_diagnostics` |
| End-to-end English→Hindi dubbing of `dubix_sample_dialogue.mp4` | **Not yet run.** Still waiting for the VAD and voice packs to finish downloading |

Bugs found on the device and fixed:
1. **Crash: "Should have a queue" hook-order error on Home.** The store selector was named `use`, a name React 19 and the React Compiler reserve for the conditional `use()` API. It is renamed to `useValue`.
2. **False "System memory is low" warning.** It fired when the app went to the background (`TRIM_MEMORY_UI_HIDDEN` / `BACKGROUND`). It is now raised only for `RUNNING_LOW` / `RUNNING_CRITICAL`; background trims are silent.

Real benchmark numbers (ASR/MT/TTS timings, real-time factor, peak RAM, drift) come from
Settings › Device Performance and the `metrics` table after the first full dub. They are
intentionally not filled in until measured.

#### Follow-up fixes from device testing (same device, 2026-11-08)

| Issue seen on device | Root cause | Fix |
|----------------------|-----------|-----|
| Voice preview: "synthesizer produced silence"; live voice output silent | sherpa-onnx 2.0 removed espeak-ng, so Piper voices cannot convert text to phonemes | Pinned sherpa-onnx **1.12.21** (espeak-ng bundled, verified in the `.so`), fetched from the maintainers' Hugging Face mirror with SHA-256 check. Silent output now also falls back to an offline Android voice |
| "cannot commit - no transaction is active" | overlapping `withTransactionAsync` calls on one SQLite connection | All writes go through `SerializedDb` (FIFO queue); covered by `tests/db-serialization.test.ts` |
| Male speaker dubbed with a female voice; 2 people detected as 6 speakers | voice chosen per line from that line's pitch; short lines created new clusters | `SpeakerVoiceAssigner`: one sticky voice per speaker from the median pitch of its first lines, distinct voices per gender pool (pitch offsets when speakers outnumber voices); short segments (<1.5 s) cannot create speakers; clustering threshold 0.5. Live mode picks a pitch-matched voice per utterance. JUnit `VoiceAssignerTest` |
| "Encountered two children with the same key" on Home | duplicate session entry in the list | session list de-duplicated on refresh |
| ML Kit translation packs fail: "Attempt to invoke virtual method … getClass() on a null object reference" | Play services threw an NPE in `RemoteModelManager.download`; both packs downloaded concurrently | Pack downloads are serialized (queued state shown); on failure the pack is fetched through a `Translator.downloadModelIfNeeded` client; readable error messages |
| Model downloads blocked on mobile data | "Wi-Fi only" was on by default; ML Kit could wait silently for Wi-Fi | Default changed to Wi-Fi **or** mobile data (settings rev 2 migrates existing installs once). The Wi-Fi-only option remains and fails fast on mobile data with a clear message |
| Blank screen after launch while Metro was slow | First render waited for Inter fonts (served by Metro in dev) and for startup housekeeping | Fonts wait at most 4 s (system-font fallback); housekeeping runs after first render; `[startup]` timing logs |
| Metro bundling took ~38 min | Metro crawled ~37k Gradle build files (`node_modules/*/android/build`, `android/`) | `metro.config.js` blockList excludes native build output |
| `expo lint` (first run): 11 errors | React Compiler rules: refs written during render, state synced via effects | Slider uses responder props without refs; draft-state pattern for sliders; keyed remount in Voice Studio; async effects. `expo lint` now passes with 0 problems |
| Release APK: translation packs fail with `NullPointerException` (`getClass()` on null) | R8 (enabled by `android.enableMinifyInReleaseBuilds=true`) stripped the no-arg constructors of ML Kit's `NaturalLanguageTranslateRegistrar` / `CommonComponentRegistrar` (logcat: `ComponentDiscovery … NoSuchMethodException … <init>`), so ML Kit registered no components | Consumer keep rules in `modules/dubix-native/android/proguard-rules.pro` for `ComponentRegistrar` implementations and `com.google.mlkit.**`. `TranslationEngine` now creates the model manager lazily, logs every failure under `DubixMLKit`, and falls back to `Translator.downloadModelIfNeeded` |
