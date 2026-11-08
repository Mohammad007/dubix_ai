import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { DubixNative } from 'dubix-native';

import { AppHeader, Button, Card, ErrorState, HeaderMenu, Icon, NativeUnavailable, Pill, Screen, ScreenTitle, Segmented, Slider, T, Toggle, WarningsHost, type IconName } from '@/components/ui';
import { LevelMeter } from '@/components/waveform/Waveform';
import { displayTranslation } from '@/domain/captions';
import { getCatalogModel } from '@/domain/modelCatalog';
import { getLanguage, languageName } from '@/domain/languages';
import { usePairAvailability } from '@/hooks/useAvailability';
import { useLayout } from '@/hooks/useLayout';
import { LIVE_STATE_COPY, setLivePaused, startLive, stopLive } from '@/services/audio/live';
import { engine } from '@/store/engine';
import { updateSettings, useSettings } from '@/store/settings';
import { cardShadow, colors, radius, space } from '@/theme/tokens';
import { nativeErrorMessage } from '@/utils/nativeError';

const dbfs = (rms: number) => (rms <= 0.00001 ? '−∞' : `${Math.round(20 * Math.log10(rms))} dBFS`);

export default function LiveTranslatorScreen() {
  const s = useSettings();
  const { isTablet } = useLayout();
  const live = engine.useValue((x) => x.live);
  const lines = engine.useValue((x) => x.liveLines);
  const level = engine.useValue((x) => x.liveLevel);
  const speech = engine.useValue((x) => x.liveSpeech);
  const available = engine.useValue((x) => x.available);
  const device = engine.useValue((x) => x.device);
  const installedIds = engine.useValue((x) => x.installedIds);
  const pair = usePairAvailability();
  const [levels, setLevels] = useState<number[]>(() => Array(40).fill(0));
  const [problem, setProblem] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [gainDraft, setGainDraft] = useState<number | null>(null);

  const running = !['idle', 'error', 'projection_stopped', 'stopped'].includes(live.state);
  const paused = live.state === 'paused';

  useEffect(() => {
    if (!running) return;
    // Sample the latest captured level straight from the store (no ref writes during render).
    const t = setInterval(() => setLevels((l) => [...l.slice(1), engine.get().liveLevel]), 100);
    return () => clearInterval(t);
  }, [running]);

  const last = lines[lines.length - 1];
  const copy = LIVE_STATE_COPY[live.state] ?? LIVE_STATE_COPY.idle;
  const target = getLanguage(s.targetLang);
  const asrName = [s.asrModelId, 'asr-whisper-base', 'asr-whisper-tiny', 'asr-whisper-small'].map((id) => id && installedIds.has(id) ? getCatalogModel(id)?.title : null).find(Boolean);

  const start = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await startLive(s.liveSource, s.liveOverlay);
      if (!r.ok) setProblem({ code: r.reason === 'permission' ? 'permission_mic' : r.reason === 'missing_models' ? 'missing_models' : r.reason === 'consent_denied' ? 'consent_denied' : 'unsupported_language', message: r.message });
    } catch (e) {
      setProblem({ code: 'service_stopped', message: nativeErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const swapDisabled = s.sourceLang === 'auto' || s.targetLang === 'hinglish';

  return (
    <Screen header={<AppHeader status={<Pill label={running ? copy.title : 'Ready'} tone={running ? (copy.tone === 'neutral' ? 'neutral' : copy.tone) : 'neutral'} />} right={<HeaderMenu />} />}>
      {!available ? <NativeUnavailable /> : null}
      <WarningsHost />
      <ScreenTitle title="Live Translator" subtitle="Real-time audio translation with on-device AI." />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <LangBox label="From (Source)" value={languageName(s.sourceLang)} onPress={() => router.push('/language')} />
        <Pressable onPress={() => !swapDisabled && updateSettings({ sourceLang: s.targetLang, targetLang: s.sourceLang })} accessibilityRole="button" accessibilityLabel="Swap languages" accessibilityState={{ disabled: swapDisabled }} style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', opacity: swapDisabled ? 0.4 : 1 }}>
          <Icon name="swap" color={colors.accent} />
        </Pressable>
        <LangBox label="To (Target)" value={languageName(s.targetLang)} onPress={() => router.push('/language')} />
      </View>

      <View style={{ marginTop: space.lg, gap: space.sm }}>
        <Segmented
          label="Translate from"
          value={s.liveSource}
          onChange={(k) => !running && updateSettings({ liveSource: k })}
          options={[
            { key: 'screen', label: 'Subtitles', disabled: !!device && !device.playbackCaptureSupported },
            { key: 'playback', label: 'App audio', disabled: !!device && !device.playbackCaptureSupported },
            { key: 'mic', label: 'Microphone' },
          ]}
        />
        <T v="caption" color={colors.textMuted}>
          {SOURCE_HELP[s.liveSource]}
        </T>
        {s.liveSource !== 'mic' ? (
          <Slider
            label="Voice boost"
            value={gainDraft ?? s.voiceGainDb}
            min={0}
            max={12}
            step={1}
            formatValue={(v) => `+${Math.round(v)} dB`}
            onChange={setGainDraft}
            onCommit={(v) => { setGainDraft(null); updateSettings({ voiceGainDb: Math.round(v) }); }}
          />
        ) : null}
      </View>

      {problem ? <ErrorState code={problem.code} message={problem.message} onRetry={start} onDismiss={() => setProblem(null)} /> : null}
      {live.state === 'capture_silent' || live.state === 'mic_silent' || live.state === 'projection_stopped' || live.state === 'screen_blocked' || live.state === 'no_subtitles' || live.state === 'error' ? (
        <ErrorState code={live.state === 'error' ? 'service_stopped' : live.state} message={live.message} onRetry={start} />
      ) : null}

      <Card style={{ marginTop: space.md, paddingVertical: space.xl }}>
        {s.liveSource === 'screen' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Icon name="captions" color={running && !paused ? colors.accent : colors.textMuted} />
            <T v="body" color={colors.textMuted} style={{ flex: 1 }}>
              {running ? (paused ? 'Paused.' : 'Reading subtitles from the screen. Keep the video app open with CC on — you can lower its volume freely.') : 'No audio is needed: DubiX reads the subtitles shown by the app and speaks the translation.'}
            </T>
          </View>
        ) : (
          <LevelMeter levels={levels} active={running && !paused} />
        )}
      </Card>

      <View style={{ flexDirection: isTablet ? 'row' : 'column', gap: space.md, marginTop: space.md }}>
        <Card style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T v="label" color={colors.textMuted}>
              {s.liveSource === 'screen' ? 'SUBTITLE' : 'ORIGINAL SPEECH'} {last ? `(${last.sourceLang.toUpperCase()})` : ''}
            </T>
            {running ? <Pill label={s.liveSource !== 'screen' && speech ? 'Hearing speech' : 'Live'} tone="accent" icon="dot" /> : null}
          </View>
          <T v="title" style={{ marginTop: space.sm, borderLeftWidth: 3, borderLeftColor: colors.surfacePressed, paddingLeft: space.md, fontSize: 19, lineHeight: 26 }} accessibilityLiveRegion="polite">
            {last?.sourceText ?? (running ? (s.liveSource === 'screen' ? 'Waiting for subtitles on screen…' : speech ? 'Listening to speech…' : 'Waiting for speech…') : s.liveSource === 'screen' ? 'Start, then play a video with subtitles (CC) turned on.' : 'Start to see recognized speech here.')}
          </T>
        </Card>
        <Card style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T v="label" color={colors.textMuted}>
              TRANSLATION ({(target?.name ?? s.targetLang).toUpperCase()})
            </T>
            {last ? <Pill label="On-device" tone="success" /> : null}
          </View>
          <T v="title" style={{ marginTop: space.sm, borderLeftWidth: 3, borderLeftColor: colors.success, paddingLeft: space.md, fontSize: 19, lineHeight: 26, writingDirection: target?.rtl ? 'rtl' : 'auto' }} accessibilityLiveRegion="polite">
            {last ? displayTranslation(last.translatedText, s.targetLang, s.hinglishStyle, last.sourceText) : '—'}
          </T>
        </Card>
      </View>

      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
        {running ? (
          <>
            <Button label={paused ? 'Resume' : 'Pause'} icon={paused ? 'play' : 'pause'} variant="secondary" onPress={() => setLivePaused(!paused)} style={{ flex: 1 }} />
            <Button label="Stop" icon="stop" variant="danger" onPress={stopLive} style={{ flex: 1 }} />
          </>
        ) : (
          <Button label="Start" icon="play" onPress={start} loading={busy} disabled={!available} style={{ flex: 1 }} />
        )}
      </View>

      <Card style={{ marginTop: space.md, gap: space.xs }}>
        <OptionRow icon="volume" title="Voice output" body="Speak translations with the offline voice. On the microphone, listening pauses while it speaks so it never re-translates itself." value={s.liveSpeak} onChange={(v) => { updateSettings({ liveSpeak: v }); if (running) DubixNative?.setLiveOptions(v, null); }} />
        <OptionRow icon="captions" title="Show subtitles" body="Translated text here and in the floating controller." value={s.liveCaptions} onChange={(v) => { updateSettings({ liveCaptions: v }); if (running) DubixNative?.setLiveOptions(null, v); }} />
        <OptionRow icon="pip" title="Floating controller" body="Control translation over other apps." value={s.liveOverlay} onChange={(v) => { updateSettings({ liveOverlay: v }); if (running) DubixNative?.setFloatingControllerVisible(v); }} />
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md }}>
        <Stat icon="bolt" label="Processing delay" value={last ? `${Math.round(last.avgLatencyMs)} ms` : '—'} hint={s.liveSource === 'screen' ? 'Measured: subtitle seen → voice starts' : 'Measured: end of speech → translated text'} />
        <Stat icon={s.liveSource === 'mic' ? 'mic' : s.liveSource === 'screen' ? 'captions' : 'phone'} label="Source" value={s.liveSource === 'mic' ? 'Microphone' : s.liveSource === 'screen' ? 'On-screen subtitles' : 'App audio'} hint={running ? copy.title : 'Off'} />
        {s.liveSource !== 'screen' ? <Stat icon="waveform" label="Input level" value={running ? dbfs(level) : '—'} hint={running ? (speech ? 'Speech detected' : 'No speech') : 'Not capturing'} /> : null}
        <Stat icon="chip" label="AI models" value={pair.status === 'ready' ? 'Ready' : pair.status === 'download' ? 'Setup needed' : 'Unsupported'} hint={s.liveSource === 'screen' ? 'Text recognition (built in)' : asrName ?? 'No speech model'} />
      </View>
      {last?.droppedAudio ? (
        <T v="caption" color={colors.warning} style={{ marginTop: space.sm }}>
          {last.droppedAudio} line(s) were captioned without voice so speech stays close to real time.
        </T>
      ) : null}

      {lines.length > 1 ? (
        <Card style={{ marginTop: space.md }}>
          <T v="label" color={colors.textMuted} style={{ marginBottom: space.sm }}>
            EARLIER LINES (KEPT IN MEMORY ONLY)
          </T>
          {lines
            .slice(-8, -1)
            .reverse()
            .map((l) => (
              <View key={l.id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <T v="caption" color={colors.textMuted}>
                  {l.sourceText}
                </T>
                <T v="body">{displayTranslation(l.translatedText, s.targetLang, s.hinglishStyle, l.sourceText)}</T>
              </View>
            ))}
        </Card>
      ) : null}
    </Screen>
  );
}

