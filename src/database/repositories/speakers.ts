import { getDb } from '../client';
import type { SpeakerRow } from '../schemas/types';

type Db = { session_id: string; speaker: number; label: string; voice_key: string | null; pitch: number; speed: number };

export async function getVoiceMappings(sessionId: string): Promise<SpeakerRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Db>('SELECT * FROM speakers WHERE session_id = ? ORDER BY speaker', [sessionId]);
  return rows.map((r) => ({ sessionId: r.session_id, speaker: r.speaker, label: r.label, voiceKey: r.voice_key, pitch: r.pitch, speed: r.speed }));
}

export async function saveVoiceMappings(rows: SpeakerRow[]): Promise<void> {
  if (!rows.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const r of rows) {
      await db.runAsync('INSERT OR REPLACE INTO speakers (session_id, speaker, label, voice_key, pitch, speed) VALUES (?, ?, ?, ?, ?, ?)', [
        r.sessionId, r.speaker, r.label, r.voiceKey, r.pitch, r.speed,
      ]);
    }
  });
}

export const saveVoiceMapping = (row: SpeakerRow) => saveVoiceMappings([row]);

/** Manual speaker correction: reassigns one line to another (possibly new) speaker. */
export async function reassignSegmentSpeaker(sessionId: string, segmentId: string, speaker: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE segments SET speaker = ? WHERE session_id = ? AND id = ?', [speaker, sessionId, segmentId]);
}
