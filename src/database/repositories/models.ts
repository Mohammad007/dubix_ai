import type { DownloadProgressEvent, InstalledModel } from 'dubix-native';

import { getDb } from '../client';
import type { DownloadJobRow, ModelStateRow } from '../schemas/types';

type Db = { id: string; kind: string; version: string; sha256: string | null; verified: number; size_bytes: number; installed_at: number | null; last_used_at: number | null; state: ModelStateRow['state'] };

const toRow = (r: Db): ModelStateRow => ({
  id: r.id, kind: r.kind, version: r.version, sha256: r.sha256, verified: r.verified === 1, sizeBytes: r.size_bytes,
  installedAt: r.installed_at, lastUsedAt: r.last_used_at, state: r.state,
});

/** Mirrors the native install manifests (the source of truth on disk) into SQLite. */
export async function saveModelState(installed: InstalledModel[]): Promise<void> {
  const db = await getDb();
  const ids = new Set(installed.map((m) => m.id));
  await db.withTransactionAsync(async () => {
    for (const m of installed) {
      await db.runAsync(
        `INSERT INTO ai_models (id, kind, version, sha256, verified, size_bytes, installed_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, 'installed')
         ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, version = excluded.version, sha256 = excluded.sha256, verified = excluded.verified,
           size_bytes = excluded.size_bytes, installed_at = excluded.installed_at, state = 'installed'`,
        [m.id, m.kind, m.version, m.sha256, m.verified ? 1 : 0, Math.round(m.sizeOnDisk), Math.round(m.installedAt)],
      );
    }
    const known = await db.getAllAsync<{ id: string }>("SELECT id FROM ai_models WHERE state = 'installed'");
    for (const k of known) if (!ids.has(k.id)) await db.runAsync("UPDATE ai_models SET state = 'removed' WHERE id = ?", [k.id]);
  });
}

export async function getInstalledModels(): Promise<ModelStateRow[]> {
  const db = await getDb();
  return (await db.getAllAsync<Db>("SELECT * FROM ai_models WHERE state = 'installed'")).map(toRow);
}

export async function touchModels(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    for (const id of ids) await db.runAsync('UPDATE ai_models SET last_used_at = ? WHERE id = ?', [now, id]);
  });
}

export async function saveDownloadJob(e: DownloadProgressEvent): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO download_jobs (id, state, bytes, total, error, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
    e.id, e.state, Math.round(e.bytes), Math.round(e.total), e.error ?? null, Date.now(),
  ]);
}

/** Downloads that did not finish (app killed, network lost): shown as "Resume" on next launch. */
export async function getInterruptedDownloads(): Promise<DownloadJobRow[]> {
  const db = await getDb();
  return db.getAllAsync<DownloadJobRow>(
    "SELECT id, state, bytes, total, error, updated_at AS updatedAt FROM download_jobs WHERE state IN ('queued', 'downloading', 'installing', 'error')",
  );
}
