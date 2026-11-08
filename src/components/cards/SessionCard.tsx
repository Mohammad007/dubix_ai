import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';

import { Button, IconButton } from '@/components/buttons/Button';
import { Pill, ProgressBar, type Tone } from '@/components/feedback/Feedback';
import { Icon } from '@/components/primitives/Icon';
import { T } from '@/components/primitives/Text';
import type { SessionRow } from '@/database';
import { languageShort } from '@/domain/languages';
import { coveredMs } from '@/domain/ranges';
import { cardShadow, colors, radius, space } from '@/theme/tokens';
import { formatDuration, formatRelativeDate } from '@/utils/format';

const STATUS: Record<SessionRow['status'], { label: string; tone: Tone }> = {
  new: { label: 'Not dubbed', tone: 'neutral' },
  processing: { label: 'Dubbing', tone: 'accent' },
  paused: { label: 'Partly dubbed', tone: 'neutral' },
  ready: { label: 'Dubbed', tone: 'success' },
  error: { label: 'Error', tone: 'danger' },
};

/** Real local session: thumbnail (or media icon), pair, last position with Continue, status. */
export function SessionCard({ s, onPress, onMenu }: { s: SessionRow; onPress: () => void; onMenu?: () => void }) {
  const st = STATUS[s.status];
  const dubbedPct = s.durationMs > 0 ? Math.round((coveredMs(s.coveredRanges) / s.durationMs) * 100) : 0;
  const watched = s.durationMs > 0 ? s.lastPositionMs / s.durationMs : 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${s.name}, ${languageShort(s.sourceLang)} to ${languageShort(s.targetLang)}, ${st.label}, last played at ${formatDuration(s.lastPositionMs)}`}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? colors.surfaceAlt : colors.surface, marginBottom: space.sm },
        cardShadow(),
      ]}
    >
      <View style={{ width: 112, height: 68, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
        {s.thumbnail ? <Image source={{ uri: s.thumbnail }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <Icon name="film" color={colors.accent} />}
        <View style={{ position: 'absolute', right: 4, bottom: 4, backgroundColor: colors.overlay, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 }}>
          <T v="mono" color={colors.onVideo} style={{ fontSize: 11 }}>
            {formatDuration(s.durationMs)}
          </T>
        </View>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <T v="cardTitle" numberOfLines={1}>
          {s.name}
        </T>
        <T v="caption" color={colors.textMuted} numberOfLines={1}>
          {languageShort(s.sourceLang)} → {languageShort(s.targetLang)} · {formatRelativeDate(s.updatedAt)}
        </T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
          <Pill label={s.status === 'paused' || s.status === 'processing' ? `${st.label} ${dubbedPct}%` : st.label} tone={st.tone} showIcon={false} />
          {s.lastPositionMs > 0 ? (
            <T v="caption" color={colors.textMuted}>
              at {formatDuration(s.lastPositionMs)}
            </T>
          ) : null}
        </View>
        {watched > 0.01 ? <ProgressBar value={watched} height={4} label="Watched" /> : null}
      </View>
      {onMenu ? (
        <IconButton icon="more" label={`Options for ${s.name}`} onPress={onMenu} />
      ) : s.lastPositionMs > 0 ? (
        <Button label="Continue" compact variant="secondary" onPress={onPress} />
      ) : null}
    </Pressable>
  );
}
