import type { ViewStyle } from 'react-native';

import { colors } from './colors';

/** Minimal elevation only; borders carry most of the separation. */
export function cardShadow(): ViewStyle {
  return { shadowColor: colors.shadow, shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 };
}
