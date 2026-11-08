import { toHinglish, type HinglishStyle } from './hinglish';
import { getLanguage } from './languages';

export type CaptionMode = 'translated' | 'original' | 'both' | 'off';

export type TimedText = {
  id: string;
  startMs: number;
  endMs: number;
  sourceText: string;
  translatedText: string;
};

/** Hold a caption briefly after its segment ends so short lines stay readable. */
export const CAPTION_HOLD_MS = 600;

/**
 * Binary search for the segment active at `positionMs` (segments sorted by start).
 * `offsetMs` is the user's audio sync offset; captions follow the dubbed audio timing.
 */
export function findActiveSegment<T extends TimedText>(segments: T[], positionMs: number, offsetMs = 0): T | null {
  const t = positionMs - offsetMs;
  let lo = 0;
  let hi = segments.length - 1;
  let candidate = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].startMs <= t) {
      candidate = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (candidate < 0) return null;
  const s = segments[candidate];
  const next = segments[candidate + 1];
  const holdUntil = Math.min(s.endMs + CAPTION_HOLD_MS, next ? next.startMs : Infinity);
  return t <= holdUntil ? s : null;
}

/** Display text for the target language, applying the Hinglish style layer when selected. */
export function displayTranslation(text: string, targetLang: string, style: HinglishStyle = 'hinglish', sourceText?: string): string {
  return getLanguage(targetLang)?.styleLayer === 'hinglish' ? toHinglish(text, style, sourceText) : text;
}

export function captionLines(seg: TimedText | null, mode: CaptionMode, targetLang: string, style: HinglishStyle = 'hinglish'): string[] {
  if (!seg || mode === 'off') return [];
  const translated = displayTranslation(seg.translatedText, targetLang, style, seg.sourceText);
  switch (mode) {
    case 'original':
      return [seg.sourceText];
    case 'translated':
      return [translated];
    case 'both':
      return [seg.sourceText, translated];
  }
}

export const SUBTITLE_SIZES = { s: 14, m: 17, l: 21, xl: 25 } as const;
export type SubtitleSize = keyof typeof SUBTITLE_SIZES;

export function stepSubtitleSize(size: SubtitleSize, dir: 1 | -1): SubtitleSize {
  const order: SubtitleSize[] = ['s', 'm', 'l', 'xl'];
  const i = Math.min(order.length - 1, Math.max(0, order.indexOf(size) + dir));
  return order[i];
}
