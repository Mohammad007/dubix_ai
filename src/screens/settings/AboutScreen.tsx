import { View } from 'react-native';

import { Card, Icon, Logo, Screen, ScreenTitle, SectionHeader, T, type IconName } from '@/components/ui';
import { colors, space } from '@/theme/tokens';

const CAN = [
  'Dub video files you open from this device: speech recognition, translation and voices run on-device.',
  'Give different speakers different voices (on-device speaker clustering, with manual correction).',
  'Time each dubbed line to its dialogue, with adjustable offset, spill buffer and pitch-preserving time-stretch.',
  'Translate the microphone, or audio from apps that allow Android playback capture (Android 10+, with your consent each time).',
  'Work without internet after model packs are downloaded once.',
];

const CANNOT = [
  'It does not change lip movements. Timing is matched per line; frame-perfect visual lip-sync is not possible.',
  'It cannot separate dialogue from music. Lowering or muting the original also lowers music and effects.',
  'It cannot capture DRM-protected or secure playback, or apps that disallow capture. Netflix, Prime Video, Disney+ and many other streaming apps block capture, so they are not supported; such audio arrives as silence.',
  'It cannot mute or replace another app’s audio. In external-app mode the translated voice plays on top of the original sound.',
  'It does not add, replace or alter YouTube audio tracks or any part of the YouTube player.',
  'It does not bypass Android permissions, consent screens, capture policies or content protection, and does not use root.',
];

const CREDITS = [
  'sherpa-onnx (Apache-2.0): VAD, speech recognition, speaker embeddings, neural TTS runtime',
  'OpenAI Whisper models (MIT) · Silero VAD (MIT) · 3D-Speaker CAM++ (Apache-2.0)',
  'Piper voices (per-voice licences; see each model card)',
  'Google ML Kit on-device translation (ML Kit terms)',
  'AndroidX Media3 ExoPlayer (Apache-2.0)',
];

export default function AboutScreen() {
  return (
    <Screen>
      <ScreenTitle title="About" back />
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
        <Logo size={56} />
        <View style={{ flex: 1 }}>
          <T v="heading">DubiX AI</T>
          <T v="caption" color={colors.textMuted}>
            Version 1.0.0 · offline movie translation and dubbing for Android
          </T>
        </View>
      </Card>
      <List title="What DubiX does" items={CAN} icon="check-circle" color={colors.success} />
      <List title="What DubiX does not do" items={CANNOT} icon="close-circle" color={colors.warning} />
      <List title="Open-source components" items={CREDITS} icon="info" color={colors.accent} />
      <T v="caption" color={colors.textFaint} style={{ marginTop: space.lg }}>
        Use DubiX only with content you own or are authorized to use, and respect the terms of the apps and services you watch.
      </T>
    </Screen>
  );
}

function List({ title, items, icon, color }: { title: string; items: string[]; icon: IconName; color: string }) {
  return (
    <>
      <SectionHeader title={title} />
      <Card style={{ gap: space.md }}>
        {items.map((t) => (
          <View key={t} style={{ flexDirection: 'row', gap: space.md }}>
            <Icon name={icon} color={color} size={20} />
            <T v="body" style={{ flex: 1 }}>
              {t}
            </T>
          </View>
        ))}
      </Card>
    </>
  );
}
