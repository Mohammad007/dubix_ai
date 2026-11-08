import { useState, type ReactNode } from 'react';
import { Alert, View } from 'react-native';

import { AppHeader, Banner, Button, Card, HeaderMenu, IconTile, Pill, ProgressBar, Screen, ScreenTitle, SectionHeader, Segmented, T, Toggle, type IconName } from '@/components/ui';
import { checkModel } from '@/domain/compatibility';
import { getLanguage, LANGUAGES } from '@/domain/languages';
import { MODEL_CATALOG, TRANSLATION_PACK_APPROX_BYTES, type CatalogModel } from '@/domain/modelCatalog';
import { useLayout } from '@/hooks/useLayout';
import { autoDeleteUnused, cancelInstall, installModel, removeModel } from '@/services/models';
import { engine } from '@/store/engine';
import { updateSettings, useSettings } from '@/store/settings';
import { colors, space } from '@/theme/tokens';
import { formatBytes } from '@/utils/format';

const KIND_ICON: Record<string, IconName> = { vad: 'waveform', asr: 'mic', speaker: 'users', tts: 'volume' };

export default function ModelManagerScreen() {
  const s = useSettings();
  const { columns } = useLayout();
  const device = engine.useValue((x) => x.device);
  const installed = engine.useValue((x) => x.installed);
  const translationPacks = engine.useValue((x) => x.translationPacks);
  const modelsBytes = engine.useValue((x) => x.modelsBytes);
  const [allVoices, setAllVoices] = useState(false);
  const [cleanup, setCleanup] = useState<string | null>(null);
  const target = getLanguage(s.targetLang);
  const voiceLang = target?.voiceLang ?? 'hi';

  const asr = MODEL_CATALOG.filter((m) => m.kind === 'asr' || m.kind === 'vad');
  const speaker = MODEL_CATALOG.filter((m) => m.kind === 'speaker');
  const voices = MODEL_CATALOG.filter((m) => m.kind === 'tts');
  const hindi = voices.filter((m) => m.languages.includes('hi'));
  const english = voices.filter((m) => m.languages.includes('en'));
  const targetVoices = voiceLang !== 'hi' && voiceLang !== 'en' ? voices.filter((m) => m.languages.includes(voiceLang)) : [];
  const otherVoices = voices.filter((m) => !m.languages.includes('hi') && !m.languages.includes('en') && !m.languages.includes(voiceLang));
  const neededPacks = new Set(['en', target?.translateTarget ?? 'hi', ...(s.sourceLang !== 'auto' ? [getLanguage(s.sourceLang)?.translateTarget ?? s.sourceLang] : [])]);
  const packs = [...new Set([...neededPacks, ...translationPacks])];

  const free = device?.storageFreeBytes ?? 0;
  const total = device?.storageTotalBytes ?? 1;

  return (
    <Screen header={<AppHeader title="Offline AI Models" right={<HeaderMenu />} />}>
      <ScreenTitle title="Offline AI Models" back subtitle="Download once from trusted sources; inference then runs entirely on this device." />

      <Card style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <IconTile icon="storage" tone="accent" size={52} />
          <View style={{ flex: 1 }}>
            <T v="cardTitle">Device Storage</T>
            <T v="caption" color={colors.textMuted}>
              Offline AI models and voice packs
            </T>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <T v="cardTitle">{formatBytes(free)} Free</T>
            <T v="caption" color={colors.textMuted}>
              of {formatBytes(total)}
            </T>
          </View>
        </View>
        <ProgressBar value={(total - free) / total} label="Storage used" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Pill label={`Models & packs ${formatBytes(modelsBytes)}`} tone="accent" showIcon={false} />
          <Pill label={`${installed.length + translationPacks.size} installed`} tone="neutral" showIcon={false} />
          <Pill label={`Free ${formatBytes(free)}`} tone="neutral" showIcon={false} />
        </View>
      </Card>

      <Group title="Speech Recognition" columns={columns}>{asr.map((m) => <ModelCard key={m.id} m={m} half={columns > 1} />)}</Group>

      <SectionHeader title="Translation" />
      <T v="caption" color={colors.textMuted} style={{ marginBottom: space.sm }}>
        Google ML Kit on-device translation. Packs download through Google Play services (version managed by Play services); translation itself never leaves the device.
      </T>
      <Grid columns={columns}>{packs.map((lang) => <PackCard key={lang} lang={lang} needed={neededPacks.has(lang)} half={columns > 1} />)}</Grid>

      <Group title="Hindi Voice" columns={columns}>{hindi.map((m) => <ModelCard key={m.id} m={m} half={columns > 1} />)}</Group>
      <Group title="English Voice" columns={columns}>{english.map((m) => <ModelCard key={m.id} m={m} half={columns > 1} />)}</Group>
      {targetVoices.length ? <Group title={`${target?.name} Voice`} columns={columns}>{targetVoices.map((m) => <ModelCard key={m.id} m={m} half={columns > 1} />)}</Group> : null}
      <SectionHeader title="Other Voices" action={allVoices ? 'Hide' : `Show ${otherVoices.length}`} onAction={() => setAllVoices(!allVoices)} />
      {allVoices ? <Grid columns={columns}>{otherVoices.map((m) => <ModelCard key={m.id} m={m} half={columns > 1} />)}</Grid> : null}

      <Group title="Speaker Detection" columns={columns}>{speaker.map((m) => <ModelCard key={m.id} m={m} half={columns > 1} />)}</Group>

      <SectionHeader title="Optional Source Separation" />
      <Card tone="warning">
        <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
          <IconTile icon="music" />
          <View style={{ flex: 1 }}>
            <T v="cardTitle">Dialogue / music separation</T>
            <T v="caption" color={colors.textMuted}>
              Not available. No verified, redistributable separation model runs fast enough on phones yet, so DubiX does not offer it. Lowering the original volume lowers music and effects too.
            </T>
          </View>
          <Pill label="Not available" tone="neutral" showIcon={false} />
        </View>
      </Card>

      <SectionHeader title="Update & Storage Preferences" />
      <Card style={{ gap: space.md }}>
        <Pref icon="wifi" title="Download on Wi-Fi only" body={s.wifiOnlyDownloads ? 'Downloads wait for Wi-Fi.' : 'Off: packs download over Wi-Fi or mobile data. Large packs can use a lot of data.'}>
          <Toggle value={s.wifiOnlyDownloads} onChange={(v) => updateSettings({ wifiOnlyDownloads: v })} label="Download on Wi-Fi only" />
        </Pref>
        <Pref icon="trash" title="Auto-delete unused packs" body="Optional packs not used for this long are removed at startup." />
        <Segmented label="Auto-delete period" value={String(s.autoDeleteUnusedDays)} onChange={(k) => updateSettings({ autoDeleteUnusedDays: Number(k) })} options={[{ key: '0', label: 'Never' }, { key: '30', label: 'After 30 days' }, { key: '90', label: 'After 90 days' }]} />
        {cleanup ? <Banner tone="success" title={cleanup} onDismiss={() => setCleanup(null)} /> : null}
        <Button
          label="Clean up now"
          icon="eraser"
          variant="secondary"
          compact
          disabled={s.autoDeleteUnusedDays === 0}
          style={{ alignSelf: 'flex-start' }}
          onPress={async () => {
            const removed = await autoDeleteUnused();
            setCleanup(removed.length ? `Removed ${removed.length} unused pack(s).` : 'Nothing to remove.');
          }}
        />
      </Card>
    </Screen>
  );
}

