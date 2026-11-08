import { ActivityIndicator, Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/primitives/Icon';
import { T } from '@/components/primitives/Text';
import { colors, radius, space, TOUCH } from '@/theme/tokens';

type Props = {
  label: string;
  onPress?: () => void;
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
  accessibilityHint?: string;
};

/** Flat buttons: purple primary, white secondary with a thin border, outline ghost, danger. */
export function Button({ label, onPress, icon, variant = 'primary', disabled, loading, style, compact, accessibilityHint }: Props) {
  const fg = variant === 'primary' ? colors.onAccent : variant === 'danger' ? colors.danger : variant === 'ghost' ? colors.accent : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => [
        {
          minHeight: compact ? 40 : 52,
          borderRadius: radius.md,
          paddingHorizontal: compact ? space.md : space.xl,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
        },
        variant === 'primary' && { backgroundColor: pressed ? colors.accentPressed : colors.accent },
        variant === 'secondary' && { backgroundColor: pressed ? colors.surfaceAlt : colors.surface, borderWidth: 1, borderColor: colors.border },
        variant === 'ghost' && { backgroundColor: pressed ? colors.accentSoft : 'transparent', borderWidth: 1, borderColor: colors.accent },
        variant === 'danger' && { backgroundColor: pressed ? colors.dangerSoft : colors.surface, borderWidth: 1, borderColor: colors.danger },
        (disabled || loading) && { opacity: 0.45 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} color={fg} size={compact ? 18 : 20} /> : null}
      <T v="bodyStrong" color={fg} style={{ fontSize: compact ? 14 : 16 }} numberOfLines={1}>
        {label}
      </T>
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  active,
  style,
  size = 22,
  disabled,
  tone = 'default',
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
  size?: number;
  disabled?: boolean;
  /** `onVideo` draws light icons for use over video */
  tone?: 'default' | 'onVideo';
}) {
  const idle = tone === 'onVideo' ? colors.onVideo : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      hitSlop={6}
      style={({ pressed }) => [
        { width: TOUCH, height: TOUCH, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
        active && { backgroundColor: colors.accent },
        pressed && !active && { backgroundColor: tone === 'onVideo' ? 'rgba(255,255,255,0.15)' : colors.surfaceAlt },
        disabled && { opacity: 0.4 },
        style,
      ]}
    >
      <Icon name={icon} size={size} color={active ? colors.onAccent : idle} />
    </Pressable>
  );
}
