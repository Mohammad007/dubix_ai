import type { BottomTabBarProps } from 'expo-router/tabs';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, Logo, T, type IconName } from '@/components/ui';
import { colors, radius, space } from '@/theme/tokens';

const META: Record<string, { label: string; icon: IconName }> = {
  index: { label: 'Home', icon: 'home' },
  translate: { label: 'Translate', icon: 'translate' },
  player: { label: 'Player', icon: 'player' },
  voices: { label: 'Voices', icon: 'voices' },
  settings: { label: 'Settings', icon: 'settings' },
};

/**
 * Main navigation: bottom bar on phones, vertical rail on tablets. Sub-screens (language, models,
 * sync, …) are pushed on the root stack above the tabs, so they show a back button instead of
 * highlighting an unrelated tab.
 */
export function TabBar({ state, navigateToTab, rail }: BottomTabBarProps & { rail: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        rail
          ? { width: 96, backgroundColor: colors.surface, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border, alignItems: 'center', gap: space.sm, paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg }
          : { flexDirection: 'row', backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: space.sm, paddingHorizontal: space.sm, gap: space.xs, paddingBottom: Math.max(insets.bottom, space.sm) },
      ]}
    >
      {rail ? (
        <View style={{ marginBottom: space.xl, alignItems: 'center' }}>
          <Logo size={44} />
        </View>
      ) : null}
      {state.routes.map((route, index) => {
        const meta = META[route.name];
        if (!meta) return null;
        const focused = state.index === index;
        return (
          <Pressable
            key={route.key}
            onPress={() => !focused && navigateToTab(route.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={meta.label}
            style={[
              rail ? { width: 76, minHeight: 64 } : { flex: 1, minHeight: 58 },
              { alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
              focused && { backgroundColor: colors.accentSoft },
            ]}
          >
            <Icon name={meta.icon} color={focused ? colors.accent : colors.textMuted} size={23} strokeWidth={focused ? 2.2 : 1.8} />
            <T v="caption" color={focused ? colors.accent : colors.textMuted} style={{ fontFamily: focused ? 'Inter_600SemiBold' : 'Inter_500Medium', marginTop: 3 }} numberOfLines={1}>
              {meta.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}
