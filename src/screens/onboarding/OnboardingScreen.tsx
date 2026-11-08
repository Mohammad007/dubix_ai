import { router } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BackHandler, View } from 'react-native';

import { Banner, Button, Card, Icon, IconTile, Logo, Pill, ProgressBar, Screen, T, type IconName } from '@/components/ui';
import { SUPPORTED_ABIS, recommendedAsr } from '@/domain/compatibility';
import { getCatalogModel, TRANSLATION_PACK_APPROX_BYTES } from '@/domain/modelCatalog';
import { PROFILES, recommendProfile } from '@/domain/performance';
import { useLanguageAvailability, usePairAvailability } from '@/hooks/useAvailability';
import { SourceLanguagePicker, TargetLanguageList, HinglishStyleCard } from '@/screens/translate/LanguageScreen';
import { applyProfile } from '@/screens/settings/SettingsScreen';
import { installModel } from '@/services/models';
import { engine } from '@/store/engine';
import { updateSettings, useSettings } from '@/store/settings';
import { colors, radius, space } from '@/theme/tokens';
import { formatBytes } from '@/utils/format';

const STEPS = ['welcome', 'how', 'language', 'device', 'models', 'progress', 'done'] as const;
type Step = (typeof STEPS)[number];

/** First-run setup. No login or signup; every step can be revisited later in Settings. */
export default function OnboardingScreen() {
  const [step, setStep] = useState<Step>('welcome');
  const idx = STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, idx + 1)]);
  const back = () => setStep(STEPS[Math.max(0, idx - 1)]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (idx === 0) return false;
      back();
      return true;
    });
    return () => sub.remove();
  });

  const finish = () => {
    updateSettings({ onboardingDone: true });
    router.replace('/');
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: space.lg, marginBottom: space.lg }} accessibilityLabel={`Step ${idx + 1} of ${STEPS.length}`}>
        {STEPS.map((s, i) => (
          <View key={s} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= idx ? colors.accent : colors.border }} />
        ))}
      </View>
      {step === 'welcome' ? <Welcome onNext={next} /> : null}
      {step === 'how' ? <HowItWorks onNext={next} onBack={back} /> : null}
      {step === 'language' ? <DefaultLanguage onNext={next} onBack={back} /> : null}
      {step === 'device' ? <DeviceCheck onNext={next} onBack={back} /> : null}
      {step === 'models' ? <RequiredModels onDownload={next} onSkip={() => setStep('done')} onBack={back} /> : null}
      {step === 'progress' ? <DownloadProgress onNext={next} /> : null}
      {step === 'done' ? <Complete onFinish={finish} /> : null}
    </Screen>
  );
}

function Nav({ onBack, onNext, nextLabel = 'Continue', nextDisabled }: { onBack?: () => void; onNext: () => void; nextLabel?: string; nextDisabled?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xl }}>
      {onBack ? <Button label="Back" variant="secondary" onPress={onBack} style={{ flex: 1 }} /> : null}
      <Button label={nextLabel} icon="next" onPress={onNext} disabled={nextDisabled} style={{ flex: 2 }} />
    </View>
  );
}

function Point({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
      <IconTile icon={icon} tone="accent" />
      <View style={{ flex: 1 }}>
        <T v="cardTitle">{title}</T>
        <T v="caption" color={colors.textMuted}>
          {body}
        </T>
      </View>
    </View>
  );
}

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <View style={{ gap: space.lg }}>
      <Logo size={72} />
      <T v="display">Welcome to DubiX AI</T>
      <T v="body" color={colors.textMuted} style={{ fontSize: 16, lineHeight: 24 }}>
        Translate movie dialogue and listen in AI voices, with everything processed on this phone. There is no account, no sign-up and no cloud.
      </T>
      <Card style={{ gap: space.md }}>
        <Point icon="shield" title="Private by design" body="Your videos and audio never leave the device." />
        <Point icon="wifi" title="Offline after setup" body="Download the language packs once; then it works without internet." />
        <Point icon="film" title="Your own videos" body="Use files you own or are authorized to use." />
      </Card>
      <Button label="Get started" icon="next" onPress={onNext} />
    </View>
  );
}

function HowItWorks({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <View style={{ gap: space.md }}>
      <T v="display">How it works</T>
      <Card style={{ gap: space.md }}>
        <Point icon="waveform" title="1. Listen" body="Finds dialogue in the movie’s audio track and recognizes speech on-device (Whisper)." />
        <Point icon="translate" title="2. Translate" body="Translates each line offline (Google ML Kit on-device translation)." />
        <Point icon="users" title="3. Voice" body="Speaks each line in an offline AI voice, with a different voice per speaker if you like." />
        <Point icon="timer" title="4. Sync" body="Fits each dubbed line to its dialogue timing. Lip movements in the video are not changed." />
      </Card>
      <Card tone="warning" style={{ gap: 6 }}>
        <T v="cardTitle">About other apps</T>
        <T v="caption" color={colors.textMuted}>
          Live translation can listen to other apps only on Android 10+, with your consent each time, and only when that app allows audio capture. Netflix, Prime Video and other DRM-protected services block it, and DubiX never bypasses that. The translated voice plays over the original; DubiX cannot mute another app.
        </T>
      </Card>
      <Nav onBack={onBack} onNext={onNext} />
    </View>
  );
}

