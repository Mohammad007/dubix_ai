import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLayout } from '@/hooks/useLayout';
import { colors, MAX_CONTENT, space } from '@/theme/tokens';

/**
 * Safe-area aware page with a centered max width (tablets).
 * - `header` stays pinned at the top while the content scrolls beneath it (a hairline divider
 *   appears once content has scrolled under it).
 * - `footer` stays pinned at the bottom.
 */
export function Screen({
  children,
  scroll = true,
  padded = true,
  header,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { isTablet } = useLayout();
  const [scrolled, setScrolled] = useState(false);
  const inner: ViewStyle = { width: '100%', maxWidth: MAX_CONTENT, alignSelf: 'center', paddingHorizontal: padded ? (isTablet ? space.xxl : space.lg) : 0 };
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      {header ? (
        <View
          style={{ backgroundColor: colors.bg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: scrolled ? colors.border : 'transparent', zIndex: 1 }}
        >
          <View style={inner}>{header}</View>
        </View>
      ) : null}
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: space.xxl }}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={32}
          onScroll={header ? (e) => setScrolled(e.nativeEvent.contentOffset.y > 2) : undefined}
        >
          <View style={inner}>{children}</View>
        </ScrollView>
      ) : (
        <View style={[inner, { flex: 1 }]}>{children}</View>
      )}
      {footer ? (
        <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.bg }}>
          <View style={[inner, { paddingVertical: space.md }]}>{footer}</View>
        </View>
      ) : null}
    </View>
  );
}