function Group({ title, columns, children }: { title: string; columns: number; children: ReactNode }) {
  return (
    <>
      <SectionHeader title={title} />
      <Grid columns={columns}>{children}</Grid>
    </>
  );
}

function Grid({ columns, children }: { columns: number; children: ReactNode }) {
  return <View style={{ flexDirection: columns > 1 ? 'row' : 'column', flexWrap: 'wrap', gap: space.sm }}>{children}</View>;
}

function Pref({ icon, title, body, children }: { icon: IconName; title: string; body: string; children?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <IconTile icon={icon} />
      <View style={{ flex: 1 }}>
        <T v="cardTitle">{title}</T>
        <T v="caption" color={colors.textMuted}>
          {body}
        </T>
      </View>
      {children}
    </View>
  );
}

function ModelCard({ m, half }: { m: CatalogModel; half: boolean }) {
  const device = engine.useValue((x) => x.device);
  const installedList = engine.useValue((x) => x.installed);
  const downloads = engine.useValue((x) => x.downloads);
  const available = engine.useValue((x) => x.available);
  const installed = installedList.find((x) => x.id === m.id);
  const d = downloads[m.id];
  const busy = d && (d.state === 'queued' || d.state === 'downloading' || d.state === 'installing');
  const issues = device ? checkModel(m, device) : [];
  const blocking = issues.find((i) => i.blocking);
  return (
    <Card style={{ width: half ? '49%' : '100%', gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
        <IconTile icon={KIND_ICON[m.kind]} />
        <View style={{ flex: 1 }}>
          <T v="cardTitle">{m.title}</T>
          <T v="caption" color={colors.textMuted}>
            {formatBytes(installed ? installed.sizeOnDisk : m.sizeBytes)}
            {installed ? ' on disk' : ' download'} · v{installed?.version ?? m.version} · {m.description}
          </T>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' }}>
        {installed ? (
          <Pill label={installed.verified ? 'Installed · checksum verified' : 'Installed'} tone="success" />
        ) : busy ? (
          <Pill label={d.state === 'installing' ? 'Verifying & installing…' : d.state === 'queued' ? 'Queued' : `Downloading ${d.total ? Math.round((d.bytes / d.total) * 100) : 0}%`} tone="accent" icon="download" />
        ) : (
          <Pill label="Not Installed" tone="neutral" icon="dot" />
        )}
        {m.required ? <Pill label="Required" tone="accent" showIcon={false} /> : null}
        {!m.sha256 ? <Pill label="No published checksum" tone="neutral" showIcon={false} /> : null}
        {!installed && issues.length === 0 && device ? <Pill label="Compatible" tone="success" showIcon={false} /> : null}
      </View>
      {busy && d.total > 0 ? <ProgressBar value={d.bytes / d.total} label={`${m.title} download progress`} /> : null}
      {d?.state === 'error' ? (
        <T v="caption" color={colors.danger}>
          {d.error} Partial data is kept, so Retry resumes the download.
        </T>
      ) : null}
      {issues.length && !installed ? (
        <T v="caption" color={blocking ? colors.danger : colors.warning}>
          {issues.map((i) => i.message).join(' · ')}
        </T>
      ) : null}
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {installed ? (
          <Button
            label="Remove"
            icon="trash"
            variant="danger"
            compact
            onPress={() =>
              Alert.alert(`Remove ${m.title}?`, `Frees ${formatBytes(installed.sizeOnDisk)}. You can download it again later.`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => removeModel(m.id) },
              ])
            }
          />
        ) : busy ? (
          <Button label="Cancel" icon="close" variant="secondary" compact onPress={() => cancelInstall(m.id)} disabled={d.state === 'installing'} />
        ) : (
          <Button label={d?.state === 'error' ? 'Retry' : 'Download'} icon="download" compact onPress={() => installModel(m.id)} disabled={!!blocking || !available} />
        )}
      </View>
    </Card>
  );
}

