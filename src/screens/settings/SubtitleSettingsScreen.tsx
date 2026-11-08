import { View } from 'react-native';

import { Card, Screen, ScreenTitle, SectionHeader, Segmented, T, Toggle } from '@/components/ui';
import { SUBTITLE_SIZES, type CaptionMode, type SubtitleSize } from '@/domain/captions';
import { toHinglish, type HinglishStyle } from '@/domain/hinglish';
import { getLanguage } from '@/domain/languages';
import { updateSettings, useSettings } from '@/store/settings';
import { colors, radius, space } from '@/theme/tokens';

const SAMPLE_SOURCE = 'We have to find another habitable planet.';
const SAMPLE_HI = 'हमें एक और रहने योग्य ग्रह ढूँढना होगा।';

export default function SubtitleSettingsScreen() {
  const s = useSettings();
  const hinglish = getLanguage(s.targetLang)?.styleLayer === 'hinglish';
  const translated = hinglish ? toHinglish(SAMPLE_HI, s.hinglishStyle, SAMPLE_SOURCE) : SAMPLE_HI;
  const lines = s.captionMode === 'off' ? [] : s.captionMode === 'original' ? [SAMPLE_SOURCE] : s.captionMode === 'both' ? [SAMPLE_SOURCE, translated] : [translated];
  const size = SUBTITLE_SIZES[s.subtitleSize];

  return (
    <Screen>
      <ScreenTitle title="Subtitle Style" back subtitle="How captions look in the movie player and fullscreen." />
      <View style={{ backgroundColor: '#111827', borderRadius: radius.lg, aspectRatio: 16 / 9, justifyContent: 'flex-end', padding: space.md, alignItems: 'center', gap: 4 }} accessibilityLabel="Subtitle preview">
        <T v="label" color="#98A2B3" style={{ position: 'absolute', top: space.md, left: space.md }}>
          PREVIEW
        </T>
        {lines.map((l, i) => (
          <View key={i} style={{ backgroundColor: s.subtitleBackground ? 'rgba(17,24,39,0.8)' : 'transparent', borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 2 }}>
            <T style={{ fontSize: lines.length > 1 && i === 0 ? size * 0.85 : size, lineHeight: size * 1.35, textAlign: 'center', fontFamily: 'Inter_600SemiBold' }} color={lines.length > 1 && i === 0 ? colors.onVideoMuted : colors.onVideo}>
              {l}
            </T>
          </View>
        ))}
      </View>

      <SectionHeader title="Size" />
      <Segmented<SubtitleSize> label="Subtitle size" value={s.subtitleSize} onChange={(k) => updateSettings({ subtitleSize: k })} options={[{ key: 's', label: 'Small' }, { key: 'm', label: 'Medium' }, { key: 'l', label: 'Large' }, { key: 'xl', label: 'XL' }]} />
      <SectionHeader title="Caption language" />
      <Segmented<CaptionMode> label="Caption language" value={s.captionMode} onChange={(k) => updateSettings({ captionMode: k })} options={[{ key: 'translated', label: 'Translated' }, { key: 'both', label: 'Both' }, { key: 'original', label: 'Original' }, { key: 'off', label: 'Off' }]} />
      {hinglish ? (
        <>
          <SectionHeader title="Hinglish script" />
          <Segmented<HinglishStyle> label="Hinglish style" value={s.hinglishStyle} onChange={(k) => updateSettings({ hinglishStyle: k })} options={[{ key: 'devanagari', label: 'Hindi script' }, { key: 'roman', label: 'Roman Hindi' }, { key: 'hinglish', label: 'Hinglish' }]} />
        </>
      ) : null}
      <Card style={{ marginTop: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <T v="cardTitle">Background box</T>
          <T v="caption" color={colors.textMuted}>
            Improves readability over bright scenes.
          </T>
        </View>
        <Toggle value={s.subtitleBackground} onChange={(v) => updateSettings({ subtitleBackground: v })} label="Caption background box" />
      </Card>
    </Screen>
  );
}
