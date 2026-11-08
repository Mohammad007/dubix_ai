import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { DubixNative, type PerfStat } from 'dubix-native';

import { AppHeader, Button, Card, Divider, HeaderMenu, Icon, ListRow, OfflineStatusPill, PickerSheet, Pill, Screen, SectionHeader, Segmented, SessionCard, T } from '@/components/ui';
import { lastRealtimeFactor } from '@/database';
import { languageName } from '@/domain/languages';
import { PROFILES, resolveProfile, type PerformanceProfile } from '@/domain/performance';
import { useLayout } from '@/hooks/useLayout';
import { clearHistory, deleteSession, loadSession, sessions } from '@/services/dubbing';
import { engine } from '@/store/engine';
import { resetSettings, updateSettings, useSettings } from '@/store/settings';
import type { ThemeMode } from '@/theme/colors';
import { colors, radius, space } from '@/theme/tokens';
import { formatBytes } from '@/utils/format';

const STAGES: [string, string][] = [
  ['decode', 'Audio decode'], ['vad', 'Voice activity'], ['asr', 'Speech recognition'], ['speaker', 'Speaker embedding'],
  ['translate', 'Translation'], ['tts', 'Voice synthesis'], ['stretch', 'Time-stretch'],
];

export function applyProfile(p: PerformanceProfile): void {
  const spec = PROFILES[p];
  updateSettings({ asrModelId: spec.asrModelId, speakerDetection: spec.speakerDetection, dubMode: spec.dubMode });
}

