import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { DubixNative } from 'dubix-native';

import { AppHeader, Button, Card, Divider, HeaderMenu, Icon, IconTile, OfflineStatusPill, Pill, ProgressBar, Screen, ScreenTitle, SectionHeader, T, type IconName, type Tone } from '@/components/ui';
import { SUPPORTED_ABIS } from '@/domain/compatibility';
import { requestMicrophone, requestNotifications, usePermissions, type PermState } from '@/services/permissions';
import { engine } from '@/store/engine';
import { colors, space } from '@/theme/tokens';
import { formatBytes } from '@/utils/format';

type Item = { key: string; icon: IconName; title: string; body: string; status: { label: string; tone: Tone }; ready: boolean; action?: { label: string; run: () => void } };

export function permissionStatus(p?: PermState): { label: string; tone: Tone } {
  if (p === 'granted') return { label: 'Allowed', tone: 'success' };
  if (p === 'blocked') return { label: 'Permanently denied', tone: 'danger' };
  if (p === 'unavailable') return { label: 'Unavailable', tone: 'neutral' };
  return { label: 'Needed', tone: 'warning' };
}

export function usePermissionItems() {
  const { snap, refresh } = usePermissions();
  const settings = () => DubixNative?.openAppSettings();
  const items: Item[] = [
    {
      key: 'mic', icon: 'mic', title: 'Microphone',
      body: 'Live translation, and (an Android rule) any capture of other apps’ audio. Local movie dubbing does not need it.',
      status: permissionStatus(snap?.microphone), ready: snap?.microphone === 'granted',
      action: snap?.microphone === 'blocked' ? { label: 'Go to Settings', run: settings } : snap?.microphone !== 'granted' ? { label: 'Allow', run: async () => { await requestMicrophone(); refresh(); } } : undefined,
    },
    {
      key: 'notif', icon: 'bell', title: 'Notifications',
      body: 'The ongoing notification with Pause / Resume / Stop while live translation runs in the background.',
      status: permissionStatus(snap?.notifications), ready: snap?.notifications === 'granted',
      action: snap?.notifications === 'blocked' ? { label: 'Go to Settings', run: settings } : snap?.notifications !== 'granted' ? { label: 'Allow', run: async () => { await requestNotifications(); refresh(); } } : undefined,
    },
    {
      key: 'overlay', icon: 'layers', title: 'Overlay Permission',
      body: 'Optional. Shows the floating controller over other apps. Without it, notification controls are used.',
      status: snap?.overlay === 'granted' ? { label: 'Allowed', tone: 'success' } : { label: 'Optional', tone: 'neutral' }, ready: true,
      action: snap?.overlay !== 'granted' ? { label: 'Open setting', run: () => DubixNative?.openOverlaySettings() } : undefined,
    },
    {
      key: 'files', icon: 'folder', title: 'File Access',
      body: 'No storage permission is needed. You pick each video in the system file picker, which grants access to that file only.',
      status: { label: 'Not required', tone: 'success' }, ready: true,
    },
    {
      key: 'projection', icon: 'phone', title: 'Screen-capture consent',
      body: snap?.playbackCapture === 'supported'
        ? 'Asked by Android every time you start app-audio capture. It is single-use and never stored, and it does not guarantee access: each app decides whether its audio can be captured.'
        : 'Capturing other apps’ audio needs Android 10 or newer.',
      status: snap?.playbackCapture === 'supported' ? { label: 'Asked each session', tone: 'neutral' } : { label: 'Not supported', tone: 'neutral' }, ready: true,
    },
  ];
  return { items, snap, refresh };
}

