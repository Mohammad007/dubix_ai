import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { DubixNative } from 'dubix-native';

import {
  AppHeader, Banner, Button, Card, EmptyState, HeaderMenu, Icon, IconTile, OfflineStatusPill, PickerSheet, Pill, Screen, ScreenTitle,
  SectionHeader, Slider, T, WarningsHost, type IconName,
} from '@/components/ui';
import type { SpeakerRow } from '@/database';
import { languageName } from '@/domain/languages';
import { maxPauseSec } from '@/domain/sync';
import { availableVoices, registerLabel, voiceForRegister, type VoiceChoice } from '@/domain/voiceMapping';
import { useLayout } from '@/hooks/useLayout';
import { saveSpeakerVoices, sessions } from '@/services/dubbing';
import { engine } from '@/store/engine';
import { getSettings, updateSettings, useSettings } from '@/store/settings';
import { cardShadow, colors, radius, space, TOUCH } from '@/theme/tokens';
import { nativeErrorMessage } from '@/utils/nativeError';

const SAMPLE: Record<string, string> = {
  hi: 'नमस्ते, यह आपकी चुनी हुई आवाज़ का एक नमूना है।',
  hinglish: 'नमस्ते, यह आपकी चुनी हुई आवाज़ का एक नमूना है।',
  ur: 'السلام علیکم، یہ آپ کی منتخب آواز کا نمونہ ہے۔',
  es: 'Hola, esta es una muestra de la voz seleccionada.',
  ar: 'مرحبا، هذه عينة من الصوت المختار.',
  en: 'This is a preview of the selected voice settings for your dubbed content.',
};

/** Remounts the editor when the movie, its speaker count or the target language changes, so local edits start from fresh data. */
export default function VoiceStudioScreen() {
  const s = useSettings();
  const active = sessions.useValue((x) => x.active);
  const target = active?.session.targetLang ?? s.targetLang;
  return <VoiceStudioBody key={`${active?.session.id ?? 'none'}:${active?.speakers.length ?? 0}:${target}`} />;
}

