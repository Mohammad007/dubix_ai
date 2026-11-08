import type { JobSegmentEvent } from 'dubix-native';

import { getDb } from '../client';
import type { SegmentRow, SegmentState } from '../schemas/types';

type Db = {
  session_id: string; id: string; start_ms: number; end_ms: number; speaker: number; register: SegmentRow['register'];
  f0: number | null; source_text: string; source_lang: string; translated_text: string; audio_path: string | null;
  audio_ms: number; speed: number; error: string | null; voice_id: string | null; overflow_ms: number;
  processing_state: SegmentState; edited: number;
};

const toRow = (r: Db): SegmentRow => ({
  sessionId: r.session_id, id: r.id, startMs: r.start_ms, endMs: r.end_ms, speaker: r.speaker, register: r.register,
  f0: r.f0, sourceText: r.source_text, sourceLang: r.source_lang, translatedText: r.translated_text,
  audioPath: r.audio_path, audioMs: r.audio_ms, speed: r.speed, error: r.error, voiceId: r.voice_id,
  overflowMs: r.overflow_ms, processingState: r.processing_state, edited: r.edited === 1,
});

/** 16-bit mono 24 kHz WAV: exact size from duration (44-byte header + 48 bytes per ms). */
export const wavBytes = (ms: number) => 44 + Math.round(ms * 48);

export function eventToRow(e: JobSegmentEvent): SegmentRow {
  return {
    sessionId: e.sessionId, id: e.id, startMs: e.startMs, endMs: e.endMs, speaker: e.speaker, register: e.register, f0: e.f0,
    sourceText: e.sourceText, sourceLang: e.sourceLang, translatedText: e.translatedText, audioPath: e.audioPath,
    audioMs: e.audioDurationMs, speed: e.speed, voiceId: e.voiceId, overflowMs: e.overflowMs,
    processingState: e.audioPath ? 'synthesized' : 'failed', edited: false, error: e.error,
  };
}

/** Batched transactional upsert of transcript segments and their generated-audio cache rows. */
export async function saveTranscriptSegments(segs: SegmentRow[]): Promise<void> {
  if (!segs.length) return;
  const db = await getDb();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    for (const s of segs) {
      await db.runAsync(
        `INSERT OR REPLACE INTO segments (session_id, id, start_ms, end_ms, speaker, register, f0, source_text, source_lang,
           translated_text, audio_path, audio_ms, speed, error, voice_id, overflow_ms, processing_state, edited)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [s.sessionId, s.id, Math.round(s.startMs), Math.round(s.endMs), s.speaker, s.register, s.f0, s.sourceText, s.sourceLang,
          s.translatedText, s.audioPath, Math.round(s.audioMs), s.speed, s.error, s.voiceId, Math.round(s.overflowMs),
          s.processingState, s.edited ? 1 : 0],
      );
      if (s.audioPath) {
        await db.runAsync('INSERT OR REPLACE INTO generated_audio_cache (path, session_id, segment_id, bytes, created_at) VALUES (?, ?, ?, ?, ?)', [
          s.audioPath, s.sessionId, s.id, wavBytes(s.audioMs), now,
        ]);
      }
    }
  });
}

export const saveTranscriptSegment = (s: SegmentRow) => saveTranscriptSegments([s]);

export async function getSegments(sessionId: string): Promise<SegmentRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Db>('SELECT * FROM segments WHERE session_id = ? ORDER BY start_ms', [sessionId]);
  return rows.map(toRow);
}

export async function deleteSegments(sessionId: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM segments WHERE session_id = ?', [sessionId]);
    await db.runAsync('DELETE FROM generated_audio_cache WHERE session_id = ?', [sessionId]);
  });
}

/** User correction of a translated line; the line must be re-voiced afterwards. */
export async function updateTranslation(sessionId: string, id: string, translatedText: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE segments SET translated_text = ?, edited = 1, processing_state = 'translated' WHERE session_id = ? AND id = ?", [
    translatedText, sessionId, id,
  ]);
}

export async function updateSegmentAudio(sessionId: string, id: string, audioPath: string, audioMs: number, speed: number, overflowMs: number, voiceId: string | null): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "UPDATE segments SET audio_path = ?, audio_ms = ?, speed = ?, overflow_ms = ?, voice_id = ?, error = NULL, processing_state = 'synthesized' WHERE session_id = ? AND id = ?",
      [audioPath, Math.round(audioMs), speed, Math.round(overflowMs), voiceId, sessionId, id],
    );
    await db.runAsync('INSERT OR REPLACE INTO generated_audio_cache (path, session_id, segment_id, bytes, created_at) VALUES (?, ?, ?, ?, ?)', [
      audioPath, sessionId, id, wavBytes(audioMs), Date.now(),
    ]);
  });
}

/** Removes transcripts but keeps sessions (Privacy › Clear transcript cache). */
export async function clearTranscripts(): Promise<void> {
  const db = await getDb();
  await db.execAsync(
    "DELETE FROM segments; DELETE FROM generated_audio_cache; DELETE FROM speakers; UPDATE sessions SET processed_ms = 0, covered_ranges = NULL, speaker_centroids = NULL, status = 'new';",
  );
}