export default function SettingsScreen() {
  const s = useSettings();
  const { isTablet } = useLayout();
  const list = sessions.useValue((x) => x.list);
  const modelsBytes = engine.useValue((x) => x.modelsBytes);
  const device = engine.useValue((x) => x.device);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [perf, setPerf] = useState<Record<string, PerfStat> | null>(null);
  const [rtf, setRtf] = useState<number | null>(null);

  useEffect(() => {
    lastRealtimeFactor().then(setRtf).catch(() => undefined);
  }, []);
  const effective = resolveProfile(s.performanceProfile, device, rtf);

  const confirmClear = () =>
    Alert.alert('Clear local history?', 'Deletes all sessions, transcripts and dubbed audio from this device. Your video files are not touched.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => clearHistory() },
    ]);

  return (
    <Screen header={<AppHeader status={<OfflineStatusPill />} right={<HeaderMenu />} />}>
      <T v="display" accessibilityRole="header" style={{ marginVertical: space.md }}>
        Settings
      </T>

      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
        <View style={{ width: 60, height: 60, borderRadius: radius.lg, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="phone" color={colors.accent} size={30} />
        </View>
        <View style={{ flex: 1 }}>
          <T v="heading">Device Only Mode</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <Icon name="shield" size={16} color={colors.textMuted} />
            <T v="body" color={colors.textMuted}>
              No backend connected
            </T>
          </View>
          <T v="caption" color={colors.textMuted} style={{ marginTop: 4 }}>
            No account or login. Speech, translation and voices run on this device; the network is used only for model downloads you start.
          </T>
        </View>
      </Card>

      <View style={{ flexDirection: isTablet ? 'row' : 'column', gap: space.lg, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, width: '100%' }}>
          <Card style={{ marginTop: space.lg, paddingVertical: space.xs }}>
            <ListRow icon="translate" title="Language Preferences" subtitle={`${languageName(s.sourceLang)} → ${languageName(s.targetLang)}`} onPress={() => router.push('/language')} />
            <Divider />
            <ListRow icon="download" title="Downloaded Models" subtitle={`${formatBytes(modelsBytes)} · manage offline AI models and storage`} onPress={() => router.push('/models')} />
            <Divider />
            <ListRow icon="volume" title="Audio Output" subtitle="Voice, speed, sync and ducking" onPress={() => router.push('/sync')} />
            <Divider />
            <ListRow icon="captions" title="Subtitle Style" subtitle="Size, background and caption language" onPress={() => router.push('/subtitles')} />
            <Divider />
            <ListRow icon="layers" title="Permissions" subtitle="Setup checklist and compatibility" onPress={() => router.push('/permissions')} />
            <Divider />
            <ListRow icon="shield" title="Privacy" subtitle="Data, caches and on-device processing" onPress={() => router.push('/privacy')} />
            <Divider />
            <ListRow icon="info" title="About" subtitle="Version, licences and Android limits" onPress={() => router.push('/about')} />
          </Card>

          <SectionHeader title="Appearance" />
          <Segmented<ThemeMode> label="Theme" value={s.themeMode} onChange={(k) => updateSettings({ themeMode: k })} options={[{ key: 'light', label: 'Light' }, { key: 'dark', label: 'Dark' }, { key: 'system', label: 'System' }]} />

          <SectionHeader title="Device Performance" action={perf ? 'Refresh stats' : 'Show stats'} onAction={() => DubixNative && setPerf(DubixNative.getPerfSnapshot())} />
          <Card style={{ gap: space.sm }}>
            <Segmented<PerformanceProfile | 'auto'>
              label="Performance profile"
              value={s.performanceProfile}
              onChange={(k) => {
                updateSettings({ performanceProfile: k });
                applyProfile(resolveProfile(k, device, rtf));
              }}
              options={[{ key: 'auto', label: 'Auto' }, { key: 'light', label: 'Light' }, { key: 'balanced', label: 'Balanced' }, { key: 'high', label: 'High' }]}
            />
            <T v="caption" color={colors.textMuted}>
              {s.performanceProfile === 'auto' ? `Auto picked ${PROFILES[effective].label} for this device${rtf ? ` (last job ran at ${rtf.toFixed(2)}× real time)` : ''}. ` : ''}
              {PROFILES[effective].description} All inference runs on the CPU; no hardware acceleration is used.
            </T>
            {device ? (
              <T v="caption" color={colors.textMuted}>
                {device.manufacturer} {device.model} · Android {device.release} · {device.cpuCores} cores · {(device.totalRamMb / 1024).toFixed(1)} GB RAM
                {device.powerSaveMode ? ' · Battery saver on (fewer inference threads)' : ''}
              </T>
            ) : null}
            {perf
              ? STAGES.filter(([k]) => perf[k]).map(([k, label]) => (
                  <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <T v="body">{label}</T>
                    <T v="mono" color={colors.textMuted}>
                      avg {perf[k].avgMs.toFixed(1)} ms · max {perf[k].maxMs.toFixed(0)} ms · n={perf[k].count}
                    </T>
                  </View>
                ))
              : null}
            {perf && Object.keys(perf).length === 0 ? (
              <T v="caption" color={colors.textMuted}>
                No measurements yet. Dub a movie or run live translation first.
              </T>
            ) : null}
          </Card>
        </View>

        <View style={{ flex: 1, width: '100%' }}>
          <SectionHeader title="History" action={list.length > 3 ? 'See All' : undefined} onAction={() => router.push('/history')} />
          {list.length === 0 ? (
            <Card>
              <T v="body" color={colors.textMuted}>
                No sessions on this device.
              </T>
            </Card>
          ) : (
            list.slice(0, isTablet ? 6 : 3).map((x) => (
              <SessionCard key={x.id} s={x} onPress={async () => { await loadSession(x.id); router.navigate('/player'); }} onMenu={() => setMenuFor(x.id)} />
            ))
          )}
          <Card tone="danger" style={{ marginTop: space.md, paddingVertical: space.xs }}>
            <ListRow icon="trash" title="Clear Local History" subtitle="Remove all translated sessions from this device" onPress={confirmClear} danger />
          </Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.lg, gap: space.sm }}>
            <Pill label="Version 1.0.0 · offline build" tone="neutral" showIcon={false} />
            <Button
              label="Reset settings"
              variant="secondary"
              compact
              onPress={() =>
                Alert.alert('Reset settings?', 'Restores default preferences. Sessions and model packs are kept.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Reset', onPress: () => { resetSettings(); updateSettings({ onboardingDone: true }); } },
                ])
              }
            />
          </View>
        </View>
      </View>

      <PickerSheet
        visible={menuFor !== null}
        title="Session"
        onClose={() => setMenuFor(null)}
        options={[
          { key: 'open', title: 'Resume in player' },
          { key: 'details', title: 'Session details', subtitle: 'Transcript, translation and speakers' },
          { key: 'delete', title: 'Delete session', subtitle: 'Removes transcript and dubbed audio only' },
        ]}
        onSelect={async (k) => {
          const id = menuFor!;
          if (k === 'open') {
            await loadSession(id);
            router.navigate('/player');
          } else if (k === 'details') router.push({ pathname: '/session/[id]', params: { id } });
          else deleteSession(id);
        }}
      />
    </Screen>
  );
}
