import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Linking, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { Button, IconButton } from '@/components/buttons/Button';
import { Card } from '@/components/cards/Card';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { T } from '@/components/primitives/Text';
import { errorInfo, type ErrorAction } from '@/domain/errors';
import { dismissWarning, engine } from '@/store/engine';
import { colors, radius, space } from '@/theme/tokens';

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

const tone = (t: Tone): { bg: string; fg: string; icon: IconName | null } =>
  ({
    success: { bg: colors.successSoft, fg: colors.success, icon: 'check-circle' as IconName },
    warning: { bg: colors.warningSoft, fg: colors.warning, icon: 'warning' as IconName },
    danger: { bg: colors.dangerSoft, fg: colors.danger, icon: 'error' as IconName },
    neutral: { bg: colors.surfaceAlt, fg: colors.textMuted, icon: null },
    accent: { bg: colors.accentSoft, fg: colors.accent, icon: null },
  })[t];

export function Pill({ label, tone: t = 'neutral', icon, showIcon = true }: { label: string; tone?: Tone; icon?: IconName; showIcon?: boolean }) {
  const c = tone(t);
  const ic = icon ?? c.icon;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, alignSelf: 'flex-start', backgroundColor: c.bg }} accessible accessibilityLabel={label}>
      {showIcon && ic ? <Icon name={ic} size={14} color={c.fg} /> : null}
      <T v="caption" color={c.fg} style={{ fontFamily: 'Inter_600SemiBold' }} numberOfLines={1}>
        {label}
      </T>
    </View>
  );
}

/** Animated (Reanimated) progress bar; jumps instantly when the user prefers reduced motion. */
export function ProgressBar({ value, color, height = 8, label }: { value: number; color?: string; height?: number; label?: string }) {
  const pct = Math.max(0, Math.min(1, value));
  const reduced = useReducedMotion();
  const w = useSharedValue(pct);
  useEffect(() => {
    w.value = reduced ? pct : withTiming(pct, { duration: 300 });
  }, [pct, reduced, w]);
  const style = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }} style={{ height, borderRadius: height, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}>
      <Animated.View style={[{ height: '100%', backgroundColor: color ?? colors.accent, borderRadius: height }, style]} />
    </View>
  );
}

export function Banner({ tone: t = 'warning', title, body, action, onAction, onDismiss }: { tone?: 'warning' | 'danger' | 'accent' | 'success'; title: string; body?: string; action?: string; onAction?: () => void; onDismiss?: () => void }) {
  const icon: IconName = t === 'danger' ? 'error' : t === 'accent' ? 'info' : t === 'success' ? 'check-circle' : 'warning';
  const fg = t === 'danger' ? colors.danger : t === 'accent' ? colors.accent : t === 'success' ? colors.success : colors.warning;
  return (
    <Card tone={t} style={{ marginBottom: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }} accessibilityLiveRegion="polite">
        <Icon name={icon} color={fg} />
        <View style={{ flex: 1 }}>
          <T v="bodyStrong">{title}</T>
          {body ? (
            <T v="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
              {body}
            </T>
          ) : null}
          {action && onAction ? <Button label={action} onPress={onAction} variant="secondary" compact style={{ alignSelf: 'flex-start', marginTop: space.sm }} /> : null}
        </View>
        {onDismiss ? <IconButton icon="close" label="Dismiss" onPress={onDismiss} size={18} style={{ width: 36, height: 36 }} /> : null}
      </View>
    </Card>
  );
}

export function runErrorAction(action: ErrorAction, onRetry?: () => void): void {
  switch (action) {
    case 'models':
    case 'storage':
      router.push('/models');
      break;
    case 'language':
      router.push('/language');
      break;
    case 'permissions':
      router.push('/permissions');
      break;
    case 'settings':
      Linking.openSettings();
      break;
    case 'sync':
      router.push('/sync');
      break;
    case 'open_file':
      router.navigate('/player');
      break;
    case 'retry':
      onRetry?.();
      break;
  }
}

/** Standard error presentation: what happened, what to do, and an action when one helps. */
export function ErrorState({ code, message, onRetry, onDismiss, compact }: { code: string | null | undefined; message?: string | null; onRetry?: () => void; onDismiss?: () => void; compact?: boolean }) {
  const info = errorInfo(code, message);
  const showAction = info.action !== 'none' && (info.action !== 'retry' || !!onRetry);
  return (
    <Banner
      tone={info.retry ? 'warning' : 'danger'}
      title={info.title}
      body={compact ? info.todo : `${info.what}${message && code && message !== info.what ? ` (${message})` : ''} ${info.todo}${info.retry ? '' : ' Retrying will not help.'}`}
      action={showAction ? info.actionLabel : undefined}
      onAction={() => runErrorAction(info.action, onRetry)}
      onDismiss={onDismiss}
    />
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body: string; action?: ReactNode }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: space.xxl, gap: space.md }}>
      <View style={{ width: 64, height: 64, borderRadius: radius.lg, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} color={colors.accent} size={30} />
      </View>
      <T v="cardTitle">{title}</T>
      <T v="body" color={colors.textMuted} style={{ textAlign: 'center', maxWidth: 440 }}>
        {body}
      </T>
      {action}
    </Card>
  );
}

export function NativeUnavailable() {
  return <ErrorState code="engine_unavailable" />;
}

/** Shows the latest engine warning (memory, thermal, permissions, …) with its catalog guidance. */
export function WarningsHost() {
  const warnings = engine.useValue((s) => s.warnings);
  if (!warnings.length) return null;
  const w = warnings[warnings.length - 1];
  const known = errorInfo(w.code).title !== 'Something went wrong';
  return known ? <ErrorState code={w.code} message={w.message} compact onDismiss={() => dismissWarning(w.code)} /> : <Banner tone="warning" title={w.message} onDismiss={() => dismissWarning(w.code)} />;
}
