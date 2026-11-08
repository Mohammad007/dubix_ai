import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, TextInput, View } from 'react-native';

import { Button, EmptyState, Icon, PickerSheet, Screen, ScreenTitle, SessionCard } from '@/components/ui';
import { languageName } from '@/domain/languages';
import { clearHistory, deleteSession, loadSession, openLocalVideo, sessions } from '@/services/dubbing';
import { colors, radius, space, TOUCH } from '@/theme/tokens';

export default function HistoryScreen() {
  const list = sessions.useValue((x) => x.list);
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const filtered = q ? list.filter((s) => s.name.toLowerCase().includes(q) || languageName(s.targetLang).toLowerCase().includes(q)) : list;

  const resume = async (id: string) => {
    await loadSession(id);
    router.navigate('/player');
  };

  return (
    <Screen
      footer={
        list.length ? (
          <Button
            label="Clear Local History"
            icon="trash"
            variant="danger"
            onPress={() =>
              Alert.alert('Clear local history?', 'Deletes all sessions, transcripts and dubbed audio. Your video files are not touched.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Clear', style: 'destructive', onPress: () => clearHistory() },
              ])
            }
          />
        ) : undefined
      }
    >
      <ScreenTitle title="Translation History" back subtitle={`${list.length} session(s) on this device`} />
      {list.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.md, marginBottom: space.md }}>
          <Icon name="search" color={colors.textMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search history" placeholderTextColor={colors.textFaint} accessibilityLabel="Search history" style={{ flex: 1, minHeight: TOUCH, color: colors.text, fontFamily: 'Inter_400Regular' }} />
        </View>
      ) : null}
      {list.length === 0 ? (
        <EmptyState
          icon="history"
          title="No history yet"
          body="Sessions you dub appear here with their language, progress and last playback position."
          action={<Button label="Open Local Movie" icon="folder" compact onPress={async () => { const r = await openLocalVideo(); if (r.ok) resume(r.sessionId); }} />}
        />
      ) : (
        filtered.map((s) => <SessionCard key={s.id} s={s} onPress={() => resume(s.id)} onMenu={() => setMenuFor(s.id)} />)
      )}
      <PickerSheet
        visible={menuFor !== null}
        title="Session"
        onClose={() => setMenuFor(null)}
        options={[
          { key: 'open', title: 'Resume in player' },
          { key: 'details', title: 'Session details', subtitle: 'Transcript, translation and speakers' },
          { key: 'delete', title: 'Delete', subtitle: 'Removes transcript and dubbed audio' },
        ]}
        onSelect={(k) => {
          const id = menuFor!;
          if (k === 'open') resume(id);
          else if (k === 'details') router.push({ pathname: '/session/[id]', params: { id } });
          else deleteSession(id);
        }}
      />
    </Screen>
  );
}
