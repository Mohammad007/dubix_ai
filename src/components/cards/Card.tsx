import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/primitives/Icon';
import { T } from '@/components/primitives/Text';
import { cardShadow, colors, radius, space, TOUCH } from '@/theme/tokens';

export type CardTone = 'default' | 'accent' | 'danger' | 'warning' | 'success';

const toneColors = (tone: CardTone) =>
  ({
    default: [colors.surface, colors.border],
    accent: [colors.accentSoft, colors.accentSoft],
    danger: [colors.dangerSoft, colors.dangerSoft],
    warning: [colors.warningSoft, colors.warningSoft],
    success: [colors.successSoft, colors.successSoft],
  })[tone];

export function Card({ children, style, tone = 'default' }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: CardTone }) {
  const [bg, border] = toneColors(tone);
  return <View style={[{ backgroundColor: bg, borderColor: border, borderWidth: 1, borderRadius: radius.lg, padding: space.lg }, tone === 'default' && cardShadow(), style]}>{children}</View>;
}

export function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: space.xs }} />;
}

export function IconTile({ icon, tone = 'default', size = 44 }: { icon: IconName; tone?: 'default' | 'accent' | 'danger'; size?: number }) {
  const color = tone === 'danger' ? colors.danger : colors.accent;
  return (
    <View style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: tone === 'danger' ? colors.dangerSoft : colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} color={tone === 'default' ? colors.text : color} size={size * 0.5} />
    </View>
  );
}

export function ListRow({ icon, title, subtitle, right, onPress, danger }: { icon?: IconName; title: string; subtitle?: string; right?: ReactNode; onPress?: () => void; danger?: boolean }) {
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, gap: space.md, minHeight: TOUCH + 8 }}>
      {icon ? <IconTile icon={icon} tone={danger ? 'danger' : 'default'} /> : null}
      <View style={{ flex: 1 }}>
        <T v="cardTitle" color={danger ? colors.danger : colors.text}>
          {title}
        </T>
        {subtitle ? (
          <T v="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron-right" color={danger ? colors.danger : colors.textMuted} /> : null)}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title} style={({ pressed }) => pressed && { opacity: 0.65 }}>
      {content}
    </Pressable>
  );
}
