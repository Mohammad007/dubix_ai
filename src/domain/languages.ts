/**
 * Language catalog. A language is *offered* as a dubbing target only when the device has (or can
 * download) every piece required: ASR for the source, an ML Kit translation pack, and an offline
 * voice. Availability is computed in `compatibility.ts`; this file only describes languages.
 */
export type LanguageCode = string;

export type Language = {
  code: LanguageCode;
  name: string;
  native: string;
  /** ML Kit translation target (Hinglish translates to Hindi, then a Roman style layer applies). */
  translateTarget: string;
  /** Language used to pick a TTS voice. */
  voiceLang: string;
  rtl?: boolean;
  /** Custom layer applied after translation (not a separate model). */
  styleLayer?: 'hinglish';
  /** Whisper can transcribe it (multilingual models). */
  asr: boolean;
  short: string;
};

export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', native: 'English', translateTarget: 'en', voiceLang: 'en', asr: true, short: 'EN' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', translateTarget: 'hi', voiceLang: 'hi', asr: true, short: 'HI' },
  {
    code: 'hinglish',
    name: 'Hinglish',
    native: 'Hindi + English (Roman)',
    translateTarget: 'hi',
    voiceLang: 'hi',
    styleLayer: 'hinglish',
    asr: false,
    short: 'HG',
  },
  { code: 'ur', name: 'Urdu', native: 'اردو', translateTarget: 'ur', voiceLang: 'ur', rtl: true, asr: true, short: 'UR' },
  { code: 'es', name: 'Spanish', native: 'Español', translateTarget: 'es', voiceLang: 'es', asr: true, short: 'ES' },
  { code: 'ar', name: 'Arabic', native: 'العربية', translateTarget: 'ar', voiceLang: 'ar', rtl: true, asr: true, short: 'AR' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', translateTarget: 'ta', voiceLang: 'ta', asr: true, short: 'TA' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', translateTarget: 'bn', voiceLang: 'bn', asr: true, short: 'BN' },
  { code: 'mr', name: 'Marathi', native: 'मराठी', translateTarget: 'mr', voiceLang: 'mr', asr: true, short: 'MR' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', translateTarget: 'te', voiceLang: 'te', asr: true, short: 'TE' },
  { code: 'fr', name: 'French', native: 'Français', translateTarget: 'fr', voiceLang: 'fr', asr: true, short: 'FR' },
  { code: 'de', name: 'German', native: 'Deutsch', translateTarget: 'de', voiceLang: 'de', asr: true, short: 'DE' },
  { code: 'ja', name: 'Japanese', native: '日本語', translateTarget: 'ja', voiceLang: 'ja', asr: true, short: 'JA' },
];

export const AUTO_DETECT = 'auto';

export function getLanguage(code: LanguageCode): Language | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

export function languageName(code: LanguageCode): string {
  if (code === AUTO_DETECT) return 'Auto-detect';
  return getLanguage(code)?.name ?? code.toUpperCase();
}

export function languageShort(code: LanguageCode): string {
  if (code === AUTO_DETECT) return 'AUTO';
  return getLanguage(code)?.short ?? code.toUpperCase();
}

export function searchLanguages(query: string, list: Language[] = LANGUAGES): Language[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (l) => l.name.toLowerCase().includes(q) || l.native.toLowerCase().includes(q) || l.code.toLowerCase().startsWith(q),
  );
}

/** Source languages Whisper can recognise (Hinglish speech is recognised as Hindi). */
export const SOURCE_LANGUAGES = LANGUAGES.filter((l) => l.asr);