const SOURCE_HELP: Record<'mic' | 'playback' | 'screen', string> = {
  screen:
    'Fastest and works with the video muted: DubiX reads the subtitles (CC) shown at the bottom of the screen and speaks them translated. Turn subtitles on in the video app. With the microphone permission it also listens to the app’s voices (even at low volume) to choose a male or female voice per line — an estimate from voice pitch. Apps that protect their video (most paid streaming services) show black to screen capture, so their subtitles cannot be read — DubiX does not bypass that.',
  playback:
    'Android 10+ captures the audio of apps that allow it, with your consent each session. Lowering the volume inside that app can make capture too quiet to understand — use Subtitles mode instead. DRM-protected content stays silent. Android does not let DubiX mute another app.',
  mic: 'Listens to speech around you through the microphone. Background noise and echo reduce accuracy.',
};

function LangBox({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} style={[{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: space.md, flexDirection: 'row', alignItems: 'center', gap: space.sm }, cardShadow()]}>
      <Icon name="translate" size={20} />
      <View style={{ flex: 1 }}>
        <T v="caption" color={colors.textMuted}>
          {label}
        </T>
        <T v="cardTitle" numberOfLines={1}>
          {value}
        </T>
      </View>
      <Icon name="chevron-down" color={colors.textMuted} size={18} />
    </Pressable>
  );
}

function OptionRow({ icon, title, body, value, onChange }: { icon: IconName; title: string; body: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <Icon name={icon} color={colors.textMuted} />
      <View style={{ flex: 1 }}>
        <T v="bodyStrong">{title}</T>
        <T v="caption" color={colors.textMuted}>
          {body}
        </T>
      </View>
      <Toggle value={value} onChange={onChange} label={title} />
    </View>
  );
}

function Stat({ icon, label, value, hint }: { icon: IconName; label: string; value: string; hint: string }) {
  return (
    <Card style={{ flexGrow: 1, flexBasis: '46%', flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md }}>
      <Icon name={icon} color={colors.accent} />
      <View style={{ flex: 1 }}>
        <T v="caption" color={colors.textMuted}>
          {label}
        </T>
        <T v="cardTitle" numberOfLines={1}>
          {value}
        </T>
        <T v="caption" color={colors.textMuted} numberOfLines={1}>
          {hint}
        </T>
      </View>
    </Card>
  );
}
