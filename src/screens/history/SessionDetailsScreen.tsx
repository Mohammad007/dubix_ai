import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, TextInput, View } from 'react-native';

import { DubixNative } from 'dubix-native';

import { Banner, Button, Card, Icon, IconButton, PickerSheet, Pill, ProgressBar, Screen, ScreenTitle, T } from '@/components/ui';
import type { SegmentRow } from '@/database';
import { displayTranslation } from '@/domain/captions';
import { languageName } from '@/domain/languages';
import { coveredMs } from '@/domain/ranges';
import { deleteSession, editTranslation, loadSession, reassignSpeaker, sessions } from '@/services/dubbing';
import { useSettings } from '@/store/settings';
import { colors, radius, space } from '@/theme/tokens';
import { formatBytes, formatDuration, formatRelativeDate } from '@/utils/format';

/** Transcript review: original + translation per line, manual speaker correction and translation edits. */
export default function SessionDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const active = sessions.useValue((x) => x.active);
  const s = useSettings();
  const [editing, setEditing] = useState<SegmentRow | null>(null);
  const [draft, setDraft] = useState('');
  const [speakerFor, setSpeakerFor] = useState<SegmentRow | null>(null);

  useEffect(() => {
    if (id) loadSession(id);
  }, [id]);

  if (!active || active.session.id !== id) {
    return (
      <Screen>
        <ScreenTitle title="Session" back />
        <T v="body" color={colors.textMuted}>
          Loading…
        </T>
      </Screen>
    );
  }
  const { session, segments, speakers } = active;
  const dubbed = coveredMs(session.coveredRanges);

  return (
    <Screen scroll={false}>
      <ScreenTitle title="Session Details" back subtitle={session.name} />
      <FlatList
        data={segments}
        keyExtractor={(x) => x.id}
        initialNumToRender={20}
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.md }}>
            <Card style={{ gap: space.sm }}>
              <T v="caption" color={colors.textMuted}>
                {languageName(session.sourceLang)} → {languageName(session.targetLang)} · {formatDuration(session.durationMs)} · {session.sizeBytes ? formatBytes(session.sizeBytes) : 'size unknown'} · opened {formatRelativeDate(session.createdAt)}
              </T>
              <ProgressBar value={session.durationMs ? dubbed / session.durationMs : 0} label="Dubbed portion" />
              <T v="caption" color={colors.textMuted}>
                {formatDuration(dubbed)} dubbed · {segments.length} lines · {speakers.length} speaker(s) · last played at {formatDuration(session.lastPositionMs)}
              </T>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button label="Resume" icon="play" compact onPress={() => router.navigate('/player')} style={{ flex: 1 }} />
                <Button
                  label="Delete"
                  icon="trash"
                  variant="danger"
                  compact
                  style={{ flex: 1 }}
                  onPress={() =>
                    Alert.alert('Delete session?', 'Removes transcript and dubbed audio. Your video file is not touched.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteSession(session.id); router.back(); } },
                    ])
                  }
                />
              </View>
            </Card>
            {active.regenerating ? <Banner tone="accent" title={active.regenerating.label} body={`${active.regenerating.done} of ${active.regenerating.total}`} /> : null}
            {segments.length === 0 ? (
              <T v="body" color={colors.textMuted}>
                No transcript yet. Start dubbing in the player.
              </T>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <Card style={{ marginBottom: space.sm, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
              <T v="mono" color={colors.textMuted}>
                {formatDuration(item.startMs)}–{formatDuration(item.endMs)}
              </T>
              <Pressable onPress={() => setSpeakerFor(item)} accessibilityRole="button" accessibilityLabel={`Speaker ${item.speaker + 1}. Change speaker`}>
                <Pill label={speakers.find((x) => x.speaker === item.speaker)?.label ?? `Speaker ${item.speaker + 1}`} tone="accent" icon="user" />
              </Pressable>
              {item.processingState === 'failed' ? <Pill label="No voice" tone="danger" /> : null}
              {item.overflowMs > 250 ? <Pill label={`+${Math.round(item.overflowMs)} ms over`} tone="warning" /> : null}
              {item.edited ? <Pill label="Edited" tone="neutral" showIcon={false} /> : null}
            </View>
            <T v="caption" color={colors.textMuted}>
              {item.sourceText}
            </T>
            <T v="body">{displayTranslation(item.translatedText, session.targetLang, s.hinglishStyle, item.sourceText)}</T>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              {item.audioPath ? <IconButton icon="play" label="Play dubbed line" onPress={() => DubixNative?.playPreview(item.audioPath!)} /> : null}
              <IconButton icon="edit" label="Edit translation" onPress={() => { setEditing(item); setDraft(item.translatedText); }} />
            </View>
          </Card>
        )}
        contentContainerStyle={{ paddingBottom: space.xxl }}
      />

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: 'center', padding: space.lg }}>
          <Card style={{ gap: space.md, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
            <T v="heading">Edit translation</T>
            <T v="caption" color={colors.textMuted}>
              {editing?.sourceText}
            </T>
            <TextInput value={draft} onChangeText={setDraft} multiline autoFocus accessibilityLabel="Translated text" style={{ minHeight: 96, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, color: colors.text, fontFamily: 'Inter_400Regular', textAlignVertical: 'top' }} />
            <T v="caption" color={colors.textMuted}>
              Saving re-voices this line with its speaker’s voice.
            </T>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label="Cancel" variant="secondary" onPress={() => setEditing(null)} style={{ flex: 1 }} />
              <Button label="Save" icon="check" disabled={!draft.trim()} onPress={() => { const seg = editing!; setEditing(null); editTranslation(seg.id, draft.trim()); }} style={{ flex: 1 }} />
            </View>
          </Card>
        </View>
      </Modal>

      <PickerSheet<string>
        visible={!!speakerFor}
        title="Assign line to speaker"
        selected={speakerFor ? String(speakerFor.speaker) : null}
        onClose={() => setSpeakerFor(null)}
        options={[
          ...speakers.map((x) => ({ key: String(x.speaker), title: x.label })),
          { key: String(Math.max(-1, ...speakers.map((x) => x.speaker)) + 1), title: 'New speaker', right: <Icon name="plus" /> },
        ]}
        onSelect={(k) => speakerFor && reassignSpeaker(speakerFor.id, Number(k))}
      />
    </Screen>
  );
}
