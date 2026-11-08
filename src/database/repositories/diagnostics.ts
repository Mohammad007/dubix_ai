import { getDb } from '../client';
import type { DiagnosticRow } from '../schemas/types';

const MAX_ROWS = 500;

/** Local-only error/perf log (never uploaded). Old rows are trimmed. */
export async function logDiagnostic(level: DiagnosticRow['level'], code: string, message: string, context?: unknown): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT INTO local_diagnostics (at, level, code, message, context) VALUES (?, ?, ?, ?, ?)', [
    Date.now(), level, code, message, context === undefined ? null : JSON.stringify(context),
  ]);
  await db.runAsync('DELETE FROM local_diagnostics WHERE id NOT IN (SELECT id FROM local_diagnostics ORDER BY at DESC LIMIT ?)', [MAX_ROWS]);
}

export async function getDiagnostics(limit = 50): Promise<DiagnosticRow[]> {
  const db = await getDb();
  return db.getAllAsync<DiagnosticRow>('SELECT * FROM local_diagnostics ORDER BY at DESC LIMIT ?', [limit]);
}

export async function clearDiagnostics(): Promise<void> {
  const db = await getDb();
  await db.execAsync('DELETE FROM local_diagnostics');
}

export async function recordMetrics(sessionId: string, realtimeFactor: number, perf: unknown): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT INTO metrics (session_id, recorded_at, realtime_factor, perf_json) VALUES (?, ?, ?, ?)', [
    sessionId, Date.now(), realtimeFactor, JSON.stringify(perf),
  ]);
}

/** Real-time factor of the most recent completed job on this device (for performance profiles). */
export async function lastRealtimeFactor(): Promise<number | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ realtime_factor: number }>('SELECT realtime_factor FROM metrics ORDER BY recorded_at DESC LIMIT 1');
  return r?.realtime_factor ?? null;
}
