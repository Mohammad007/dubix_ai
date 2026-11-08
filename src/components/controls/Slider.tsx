import { useState } from 'react';
import { View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';

import { colors } from '@/theme/tokens';

type Props = {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /** Called once when the drag ends (commit expensive work here). */
  onCommit?: (v: number) => void;
  label: string;
  formatValue?: (v: number) => string;
  disabled?: boolean;
  /** light track for use over video */
  onVideo?: boolean;
};

function snapTo(v: number, lo: number, hi: number, st: number): number {
  const snapped = Math.round((v - lo) / st) * st + lo;
  return Math.max(lo, Math.min(hi, Number(snapped.toFixed(4))));
}

/**
 * Flat slider with a 48dp touch area. Exposed to TalkBack as an "adjustable" control:
 * swipe up/down changes the value by one step.
 */
export function Slider({ value, min, max, step = 0.01, onChange, onCommit, label, formatValue, disabled, onVideo }: Props) {
  const [width, setWidth] = useState(0);
  // Plain responder handlers read current props/state directly (no refs, no PanResponder object).
  const fromX = (x: number) => snapTo(min + (Math.max(0, Math.min(width, x)) / Math.max(1, width)) * (max - min), min, max, step);
  const onX = (e: GestureResponderEvent) => onChange(fromX(e.nativeEvent.locationX));

  const pct = (Math.max(min, Math.min(max, value)) - min) / (max - min || 1);
  const adjust = (dir: 1 | -1) => {
    const next = snapTo(value + dir * Math.max(step, (max - min) / 20), min, max, step);
    onChange(next);
    onCommit?.(next);
  };

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      accessibilityValue={{ text: formatValue ? formatValue(value) : String(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => adjust(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      pointerEvents={disabled ? 'none' : 'auto'}
      style={{ height: 48, justifyContent: 'center', opacity: disabled ? 0.45 : 1 }}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={onX}
      onResponderMove={onX}
      onResponderRelease={(e) => onCommit?.(fromX(e.nativeEvent.locationX))}
    >
      <View pointerEvents="none" style={{ height: 6, borderRadius: 3, backgroundColor: onVideo ? 'rgba(255,255,255,0.3)' : colors.surfaceAlt }}>
        <View style={{ width: `${pct * 100}%`, height: 6, borderRadius: 3, backgroundColor: colors.accent }} />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: Math.max(0, pct * width - 12),
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: '#FFFFFF',
          borderWidth: 3,
          borderColor: colors.accent,
        }}
      />
    </View>
  );
}
