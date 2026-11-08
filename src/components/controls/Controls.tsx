import { Pressable, Switch, View } from 'react-native';

import { T } from '@/components/primitives/Text';
import { colors, radius, TOUCH } from '@/theme/tokens';

export function Toggle({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      accessibilityLabel={label}
      trackColor={{ false: colors.border, true: colors.accent }}
      thumbColor="#FFFFFF"
      style={{ minHeight: TOUCH }}
    />
  );
}

export function Segmented<K extends string>({ options, value, onChange, label }: { options: { key: K; label: string; disabled?: boolean }[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, padding: 3, borderWidth: 1, borderColor: colors.border }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const sel = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            disabled={o.disabled}
            accessibilityRole="radio"
            accessibilityState={{ checked: sel, disabled: o.disabled }}
            style={{ flex: 1, minHeight: 42, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, backgroundColor: sel ? colors.accent : 'transparent', opacity: o.disabled ? 0.4 : 1 }}
          >
            <T v="bodyStrong" color={sel ? colors.onAccent : colors.text} style={{ fontSize: 13 }} numberOfLines={1}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

export { Slider } from './Slider';