function PackCard({ lang, needed, half }: { lang: string; needed: boolean; half: boolean }) {
  const installed = engine.useValue((x) => x.translationPacks.has(lang));
  const d = engine.useValue((x) => x.downloads[`mlkit-${lang}`]);
  const available = engine.useValue((x) => x.available);
  const busy = d?.state === 'downloading' || d?.state === 'queued';
  const name = LANGUAGES.find((l) => l.translateTarget === lang && !l.styleLayer)?.name ?? lang.toUpperCase();
  return (
    <Card style={{ width: half ? '49%' : '100%', flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <IconTile icon="translate" />
      <View style={{ flex: 1, gap: 4 }}>
        <T v="cardTitle">Translator · {name}</T>
        <T v="caption" color={colors.textMuted}>
          ≈{formatBytes(TRANSLATION_PACK_APPROX_BYTES)} (size reported by ML Kit docs){needed ? ' · needed for your language pair' : ''}
        </T>
        <Pill label={installed ? 'Installed' : d?.state === 'queued' ? 'Queued' : busy ? 'Downloading…' : 'Not Installed'} tone={installed ? 'success' : busy ? 'accent' : 'neutral'} />
        {d?.state === 'error' ? (
          <T v="caption" color={colors.danger}>
            {d.error}
          </T>
        ) : null}
      </View>
      {installed ? (
        <Button label="Remove" variant="danger" compact onPress={() => removeModel(`mlkit-${lang}`)} />
      ) : (
        <Button label={d?.state === 'error' ? 'Retry' : 'Download'} icon="download" compact loading={busy} onPress={() => installModel(`mlkit-${lang}`)} disabled={!available} />
      )}
    </Card>
  );
}
