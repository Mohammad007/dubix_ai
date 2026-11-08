import { View } from 'react-native';

import { T } from '@/components/primitives/Text';
import { captionLines, findActiveSegment, SUBTITLE_SIZES, type TimedText } from '@/domain/captions';
import { getLanguage } from '@/domain/languages';
import { useSettings } from '@/store/settings';
import { colors, radius, space } from '@/theme/tokens';

/**
 * Timed captions over video. Uses per-segment timestamps, the user's sync offset (captions follow
 * the dubbed audio), and the stateful caption-language selection.
 */
export function SubtitleOverlay({ segments, positionMs, targetLang, bottom = 76, scale = 1 }: { segments: TimedText[]; positionMs: number; targetLang: string; bottom?: number; scale?: number }) {
  const s = useSettings();
  const active = findActiveSegment(segments, positionMs, s.syncOffsetMs);
  const lines = captionLines(active, s.captionMode, targetLang, s.hinglishStyle);
  if (!lines.length) return null;
  const rtl = getLanguage(targetLang)?.rtl;
  const size = SUBTITLE_SIZES[s.subtitleSize] * scale;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: space.md, right: space.md, bottom, alignItems: 'center', gap: 4 }} accessibilityLiveRegion="polite">
      {lines.map((l, i) => {
        const isOriginal = lines.length > 1 && i === 0;
        return (
          <View key={i} style={{ backgroundColor: s.subtitleBackground ? colors.overlay : 'transparent', borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 2 }}>
            <T
              style={{
                fontSize: isOriginal ? size * 0.85 : size,
                lineHeight: (isOriginal ? size * 0.85 : size) * 1.35,
                textAlign: 'center',
                fontFamily: 'Inter_600SemiBold',
                writingDirection: !isOriginal && rtl ? 'rtl' : 'auto',
                textShadowColor: '#000000',
                textShadowRadius: s.subtitleBackground ? 0 : 4,
              }}
              color={isOriginal ? colors.onVideoMuted : colors.onVideo}
            >
              {l}
            </T>
          </View>
        );
      })}
    </View>
  );
}
