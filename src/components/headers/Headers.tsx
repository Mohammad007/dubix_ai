import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { IconButton } from '@/components/buttons/Button';
import { Pill } from '@/components/feedback/Feedback';
import { PickerSheet } from '@/components/feedback/PickerSheet';
import { Icon } from '@/components/primitives/Icon';
import { T } from '@/components/primitives/Text';
import { usePairStatus } from '@/hooks/useAvailability';
import { colors, space } from '@/theme/tokens';

/** Brand mark: flat rounded tile, white play triangle, purple/cyan voice bars. */
export function Logo({ size = 40 }: { size?: number }) {
  const bars = [0.35, 0.7, 1, 0.55];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: size * 0.05 }}
    >
      <View style={{ width: 0, height: 0, borderTopWidth: size * 0.15, borderBottomWidth: size * 0.15, borderLeftWidth: size * 0.24, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: '#FFFFFF', marginRight: size * 0.04 }} />
      {bars.map((h, i) => (
        <View key={i} style={{ width: size * 0.06, height: size * 0.42 * h, borderRadius: 2, backgroundColor: i % 2 ? '#A994FF' : '#6848F4' }} />
      ))}
    </View>
  );
}

export function AppHeader({ status, right, title = 'DubiX AI' }: { status?: ReactNode; right?: ReactNode; title?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space.md, paddingBottom: space.sm, gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
        <Logo />
        <T v="title" style={{ marginLeft: space.md }} accessibilityRole="header" numberOfLines={1}>
          {title}
        </T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        {/* Wrapper keeps any status badge vertically centred with the menu (Pill self-aligns to the top). */}
        {status ? <View style={{ justifyContent: 'center' }}>{status}</View> : null}
        {right}
      </View>
    </View>
  );
}

export function ScreenTitle({ title, subtitle, back = false, right }: { title: string; subtitle?: string; back?: boolean; right?: ReactNode }) {
  return (
    <View style={{ marginTop: space.md, marginBottom: space.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          {back ? <IconButton icon="back" label="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={{ marginLeft: -space.sm, marginRight: space.xs }} /> : null}
          <T v="display" accessibilityRole="header" style={{ flex: 1 }}>
            {title}
          </T>
        </View>
        {right}
      </View>
      {subtitle ? (
        <T v="body" color={colors.textMuted} style={{ marginTop: space.xs }}>
          {subtitle}
        </T>
      ) : null}
    </View>
  );
}

export function SectionHeader({ title, action, onAction, icon }: { title: string; action?: string; onAction?: () => void; icon?: 'info' | 'sync' }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xl, marginBottom: space.md }}>
      <T v="heading" accessibilityRole="header">
        {title}
      </T>
      {action && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" hitSlop={12} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {icon ? <Icon name={icon} color={colors.accent} size={16} /> : null}
          <T v="bodyStrong" color={colors.accent}>
            {action}
          </T>
          {icon ? null : <Icon name="chevron-right" color={colors.accent} size={18} />}
        </Pressable>
      ) : null}
    </View>
  );
}

/** "Offline Ready" only when the current language pair can run fully on-device. */
export function OfflineStatusPill() {
  const { label, tone } = usePairStatus();
  return (
    <Pressable onPress={() => router.push('/models')} accessibilityRole="button" accessibilityHint="Opens offline model manager" hitSlop={6}>
      <Pill label={label} tone={tone} />
    </Pressable>
  );
}

export function HeaderMenu() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton icon="more" label="More options" onPress={() => setOpen(true)} />
      <PickerSheet
        visible={open}
        title="DubiX AI"
        onClose={() => setOpen(false)}
        options={[
          { key: '/models', title: 'Offline AI models', subtitle: 'Download and manage on-device packs' },
          { key: '/history', title: 'Translation history', subtitle: 'All sessions on this device' },
          { key: '/permissions', title: 'Permissions & compatibility', subtitle: 'Setup checklist for this device' },
          { key: '/floating', title: 'Floating controller', subtitle: 'Control live translation over other apps' },
          { key: '/sync', title: 'Audio sync', subtitle: 'Offset, voice speed and timing' },
          { key: '/about', title: 'About & limits', subtitle: 'What DubiX can and cannot do on Android' },
        ]}
        onSelect={(k) => router.push(k as '/models')}
      />
    </>
  );
}

export function Radio({ selected }: { selected: boolean }) {
  return (
    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: selected ? colors.accent : colors.textFaint, alignItems: 'center', justifyContent: 'center' }}>
      {selected ? <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: colors.accent }} /> : null}
    </View>
  );
}

