import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  AppHeader, Banner, Button, Card, EmptyState, ErrorState, HeaderMenu, Icon, NativeUnavailable, OfflineStatusPill, PickerSheet, Pill, Screen,
  SectionHeader, SessionCard, T, WarningsHost, type IconName,
} from '@/components/ui';
import { languageName } from '@/domain/languages';
import { usePairAvailability } from '@/hooks/useAvailability';
import { useLayout } from '@/hooks/useLayout';
import { deleteSession, loadSession, openLocalVideo, sessions } from '@/services/dubbing';
import { usePermissions } from '@/services/permissions';
import { engine } from '@/store/engine';
import { useSettings } from '@/store/settings';
import { cardShadow, colors, radius, space } from '@/theme/tokens';
import { formatBytes } from '@/utils/format';

export default function HomeScreen() {
  const { isTablet } = useLayout();
  const available = engine.useValue((s) => s.available);
  const device = engine.useValue((s) => s.device);
  const installed = engine.useValue((s) => s.installed);
  const list = sessions.useValue((s) => s.list);
  const settings = useSettings();
  const pair = usePairAvailability();
  const { snap } = usePermissions();
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<{ code: string; message?: string } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const open = async () => {
    setOpening(true);
    setOpenError(null);
    try {
      const r = await openLocalVideo();
      if (r.ok) {
        await loadSession(r.sessionId);
        router.navigate('/player');
      } else if (r.code !== 'cancelled') setOpenError({ code: r.code, message: r.message });
    } finally {
      setOpening(false);
    }
  };

  const openSession = async (id: string) => {
    await loadSession(id);
    router.navigate('/player');
  };

  const actions: { icon: IconName; title: string; body: string; onPress: () => void }[] = [
    { icon: 'folder', title: 'Open Local Movie', body: 'Play and translate a video from your device', onPress: open },
    { icon: 'live', title: 'Live Translator', body: 'Real-time speech translation and dubbing', onPress: () => router.navigate('/translate') },
    { icon: 'mic', title: 'AI Voices', body: 'Offline voices for each speaker', onPress: () => router.navigate('/voices') },
  ];

  return (
    <Screen header={<AppHeader status={<OfflineStatusPill />} right={<HeaderMenu />} />}>
      {!available ? <NativeUnavailable /> : null}
      <WarningsHost />
      {openError ? <ErrorState code={openError.code} message={openError.message} onRetry={open} onDismiss={() => setOpenError(null)} /> : null}

      <Card style={{ marginTop: space.md, flexDirection: 'row', gap: space.lg, alignItems: 'center', padding: space.xl }}>
        <View style={{ flex: 1 }}>
          <T v="display" accessibilityRole="header" style={{ fontSize: isTablet ? 32 : 28, lineHeight: isTablet ? 38 : 34 }}>
            Live Movie{'\n'}Translation
          </T>
          <T v="body" color={colors.textMuted} style={{ marginTop: space.sm, fontSize: 15, lineHeight: 22 }}>
            Translate and dub supported movie audio on your device. No account, no uploads.
          </T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg }}>
            <Button label="Start Live" icon="play" onPress={() => router.navigate('/translate')} disabled={!available} />
            {isTablet ? <Button label="Open Local Movie" icon="folder" variant="secondary" onPress={open} loading={opening} disabled={!available} /> : null}
          </View>
          <Pressable onPress={() => router.push('/language')} accessibilityRole="button" style={{ marginTop: space.md, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="translate" size={16} color={colors.accent} />
            <T v="bodyStrong" color={colors.accent}>
              {languageName(settings.sourceLang)} → {languageName(settings.targetLang)}
            </T>
          </Pressable>
        </View>
        <HeroArt compact={!isTablet} />
      </Card>

      {available && pair.status !== 'ready' ? (
        <View style={{ marginTop: space.md }}>
          <Banner
            tone={pair.status === 'unavailable' ? 'danger' : 'accent'}
            title={pair.status === 'unavailable' ? `${pair.language.name} can’t be dubbed on this device` : `Finish offline setup for ${pair.language.name}`}
            body={pair.reason ?? `${pair.requirements.filter((r) => !r.satisfied).length} pack(s) to download once. Afterwards everything works without internet.`}
            action={pair.status === 'unavailable' ? 'Choose another language' : 'Download packs'}
            onAction={() => router.push(pair.status === 'unavailable' ? '/language' : '/models')}
          />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
        {actions.map((a) => (
          <Pressable
            key={a.title}
            onPress={a.onPress}
            accessibilityRole="button"
            accessibilityLabel={`${a.title}. ${a.body}`}
            style={({ pressed }) => [
              { flex: 1, backgroundColor: pressed ? colors.surfaceAlt : colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: isTablet ? space.lg : space.md, gap: space.sm, minHeight: 150 },
              cardShadow(),
            ]}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Icon name={a.icon} size={26} />
              <Icon name="chevron-right" size={18} color={colors.textMuted} />
            </View>
            <T v="cardTitle" style={{ fontSize: isTablet ? 16 : 14, lineHeight: isTablet ? 22 : 19 }}>
              {a.title}
            </T>
            <T v="caption" color={colors.textMuted} style={{ fontSize: isTablet ? 13 : 11.5, lineHeight: 16 }}>
              {a.body}
            </T>
          </Pressable>
        ))}
      </View>

      <SectionHeader title="Recent Sessions" action={list.length ? 'See All' : undefined} onAction={() => router.push('/history')} />
      {list.length === 0 ? (
        <EmptyState icon="film" title="No sessions yet" body="Open a video you own or are authorized to use. Its transcript, translation and dubbed audio stay on this device." action={<Button label="Open Local Movie" icon="folder" onPress={open} loading={opening} disabled={!available} compact />} />
      ) : (
        list.slice(0, isTablet ? 4 : 3).map((s) => <SessionCard key={s.id} s={s} onPress={() => openSession(s.id)} onMenu={() => setMenuFor(s.id)} />)
      )}

      <Card style={{ marginTop: space.lg }}>
        <T v="heading" style={{ marginBottom: space.md }}>
          Device Status
        </T>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <StatusItem icon="mic" title="Mic" ok={snap?.microphone === 'granted'} okLabel="Ready" badLabel={snap?.microphone === 'blocked' ? 'Blocked' : 'Not allowed'} onPress={() => router.push('/permissions')} />
          <StatusItem icon="chip" title="AI Models" ok={pair.status === 'ready'} okLabel={`${installed.length} installed`} badLabel={installed.length ? 'Incomplete' : 'None'} onPress={() => router.push('/models')} />
          <StatusItem icon="storage" title="Storage" ok={(device?.storageFreeBytes ?? 0) > 2 * 1024 ** 3} okLabel={`${formatBytes(device?.storageFreeBytes ?? 0)} free`} badLabel={`${formatBytes(device?.storageFreeBytes ?? 0)} free`} onPress={() => router.push('/models')} />
        </View>
      </Card>

      <PickerSheet
        visible={menuFor !== null}
        title="Session"
        onClose={() => setMenuFor(null)}
        options={[
          { key: 'open', title: 'Continue in player' },
          { key: 'details', title: 'Session details', subtitle: 'Transcript, translation and speakers' },
          { key: 'delete', title: 'Delete session', subtitle: 'Removes transcript and dubbed audio. Your video file is not touched.' },
        ]}
        onSelect={(k) => {
          const id = menuFor!;
          if (k === 'open') openSession(id);
          else if (k === 'details') router.push({ pathname: '/session/[id]', params: { id } });
          else deleteSession(id);
        }}
      />
    </Screen>
  );
}

function StatusItem({ icon, title, ok, okLabel, badLabel, onPress }: { icon: IconName; title: string; ok: boolean; okLabel: string; badLabel: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}: ${ok ? okLabel : badLabel}`} style={{ flex: 1, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={icon} size={20} />
        <T v="bodyStrong">{title}</T>
      </View>
      <Pill label={ok ? okLabel : badLabel} tone={ok ? 'success' : 'warning'} />
    </Pressable>
  );
}

/** Flat illustration: clapperboard + translation bubble (solid fills, no gradients or 3D). */
function HeroArt({ compact }: { compact: boolean }) {
  const s = compact ? 0.75 : 1;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 150 * s, height: 130 * s, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 128 * s, height: 92 * s, borderRadius: 14 * s, backgroundColor: '#1F2433', alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', top: -14 * s, left: 6 * s, right: 6 * s, height: 20 * s, borderRadius: 5 * s, backgroundColor: '#1F2433', flexDirection: 'row', overflow: 'hidden', transform: [{ rotate: '-8deg' }] }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={{ width: 12 * s, height: 40 * s, marginLeft: 10 * s, backgroundColor: '#FFFFFF', transform: [{ rotate: '35deg' }], marginTop: -8 * s }} />
          ))}
        </View>
        <Icon name="play" size={40 * s} color="#FFFFFF" />
      </View>
      <View style={{ position: 'absolute', right: 0, bottom: 4 * s, width: 52 * s, height: 44 * s, borderRadius: 12 * s, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="translate" size={24 * s} color={colors.accent} />
      </View>
    </View>
  );
}
