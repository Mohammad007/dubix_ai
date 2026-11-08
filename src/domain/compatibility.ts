import type { DeviceInfo, SystemVoice } from 'dubix-native';

import { getLanguage, type Language } from './languages';
import { MODEL_CATALOG, voicesFor, type CatalogModel } from './modelCatalog';

export const SUPPORTED_ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86_64'];
export const MIN_API = 26;

export type CompatIssue =
  | { code: 'abi'; message: string; blocking: true }
  | { code: 'api'; message: string; blocking: true }
  | { code: 'ram'; message: string; blocking: boolean }
  | { code: 'storage'; message: string; blocking: boolean };

/** Checks whether a model pack can be installed and run on this device. */
export function checkModel(model: CatalogModel, device: DeviceInfo): CompatIssue[] {
  const issues: CompatIssue[] = [];
  if (!device.abis.some((a) => SUPPORTED_ABIS.includes(a))) {
    issues.push({ code: 'abi', message: `CPU architecture ${device.abis.join(', ')} is not supported`, blocking: true });
  }
  if (device.apiLevel < MIN_API) {
    issues.push({ code: 'api', message: 'Requires Android 8.0 or newer', blocking: true });
  }
  if (device.totalRamMb < model.minRamMb) {
    const blocking = device.totalRamMb < model.minRamMb * 0.6;
    issues.push({
      code: 'ram',
      message: blocking
        ? `Needs about ${Math.round(model.minRamMb / 1024)} GB RAM; this device has ${(device.totalRamMb / 1024).toFixed(1)} GB`
        : 'May run slowly on this device (below recommended RAM)',
      blocking,
    });
  }
  const need = model.archive === 'tar.bz2' ? model.sizeBytes * 3.2 : model.sizeBytes;
  if (device.storageFreeBytes < need + 200 * 1024 * 1024) {
    issues.push({ code: 'storage', message: 'Not enough free storage to install', blocking: true });
  }
  return issues;
}

/** Picks the best ASR model that fits the device, preferring an installed one. */
export function recommendedAsr(device: DeviceInfo | null, installed: Set<string>): CatalogModel {
  const asr = MODEL_CATALOG.filter((m) => m.kind === 'asr');
  const fits = (m: CatalogModel) => !device || device.totalRamMb >= m.minRamMb;
  return (
    asr.find((m) => installed.has(m.id) && m.tier === 'balanced' && fits(m)) ??
    asr.find((m) => installed.has(m.id) && fits(m)) ??
    asr.find((m) => m.tier === 'balanced' && fits(m)) ??
    asr[0]
  );
}

export type Requirement = {
  key: string;
  label: string;
  satisfied: boolean;
  /** catalog model id or `mlkit-<lang>` */
  installId?: string;
};

export type LanguageAvailability = {
  language: Language;
  status: 'ready' | 'download' | 'unavailable';
  requirements: Requirement[];
  voiceSource: 'pack' | 'system' | null;
  reason?: string;
};

export type AvailabilityContext = {
  installed: Set<string>;
  translationPacks: Set<string>;
  systemVoices: SystemVoice[];
  /** ML Kit supported languages; null when unknown (engine unavailable) */
  translatable: Set<string> | null;
};

/**
 * Whether `target` can be dubbed from `source` on this device: ASR + VAD, both translation packs,
 * and an offline voice (downloadable pack, or an already-installed Android system voice).
 */
export function languageAvailability(target: string, source: string, ctx: AvailabilityContext): LanguageAvailability {
  const language = getLanguage(target);
  if (!language) throw new Error(`Unknown language ${target}`);
  const reqs: Requirement[] = [];
  const hasAsr = MODEL_CATALOG.some((m) => m.kind === 'asr' && ctx.installed.has(m.id));
  reqs.push({ key: 'vad', label: 'Voice activity detection', satisfied: ctx.installed.has('vad-silero'), installId: 'vad-silero' });
  reqs.push({ key: 'asr', label: 'Speech recognition', satisfied: hasAsr, installId: 'asr-whisper-base' });

  if (ctx.translatable && !ctx.translatable.has(language.translateTarget)) {
    return { language, status: 'unavailable', requirements: reqs, voiceSource: null, reason: 'Offline translation does not support this language' };
  }
  const langs = new Set([language.translateTarget]);
  if (source !== 'auto') langs.add(getLanguage(source)?.translateTarget ?? source);
  else langs.add('en');
  for (const l of langs) {
    reqs.push({ key: `mt-${l}`, label: `Translation pack · ${getLanguage(l)?.name ?? l}`, satisfied: ctx.translationPacks.has(l), installId: `mlkit-${l}` });
  }

  const packVoices = voicesFor(language.voiceLang);
  const installedPack = packVoices.some((v) => ctx.installed.has(v.id));
  const systemVoice = ctx.systemVoices.some((v) => v.language.split('-')[0] === language.voiceLang);
  let voiceSource: LanguageAvailability['voiceSource'] = null;
  if (installedPack) voiceSource = 'pack';
  else if (systemVoice) voiceSource = 'system';

  if (!voiceSource && packVoices.length === 0) {
    return {
      language,
      status: 'unavailable',
      requirements: reqs,
      voiceSource: null,
      reason: 'No offline voice for this language on this device. Install one in Android Settings > Text-to-speech.',
    };
  }
  reqs.push({ key: 'voice', label: `${language.name} voice`, satisfied: voiceSource !== null, installId: packVoices[0]?.id });

  const ready = reqs.every((r) => r.satisfied);
  return { language, status: ready ? 'ready' : 'download', requirements: reqs, voiceSource };
}
