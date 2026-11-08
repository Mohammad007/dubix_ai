import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { DubixNative } from 'dubix-native';

import { AppHeader, Banner, Button, Card, HeaderMenu, Icon, OfflineStatusPill, Pill, Screen, ScreenTitle, SectionHeader, T, Toggle, WarningsHost, type IconName } from '@/components/ui';
import { displayTranslation } from '@/domain/captions';
import { languageShort } from '@/domain/languages';
import { useLayout } from '@/hooks/useLayout';
import { setLivePaused, stopLive } from '@/services/audio/live';
import { usePermissions } from '@/services/permissions';
import { engine } from '@/store/engine';
import { updateSettings, useSettings } from '@/store/settings';
import { cardShadow, colors, radius, space } from '@/theme/tokens';

export default function FloatingControllerScreen() {
  const s = useSettings();
  const { columns } = useLayout();
  const { snap } = usePermissions();
  const live = engine.useValue((x) => x.live);
  const lines = engine.useValue((x) => x.liveLines);
  const running = !['idle', 'error', 'projection_stopped', 'stopped'].includes(live.state);
  const overlayGranted = snap?.overlay === 'granted';
  const last = lines[lines.length - 1];
  const pair = `${languageShort(s.sourceLang)} → ${languageShort(s.targetLang)}`;

  const show = async () => {
    updateSettings({ liveOverlay: true });
    if (!overlayGranted) return DubixNative?.openOverlaySettings();
    if (running) await DubixNative?.setFloatingControllerVisible(true);
    else router.navigate('/translate');
  };

  return (
    <Screen header={<AppHeader status={<OfflineStatusPill />} right={<HeaderMenu />} />}>
      <WarningsHost />
      <ScreenTitle title="Floating Controller" back subtitle="A compact, always-on-top control panel for live translation over other apps." />

      <Card style={{ flexDirection: columns > 1 ? 'row' : 'column', gap: space.xl, alignItems: 'center' }}>
        <View style={{ flex: columns > 1 ? 1 : undefined, gap: space.md, alignSelf: 'stretch' }}>
          <T v="body" color={colors.textMuted}>
            Drag it anywhere, collapse it to a bubble, pause or stop translation, and toggle subtitles or the translated voice without leaving the app you are watching.
          </T>
          {!overlayGranted ? (
            <Banner
              tone="accent"
              title="“Display over other apps” is off"
              body="Android requires this permission for floating controls. Without it, use the Pause / Resume / Stop buttons in the DubiX notification while live translation runs."
            />
          ) : null}
          <Button
            label={!overlayGranted ? 'Allow display over other apps' : running ? (live.overlay ? 'Controller is showing' : 'Show floating controller') : 'Start live translation'}
            icon={!overlayGranted ? 'shield' : 'pip'}
            onPress={show}
            disabled={overlayGranted && running && !!live.overlay}
          />
          {running && live.overlay ? <Button label="Hide controller" variant="secondary" onPress={() => DubixNative?.setFloatingControllerVisible(false)} /> : null}
        </View>
        <ControllerPreview paused={live.state === 'paused'} captions={s.liveCaptions} voice={s.liveSpeak} pair={pair} caption={last ? displayTranslation(last.translatedText, s.targetLang, s.hinglishStyle, last.sourceText) : null} state={live.state} />
      </Card>

      <SectionHeader title="Controller Controls" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Tile half={columns > 1} icon={live.state === 'paused' ? 'play' : 'pause'} title="Start / Pause" body="Begin or pause live translation." action={running ? <Button label={live.state === 'paused' ? 'Resume' : 'Pause'} compact variant="secondary" onPress={() => setLivePaused(live.state !== 'paused')} /> : <Button label="Start" compact variant="secondary" onPress={() => router.navigate('/translate')} />} />
        <Tile half={columns > 1} icon="stop" title="Stop" body="End capture and release the microphone or capture consent." action={<Button label="Stop" compact variant="danger" onPress={stopLive} disabled={!running} />} />
        <Tile half={columns > 1} icon="captions" title="Subtitles" body="Show live translated subtitles in the panel." action={<Toggle value={s.liveCaptions} label="Subtitles in controller" onChange={(v) => { updateSettings({ liveCaptions: v }); if (running) DubixNative?.setLiveOptions(null, v); }} />} />
        <Tile half={columns > 1} icon="volume" title="Voice" body="Enable AI dubbing with the offline voice." action={<Toggle value={s.liveSpeak} label="Translated voice" onChange={(v) => { updateSettings({ liveSpeak: v }); if (running) DubixNative?.setLiveOptions(v, null); }} />} />
        <Tile half={columns > 1} icon="minus" title="Minimize" body="Tap – to shrink the controller to a bubble; tap the bubble to expand. Drag to reposition so it never blocks controls." />
        <Tile half={columns > 1} icon="info" title="Unsupported audio" body="If the app below blocks capture, the controller says “No capturable audio” instead of pretending to translate." />
      </View>

      <Card tone="warning" style={{ marginTop: space.lg }}>
        <T v="bodyStrong">What the controller cannot do</T>
        <T v="caption" color={colors.textMuted} style={{ marginTop: 4 }}>
          It controls DubiX only. It cannot mute, replace or change the audio or video of the app underneath, and it cannot capture apps that block audio capture (including DRM-protected streams). Some apps hide overlays during secure playback.
        </T>
      </Card>
    </Screen>
  );
}

