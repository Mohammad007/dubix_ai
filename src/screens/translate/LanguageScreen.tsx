import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { Button, Card, Icon, PickerSheet, Pill, Radio, Screen, ScreenTitle, SectionHeader, T } from '@/components/ui';
import type { LanguageAvailability } from '@/domain/compatibility';
import type { HinglishStyle } from '@/domain/hinglish';
import { AUTO_DETECT, languageName, SOURCE_LANGUAGES } from '@/domain/languages';
import { useLanguageAvailability } from '@/hooks/useAvailability';
import { useLayout } from '@/hooks/useLayout';
import { installModel } from '@/services/models';
import { engine } from '@/store/engine';
import { updateSettings, useSettings } from '@/store/settings';
import { cardShadow, colors, radius, space, TOUCH } from '@/theme/tokens';

export default function LanguageScreen() {
  const s = useSettings();
  const [target, setTarget] = useState(s.targetLang);
  const [query, setQuery] = useState('');
  const all = useLanguageAvailability(s.sourceLang);
  const selected = all.find((a) => a.language.code === target);
  const missing = selected?.requirements.filter((r) => !r.satisfied && r.installId) ?? [];

  const confirm = () => {
    updateSettings({ targetLang: target });
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <Screen
      footer={
        <Button
          label={selected?.status === 'ready' ? 'Continue' : selected?.status === 'download' ? `Download ${missing.length} pack(s) & continue` : 'Not available on this device'}
          icon={selected?.status === 'ready' ? 'play' : 'download'}
          disabled={!selected || selected.status === 'unavailable'}
          onPress={() => {
            if (selected?.status === 'download') {
              missing.forEach((m) => installModel(m.installId!));
              updateSettings({ targetLang: target });
              router.replace('/models');
              return;
            }
            confirm();
          }}
        />
      }
    >
      <ScreenTitle title="Choose Language" back />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.md }}>
        <Icon name="search" color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search language"
          placeholderTextColor={colors.textFaint}
          accessibilityLabel="Search language"
          style={{ flex: 1, minHeight: TOUCH, color: colors.text, fontSize: 15, fontFamily: 'Inter_400Regular' }}
        />
      </View>
      <SourceLanguagePicker />
      <SectionHeader title="Translate To" />
      <TargetLanguageList availability={all} query={query} value={target} onChange={setTarget} />
      {target === 'hinglish' ? <HinglishStyleCard /> : null}
      {selected ? <PackRequirements a={selected} /> : null}
    </Screen>
  );
}

