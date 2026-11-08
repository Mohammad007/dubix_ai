# Production checklist

## Before the first release

- [ ] Run the full on-device plan in [TESTING.md](TESTING.md) on the device matrix; record RTF and live latency.
- [ ] Release signing: create an upload keystore (kept out of git, `*.jks` is ignored) and configure
      `android/app/build.gradle` signingConfigs via a config plugin or EAS credentials.
- [x] R8/minify is on for release (`android.enableMinifyInReleaseBuilds=true`). `modules/dubix-native/android/proguard-rules.pro`
      keeps `com.k2fsa.sherpa.onnx.**` (JNI field access) and ML Kit component registrars (reflection). Without the latter,
      translation fails only in release builds. After adding any library that uses reflection, re-test a release build on a device.
- [ ] Split APKs / App Bundle per ABI (sherpa-onnx native libs are large); consider dropping `x86_64` for store builds.
- [ ] Play Console declarations:
      - Foreground service types `mediaProjection` and `microphone`, with a demo video of user-initiated capture.
      - `SYSTEM_ALERT_WINDOW` justification (floating controller, user-enabled).
      - Data safety: no data collected or shared; on-device processing; downloads from GitHub and Google Play services.
- [ ] Store listing copy must match [RESTRICTIONS.md](RESTRICTIONS.md): no claims of Netflix/Prime/YouTube
      support, lip-sync, or muting other apps.
- [ ] Review the licence of each shipped/downloadable Piper voice (some are CC-BY-NC or have dataset
      restrictions) and show attributions in the app.
- [ ] Mirror model files to infrastructure you control (and update catalog URLs) if GitHub release
      availability or rate limits are a concern; add published SHA-256 for Whisper and speaker models
      once mirrored (catalog entries currently have `sha256: null`).
- [ ] Crash reporting: none is included (no-backend requirement). If one is added, it must be opt-in and listed in Data safety.

## Phase 4: performance and accuracy work still open

- [ ] Hardware acceleration: evaluate sherpa-onnx `provider = "nnapi"` / QNN on supported SoCs (currently CPU only).
- [ ] Use int8 Whisper consistently and benchmark `whisper-turbo` on flagships.
- [ ] Streaming ASR (online zipformer) for lower live latency on low-end devices.
- [ ] Parallelize the job: decode+VAD producer thread, ASR/MT/TTS consumer pool (currently one thread per job).
- [ ] Context-aware MT: batch adjacent short lines before translation to improve fluency.
- [ ] Diarization quality: re-cluster speakers at job end (agglomerative over stored embeddings) and relabel.
- [ ] Speaker register: replace the pitch heuristic with a small on-device classifier, if a suitably licensed one exists.
- [ ] Optional music/dialogue separation if a mobile-feasible model becomes available; until then keep the warning.
- [ ] Prefetch policy: prioritise dubbing near the playback position after a seek (currently restarts from the processed frontier).
- [ ] Persist live-session preferences per source app; per-app capture-support hints learned from silence detection.

## Operational

- [ ] Version the model catalog (`version` field) and handle upgrades: download new, verify, swap, delete old.
- [ ] Migration tests for `dubix.db` (`PRAGMA user_version`) before shipping schema changes.
- [ ] Accessibility audit with TalkBack and font scale 200% on phone and tablet.
- [ ] Localise UI strings (currently English).