function Tile({ icon, title, body, action, half }: { icon: IconName; title: string; body: string; action?: ReactNode; half: boolean }) {
  return (
    <Card style={{ width: half ? '49%' : '100%', gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Icon name={icon} color={colors.accent} />
          <T v="cardTitle">{title}</T>
        </View>
        {action}
      </View>
      <T v="caption" color={colors.textMuted}>
        {body}
      </T>
    </Card>
  );
}

/** Preview that mirrors the native overlay's layout and palette (clearly labelled). */
function ControllerPreview({ paused, captions, voice, pair, caption, state }: { paused: boolean; captions: boolean; voice: boolean; pair: string; caption: string | null; state: string }) {
  const btn = (icon: IconName, on: boolean) => (
    <View style={{ height: 44, minWidth: 56, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.accent : colors.surfaceAlt, borderWidth: 1, borderColor: on ? colors.accent : colors.border }}>
      <Icon name={icon} color={on ? colors.onAccent : colors.text} size={20} />
    </View>
  );
  return (
    <View accessible accessibilityLabel="Preview of the floating controller" style={{ width: 290, alignSelf: 'center' }}>
      <T v="label" color={colors.textFaint} style={{ marginBottom: 6 }}>
        PREVIEW
      </T>
      <View style={[{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: space.md, gap: space.sm }, cardShadow()]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Icon name="drag" color={colors.textMuted} size={18} />
          <View style={{ flex: 1 }}>
            <T v="cardTitle">DubiX AI</T>
            <T v="caption" color={colors.accent}>
              {pair}
            </T>
          </View>
          <Icon name="minus" />
          <Icon name="close" />
        </View>
        <Pill label={state === 'capture_silent' ? 'No capturable audio' : state === 'screen_blocked' ? 'Screen protected' : state === 'no_subtitles' ? 'No subtitles' : paused ? 'Paused' : state === 'listening' ? 'Listening' : 'Not running'} tone={state === 'capture_silent' || state === 'screen_blocked' || state === 'no_subtitles' ? 'warning' : state === 'listening' ? 'success' : 'neutral'} />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {btn(paused ? 'play' : 'pause', !paused)}
          {btn('captions', captions)}
          {btn('volume', voice)}
        </View>
        {captions ? (
          <T v="body" numberOfLines={3}>
            {caption ?? 'Live subtitles appear here.'}
          </T>
        ) : null}
      </View>
    </View>
  );
}
