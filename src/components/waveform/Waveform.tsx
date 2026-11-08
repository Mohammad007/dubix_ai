import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { colors } from '@/theme/tokens';

/** Bar waveform from real amplitude data (0..1). Renders nothing misleading when data is empty. */
export function Waveform({ data, height = 48, color, gap = 2, label }: { data: number[]; height?: number; color?: string; gap?: number; label?: string }) {
  const peak = Math.max(0.0001, ...data);
  return (
    <View accessible={!!label} accessibilityLabel={label} style={{ height, flexDirection: 'row', alignItems: 'center', gap }}>
      {data.map((v, i) => (
        <View key={i} style={{ flex: 1, height: Math.max(2, (v / peak) * height), borderRadius: 2, backgroundColor: color ?? colors.accent, opacity: v < 0.02 * peak ? 0.3 : 1 }} />
      ))}
    </View>
  );
}

function Bar({ level, height, active }: { level: number; height: number; active: boolean }) {
  const reduced = useReducedMotion();
  const h = useSharedValue(4);
  const target = Math.max(4, Math.min(1, Math.sqrt(level) * 4) * height);
  useEffect(() => {
    h.value = reduced ? target : withTiming(target, { duration: 90 });
  }, [target, reduced, h]);
  const style = useAnimatedStyle(() => ({ height: h.value }));
  return <Animated.View style={[{ flex: 1, borderRadius: 3, backgroundColor: active ? colors.accent : colors.border }, style]} />;
}

/** Rolling input meter driven by real captured RMS levels from the native capture thread. */
export function LevelMeter({ levels, height = 64, active }: { levels: number[]; height?: number; active: boolean }) {
  return (
    <View style={{ height, flexDirection: 'row', alignItems: 'center', gap: 3 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {levels.map((l, i) => (
        <Bar key={i} level={l} height={height} active={active} />
      ))}
    </View>
  );
}
