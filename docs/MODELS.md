# Model setup

All models run on device. Packs are optional downloads, started by the user in **Offline AI Models**
or from the language screen. The catalog is local metadata in
[`src/domain/modelCatalog.ts`](../src/domain/modelCatalog.ts); there is no server.

## Native runtime

`scripts/fetch-sherpa-onnx.js` (run by `npm install`) downloads `sherpa-onnx-2.0.1.aar` and checks
its SHA-256 (`a8d09d1d…0ee7`, published by GitHub for the release asset). It then installs the AAR
into `modules/dubix-native/android/maven/` as `com.k2fsa:sherpa-onnx:2.0.1`. The app picks it up through
`expo-build-properties.extraMavenRepos` (absolute path computed in `app.config.js`).

Offline/air-gapped build: `DUBIX_SHERPA_AAR=/path/to/sherpa-onnx-2.0.1.aar node scripts/fetch-sherpa-onnx.js`.

To upgrade sherpa-onnx, change `VERSION` + `SHA256` in the script and `sherpaOnnxVersion` in
`modules/dubix-native/android/build.gradle`, then re-run the JVM tests and an on-device smoke test.
The Kotlin config classes have changed between versions before.

## Catalog

| ID | Kind | Size | Checksum | Notes |
|----|------|------|----------|-------|
| `vad-silero` | VAD | 0.6 MB | published | Required |
| `asr-whisper-tiny` | ASR | 111 MB | not published | ≥2 GB RAM, fastest |
| `asr-whisper-base` | ASR | 198 MB | not published | ≥3 GB RAM, recommended |
| `asr-whisper-small` | ASR | 610 MB | not published | ≥6 GB RAM, most accurate |
| `speaker-campplus` | Speaker embedding | 28 MB | not published | Enables per-speaker voices |
| `tts-hi_IN-rohan-medium` | Hindi voice (male) | 64 MB | published | |
| `tts-hi_IN-priyamvada-medium` | Hindi voice (female) | 64 MB | published | |
| `tts-hi_IN-pratham-medium` | Hindi voice (male) | 64 MB | published | |
| `tts-ur_PK-fasih-medium` | Urdu voice (male) | 64 MB | published | |
| `tts-es_ES-davefx-medium` | Spanish voice (male) | 64 MB | published | |
| `tts-es_AR-daniela-high` | Spanish voice (female) | 110 MB | published | |
| `tts-ar_JO-kareem-medium` | Arabic voice (male) | 64 MB | published | |
| `tts-en_US-amy-low` | English voice (female) | 64 MB | published | |
| `tts-en_US-ryan-medium` | English voice (male) | 64 MB | published | |
| `mlkit-<lang>` | Translation pack | ~30 MB each | managed by Play services | English + target (+ fixed source) |

Sizes and digests come from the GitHub release API for the `k2-fsa/sherpa-onnx` `asr-models`,
`tts-models` and `speaker-recongition-models` releases (the misspelling is the real release tag).
Archives are `.tar.bz2` and are extracted on device.

Languages without a downloadable voice (for example Tamil, Bengali, Marathi, Telugu) work when the
device has an **installed offline** Android TTS voice for them (Settings › System › Languages ›
Text-to-speech › install voice data). Network-only system voices are ignored.

## Install pipeline

1. Compatibility check (`domain/compatibility.ts#checkModel`): ABI, API level, RAM (warn under the
   recommended amount, block under 60% of it), and free storage (about 3.2× the archive size
   during extraction).
2. Download with HTTP `Range` resume into `cache/model-downloads/<id>.part`, with a Wi-Fi-only check.
3. SHA-256 is computed while streaming. When the catalog has a digest, a mismatch deletes the file
   and fails. When it does not, the computed hash is stored and the UI shows "No published checksum".
4. Extraction into a staging directory, with path-traversal and symlink protection.
5. Atomic rename to `files/models/<id>/` and write of `dubix-manifest.json` (id, version, sha256,
   verified, size, source). Only directories with a manifest count as installed.

## Adding a model

Add an entry to `MODEL_CATALOG`. File resolution is pattern-based (`ModelStore.kt`):

- Whisper: `*encoder*.onnx`, `*decoder*.onnx` (int8 preferred), `*tokens.txt`
- VITS/Piper: the `.onnx` in the pack, `tokens.txt`, optional `espeak-ng-data/`, `lexicon.txt`
- VAD / speaker: the single `.onnx`

Other sherpa-onnx families (Kokoro, Matcha, SenseVoice, Moonshine, …) need a new branch in
`AsrEngine`/`TtsEngine`.

## Choosing models per device

`recommendedAsr()` picks Whisper base where RAM allows and falls back to tiny. On devices with less
than 4 GB of RAM, use tiny with speaker detection off for real-time live mode. For offline dubbing,
any model works; it only changes how long the job takes (see the real-time factor on the player).

## Known issue: Piper voices on sherpa-onnx 2.x

sherpa-onnx **2.0 removed the built-in espeak-ng phonemizer**. Its log says: `No frontend available.
For piper/icefall/inflect/coqui models, provide phoneme_codepoints via GenerationConfig`. On 2.0.1,
Piper/VITS voice packs therefore produce no audio, which was found on a device on 2026-11-08.

- **Current behaviour:** `TtsEngine` detects silent output, marks that pack unusable for the session,
  warns once (`voice_pack_fallback`), and speaks with an installed **offline** Android system voice
  for the same language. If none is installed, the error tells the user to install the language's
  voice data in Android Settings › Text-to-speech.
- **Planned fix:** pin the last 1.x runtime, which still bundles espeak-ng: `v1.13.8`, AAR SHA-256
  `633c24321e06b1fe79feafa03ea16cbc0f8a286641e2da3559bac91bdb13bd96` (from the GitHub release API).
  Change `VERSION`/`SHA256` in `scripts/fetch-sherpa-onnx.js` and `sherpaOnnxVersion` in
  `modules/dubix-native/android/build.gradle`, rebuild, and confirm on a device that Piper speaks.
  This was blocked on 2026-11-08 because GitHub's release CDN returned 504 for every asset.
