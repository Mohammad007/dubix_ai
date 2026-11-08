import { getDb } from '../client';

export async function audioCacheBytes(): Promise<number> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ total: number | null }>('SELECT SUM(bytes) AS total FROM generated_audio_cache');
  return r?.total ?? 0;
}

/** Sessions ordered oldest-used first with their generated audio size, for cache eviction. */
export async function audioCacheBySession(): Promise<{ sessionId: string; bytes: number; updatedAt: number }[]> {
  const db = await getDb();
  return db.getAllAsync<{ sessionId: string; bytes: number; updatedAt: number }>(
    `SELECT c.session_id AS sessionId, SUM(c.bytes) AS bytes, s.updated_at AS updatedAt
     FROM generated_audio_cache c JOIN sessions s ON s.id = c.session_id
     GROUP BY c.session_id ORDER BY s.updated_at ASC`,
  );
}

/**
 * Forgets generated audio for a session (files are deleted natively by the caller). Transcripts and
 * translations are kept and marked for re-synthesis.
 */
export async function clearAudioCache(sessionId?: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    if (sessionId) {
      await db.runAsync('DELETE FROM generated_audio_cache WHERE session_id = ?', [sessionId]);
      await db.runAsync("UPDATE segments SET audio_path = NULL, audio_ms = 0, processing_state = 'translated' WHERE session_id = ?", [sessionId]);
    } else {
      await db.execAsync("DELETE FROM generated_audio_cache; UPDATE segments SET audio_path = NULL, audio_ms = 0, processing_state = 'translated';");
    }
  });
}
