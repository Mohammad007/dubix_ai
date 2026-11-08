import { languageAvailability, type LanguageAvailability } from '@/domain/compatibility';
import { LANGUAGES } from '@/domain/languages';
import { engine } from '@/store/engine';
import { getSettings, useSettings } from '@/store/settings';

/** Availability of every target language for the current source language. */
export function useLanguageAvailability(source: string): LanguageAvailability[] {
  const st = engine.useValue();
  return LANGUAGES.map((l) =>
    languageAvailability(l.code, source, {
      installed: st.installedIds,
      translationPacks: st.translationPacks,
      systemVoices: st.systemVoices,
      translatable: st.translatable,
    }),
  );
}

export function usePairAvailability(): LanguageAvailability {
  const s = useSettings();
  const st = engine.useValue();
  return languageAvailability(s.targetLang, s.sourceLang, {
    installed: st.installedIds,
    translationPacks: st.translationPacks,
    systemVoices: st.systemVoices,
    translatable: st.translatable,
  });
}

/** Label + tone for the global offline status pill (hook: re-renders on engine/settings changes). */
export function usePairStatus(): { label: string; tone: 'success' | 'warning' | 'danger' } {
  const st = engine.useValue();
  useSettings();
  if (!st.available) return { label: 'Engine unavailable', tone: 'danger' };
  const s = getSettings();
  const a = languageAvailability(s.targetLang, s.sourceLang, {
    installed: st.installedIds,
    translationPacks: st.translationPacks,
    systemVoices: st.systemVoices,
    translatable: st.translatable,
  });
  if (a.status === 'ready') return { label: 'Offline Ready', tone: 'success' };
  if (a.status === 'download') return { label: 'Setup needed', tone: 'warning' };
  return { label: 'Not supported', tone: 'danger' };
}
