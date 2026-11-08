import { useCallback, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { DubixNative } from 'dubix-native';

import { AppHeader, Banner, Button, Card, ErrorState, HeaderMenu, IconButton, IconTile, OfflineStatusPill, Pill, Screen, ScreenTitle, Segmented, Slider, T, Toggle, type IconName } from '@/components/ui';
import { Waveform } from '@/components/waveform/Waveform';
import { clampOffset, OFFSET_RANGE, ORIGINAL_AUDIO_WARNING, SPEED_RANGE, speedPreset, type SilenceTrim } from '@/domain/sync';
import { applyMix, sessions, startDubbing } from '@/services/dubbing';
import { engine } from '@/store/engine';
import { updateSettings, useSettings } from '@/store/settings';
import { colors, radius, space } from '@/theme/tokens';
import { formatDuration, formatOffset } from '@/utils/format';

const WINDOW_MS = 120_000;
const BUCKETS = 90;

export default function AudioSyncScreen() {
  const s = useSettings();
  const active = sessions.useValue((x) => x.active);
  const route = engine.useValue((x) => x.route);
  // Draft only while dragging the offset slider; otherwise show the saved value.
  const [offsetDraft, setOffset] = useState<number | null>(null);
  const offset = offsetDraft ?? s.syncOffsetMs;
  const [speed, setSpeed] = useState(s.voiceSpeed);
  const [spill, setSpill] = useState(s.spillMs);
  const [duck, setDuck] = useState(s.duckLevel);
  const [wave, setWave] = useState<{ original: number[]; dubbed: number[]; marks: number[]; startMs: number } | null>(null);
  const [loadingWave, setLoadingWave] = useState(false);
  const [waveError, setWaveError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [offerRedub, setOfferRedub] = useState(false);


  const loadWave = useCallback(async () => {
    if (!active || !DubixNative) return;
    setLoadingWave(true);
    setWaveError(null);
    try {
      const first = active.segments.find((x) => x.audioPath && x.startMs >= active.session.lastPositionMs - 30_000) ?? active.segments.find((x) => x.audioPath);
      const startMs = Math.max(0, (first?.startMs ?? active.session.lastPositionMs) - 5_000);
      const endMs = Math.min(active.session.durationMs || startMs + WINDOW_MS, startMs + WINDOW_MS);
      const inWindow = active.segments.filter((x) => x.audioPath && x.endMs >= startMs && x.startMs <= endMs);
      const [original, dubbed] = await Promise.all([
        DubixNative.computeWaveform(active.session.uri, startMs, endMs, BUCKETS),
        DubixNative.dubWaveform(inWindow.map((x) => ({ startMs: x.startMs + s.syncOffsetMs, path: x.audioPath! })), startMs, endMs, BUCKETS),
      ]);
      setWave({ original, dubbed, marks: inWindow.map((x) => (x.startMs - startMs) / (endMs - startMs)), startMs });
    } catch (e) {
      setWaveError((e as Error).message);
    } finally {
      setLoadingWave(false);
    }
  }, [active, s.syncOffsetMs]);

  const commitOffset = (v: number) => {
    updateSettings({ syncOffsetMs: clampOffset(v) });
    setOffset(null);
  };

  const apply = async () => {
    const regenNeeded = Math.abs(speed - s.voiceSpeed) > 0.001 || spill !== s.spillMs;
    updateSettings({ syncOffsetMs: offset, voiceSpeed: speed, duckLevel: duck, spillMs: spill });
    await applyMix();
    setApplied('Sync applied. Offset and ducking take effect immediately.');
    setOfferRedub(regenNeeded && !!active?.segments.length);
  };

  return (
    <Screen header={<AppHeader status={<OfflineStatusPill />} right={<HeaderMenu />} />} footer={<Button label="Apply Sync" icon="check-circle" onPress={apply} />}>
      <ScreenTitle title="Audio Sync" back subtitle="Align the dubbed voice with each line of dialogue. Lip movements in the video are not altered." />
      {applied ? <Banner tone="success" title={applied} onDismiss={() => setApplied(null)} /> : null}
      {offerRedub ? (
        <Banner tone="accent" title="Re-dub with the new speed and spill buffer?" body="Voice speed and the spill buffer apply when lines are generated." action="Re-dub this movie" onAction={() => { setOfferRedub(false); startDubbing({ mode: 'prepare', fromMs: 0 }); }} onDismiss={() => setOfferRedub(false)} />
      ) : null}

      <Card style={{ gap: space.sm }}>
        <Header icon="sync" title="Automatic Sync" body="Measures the delay of the current audio output and starts each line early by that amount.">
          <Toggle value={s.autoSync} onChange={(v) => updateSettings({ autoSync: v })} label="Automatic sync" />
        </Header>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Pill label={route ? `${route.type === 'bluetooth' ? 'Bluetooth' : route.type === 'wired' ? 'Wired' : 'Speaker'} · ${route.name}` : 'Output unknown'} tone="neutral" icon={route?.type === 'bluetooth' ? 'bluetooth' : route?.type === 'wired' ? 'headphones' : 'speaker'} />
          <Pill label={active?.measuredLatencyMs ? `Output delay ≈ ${Math.round(active.measuredLatencyMs)} ms` : 'Delay measured while dub plays'} tone={active?.measuredLatencyMs ? 'success' : 'neutral'} />
          <Pill label={active?.driftAvgMs ? `Scheduling drift ≈ ${Math.round(active.driftAvgMs)} ms` : 'Drift: no lines played yet'} tone={active?.driftAvgMs && Math.abs(active.driftAvgMs) > 120 ? 'warning' : 'neutral'} icon="timer" />
        </View>
      </Card>

      <Card style={{ gap: space.sm, marginTop: space.md }}>
        <Header icon="waveform" title="Manual Offset" body="Fine-tune if the audio is ahead or behind. Positive delays the dubbed voice." />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md }}>
          <IconButton icon="minus" label="Decrease offset by 20 milliseconds" onPress={() => commitOffset(offset - OFFSET_RANGE.step)} style={{ backgroundColor: colors.accentSoft }} />
          <View style={{ minWidth: 140, alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 10 }}>
            <T v="heading">{formatOffset(offset)}</T>
          </View>
          <IconButton icon="plus" label="Increase offset by 20 milliseconds" onPress={() => commitOffset(offset + OFFSET_RANGE.step)} style={{ backgroundColor: colors.accentSoft }} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <T v="caption" color={colors.textMuted}>
            −1000 ms
          </T>
          <View style={{ flex: 1 }}>
            <Slider label="Offset" value={offset} min={OFFSET_RANGE.min} max={OFFSET_RANGE.max} step={OFFSET_RANGE.step} onChange={setOffset} onCommit={commitOffset} formatValue={formatOffset} />
          </View>
          <T v="caption" color={colors.textMuted}>
            +1000 ms
          </T>
        </View>
      </Card>

      <Card style={{ gap: space.sm, marginTop: space.md }}>
        <Header icon="speed" title="Voice Speed" body="Base speaking rate of the dubbed voice." />
        <Segmented label="Voice speed preset" value={speedPreset(speed)} onChange={(k) => setSpeed(k === 'slower' ? 0.9 : k === 'faster' ? 1.1 : 1)} options={[{ key: 'slower', label: 'Slower' }, { key: 'normal', label: 'Normal' }, { key: 'faster', label: 'Faster' }]} />
        <T v="cardTitle" style={{ textAlign: 'center' }}>
          {speed.toFixed(2)}×
        </T>
        <Slider label="Voice speed" value={speed} min={SPEED_RANGE.min} max={SPEED_RANGE.max} step={0.01} onChange={setSpeed} formatValue={(v) => `${v.toFixed(2)} times`} />
        <T v="caption" color={colors.textMuted}>
          Lines that still don’t fit are time-stretched with pitch preserved, up to:
        </T>
        <Segmented label="Maximum stretch" value={String(s.maxStretch)} onChange={(k) => updateSettings({ maxStretch: Number(k) })} options={[{ key: '1.15', label: '1.15× natural' }, { key: '1.25', label: '1.25×' }, { key: '1.4', label: '1.4× tight' }]} />
        <T v="caption" color={colors.textMuted} style={{ marginTop: space.sm }}>
          Spill buffer: a line may run {spill} ms into the following silence before it is stretched (gap management).
        </T>
        <Slider label="Spill buffer" value={spill} min={0} max={1500} step={50} onChange={setSpill} formatValue={(v) => `${v} milliseconds`} />
      </Card>

      <Card style={{ gap: space.sm, marginTop: space.md }}>
        <Header icon="scissors" title="Silence Trimming" body="Remove long silent parts to keep the audio tight and natural.">
          <Toggle value={s.silenceTrim !== 'off'} onChange={(v) => updateSettings({ silenceTrim: v ? 'light' : 'off' })} label="Silence trimming" />
        </Header>
        <Segmented<SilenceTrim> label="Silence trimming level" value={s.silenceTrim} onChange={(k) => updateSettings({ silenceTrim: k })} options={[{ key: 'off', label: 'Off' }, { key: 'light', label: 'Light (≥0.3 s)' }, { key: 'aggressive', label: 'Strong (≥0.6 s)' }]} />
      </Card>

      <Card style={{ gap: space.sm, marginTop: space.md }}>
        <Header icon="music" title="Lower original while dubbing" body="Ducks the whole original track only while a dubbed line plays.">
          <Toggle value={s.duckWhileDubbing} onChange={(v) => updateSettings({ duckWhileDubbing: v })} label="Lower original while dubbing" />
        </Header>
        <T v="cardTitle" style={{ textAlign: 'center' }}>
          −{Math.round(duck * 100)}%
        </T>
        <Slider label="Ducking amount" value={duck} min={0} max={1} step={0.05} onChange={setDuck} disabled={!s.duckWhileDubbing} formatValue={(v) => `${Math.round(v * 100)} percent quieter`} />
        <Banner tone="warning" title="This is not background-music separation" body={`${ORIGINAL_AUDIO_WARNING} Music-preserving reduction needs a source-separation model, which is not available in this version.`} />
      </Card>

      <Card style={{ gap: space.sm, marginTop: space.md }}>
        <Header icon="chart" title="Sync Preview" body="Original audio vs. dubbed lines (with your offset), from the open movie.">
          <Button label={wave ? 'Refresh' : 'Load'} compact variant="secondary" onPress={loadWave} loading={loadingWave} disabled={!active} />
        </Header>
        {waveError ? <ErrorState code="decode_failed" message={waveError} compact onDismiss={() => setWaveError(null)} /> : null}
        {!active ? (
          <T v="caption" color={colors.textMuted}>
            Open a movie in the Player to preview alignment.
          </T>
        ) : wave ? (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                <T key={f} v="mono" color={colors.textMuted} style={{ fontSize: 11 }}>
                  {formatDuration(wave.startMs + f * WINDOW_MS)}
                </T>
              ))}
            </View>
            <Pill label="Original" tone="neutral" showIcon={false} />
            <Waveform data={wave.original} color={colors.textMuted} label="Original audio waveform" />
            <Pill label="Dubbed" tone="accent" showIcon={false} />
            <Waveform data={wave.dubbed} label="Dubbed audio waveform" />
            <View style={{ height: 10 }} accessibilityLabel={`${wave.marks.length} dialogue line starts in this window`}>
              {wave.marks.map((m, i) => (
                <View key={i} style={{ position: 'absolute', left: `${m * 100}%`, width: 2, height: 10, backgroundColor: colors.accent, borderRadius: 1 }} />
              ))}
            </View>
            <T v="caption" color={colors.textMuted}>
              Ticks mark dialogue line timestamps.
            </T>
          </>
        ) : null}
      </Card>
    </Screen>
  );
}

function Header({ icon, title, body, children }: { icon: IconName; title: string; body: string; children?: ReactNode }) {
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