function DefaultLanguage({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const s = useSettings();
  const all = useLanguageAvailability(s.sourceLang);
  return (
    <View>
      <T v="display">Default languages</T>
      <T v="body" color={colors.textMuted} style={{ marginTop: space.xs }}>
        You can change these any time. Languages are marked by what this device can support offline.
      </T>
      <SourceLanguagePicker />
      <T v="heading" style={{ marginTop: space.xl, marginBottom: space.md }}>
        Translate to
      </T>
      <TargetLanguageList availability={all} value={s.targetLang} onChange={(code) => updateSettings({ targetLang: code })} />
      {s.targetLang === 'hinglish' ? <HinglishStyleCard /> : null}
      <Nav onBack={onBack} onNext={onNext} nextDisabled={all.find((a) => a.language.code === s.targetLang)?.status === 'unavailable'} />
    </View>
  );
}

function DeviceCheck({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const device = engine.useValue((x) => x.device);
  const available = engine.useValue((x) => x.available);
  const profile = recommendProfile(device);
  const rows: { label: string; value: string; ok: boolean }[] = device
    ? [
        { label: 'Android version', value: `${device.release} (API ${device.apiLevel})`, ok: device.apiLevel >= 26 },
        { label: 'CPU architecture', value: device.abis[0] ?? 'unknown', ok: device.abis.some((a) => SUPPORTED_ABIS.includes(a)) },
        { label: 'Memory', value: `${(device.totalRamMb / 1024).toFixed(1)} GB RAM${device.lowRamDevice ? ' (low-RAM device)' : ''}`, ok: device.totalRamMb >= 2000 },
        { label: 'Free storage', value: formatBytes(device.storageFreeBytes), ok: device.storageFreeBytes > 1.5 * 1024 ** 3 },
        { label: 'App-audio capture', value: device.playbackCaptureSupported ? 'Available (depends on each app)' : 'Needs Android 10+', ok: true },
      ]
    : [];
  return (
    <View style={{ gap: space.md }}>
      <T v="display">Device compatibility</T>
      {!available ? <Banner tone="danger" title="Native engine missing" body="This build cannot run the on-device engine. Install a development or release build." /> : null}
      <Card style={{ gap: space.md }}>
        {rows.map((r) => (
          <View key={r.label} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Icon name={r.ok ? 'check-circle' : 'warning'} color={r.ok ? colors.success : colors.warning} />
            <T v="bodyStrong" style={{ flex: 1 }}>
              {r.label}
            </T>
            <T v="body" color={colors.textMuted}>
              {r.value}
            </T>
          </View>
        ))}
      </Card>
      {device ? (
        <Card tone="accent" style={{ gap: 4 }}>
          <T v="cardTitle">Recommended profile: {PROFILES[profile].label}</T>
          <T v="caption" color={colors.textMuted}>
            {PROFILES[profile].description} Auto mode refines this after your first dub, from measured speed.
          </T>
        </Card>
      ) : null}
      <Nav
        onBack={onBack}
        onNext={() => {
          applyProfile(profile);
          onNext();
        }}
      />
    </View>
  );
}

function RequiredModels({ onDownload, onSkip, onBack }: { onDownload: () => void; onSkip: () => void; onBack: () => void }) {
  const pair = usePairAvailability();
  const s = useSettings();
  const device = engine.useValue((x) => x.device);
  const installedIds = engine.useValue((x) => x.installedIds);
  const missing = pair.requirements.filter((r) => !r.satisfied && r.installId);
  // Prefer the speech model of the chosen profile.
  const asrId = s.asrModelId ?? recommendedAsr(device, installedIds).id;
  const ids = missing.map((r) => (r.key === 'asr' ? asrId : r.installId!));
  if (s.speakerDetection && !installedIds.has('speaker-campplus')) ids.push('speaker-campplus');
  const size = ids.reduce((sum, id) => sum + (id.startsWith('mlkit-') ? TRANSLATION_PACK_APPROX_BYTES : (getCatalogModel(id)?.sizeBytes ?? 0)), 0);

  return (
    <View style={{ gap: space.md }}>
      <T v="display">Offline models</T>
      <T v="body" color={colors.textMuted}>
        For {pair.language.name}, these packs are needed once. Downloads use {s.wifiOnlyDownloads ? 'Wi-Fi only' : 'any network'} and come from official sherpa-onnx releases and Google Play services.
      </T>
      <Card style={{ gap: space.sm }}>
        {ids.length === 0 ? (
          <T v="bodyStrong" color={colors.success}>
            Everything needed is already installed.
          </T>
        ) : (
          ids.map((id) => (
            <View key={id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
              <T v="body" style={{ flex: 1 }}>
                {id.startsWith('mlkit-') ? `Translation · ${id.slice(6).toUpperCase()}` : getCatalogModel(id)?.title}
              </T>
              <T v="caption" color={colors.textMuted}>
                {formatBytes(id.startsWith('mlkit-') ? TRANSLATION_PACK_APPROX_BYTES : (getCatalogModel(id)?.sizeBytes ?? 0))}
              </T>
            </View>
          ))
        )}
        {ids.length ? (
          <T v="caption" color={colors.textMuted}>
            Total ≈ {formatBytes(size)}
          </T>
        ) : null}
      </Card>
      {pair.status === 'unavailable' ? <Banner tone="danger" title={pair.reason ?? 'This language is not supported on this device.'} /> : null}
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
        <Button label="Back" variant="secondary" onPress={onBack} style={{ flex: 1 }} />
        <Button
          label={ids.length ? 'Download now' : 'Continue'}
          icon={ids.length ? 'download' : 'next'}
          style={{ flex: 2 }}
          disabled={pair.status === 'unavailable'}
          onPress={() => {
            ids.forEach(installModel);
            if (ids.length) onDownload();
            else onSkip();
          }}
        />
      </View>
      {ids.length ? <Button label="Skip for now (limited functionality)" variant="ghost" onPress={onSkip} /> : null}
    </View>
  );
}

function DownloadProgress({ onNext }: { onNext: () => void }) {
  const downloads = engine.useValue((x) => x.downloads);
  const pair = usePairAvailability();
  const items = useMemo(() => Object.values(downloads), [downloads]);
  const active = items.filter((d) => d.state === 'queued' || d.state === 'downloading' || d.state === 'installing');
  const failed = items.filter((d) => d.state === 'error');
  const total = items.reduce((s, d) => s + (d.total || 0), 0);
  const done = items.reduce((s, d) => s + (d.state === 'installed' ? d.total || 0 : d.bytes || 0), 0);
  return (
    <View style={{ gap: space.md }}>
      <T v="display">Downloading</T>
      <T v="body" color={colors.textMuted}>
        You can keep this screen open or continue; downloads keep running and resume if interrupted.
      </T>
      <Card style={{ gap: space.md }}>
        <ProgressBar value={total ? done / total : active.length ? 0 : 1} label="Overall download progress" />
        {items.map((d) => (
          <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <T v="body" style={{ flex: 1 }} numberOfLines={1}>
              {d.id.startsWith('mlkit-') ? `Translation · ${d.id.slice(6).toUpperCase()}` : (getCatalogModel(d.id)?.title ?? d.id)}
            </T>
            <Pill
              label={d.state === 'installed' ? 'Installed' : d.state === 'error' ? 'Failed' : d.state === 'installing' ? 'Verifying' : d.total ? `${Math.round((d.bytes / d.total) * 100)}%` : 'Waiting'}
              tone={d.state === 'installed' ? 'success' : d.state === 'error' ? 'danger' : 'accent'}
            />
          </View>
        ))}
      </Card>
      {failed.length ? <Banner tone="warning" title={`${failed.length} download(s) failed`} body={`${failed[0].error ?? ''} You can retry later in Offline AI Models.`} /> : null}
      <Button label={active.length ? 'Continue while downloading' : pair.status === 'ready' ? 'Continue' : 'Continue with limited functionality'} icon="next" onPress={onNext} />
    </View>
  );
}

function Complete({ onFinish }: { onFinish: () => void }) {
  const pair = usePairAvailability();
  const ready = pair.status === 'ready';
  return (
    <View style={{ gap: space.lg, alignItems: 'center', marginTop: space.xl }}>
      <View style={{ width: 88, height: 88, borderRadius: radius.xl, backgroundColor: ready ? colors.successSoft : colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={ready ? 'check-circle' : 'hourglass'} size={44} color={ready ? colors.success : colors.accent} />
      </View>
      <T v="display" style={{ textAlign: 'center' }}>
        {ready ? 'Setup complete' : 'Almost ready'}
      </T>
      <T v="body" color={colors.textMuted} style={{ textAlign: 'center', maxWidth: 460 }}>
        {ready
          ? `${pair.language.name} dubbing works fully offline on this device.`
          : 'Some packs are still missing or downloading. You can browse the app now; dubbing becomes available when they finish (see Offline AI Models).'}
      </T>
      <SetupRow title="Permissions" body="Microphone and notifications are asked when you first use live translation." />
      <Button label="Go to Home" icon="home" onPress={onFinish} style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

function SetupRow({ title, body }: { title: string; body: ReactNode }) {
  return (
    <Card style={{ alignSelf: 'stretch', gap: 4 }}>
      <T v="cardTitle">{title}</T>
      <T v="caption" color={colors.textMuted}>
        {body}
      </T>
    </Card>
  );
}
