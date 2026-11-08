import type { SystemVoice, VoiceSpec } from 'dubix-native';

import { getLanguage } from './languages';
import { voicesFor } from './modelCatalog';

export type Register = 'low' | 'high' | 'neutral';

/** A user-facing voice choice for a speaker. */
export type VoiceChoice = {
  key: string; // `pack:<modelId>` | `system:<name>` | `auto`
  label: string;
  gender: 'male' | 'female' | 'neutral';
  spec: VoiceSpec;
};

export type SpeakerOverride = { voiceKey: string; pitch: number; speed: number };

export const DEFAULT_TUNING = { pitch: 0, speed: 1 } as const;

/** All offline voices usable for `targetLang` given installed packs and system voices. */
export function availableVoices(targetLang: string, installed: Set<string>, systemVoices: SystemVoice[]): VoiceChoice[] {
  const lang = getLanguage(targetLang)?.voiceLang ?? targetLang;
  // Labels number voices per published voice character ("Male Voice 1 · Rohan"). Android system
  // voices do not report a gender, so they are listed as neutral rather than guessed.
  const counters = { male: 0, female: 0, neutral: 0 };
  const name = (g: 'male' | 'female' | 'neutral') => `${g === 'male' ? 'Male' : g === 'female' ? 'Female' : 'Neutral'} Voice ${++counters[g]}`;
  const packs: VoiceChoice[] = voicesFor(lang)
    .filter((m) => installed.has(m.id))
    .map((m) => {
      const gender = m.gender ?? 'neutral';
      return {
        key: `pack:${m.id}`,
        label: `${name(gender)} · ${m.title.replace(/^.*Voice · /, '')}`,
        gender,
        spec: { engine: 'sherpa' as const, modelId: m.id, speakerId: 0, language: lang, pitch: 0, speed: 1 },
      };
    });
  const system: VoiceChoice[] = systemVoices
    .filter((v) => v.language.split('-')[0] === lang)
    .map((v) => ({
      key: `system:${v.name}`,
      label: `${name('neutral')} · Android system`,
      gender: 'neutral' as const,
      spec: { engine: 'system' as const, systemVoice: v.name, language: lang, pitch: 0, speed: 1 },
    }));
  return [...packs, ...system];
}

/**
 * Default voice for an estimated pitch register. Low -> a male voice, high -> a female voice,
 * neutral -> the first available. When only one gender exists, pitch shifting approximates the
 * other register; this is labelled in the UI as an approximation.
 */
export function voiceForRegister(register: Register, voices: VoiceChoice[]): VoiceSpec | null {
  if (voices.length === 0) return null;
  const want = register === 'low' ? 'male' : register === 'high' ? 'female' : null;
  if (!want) return voices[0].spec;
  const exact = voices.find((v) => v.gender === want);
  if (exact) return exact.spec;
  return { ...voices[0].spec, pitch: register === 'low' ? -3 : 3 };
}

/** Builds the job voice map: per-register defaults plus explicit per-speaker overrides. */
export function buildVoiceMap(
  voices: VoiceChoice[],
  overrides: Record<number, SpeakerOverride>,
  globalSpeed: number,
): Record<string, VoiceSpec> {
  const map: Record<string, VoiceSpec> = {};
  const withSpeed = (s: VoiceSpec): VoiceSpec => ({ ...s, speed: s.speed * globalSpeed });
  const def = voiceForRegister('neutral', voices);
  if (def) map.default = withSpeed(def);
  for (const r of ['low', 'high', 'neutral'] as Register[]) {
    const v = voiceForRegister(r, voices);
    if (v) map[r] = withSpeed(v);
  }
  for (const [speaker, o] of Object.entries(overrides)) {
    const choice = voices.find((v) => v.key === o.voiceKey);
    if (!choice) continue;
    map[`speaker:${speaker}`] = { ...choice.spec, pitch: o.pitch, speed: o.speed * globalSpeed };
  }
  return map;
}

/** Voices grouped by published character, for automatic per-speaker assignment (with speed applied). */
export function buildVoicePools(voices: VoiceChoice[], globalSpeed: number): { male: VoiceSpec[]; female: VoiceSpec[]; neutral: VoiceSpec[] } {
  const pick = (g: VoiceChoice['gender']) => voices.filter((v) => v.gender === g).map((v) => ({ ...v.spec, speed: v.spec.speed * globalSpeed }));
  return { male: pick('male'), female: pick('female'), neutral: pick('neutral') };
}

export function registerLabel(r: Register): string {
  return r === 'low' ? 'Lower voice (estimated)' : r === 'high' ? 'Higher voice (estimated)' : 'Voice range unclear';
}