function VoiceStudioBody() {
  const s = useSettings();
  const { columns } = useLayout();
  const active = sessions.useValue((x) => x.active);
  const installedIds = engine.useValue((x) => x.installedIds);
  const systemVoices = engine.useValue((x) => x.systemVoices);
  const target = active?.session.targetLang ?? s.targetLang;
  const voices = useMemo(() => availableVoices(target, installedIds, systemVoices), [target, installedIds, systemVoices]);

  const [rows, setRows] = useState<SpeakerRow[]>(() =>
    active?.speakers.length ? active.speakers : [{ sessionId: '', speaker: 0, label: 'Default voice', voiceKey: s.defaultVoiceKey, pitch: 0, speed: 1 }],
  );
  const [selected, setSelected] = useState(0);
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [previewText, setPreviewText] = useState(SAMPLE[target] ?? SAMPLE.en);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [askRegenerate, setAskRegenerate] = useState(false);


  const segCount = (sp: number) => active?.segments.filter((x) => x.speaker === sp).length ?? 0;
  const dominantRegister = (sp: number) => {
    const counts = { low: 0, high: 0, neutral: 0 };
    active?.segments.filter((x) => x.speaker === sp).forEach((x) => counts[x.register]++);
    return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'neutral') as 'low' | 'high' | 'neutral';
  };
  const voiceFor = (r: SpeakerRow): VoiceChoice | undefined => voices.find((v) => v.key === r.voiceKey);
  const autoVoice = (r: SpeakerRow) => {
    const spec = voiceForRegister(active ? dominantRegister(r.speaker) : 'neutral', voices);
    return voices.find((x) => x.spec.modelId === spec?.modelId && x.spec.systemVoice === spec?.systemVoice);
  };

  const cur = rows[selected];
  const patch = (p: Partial<SpeakerRow>) => {
    setSaved(null);
    setRows((rs) => rs.map((r, i) => (i === selected ? { ...r, ...p } : r)));
  };

  const preview = async () => {
    if (!DubixNative || !cur) return;
    const choice = voiceFor(cur) ?? autoVoice(cur) ?? voices[0];
    if (!choice) return;
    setPreviewing(true);
    setError(null);
    try {
      const out = await DubixNative.synthesize({ text: previewText, voice: { ...choice.spec, pitch: cur.pitch, speed: cur.speed * getSettings().voiceSpeed }, maxPauseSec: maxPauseSec(s.silenceTrim) });
      await DubixNative.playPreview(out.path);
    } catch (e) {
      setError(nativeErrorMessage(e));
    } finally {
      setPreviewing(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      if (!active) {
        updateSettings({ defaultVoiceKey: rows[0]?.voiceKey ?? null });
        setSaved('Default voice saved. It is used for new dubs and live translation.');
        return;
      }
      const changed = rows.filter((r) => {
        const old = active.speakers.find((o) => o.speaker === r.speaker);
        return !old || old.voiceKey !== r.voiceKey || old.pitch !== r.pitch || old.speed !== r.speed;
      });
      await saveSpeakerVoices(rows, false);
      setSaved('Voice mapping saved for this movie. New lines use it.');
      if (changed.some((r) => segCount(r.speaker) > 0)) setAskRegenerate(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen header={<AppHeader status={<OfflineStatusPill />} right={<HeaderMenu />} />} footer={<Button label={active ? 'Save Voice Mapping' : 'Save Default Voice'} icon="check" onPress={save} loading={saving} disabled={!voices.length} />}>
      <WarningsHost />
      <ScreenTitle
        title="AI Voice Studio"
        subtitle={active ? `Assign speakers, fine-tune voices and preview the result for “${active.session.name}”.` : `Choose the default ${languageName(target)} voice. Open a movie to assign voices per speaker.`}
      />
      {!voices.length ? (
        <Banner tone="accent" title={`No offline ${languageName(target)} voice installed`} body="Download a voice pack, or install an offline voice in Android Settings › Text-to-speech. Only voices that can really be synthesized are listed." action="Get voices" onAction={() => router.push('/models')} />
      ) : null}
      {error ? <Banner tone="warning" title="Couldn’t play this voice" body={error} action="Get voices" onAction={() => router.push('/models')} onDismiss={() => setError(null)} /> : null}
      {saved ? <Banner tone="success" title={saved} onDismiss={() => setSaved(null)} /> : null}
      {askRegenerate ? (
        <Banner
          tone="accent"
          title="Re-voice existing lines?"
          body="Lines already dubbed for the changed speakers can be regenerated with the new voice now."
          action="Regenerate now"
          onAction={() => {
            setAskRegenerate(false);
            saveSpeakerVoices(rows, true);
          }}
          onDismiss={() => setAskRegenerate(false)}
        />
      ) : null}
      {active?.regenerating ? <Banner tone="accent" title={active.regenerating.label} body={`${active.regenerating.done} of ${active.regenerating.total} lines`} /> : null}

      <SectionHeader title="Speaker Assignment" action="How it works" icon="info" onAction={() => setInfoOpen(true)} />
      {active && active.speakers.length === 0 ? (
        <EmptyState icon="users" title="No speakers yet" body="Speakers appear as dubbing detects them. Without the Speaker Detection pack, all dialogue is one speaker; you can still reassign lines in Session details." />
      ) : null}
      <View style={{ flexDirection: columns > 1 ? 'row' : 'column', flexWrap: 'wrap', gap: space.sm }}>
        {rows.map((r, i) => {
          const v = voiceFor(r);
          const auto = autoVoice(r);
          const reg = active ? dominantRegister(r.speaker) : null;
          return (
            <Pressable
              key={r.speaker}
              onPress={() => setSelected(i)}
              accessibilityRole="radio"
              accessibilityState={{ checked: i === selected }}
              accessibilityLabel={`${r.label}, ${v ? v.label : `automatic, ${auto?.label ?? 'no voice'}`}`}
              style={[{ width: columns > 1 ? '49%' : '100%', flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: i === selected ? 1.5 : 1, borderColor: i === selected ? colors.accent : colors.border, backgroundColor: colors.surface }, cardShadow()]}
            >
              <View style={{ width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="user-voice" color={colors.accent} size={28} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <T v="cardTitle">{r.label}</T>
                <Pill label={v ? v.label : `Auto · ${auto?.label ?? 'no voice'}`} tone="accent" icon="waveform" />
                {reg ? (
                  <T v="caption" color={colors.textMuted}>
                    {registerLabel(reg)} · {segCount(r.speaker)} lines
                  </T>
                ) : null}
              </View>
              <Button label="Edit" icon="edit" variant="secondary" compact onPress={() => { setSelected(i); setPickerFor(i); }} disabled={!voices.length} />
            </Pressable>
          );
        })}
      </View>

      {cur ? (
        <>
          <SectionHeader title="Voice Controls" action="Reset" icon="sync" onAction={() => patch({ pitch: 0, speed: 1 })} />
          <Card style={{ gap: space.md }}>
            <ControlRow icon="audio-wave" title="Pitch" subtitle="Voice highness or lowness" value={`${cur.pitch > 0 ? '+' : ''}${cur.pitch.toFixed(1)}`}>
              <Slider label="Pitch" value={cur.pitch} min={-6} max={6} step={0.5} onChange={(v) => patch({ pitch: v })} formatValue={(v) => `${v} semitones`} />
            </ControlRow>
            <ControlRow icon="speed" title="Speed" subtitle="Speaking rate before sync fitting" value={`${cur.speed.toFixed(2)}×`}>
              <Slider label="Speed" value={cur.speed} min={0.8} max={1.25} step={0.05} onChange={(v) => patch({ speed: v })} formatValue={(v) => `${v.toFixed(2)} times`} />
            </ControlRow>
            <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center', opacity: 0.6 }}>
              <IconTile icon="sparkles" />
              <View style={{ flex: 1 }}>
                <T v="cardTitle">Expressiveness</T>
                <T v="caption" color={colors.textMuted}>
                  Not supported by the installed offline voices (Piper/VITS and Android TTS have no emotion control), so it is disabled.
                </T>
              </View>
            </View>
          </Card>
        </>
      ) : null}

      <SectionHeader title="Preview Text" />
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Icon name="file" color={colors.textMuted} />
        <TextInput value={previewText} onChangeText={setPreviewText} multiline accessibilityLabel="Preview text" style={{ flex: 1, color: colors.text, fontSize: 14, fontFamily: 'Inter_400Regular', minHeight: TOUCH }} placeholderTextColor={colors.textFaint} />
        <Button label="Play" icon="play" variant="ghost" compact onPress={preview} loading={previewing} disabled={!voices.length || !previewText.trim()} />
      </Card>

      <PickerSheet<string>
        visible={pickerFor !== null}
        title={`Voice for ${rows[pickerFor ?? 0]?.label ?? ''}`}
        selected={rows[pickerFor ?? 0]?.voiceKey ?? 'auto'}
        onClose={() => setPickerFor(null)}
        options={[
          { key: 'auto', title: 'Automatic suggestion', subtitle: 'Suggests a lower or higher voice from this speaker’s pitch. It does not decide anyone’s gender; change it whenever it does not fit.' },
          ...voices.map((v) => ({ key: v.key, title: v.label, subtitle: v.spec.engine === 'sherpa' ? 'Downloaded neural voice' : 'Installed Android voice (offline)' })),
        ]}
        onSelect={(k) => patch({ voiceKey: k === 'auto' ? null : k })}
      />
      <PickerSheet
        visible={infoOpen}
        title="How speaker voices work"
        onClose={() => setInfoOpen(false)}
        options={[
          { key: '1', title: 'Speakers are grouped on device', subtitle: 'A speaker-embedding model clusters lines that sound like the same person. It can merge or split similar voices; fix lines in Session details.' },
          { key: '2', title: 'You choose each voice', subtitle: 'Pitch only suggests a lower or higher voice. Pick any voice style for any speaker.' },
          { key: '3', title: 'Timing, not lip-sync', subtitle: 'Dubbed lines are fitted to each dialogue window. Mouth movements in the video are not changed.' },
        ]}
        onSelect={() => undefined}
      />
    </Screen>
  );
}

function ControlRow({ icon, title, subtitle, value, children }: { icon: IconName; title: string; subtitle: string; value: string; children: ReactNode }) {
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <IconTile icon={icon} />
        <View style={{ flex: 1 }}>
          <T v="cardTitle">{title}</T>
          <T v="caption" color={colors.textMuted}>
            {subtitle}
          </T>
        </View>
        <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4 }}>
          <T v="mono">{value}</T>
        </View>
      </View>
      {children}
    </View>
  );
}
