import type { ModelDownloadDescriptor, ModelKind } from 'dubix-native';

/**
 * Local model metadata. URLs point at official sherpa-onnx release assets; sizes and SHA-256
 * digests were taken from the GitHub release API. Entries without a published digest are
 * installed with their computed hash recorded and shown as "unverified source" in the UI.
 * Edit this file to add packs; no server is involved.
 */
export type CatalogModel = {
  id: string;
  kind: ModelKind;
  title: string;
  description: string;
  version: string;
  url: string;
  sha256: string | null;
  sizeBytes: number;
  archive: 'tar.bz2' | 'none';
  fileName?: string;
  /** Recommended minimum total RAM in MB to run comfortably. */
  minRamMb: number;
  /** Languages a TTS voice speaks / an ASR model recognises ('*' = multilingual). */
  languages: string[];
  /** Voice character as published by the voice's authors. */
  gender?: 'male' | 'female';
  required?: boolean;
  tier?: 'fast' | 'balanced' | 'accurate';
};

const SHERPA = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';

function piper(
  name: string,
  lang: string,
  gender: 'male' | 'female',
  title: string,
  sizeBytes: number,
  sha256: string,
): CatalogModel {
  return {
    id: `tts-${name}`,
    kind: 'tts',
    title,
    description: `Offline neural voice (Piper VITS), ${gender}`,
    version: '1',
    url: `${SHERPA}/tts-models/vits-piper-${name}.tar.bz2`,
    sha256,
    sizeBytes,
    archive: 'tar.bz2',
    minRamMb: 2048,
    languages: [lang],
    gender,
  };
}

export const MODEL_CATALOG: CatalogModel[] = [
  {
    id: 'vad-silero',
    kind: 'vad',
    title: 'Voice Activity Detection',
    description: 'Finds dialogue in the audio track (Silero VAD)',
    version: '5',
    url: `${SHERPA}/asr-models/silero_vad.onnx`,
    sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
    sizeBytes: 643854,
    archive: 'none',
    fileName: 'silero_vad.onnx',
    minRamMb: 1024,
    languages: ['*'],
    required: true,
  },
  {
    id: 'asr-whisper-tiny',
    kind: 'asr',
    title: 'Speech Recognition · Fast',
    description: 'Whisper tiny, multilingual. Lowest latency, lower accuracy',
    version: '1',
    url: `${SHERPA}/asr-models/sherpa-onnx-whisper-tiny.tar.bz2`,
    sha256: null,
    sizeBytes: 116204861,
    archive: 'tar.bz2',
    minRamMb: 2048,
    languages: ['*'],
    tier: 'fast',
  },
  {
    id: 'asr-whisper-base',
    kind: 'asr',
    title: 'Speech Recognition · Balanced',
    description: 'Whisper base, multilingual. Recommended for most phones',
    version: '1',
    url: `${SHERPA}/asr-models/sherpa-onnx-whisper-base.tar.bz2`,
    sha256: null,
    sizeBytes: 207557382,
    archive: 'tar.bz2',
    minRamMb: 3072,
    languages: ['*'],
    tier: 'balanced',
  },
  {
    id: 'asr-whisper-small',
    kind: 'asr',
    title: 'Speech Recognition · Accurate',
    description: 'Whisper small, multilingual. Best accuracy, slower than real time on many phones',
    version: '1',
    url: `${SHERPA}/asr-models/sherpa-onnx-whisper-small.tar.bz2`,
    sha256: null,
    sizeBytes: 639387718,
    archive: 'tar.bz2',
    minRamMb: 6144,
    languages: ['*'],
    tier: 'accurate',
  },
  {
    id: 'speaker-campplus',
    kind: 'speaker',
    title: 'Speaker Detection',
    description: 'Separates speakers so each gets its own voice (3D-Speaker CAM++)',
    version: '1',
    url: `${SHERPA}/speaker-recongition-models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx`,
    sha256: null,
    sizeBytes: 29596978,
    archive: 'none',
    fileName: 'campplus.onnx',
    minRamMb: 2048,
    languages: ['*'],
  },
  piper('hi_IN-rohan-medium', 'hi', 'male', 'Hindi Voice · Rohan', 67221139, 'f0bb7781724951e9c90c49f68abfe821cffcbc198a9ae0031366d045a6ad5488'),
  piper('hi_IN-priyamvada-medium', 'hi', 'female', 'Hindi Voice · Priyamvada', 67240610, '399d91cc97eb288725633261f26b715f9a971e3bf7ec4fa1d7910cd0080d37eb'),
  piper('hi_IN-pratham-medium', 'hi', 'male', 'Hindi Voice · Pratham', 67238438, '2084d321e1d2752f2b64ed3012ba27751df01a80da46f52920098cdcb7e35648'),
  piper('ur_PK-fasih-medium', 'ur', 'male', 'Urdu Voice · Fasih', 67227718, 'de64e03109f3c896b7cf910db6d9ffd2703e3d665580d9a19bedbf3e0760d0e4'),
  piper('es_ES-davefx-medium', 'es', 'male', 'Spanish Voice · Davefx', 67184952, 'a3f6beb54a9cb893279f72978a22f807a4d9fc9c7848157b524d5cc7b7f58b22'),
  piper('es_AR-daniela-high', 'es', 'female', 'Spanish Voice · Daniela', 115562134, '71cbf6b7f646ab74f3c51336151abef41e6c54467ac929ffdb19ed706a07dd7b'),
  piper('ar_JO-kareem-medium', 'ar', 'male', 'Arabic Voice · Kareem', 67177830, '9ebbcea30e0fbd588f7b2cb45ee897d6aeb1bf5791cbc037a7b5a3f641e3dbce'),
  piper('en_US-amy-low', 'en', 'female', 'English Voice · Amy', 67095344, 'c70f5284a09a7fd4ed203b39b2ff51cac1432b422b852eb647b481dade3cf639'),
  piper('en_US-ryan-medium', 'en', 'male', 'English Voice · Ryan', 67213100, 'c546af78b6395b4e7c4ce1ed899438b64426a362f5d4ec5fecd090ded9ad7505'),
];

/** ML Kit translation packs are managed by Google Play services; size is an approximation. */
export const TRANSLATION_PACK_APPROX_BYTES = 30 * 1024 * 1024;

export function getCatalogModel(id: string): CatalogModel | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

export function toDescriptor(m: CatalogModel, wifiOnly: boolean): ModelDownloadDescriptor {
  return {
    id: m.id,
    version: m.version,
    kind: m.kind,
    url: m.url,
    sha256: m.sha256,
    sizeBytes: m.sizeBytes,
    archive: m.archive,
    fileName: m.fileName,
    wifiOnly,
  };
}

export function voicesFor(lang: string): CatalogModel[] {
  return MODEL_CATALOG.filter((m) => m.kind === 'tts' && m.languages.includes(lang));
}
