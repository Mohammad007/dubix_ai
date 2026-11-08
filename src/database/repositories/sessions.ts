import { getDb, type BindValue } from '../client';
import type { Range, SessionRow, SessionStatus } from '../schemas/types';

type Db = {
  id: string; uri: string; name: string; thumbnail: string | null; duration_ms: number; source_lang: string;
  target_lang: string; status: SessionStatus; processed_ms: number; error: string | null; speaker_centroids: string | null;
  last_position_ms: number; covered_ranges: string | null; audio_track: number; size_bytes: number; mime_type: string | null;
  created_at: number; updated_at: number;
};

const parse = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

const toRow = (r: Db): SessionRow => ({
  id: r.id, uri: r.uri, name: r.name, thumbnail: r.thumbnail, durationMs: r.duration_ms, sourceLang: r.source_lang,
  targetLang: r.target_lang, status: r.status, processedMs: r.processed_ms, error: r.error,
  speakerCentroids: parse<number[][] | null>(r.speaker_centroids, null), lastPositionMs: r.last_position_ms,
  coveredRanges: parse<Range[]>(r.covered_ranges, []), audioTrack: r.audio_track, sizeBytes: r.size_bytes, mimeType: r.mime_type,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

export type NewSession = Pick<SessionRow, 'id' | 'uri' | 'name' | 'thumbnail' | 'durationMs' | 'sourceLang' | 'targetLang' | 'sizeBytes' | 'mimeType'>;

export async function createSession(s: NewSession): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO sessions (id, uri, name, thumbnail, duration_ms, source_lang, target_lang, status, size_bytes, mime_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)`,
    [s.id, s.uri, s.name, s.thumbnail, Math.round(s.durationMs), s.sourceLang, s.targetLang, Math.round(s.sizeBytes), s.mimeType, now, now],
  );
}

type Patch = Partial<Pick<SessionRow, 'status' | 'processedMs' | 'error' | 'speakerCentroids' | 'lastPositionMs' | 'sourceLang' | 'targetLang' | 'coveredRanges' | 'audioTrack'>>;

const COLUMNS: Record<keyof Patch, [string, (v: unknown) => BindValue]> = {
  status: ['status', (v) => v as string],
  processedMs: ['processed_ms', (v) => Math.round(v as number)],
  error: ['error', (v) => (v as string | null) ?? null],
  speakerCentroids: ['speaker_centroids', (v) => (v ? JSON.stringify(v) : null)],
  lastPositionMs: ['last_position_ms', (v) => Math.round(v as number)],
  sourceLang: ['source_lang', (v) => v as string],
  targetLang: ['target_lang', (v) => v as string],
  coveredRanges: ['covered_ranges', (v) => JSON.stringify(v ?? [])],
  audioTrack: ['audio_track', (v) => v as number],
};

export async function updateSession(id: string, patch: Patch): Promise<void> {
  const cols: string[] = [];
  const vals: BindValue[] = [];
  for (const [k, v] of Object.entries(patch) as [keyof Patch, unknown][]) {
    if (v === undefined) continue;
    const [col, conv] = COLUMNS[k];
    cols.push(`${col} = ?`);
    vals.push(conv(v));
  }
  if (!cols.length) return;
  const db = await getDb();
  await db.runAsync(`UPDATE sessions SET ${cols.join(', ')}, updated_at = ? WHERE id = ?`, [...vals, Date.now(), id]);
}

export async function getSession(id: string): Promise<SessionRow | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<Db>('SELECT * FROM sessions WHERE id = ?', [id]);
  return r ? toRow(r) : null;
}

export async function getRecentSessions(limit = 50): Promise<SessionRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Db>('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?', [limit]);
  return rows.map(toRow);
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM sessions WHERE id = ?', [id]);
}

/** Deletes every session (cascades to segments, speakers, progress, cache rows). Returns removed rows. */
export async function clearHistory(): Promise<SessionRow[]> {
  const db = await getDb();
  const rows = (await db.getAllAsync<Db>('SELECT * FROM sessions')).map(toRow);
  await db.execAsync('DELETE FROM sessions');
  return rows;
}

export async function savePlaybackProgress(sessionId: string, positionMs: number, durationMs: number, speed: number): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT OR REPLACE INTO playback_progress (session_id, position_ms, duration_ms, speed, updated_at) VALUES (?, ?, ?, ?, ?)',
      [sessionId, Math.round(positionMs), Math.round(durationMs), speed, now],
    );
    await db.runAsync('UPDATE sessions SET last_position_ms = ?, updated_at = ? WHERE id = ?', [Math.round(positionMs), now, sessionId]);
  });
}
