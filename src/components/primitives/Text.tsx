import { Text, type TextProps, type TextStyle } from 'react-native';

import { colors, type, type TypeVariant } from '@/theme/tokens';

/** Themed text. Font scaling stays on (accessibility) but is capped to keep layouts intact. */
export function T({ v = 'body', color, style, ...rest }: TextProps & { v?: TypeVariant; color?: string }) {
  return <Text {...rest} style={[type[v] as TextStyle, { color: color ?? colors.text }, style]} maxFontSizeMultiplier={1.6} />;
}