export function SourceLanguagePicker() {
  const s = useSettings();
  const [open, setOpen] = useState(false);
  return (
    <>
      <SectionHeader title="Source Language" />
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Source language: ${languageName(s.sourceLang)}. Change`}
        style={[{ flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg }, cardShadow()]}
      >
        <LangBadge text={s.sourceLang === AUTO_DETECT ? 'Aあ' : s.sourceLang.toUpperCase()} />
        <View style={{ flex: 1 }}>
          <T v="cardTitle">{s.sourceLang === AUTO_DETECT ? 'Auto-detect' : languageName(s.sourceLang)}</T>
          <T v="caption" color={colors.textMuted}>
            {s.sourceLang === AUTO_DETECT ? 'Detects the spoken language of each line' : 'Forces recognition in this language (more accurate when known)'}
          </T>
        </View>
        <Icon name="chevron-down" color={colors.textMuted} />
      </Pressable>
      <PickerSheet
        visible={open}
        title="Source language"
        selected={s.sourceLang}
        onClose={() => setOpen(false)}
        options={[{ key: AUTO_DETECT, title: 'Auto-detect', subtitle: 'Recommended for mixed-language films' }, ...SOURCE_LANGUAGES.map((l) => ({ key: l.code, title: l.name, subtitle: l.native }))]}
        onSelect={(k) => updateSettings({ sourceLang: k })}
      />
    </>
  );
}

export function TargetLanguageList({ availability, query = '', value, onChange }: { availability: LanguageAvailability[]; query?: string; value: string; onChange: (code: string) => void }) {
  const s = useSettings();
  const { columns } = useLayout();
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => availability.filter((a) => !q || a.language.name.toLowerCase().includes(q) || a.language.native.toLowerCase().includes(q) || a.language.code.startsWith(q)),
    [availability, q],
  );
  const offered = filtered.filter((a) => a.status !== 'unavailable' && a.language.code !== s.sourceLang);
  const unavailable = filtered.filter((a) => a.status === 'unavailable');
  return (
    <>
      <View style={{ flexDirection: columns > 1 ? 'row' : 'column', flexWrap: 'wrap', gap: space.sm }}>
        {offered.map((a) => (
          <LanguageRow key={a.language.code} a={a} selected={value === a.language.code} onPress={() => onChange(a.language.code)} half={columns > 1} />
        ))}
      </View>
      {unavailable.length ? (
        <>
          <T v="label" color={colors.textMuted} style={{ marginTop: space.lg, marginBottom: space.sm }}>
            NOT AVAILABLE ON THIS DEVICE
          </T>
          {unavailable.map((a) => (
            <View key={a.language.code} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, opacity: 0.75 }}>
              <LangBadge text={a.language.short} muted />
              <View style={{ flex: 1 }}>
                <T v="bodyStrong">
                  {a.language.name} · {a.language.native}
                </T>
                <T v="caption" color={colors.textMuted}>
                  {a.reason}
                </T>
              </View>
            </View>
          ))}
        </>
      ) : null}
    </>
  );
}

const HINGLISH_STYLES: { key: HinglishStyle; title: string; example: string }[] = [
  { key: 'devanagari', title: 'Hindi script', example: 'हम पाँच मिनट में स्टेशन पहुँचेंगे।' },
  { key: 'roman', title: 'Roman Hindi', example: 'Hum paanch minat mein steshan pahunchenge.' },
  { key: 'hinglish', title: 'Hinglish style', example: 'Hum paanch minute mein station pahunchenge.' },
];

export function HinglishStyleCard() {
  const s = useSettings();
  return (
    <Card style={{ marginTop: space.md, gap: space.sm }}>
      <T v="cardTitle">Hinglish output style</T>
      <T v="caption" color={colors.textMuted}>
        Hinglish is a local layer on top of the Hindi translator (not a separate ML model). The voice speaks Hindi; this choice controls how captions are written.
      </T>
      {HINGLISH_STYLES.map((o) => (
        <Pressable
          key={o.key}
          onPress={() => updateSettings({ hinglishStyle: o.key })}
          accessibilityRole="radio"
          accessibilityState={{ checked: s.hinglishStyle === o.key }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm }}
        >
          <Radio selected={s.hinglishStyle === o.key} />
          <View style={{ flex: 1 }}>
            <T v="bodyStrong">{o.title}</T>
            <T v="caption" color={colors.textMuted}>
              {o.example}
            </T>
          </View>
        </Pressable>
      ))}
    </Card>
  );
}

export function PackRequirements({ a }: { a: LanguageAvailability }) {
  const downloads = engine.useValue((x) => x.downloads);
  return (
    <Card style={{ marginTop: space.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="download" color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <T v="cardTitle">Offline language packs</T>
          <T v="caption" color={colors.textMuted}>
            Downloaded once; translation and dubbing then work without internet.
          </T>
        </View>
      </View>
      <View style={{ marginTop: space.sm }}>
        {a.requirements.map((r) => {
          const d = r.installId ? downloads[r.installId] : undefined;
          const busy = d && (d.state === 'downloading' || d.state === 'queued' || d.state === 'installing');
          return (
            <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, gap: space.sm }}>
              <T v="body" style={{ flex: 1 }}>
                {r.label}
              </T>
              {r.satisfied ? (
                <Pill label="Installed" tone="success" />
              ) : busy ? (
                <Pill label={d.total > 0 ? `Downloading ${Math.round((d.bytes / d.total) * 100)}%` : 'Downloading'} tone="accent" icon="download" />
              ) : (
                <Button label={d?.state === 'error' ? 'Retry' : 'Get'} icon="download" compact variant="secondary" onPress={() => r.installId && installModel(r.installId)} />
              )}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function LangBadge({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <View style={{ width: 48, height: 40, borderRadius: radius.sm, backgroundColor: muted ? colors.surfaceAlt : colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
      <T v="bodyStrong" color={muted ? colors.textMuted : colors.accent}>
        {text}
      </T>
    </View>
  );
}

function LanguageRow({ a, selected, onPress, half }: { a: LanguageAvailability; selected: boolean; onPress: () => void; half: boolean }) {
  const ready = a.status === 'ready';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${a.language.name}, ${ready ? 'ready offline' : 'download needed'}`}
      style={[
        { width: half ? '49%' : '100%', flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: selected ? 1.5 : 1, borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accentSoft : colors.surface },
        !selected && cardShadow(),
      ]}
    >
      <LangBadge text={a.language.short} />
      <View style={{ flex: 1 }}>
        <T v="cardTitle">{a.language.name}</T>
        <T v="caption" color={colors.textMuted} style={{ writingDirection: a.language.rtl ? 'rtl' : 'auto' }}>
          {a.language.native}
        </T>
      </View>
      <Pill label={ready ? (a.voiceSource === 'system' ? 'Ready · system voice' : 'Ready') : 'Download'} tone={ready ? 'success' : 'neutral'} showIcon={ready} />
      <Radio selected={selected} />
    </Pressable>
  );
}
