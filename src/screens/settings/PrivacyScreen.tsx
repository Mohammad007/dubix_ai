import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { Banner, Button, Card, Divider, Icon, ListRow, Screen, ScreenTitle, SectionHeader, Segmented, T } from '@/components/ui';
import { audioCacheBytes, clearDiagnostics, getDiagnostics, type DiagnosticRow } from '@/database';
import { clearGeneratedAudio, clearHistory, clearTranscriptCache } from '@/services/dubbing';
import { updateSettings, useSettings } from '@/store/settings';
import { colors, space } from '@/theme/tokens';
import { formatBytes, formatRelativeDate } from '@/utils/format';

const POINTS = [
  'Speech recognition, translation and voice generation run on this device. Your videos and audio are never uploaded.',
  'No account, analytics, crash reporting or backend.',
  'Sessions, transcripts, voice mappings and generated audio are stored in this app’s private storage until you delete them.',
  'Live translation lines are kept in memory only and discarded when you stop.',
  'The network is used only for model downloads you start (sherpa-onnx files from GitHub; translation packs via Google Play services).',
];

export default function PrivacyScreen() {
  const s = useSettings();
  const [cache, setCache] = useState(0);
  const [log, setLog] = useState<DiagnosticRow[]>([]);
  const [done, setDone] = useState<string | null>(null);

  const refresh = async () => {
    setCache(await audioCacheBytes());
    setLog(await getDiagnostics(20));
  };
  useEffect(() => {
    let alive = true;
    Promise.all([audioCacheBytes(), getDiagnostics(20)]).then(([bytes, rows]) => {
      if (!alive) return;
      setCache(bytes);
      setLog(rows);
    });
    return () => {
      alive = false;
    };
  }, []);

  const confirm = (title: string, body: string, run: () => Promise<void>, doneMsg: string) =>
    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => { await run(); setDone(doneMsg); refresh(); } },
    ]);

  return (
    <Screen>
      <ScreenTitle title="Privacy" back subtitle="Everything stays on this device." />
      {done ? <Banner tone="success" title={done} onDismiss={() => setDone(null)} /> : null}
      <Card style={{ gap: space.md }}>
        {POINTS.map((p) => (
          <View key={p} style={{ flexDirection: 'row', gap: space.md }}>
            <Icon name="shield" color={colors.success} size={20} />
            <T v="body" style={{ flex: 1 }}>
              {p}
            </T>
          </View>
        ))}
      </Card>

      <SectionHeader title="Local data" />
      <Card style={{ paddingVertical: space.xs }}>
        <ListRow icon="file" title="Clear transcript cache" subtitle="Transcripts, translations, speakers and their audio. Sessions stay in history." onPress={() => confirm('Clear transcripts?', 'All transcripts, translations and dubbed audio will be deleted. Movies need to be dubbed again.', clearTranscriptCache, 'Transcript cache cleared.')} />
        <Divider />
        <ListRow icon="waveform" title="Clear generated audio cache" subtitle={`${formatBytes(cache)} of dubbed speech. Transcripts are kept and can be re-voiced.`} onPress={() => confirm('Clear generated audio?', 'Dubbed speech files will be deleted. Transcripts and translations are kept.', clearGeneratedAudio, 'Generated audio cleared.')} />
        <Divider />
        <ListRow icon="trash" title="Clear all local history" subtitle="Deletes every session and its data. Your video files are not touched." danger onPress={() => confirm('Clear all history?', 'Every session, transcript and dubbed audio file will be deleted.', clearHistory, 'History cleared.')} />
      </Card>

      <SectionHeader title="Generated audio limit" />
      <Segmented label="Audio cache limit" value={String(s.audioCacheLimitMb)} onChange={(k) => updateSettings({ audioCacheLimitMb: Number(k) })} options={[{ key: '512', label: '512 MB' }, { key: '2048', label: '2 GB' }, { key: '8192', label: '8 GB' }]} />
      <T v="caption" color={colors.textMuted} style={{ marginTop: space.sm }}>
        When exceeded, audio of the least recently used sessions is removed at startup (transcripts are kept).
      </T>

      <SectionHeader title="Diagnostics (local only)" action={log.length ? 'Clear' : undefined} onAction={async () => { await clearDiagnostics(); refresh(); }} />
      <Card style={{ gap: space.sm }}>
        {log.length === 0 ? (
          <T v="caption" color={colors.textMuted}>
            No errors or warnings recorded.
          </T>
        ) : (
          log.map((d) => (
            <View key={d.id}>
              <T v="bodyStrong" color={d.level === 'error' ? colors.danger : colors.text}>
                {d.code}
              </T>
              <T v="caption" color={colors.textMuted}>
                {formatRelativeDate(d.at)} · {d.message}
              </T>
            </View>
          ))
        )}
      </Card>
      <Button label="Refresh" variant="secondary" compact onPress={refresh} style={{ alignSelf: 'flex-start', marginTop: space.sm }} />
    </Screen>
  );
}
