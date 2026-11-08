# DubiX AI

Android-first offline movie translator and dubbing app. Open a video file you own, and DubiX
recognizes the dialogue, translates it and speaks it in offline AI voices (a different voice per
speaker if you like), timed to each line. Everything runs on the device after optional one-time
model downloads. There is no backend, Firebase, account or login.

> DubiX does not change lip movements, cannot separate music from dialogue, and cannot capture
> DRM-protected or capture-restricted apps (Netflix, Prime Video, Disney+ and many others).
> See [docs/RESTRICTIONS.md](docs/RESTRICTIONS.md).

## Stack

| Layer | Technology |
|-------|------------|
| UI | React Native 0.88 (Expo SDK 58, prebuild / development build), TypeScript, Expo Router (React Navigation), Reanimated, Gesture Handler, Safe Area Context, Zustand, Lucide line icons (react-native-svg), Inter |
| Native | Kotlin (Expo Modules API), Media3 ExoPlayer, MediaCodec, MediaProjection + AudioPlaybackCapture, AudioRecord / AudioTrack, foreground service, WindowManager overlay, Android TextToSpeech, Storage Access Framework |
| AI (on device) | sherpa-onnx 2.0.1: Silero VAD, Whisper ASR, CAM++ speaker embeddings, Piper/VITS TTS · Google ML Kit on-device translation · Android offline system voices |
| Storage | SQLite (expo-sqlite, migrations + typed repositories), MMKV (preferences), app-private files |
| Build | Gradle, Hermes, New Architecture |

## Design

Flat, minimalist and premium, matching the reference screens: primary `#6848F4` (pressed `#5635DA`),
background `#F8F9FE`, cards `#FFFFFF`, secondary `#F0EEFF`, text `#111827` / `#667085`,
borders `#E5E7EF`, success `#16A34A`, error `#DC2626`. Warning *text* uses `#B45309`, a darker step
of the specified `#D97706` that passes WCAG AA on white. There are no gradients, no glassmorphism,
16 dp cards and 14 dp buttons. An optional dark theme (navy `#101827` / cyan `#25BCD6`) is available
in Settings › Appearance.

Layouts are responsive:
- **Phones:** bottom tabs.
- **Tablets:** a side rail and two-column layouts.
- **Movie playback:** landscape fullscreen with picture-in-picture.

## Screens

| # | Screen | Route | Highlights |
|---|--------|-------|-----------|
| 1 | Home | `(tabs)/index` | Live Movie Translation hero, quick features, real recent sessions with Continue, device status |
| 2 | Language Selection | `/language` | Search, source auto-detect, availability per language, download flow, Hinglish style (Hindi script / Roman Hindi / Hinglish) |
| 3 | Live Translator | `(tabs)/translate` | Mic or permitted app capture, real level meter, real ASR/MT text, Start/Pause/Stop, voice and subtitle toggles, measured delay, model status |
| 4 | Floating Controller | `/floating` | Overlay permission, draggable bubble, start/pause/stop, subtitle/voice toggles, notification fallback |
| 5 | Local Movie Player | `(tabs)/player` | Media3 playback, seek, speed, audio tracks, PiP, landscape fullscreen, resume, Prepare vs Live dubbing, separate original/dub volume and mute |
| 6 | AI Voice Studio | `(tabs)/voices` | Detected speakers, only installed voices, pitch/speed, preview, reset, save to SQLite, regenerate |
| 7 | Audio Sync | `/sync` | Automatic latency compensation, ±1000 ms offset, speed, stretch limit, spill buffer, silence trim, ducking, drift, real waveforms |
| 8 | Offline AI Models | `/models` | Storage summary, categories, real version and size, checksum, progress, cancel/retry/remove, Wi-Fi only, auto-delete |
| 9 | Permissions & Compatibility | `/permissions` | Checklist, denied / permanently denied, Go to Settings, single-use MediaProjection explained |
| 10 | Settings & History | `(tabs)/settings` | Preferences, appearance, performance profiles + stage timings, history, clear data |

