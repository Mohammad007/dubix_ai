import * as ScreenOrientation from 'expo-screen-orientation';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, View } from 'react-native';

import { DubixNative, type AudioTrackInfo, type SubtitleTrack } from 'dubix-native';

import {
  AppHeader, Banner, Button, Card, EmptyState, ErrorState, HeaderMenu, Icon, IconButton, IconTile, NativeUnavailable, OfflineStatusPill,
  PickerSheet, Pill, ProgressBar, Screen, ScreenTitle, Segmented, SessionCard, Slider, T, Toggle, WarningsHost, type IconName,
} from '@/components/ui';
import { VideoStage } from '@/components/player/VideoStage';
import { stepSubtitleSize, type CaptionMode } from '@/domain/captions';
import { languageName, languageShort } from '@/domain/languages';
import { coveredMs } from '@/domain/ranges';
import { ORIGINAL_AUDIO_WARNING } from '@/domain/sync';
import { useLayout } from '@/hooks/useLayout';
import { usePlayerState } from '@/hooks/usePlayer';
import {
  applyMix, attachPlayer, cancelDubbing, detachPlayer, loadSession, onPlayerTick, openLocalVideo, pauseDubbing, resumeDubbing, selectAudioTrack,
  sessions, setPlaybackSpeed, startDubbing,
} from '@/services/dubbing';
import {
  getUsedSignature, listSubtitleTracks, pickSubtitleFile, setSubtitleChoice, sourceSignature, trackLabel, useSubtitleChoice, type SubtitleChoice,
} from '@/services/dubbing/subtitleSource';
import { installModel } from '@/services/models';
import { engine } from '@/store/engine';
import { updateSettings, useSettings } from '@/store/settings';
import { colors, space } from '@/theme/tokens';
import { formatDuration } from '@/utils/format';

const SPEEDS = ['0.5', '0.75', '1', '1.25', '1.5', '2'];