export default function PermissionsScreen() {
  const { items, snap, refresh } = usePermissionItems();
  const device = engine.useValue((x) => x.device);
  const available = engine.useValue((x) => x.available);
  const [busy, setBusy] = useState(false);
  const readyCount = items.filter((i) => i.ready).length;

  const grantAll = async () => {
    setBusy(true);
    try {
      if (snap?.microphone === 'blocked' || snap?.notifications === 'blocked') DubixNative?.openAppSettings();
      else {
        if (snap?.microphone !== 'granted') await requestMicrophone();
        if (snap?.notifications !== 'granted') await requestNotifications();
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const localOk = !!device && device.apiLevel >= 26 && device.abis.some((a) => SUPPORTED_ABIS.includes(a));

  return (
    <Screen header={<AppHeader status={<OfflineStatusPill />} right={<HeaderMenu />} />} footer={<Button label="Grant Required Permissions" icon="shield" onPress={grantAll} loading={busy} disabled={!available || readyCount === items.length} />}>
      <ScreenTitle title="Permissions" back />

      <Card style={{ gap: space.sm }}>
        <T v="heading">Setup Checklist</T>
        <T v="body" color={colors.textMuted}>
          Grant only what you need. Each permission can be changed later in Android Settings.
        </T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <ProgressBar value={readyCount / items.length} label="Setup progress" />
          </View>
          <T v="bodyStrong">
            {readyCount} of {items.length} Ready
          </T>
        </View>
      </Card>

      <View style={{ marginTop: space.md, gap: space.sm }}>
        {items.map((it) => (
          <Pressable key={it.key} onPress={it.action?.run} disabled={!it.action} accessibilityRole={it.action ? 'button' : undefined} accessibilityLabel={`${it.title}. ${it.status.label}. ${it.body}`}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <IconTile icon={it.icon} />
              <View style={{ flex: 1, gap: 4 }}>
                <T v="cardTitle">{it.title}</T>
                <T v="caption" color={colors.textMuted}>
                  {it.body}
                </T>
                <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Pill label={it.status.label} tone={it.status.tone} />
                  {it.action ? (
                    <T v="bodyStrong" color={colors.accent}>
                      {it.action.label}
                    </T>
                  ) : null}
                </View>
              </View>
              {it.action ? <Icon name="chevron-right" color={colors.textMuted} /> : null}
            </Card>
          </Pressable>
        ))}
      </View>

      <SectionHeader title="Compatibility" />
      <Card style={{ gap: space.sm }}>
        <CompatRow icon="player" title="Local Video Mode" body="Play and translate local videos on this device." status={localOk ? { label: 'Available', tone: 'success' } : { label: 'Unsupported device', tone: 'danger' }} />
        <Divider />
        <CompatRow icon="layers" title="External App Mode" body="Capture and translate audio from other apps that allow it." status={device?.playbackCaptureSupported ? { label: 'Subject to app policy', tone: 'warning' } : { label: 'Needs Android 10+', tone: 'neutral' }} />
        <Divider />
        <CompatRow icon="shield" title="Protected Media" body="DRM / secure playback (most streaming services)." status={{ label: 'Not supported', tone: 'neutral' }} />
        <Divider />
        {device ? (
          <T v="caption" color={colors.textMuted}>
            Android {device.release} (API {device.apiLevel}) · {device.abis[0]} · {(device.totalRamMb / 1024).toFixed(1)} GB RAM · {device.cpuCores} cores · {formatBytes(device.storageFreeBytes)} free
            {device.lowRamDevice ? ' · low-RAM device: use the Light profile' : ''}
          </T>
        ) : null}
        <Button label="What DubiX can’t do" variant="ghost" compact onPress={() => router.push('/about')} style={{ alignSelf: 'flex-start' }} />
      </Card>
    </Screen>
  );
}

function CompatRow({ icon, title, body, status }: { icon: IconName; title: string; body: string; status: { label: string; tone: Tone } }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <IconTile icon={icon} />
      <View style={{ flex: 1 }}>
        <T v="cardTitle">{title}</T>
        <T v="caption" color={colors.textMuted}>
          {body}
        </T>
      </View>
      <Pill label={status.label} tone={status.tone} />
    </View>
  );
}