Additional screens:
- **Onboarding** (`/onboarding`): Welcome → How it works → Default language → Device compatibility → Required models → Download progress → Setup complete.
- **Other routes:** Translation History (`/history`), Session Details with transcript editing and speaker correction (`/session/[id]`), Subtitle Style (`/subtitles`), Privacy with cache clearing and diagnostics (`/privacy`), and About & limits (`/about`).

## Status and verification

The following were verified for this revision:
- **TypeScript:** `tsc` is clean.
- **Jest:** 26 tests pass.
- **Kotlin:** the module compiles and its JVM unit tests pass.
- **Debug APK:** builds for arm64-v8a.
- **On-device:** results of the run on a Motorola Edge 50 Pro (Android 16) are recorded in [docs/TESTING.md](docs/TESTING.md#device-run-log).

Anything not listed there has not been verified on hardware yet.

## Build and run

Requirements:
- Node 20+.
- JDK 17.
- Android SDK (platform 36).
- A device running Android 8.0+ (API 26). External-app capture needs Android 10+.

```bash
npm install                      # also fetches + SHA-256-verifies the sherpa-onnx AAR
npx expo prebuild --platform android
npx expo run:android             # development build on a connected device (Expo Go cannot load the native engine)
```

### Debug APK

```bash
cd android
./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The debug APK loads JS from Metro (`npm start`). For a standalone debug build that bundles JS,
use `./gradlew assembleRelease` with the debug signing config (default after prebuild), or see below.

### Signed release

1. Create an upload key (keep it out of git; `*.jks` is ignored):
   `keytool -genkeypair -v -keystore dubix-upload.jks -alias dubix -keyalg RSA -keysize 2048 -validity 10000`
2. Put `DUBIX_UPLOAD_STORE_FILE`, `DUBIX_UPLOAD_KEY_ALIAS`, `DUBIX_UPLOAD_STORE_PASSWORD` and `DUBIX_UPLOAD_KEY_PASSWORD` in `~/.gradle/gradle.properties`.
3. Add a `release` signingConfig in `android/app/build.gradle` that reads those properties. Prebuild regenerates this file, so do it in a config plugin, or use EAS credentials.
4. Run `./gradlew bundleRelease` to get an App Bundle (per-ABI splits keep the sherpa-onnx native libraries small).

See [docs/PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md) for Play Console declarations
(foreground service types, overlay, data safety).

## Tests

```bash
npm test              # Jest (tests/): Hinglish, captions, ranges/seek resync, profiles, errors, compatibility, voices, sync math
npm run typecheck
npm run test:native   # JUnit: resampler, WSOLA, pitch, silence trim, WAV, clustering, scheduler, text normalisation
```

## Project layout

```
src/
  app/                  Expo Router routes (thin wrappers) = navigation tree (root stack + tabs)
  navigation/           tab bar / tablet rail
  screens/              home, onboarding, translate (live, language, floating), player, voices, sync, models,
                        permissions, settings (settings, subtitles, privacy, about), history (list, details)
  components/           buttons, cards, controls, feedback, headers, layout, player, primitives, subtitles, waveform
  theme/                colors, spacing, typography, shadows
  store/                Zustand stores (engine state, settings persisted to MMKV)
  services/             dubbing (sessions/sync orchestration), audio (live), models, permissions
  database/             client, migrations, schemas, repositories
  domain/               pure logic: languages, Hinglish, captions, ranges, sync, voices, compatibility, profiles, errors
  hooks/, utils/
modules/dubix-native/   Kotlin engine (audio, ml, models, pipeline, player, live) + typed TS bridge
plugins/                config plugin (picture-in-picture, config changes)
tests/                  Jest suites
docs/                   architecture, native API, models, restrictions, testing, production checklist
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Native bridge API](docs/NATIVE_API.md)
- [Model setup and legal sources](docs/MODELS.md)
- [Android and OTT restrictions](docs/RESTRICTIONS.md)
- [Testing, benchmarks and device log](docs/TESTING.md)
- [Production checklist](docs/PRODUCTION_CHECKLIST.md)