export default function PlayerScreen() {
  const active = sessions.useValue((s) => s.active);
  const list = sessions.useValue((s) => s.list);
  const available = engine.useValue((x) => x.available);
  const route = engine.useValue((x) => x.route);
  const progress = engine.useValue((x) => (active ? x.jobProgress[active.session.id] : undefined));
  const s = useSettings();
  const { isTablet } = useLayout();
  const snap = usePlayerState(active?.playerId ?? null);
  const [fullscreen, setFullscreen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<{ code: string; message?: string } | null>(null);
  const [startError, setStartError] = useState<{ code: string; message: string; missing: string[] } | null>(null);
  const [optionsOpen, setOptionsOpen] = useState<'menu' | 'speed' | 'tracks' | 'subs' | null>(null);
  const [tracks, setTracks] = useState<AudioTrackInfo[]>([]);
  const [subTracks, setSubTracks] = useState<SubtitleTrack[] | null>(null);
  const subChoice = useSubtitleChoice(active?.session.id ?? '');
  const snapRef = useRef(snap);
  useEffect(() => {
    snapRef.current = snap;
  }, [snap]);

  const sessionId = active?.session.id;
  useFocusEffect(
    useCallback(() => {
      if (sessionId) attachPlayer();
      return () => {
        detachPlayer(snapRef.current.positionMs, snapRef.current.durationMs);
      };
    }, [sessionId]),
  );

  useEffect(() => {
    applyMix();
  }, [s.dubEnabled, s.originalVolume, s.originalMuted, s.dubVolume, s.syncOffsetMs, s.autoSync, s.duckWhileDubbing, s.duckLevel, active?.measuredLatencyMs]);

  useEffect(() => {
    if (active?.playerId) onPlayerTick(snap.positionMs, snap.isPlaying);
  }, [snap.positionMs, snap.isPlaying, active?.playerId]);

  useEffect(() => {
    if (fullscreen) ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => undefined);
    else ScreenOrientation.unlockAsync().catch(() => undefined);
  }, [fullscreen]);

  const open = async () => {
    setOpening(true);
    setOpenError(null);
    try {
      const r = await openLocalVideo();
      if (r.ok) await loadSession(r.sessionId);
      else if (r.code !== 'cancelled') setOpenError({ code: r.code, message: r.message });
    } finally {
      setOpening(false);
    }
  };

  if (!active) {
    return (
      <Screen header={<AppHeader status={<OfflineStatusPill />} right={<HeaderMenu />} />}>
        {!available ? <NativeUnavailable /> : null}
        {openError ? <ErrorState code={openError.code} message={openError.message} onRetry={open} onDismiss={() => setOpenError(null)} /> : null}
        <ScreenTitle title="Movie Player" subtitle="Play local movies with dubbing and subtitles." />
        <EmptyState
          icon="film"
          title="No video open"
          body="Choose a video file you own or are authorized to use (MP4, MKV, WebM and other formats your device supports). It is read in place and never uploaded."
          action={<Button label="Open Local Movie" icon="folder-open" onPress={open} loading={opening} disabled={!available} />}
        />
        {list.length ? (
          <>
            <T v="heading" style={{ marginTop: space.xl, marginBottom: space.md }}>
              Continue watching
            </T>
            {list.slice(0, 5).map((x) => (
              <SessionCard key={x.id} s={x} onPress={() => loadSession(x.id)} />
            ))}
          </>
        ) : null}
      </Screen>
    );
  }

  const { session, segments } = active;
  const jobActive = ['loading', 'running', 'waiting'].includes(active.jobState) && !!active.jobId;
  const dubbedMs = coveredMs(session.coveredRanges);
  const pct = session.durationMs > 0 ? Math.min(1, dubbedMs / session.durationMs) : 0;
  const fromSubtitles = s.dubSource === 'subtitles';
  const langChanged = session.targetLang !== s.targetLang || session.sourceLang !== s.sourceLang;
  const sourceChanged = segments.length > 0 && getUsedSignature(session.id) !== sourceSignature(fromSubtitles ? subChoice : null);

  const openSubtitles = async () => {
    setSubTracks(null);
    setOptionsOpen('subs');
    try {
      setSubTracks(await listSubtitleTracks(session.uri));
    } catch {
      setSubTracks([]);
    }
  };
  const chooseSubtitles = async (k: string) => {
    let c: SubtitleChoice | null = null;
    if (k === 'file') {
      await new Promise((r) => setTimeout(r, 250)); // let the sheet close before the system picker opens
      c = await pickSubtitleFile();
    } else {
      const t = subTracks?.find((x) => String(x.index) === k);
      if (t) c = { kind: 'track', index: t.index, label: trackLabel(t) };
    }
    if (c) {
      setSubtitleChoice(session.id, c);
      setStartError(null);
    }
  };
  const overflowLines = segments.filter((x) => x.overflowMs > 250).length;
  const failedLines = segments.filter((x) => x.processingState === 'failed').length;

  const start = async (mode: 'prepare' | 'live') => {
    updateSettings({ dubMode: mode });
    setStartError(null);
    const r = await startDubbing({ mode });
    if (!r.ok) setStartError({ code: r.code, message: r.message, missing: r.missing });
  };

  const openTracks = async () => {
    if (active.playerId && DubixNative) setTracks(await DubixNative.getAudioTracks(active.playerId));
    setOptionsOpen('tracks');
  };

  const pip = async () => {
    const ok = await DubixNative?.enterPictureInPicture(16, 9);
    if (!ok) setOpenError({ code: 'pip', message: 'Picture-in-picture is not available on this device.' });
  };

  const statusLabel = jobActive
    ? active.jobState === 'waiting'
      ? `Live · ${Math.round(pct * 100)}% (buffered ahead)`
      : `${active.jobMode === 'live' ? 'Live dubbing' : 'Preparing'} · ${Math.round(pct * 100)}%`
    : session.status === 'ready'
      ? 'Complete'
      : session.status === 'error'
        ? 'Stopped by an error'
        : dubbedMs > 0
          ? `Dubbed ${Math.round(pct * 100)}%`
          : 'Not dubbed yet';

  const stage = (
    <VideoStage
      playerId={fullscreen ? null : active.playerId}
      snap={snap}
      segments={segments}
      targetLang={session.targetLang}
      gated={active.gated}
      onToggleFullscreen={() => setFullscreen(true)}
      onOpenOptions={() => setOptionsOpen('menu')}
      onPip={pip}
      showSurface={!fullscreen}
    />
  );

  const dubbing = (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
        <T v="cardTitle">Dubbing</T>
        <Pill label={statusLabel} tone={jobActive ? 'accent' : session.status === 'ready' ? 'success' : session.status === 'error' ? 'danger' : 'neutral'} showIcon={false} />
      </View>
      <ProgressBar value={pct} label="Dubbed portion of the movie" />
      <T v="caption" color={colors.textMuted}>
        {formatDuration(dubbedMs)} of {formatDuration(session.durationMs)} dubbed · {segments.length} lines · {active.speakers.length} speaker(s)
        {progress && progress.realtimeFactor > 0 && jobActive ? ` · ${progress.realtimeFactor < 1 ? `${(1 / progress.realtimeFactor).toFixed(1)}× faster than real time` : `${progress.realtimeFactor.toFixed(1)}× slower than real time`}` : ''}
      </T>
      {active.regenerating ? <Banner tone="accent" title={active.regenerating.label} body={`${active.regenerating.done} of ${active.regenerating.total} lines`} /> : null}
      {startError ? (
        <ErrorState
          code={startError.code}
          message={startError.message}
          onDismiss={() => setStartError(null)}
          onRetry={() => {
            startError.missing.forEach(installModel);
            router.push('/models');
          }}
        />
      ) : null}
      {session.status === 'error' && !jobActive ? <ErrorState code={active.jobCode ?? 'pipeline_error'} message={session.error} onRetry={() => start(s.dubMode)} /> : null}
      {active.jobState === 'cancelled' && !jobActive ? <ErrorState code="cancelled" compact onRetry={() => start(s.dubMode)} /> : null}
      {langChanged && segments.length ? (
        <T v="caption" color={colors.warning}>
          Language changed to {languageName(s.targetLang)}. Dubbing again replaces the existing lines.
        </T>
      ) : null}
      {overflowLines || failedLines ? (
        <Banner
          tone="warning"
          title={`${overflowLines ? `${overflowLines} line(s) run past their dialogue slot` : ''}${overflowLines && failedLines ? ' · ' : ''}${failedLines ? `${failedLines} line(s) have no voice` : ''}`}
          body={
            overflowLines
              ? 'Translated speech was longer than the original even at the maximum stretch. Allow a larger spill buffer or stretch in Audio Sync, then re-dub.'
              : `Captions are still shown. Reason: ${segments.find((x) => x.processingState === 'failed')?.error ?? 'unknown'}`
          }
          action={overflowLines ? 'Audio Sync' : 'Voices'}
          onAction={() => router.push(overflowLines ? '/sync' : '/models')}
        />
      ) : null}

      {jobActive ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label="Pause" icon="pause" variant="secondary" onPress={pauseDubbing} compact style={{ flex: 1 }} />
          <Button label="Cancel" icon="stop" variant="danger" onPress={cancelDubbing} compact style={{ flex: 1 }} />
        </View>
      ) : active.jobState === 'paused' && active.jobId ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label="Resume" icon="play" onPress={resumeDubbing} compact style={{ flex: 1 }} />
          <Button label="Cancel" icon="stop" variant="danger" onPress={cancelDubbing} compact style={{ flex: 1 }} />
        </View>
      ) : null}

      {!jobActive && !(active.jobState === 'paused' && active.jobId) ? (
        <View style={{ gap: space.sm }}>
          <Segmented<'speech' | 'subtitles'>
            label="Dub from"
            value={s.dubSource}
            onChange={(k) => updateSettings({ dubSource: k })}
            options={[
              { key: 'speech', label: 'Speech (AI listens)' },
              { key: 'subtitles', label: 'Subtitles (faster)' },
            ]}
          />
          {fromSubtitles ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Icon name="captions" color={subChoice ? colors.accent : colors.textMuted} />
              <T v="body" numberOfLines={1} style={{ flex: 1 }}>
                {subChoice ? (subChoice.kind === 'track' ? `Embedded: ${subChoice.label}` : subChoice.name) : 'No subtitles chosen'}
              </T>
              <Button label={subChoice ? 'Change' : 'Choose subtitles'} variant="secondary" compact onPress={openSubtitles} />
            </View>
          ) : null}
          <T v="caption" color={colors.textMuted}>
            {fromSubtitles
              ? 'Uses the exact text and timing of the subtitle lines, so lines start on cue and no speech model is needed. Voices are still matched to who is speaking from the audio.'
              : 'Speech recognition listens to the dialogue. Works without subtitles; music and noise can reduce accuracy.'}
          </T>
        </View>
      ) : null}

      {!jobActive && !(active.jobState === 'paused' && active.jobId) && (session.status !== 'ready' || langChanged || sourceChanged) ? (
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="Live Dubbing" icon="live" onPress={() => start('live')} compact style={{ flex: 1 }} disabled={!available} />
            <Button label="Prepare Dubbing" icon="hourglass" variant="secondary" onPress={() => start('prepare')} compact style={{ flex: 1 }} disabled={!available} />
          </View>
          <T v="caption" color={colors.textMuted}>
            Live dubbing works while you watch, staying up to {s.liveLeadSec}s ahead; playback may pause briefly to let it catch up. Prepare analyses the whole movie first for the smoothest timing.
          </T>
        </View>
      ) : null}
    </Card>
  );

  const mix = (
    <Card style={{ gap: space.md }}>
      <MixRow icon="mic" title="Original Audio" subtitle={`Source: ${languageName(session.sourceLang)}`} value={s.originalVolume} muted={s.originalMuted} onMute={(m) => updateSettings({ originalMuted: m })} onChange={(v) => updateSettings({ originalVolume: v })} />
      {s.originalMuted || s.originalVolume < 0.95 || s.duckWhileDubbing ? (
        <T v="caption" color={colors.warning}>
          {ORIGINAL_AUDIO_WARNING}
        </T>
      ) : null}
      <MixRow icon="waveform" title="Dubbed Voice" subtitle={`Target: ${languageName(session.targetLang)}`} value={s.dubVolume} muted={!s.dubEnabled} onMute={(m) => updateSettings({ dubEnabled: !m })} onChange={(v) => updateSettings({ dubVolume: v })} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <IconTile icon="text-larger" />
        <View style={{ flex: 1 }}>
          <T v="cardTitle">Subtitle Size</T>
          <T v="caption" color={colors.textMuted}>
            Adjust on-screen subtitle text size.
          </T>
        </View>
        <IconButton icon="text-smaller" label="Smaller subtitles" onPress={() => updateSettings({ subtitleSize: stepSubtitleSize(s.subtitleSize, -1) })} />
        <T v="bodyStrong" style={{ width: 26, textAlign: 'center' }}>
          {s.subtitleSize.toUpperCase()}
        </T>
        <IconButton icon="text-larger" label="Larger subtitles" onPress={() => updateSettings({ subtitleSize: stepSubtitleSize(s.subtitleSize, 1) })} />
      </View>
      <Segmented<CaptionMode>
        label="Caption language"
        value={s.captionMode}
        onChange={(k) => updateSettings({ captionMode: k })}
        options={[
          { key: 'translated', label: languageShort(session.targetLang) },
          { key: 'both', label: 'Both' },
          { key: 'original', label: 'Original' },
          { key: 'off', label: 'Off' },
        ]}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Icon name={route?.type === 'bluetooth' ? 'bluetooth' : route?.type === 'wired' ? 'headphones' : 'speaker'} color={colors.textMuted} />
        <T v="caption" color={colors.textMuted} style={{ flex: 1 }}>
          Output: {route?.name ?? 'Phone speaker'}
          {active.measuredLatencyMs ? ` · measured delay ≈ ${Math.round(active.measuredLatencyMs)} ms (compensated)` : ''}
        </T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <T v="body" style={{ flex: 1 }}>
          Pause video while live dubbing catches up
        </T>
        <Toggle value={s.waitForDubbing} onChange={(v) => updateSettings({ waitForDubbing: v })} label="Pause video while dubbing catches up" />
      </View>
    </Card>
  );

  return (
    <Screen header={<AppHeader status={<OfflineStatusPill />} right={<HeaderMenu />} />}>
      <WarningsHost />
      {openError ? <ErrorState code={openError.code} message={openError.message} onDismiss={() => setOpenError(null)} /> : null}
      <ScreenTitle title="Movie Player" subtitle="Dubbed speech is timed to each line of dialogue. Lip movements in the video are not changed." />
      {snap.state === 'error' ? <ErrorState code="playback_error" message={snap.message} /> : null}
      <View style={{ flexDirection: isTablet ? 'row' : 'column', gap: space.lg }}>
        <View style={{ flex: isTablet ? 1.4 : undefined, gap: space.md }}>
          {stage}
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Icon name="clapper" />
            <View style={{ flex: 1 }}>
              <T v="cardTitle" numberOfLines={1}>
                {session.name}
              </T>
              <T v="caption" color={colors.textMuted}>
                {formatDuration(session.durationMs)} · {languageShort(session.sourceLang)} → {languageShort(session.targetLang)}
                {s.playbackSpeed !== 1 ? ` · ${s.playbackSpeed}×` : ''}
              </T>
            </View>
            <IconButton icon="file" label="Session details" onPress={() => router.push({ pathname: '/session/[id]', params: { id: session.id } })} />
            <Button label="Change" variant="secondary" compact onPress={open} loading={opening} />
          </Card>
          {dubbing}
        </View>
        <View style={{ flex: isTablet ? 1 : undefined, gap: space.md }}>
          {mix}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Button label="Voice Mapping" icon="users" variant="ghost" onPress={() => router.navigate('/voices')} style={{ flexGrow: 1 }} />
            <Button label="Audio Sync" icon="sliders" variant="ghost" onPress={() => router.push('/sync')} style={{ flexGrow: 1 }} />
            <Button label="Subtitle Settings" icon="captions" variant="ghost" onPress={() => router.push('/subtitles')} style={{ flexGrow: 1 }} />
          </View>
        </View>
      </View>

      <Modal visible={fullscreen} onRequestClose={() => setFullscreen(false)} supportedOrientations={['portrait', 'landscape']} statusBarTranslucent navigationBarTranslucent animationType="fade">
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <VideoStage playerId={active.playerId} snap={snap} segments={segments} targetLang={session.targetLang} gated={active.gated} fullscreen onToggleFullscreen={() => setFullscreen(false)} onOpenOptions={() => setOptionsOpen('menu')} />
        </View>
      </Modal>

      <PickerSheet
        visible={optionsOpen === 'menu'}
        title="Playback options"
        onClose={() => setOptionsOpen(null)}
        options={[
          { key: 'speed', title: 'Playback speed', subtitle: `${s.playbackSpeed}× (dubbed voice follows, pitch preserved)` },
          { key: 'tracks', title: 'Audio track', subtitle: 'Choose the language track to play and dub' },
          { key: 'subs', title: 'Dub from subtitles', subtitle: 'Choose an embedded subtitle track or a .srt/.vtt file' },
          { key: 'subtitles', title: 'Subtitle settings' },
        ]}
        onSelect={(k) => {
          if (k === 'speed') setTimeout(() => setOptionsOpen('speed'), 250);
          else if (k === 'tracks') setTimeout(openTracks, 250);
          else if (k === 'subs') {
            updateSettings({ dubSource: 'subtitles' });
            setTimeout(openSubtitles, 250);
          }
          else router.push('/subtitles');
        }}
      />
      <PickerSheet
        visible={optionsOpen === 'speed'}
        title="Playback speed"
        selected={String(s.playbackSpeed)}
        onClose={() => setOptionsOpen(null)}
        options={SPEEDS.map((v) => ({ key: v, title: `${v}×` }))}
        onSelect={(k) => {
          updateSettings({ playbackSpeed: Number(k) });
          setPlaybackSpeed(Number(k));
        }}
      />
      <PickerSheet
        visible={optionsOpen === 'tracks'}
        title="Audio track"
        selected={String(session.audioTrack)}
        onClose={() => setOptionsOpen(null)}
        options={
          tracks.length
            ? tracks.map((t) => ({
                key: String(t.ordinal),
                title: t.label ?? (t.language ? `${t.language.toUpperCase()} track` : `Track ${t.ordinal + 1}`),
                subtitle: `${t.channels} ch · ${t.mimeType ?? 'audio'}${t.supported ? '' : ' · not playable on this device'}${t.ordinal !== session.audioTrack && segments.length ? ' · re-dubs from this track' : ''}`,
                disabled: !t.supported,
              }))
            : [{ key: '0', title: 'Single audio track', subtitle: 'This file has one audio track', disabled: true }]
        }
        onSelect={(k) => selectAudioTrack(Number(k))}
      />
      <PickerSheet
        visible={optionsOpen === 'subs'}
        title="Dub from subtitles"
        selected={subChoice?.kind === 'track' ? String(subChoice.index) : null}
        onClose={() => setOptionsOpen(null)}
        options={[
          ...(subTracks === null
            ? [{ key: 'loading', title: 'Looking for subtitle tracks…', disabled: true }]
            : subTracks.length
              ? subTracks.map((t) => ({ key: String(t.index), title: trackLabel(t), subtitle: 'Embedded in this video' }))
              : [{ key: 'none', title: 'No text subtitle tracks in this video', subtitle: 'Picture-based subtitles (PGS/VobSub) cannot be read', disabled: true }]),
          { key: 'file', title: 'Open subtitle file…', subtitle: '.srt, .vtt or .ass from your device' },
        ]}
        onSelect={chooseSubtitles}
      />
    </Screen>
  );
}

function MixRow({ icon, title, subtitle, value, muted, onMute, onChange }: { icon: IconName; title: string; subtitle: string; value: number; muted: boolean; onMute: (m: boolean) => void; onChange: (v: number) => void }) {
  // Draft value only while dragging; otherwise the stored setting is shown.
  const [draft, setDraft] = useState<number | null>(null);
  const local = draft ?? value;
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <IconTile icon={icon} tone="accent" />
        <View style={{ flex: 1 }}>
          <T v="cardTitle">{title}</T>
          <T v="caption" color={colors.textMuted}>
            {subtitle}
          </T>
        </View>
        <T v="bodyStrong">{muted ? 'Muted' : `${Math.round(local * 100)}%`}</T>
        <IconButton icon={muted ? 'volume-off' : 'volume'} label={muted ? `Unmute ${title}` : `Mute ${title}`} onPress={() => onMute(!muted)} style={{ borderWidth: 1, borderColor: colors.border }} />
      </View>
      <Slider label={`${title} volume`} value={local} min={0} max={1} step={0.05} formatValue={(v) => `${Math.round(v * 100)} percent`} onChange={setDraft} onCommit={(v) => { setDraft(null); onChange(v); }} disabled={muted} />
    </View>
  );
}
