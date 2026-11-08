import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/buttons/Button';
import { T } from '@/components/primitives/Text';
import { colors, radius, space, TOUCH } from '@/theme/tokens';

export type PickerOption<K extends string> = { key: K; title: string; subtitle?: string; disabled?: boolean; right?: ReactNode };

/** Bottom sheet list (radio list when `selected` is given, plain menu otherwise). */
export function PickerSheet<K extends string>({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: PickerOption<K>[];
  selected?: K | null;
  onSelect: (k: K) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const radio = selected !== undefined;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: colors.scrim }} onPress={onClose} accessibilityLabel="Close" />
      <View
        style={{
          backgroundColor: colors.surface,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          maxHeight: '78%',
          paddingBottom: insets.bottom + space.md,
          width: '100%',
          maxWidth: 640,
          alignSelf: 'center',
        }}
      >
        <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: space.sm }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: space.sm }}>
          <T v="heading" accessibilityRole="header">
            {title}
          </T>
          <IconButton icon="close" label="Close" onPress={onClose} />
        </View>
        <ScrollView>
          {options.map((o) => {
            const sel = o.key === selected;
            return (
              <Pressable
                key={o.key}
                disabled={o.disabled}
                onPress={() => {
                  onSelect(o.key);
                  onClose();
                }}
                accessibilityRole={radio ? 'radio' : 'button'}
                accessibilityState={radio ? { checked: sel, disabled: o.disabled } : { disabled: o.disabled }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  paddingHorizontal: space.lg,
                  minHeight: TOUCH + 12,
                  backgroundColor: pressed ? colors.surfaceAlt : sel ? colors.accentSoft : 'transparent',
                  opacity: o.disabled ? 0.45 : 1,
                })}
              >
                <View style={{ flex: 1, paddingVertical: space.sm }}>
                  <T v="cardTitle">{o.title}</T>
                  {o.subtitle ? (
                    <T v="caption" color={colors.textMuted}>
                      {o.subtitle}
                    </T>
                  ) : null}
                </View>
                {o.right}
                {radio ? (
                  <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: sel ? colors.accent : colors.textFaint, alignItems: 'center', justifyContent: 'center' }}>
                    {sel ? <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: colors.accent }} /> : null}
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}
