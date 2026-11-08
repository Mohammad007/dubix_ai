import * as SQLite from 'expo-sqlite';

import { MIGRATIONS } from './migrations';

/**
 * expo-sqlite shares one connection, and `withTransactionAsync` is not exclusive: two
 * overlapping transactions (e.g. a segment batch flush and a voice-mapping save) interleave their
 * BEGIN/COMMIT and fail with "cannot commit - no transaction is active". Every write therefore
 * goes through one FIFO queue. Writes issued while a queued transaction is running execute
 * directly (they are part of that transaction's scope); reads are never queued.
 */
export class SerializedDb {
  private queue: Promise<unknown> = Promise.resolve();
  private inTransaction = false;

  constructor(private readonly raw: SQLite.SQLiteDatabase) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  runAsync(sql: string, params: SQLite.SQLiteBindParams = []): Promise<SQLite.SQLiteRunResult> {
    return this.inTransaction ? this.raw.runAsync(sql, params) : this.enqueue(() => this.raw.runAsync(sql, params));
  }

  execAsync(sql: string): Promise<void> {
    return this.inTransaction ? this.raw.execAsync(sql) : this.enqueue(() => this.raw.execAsync(sql));
  }

  withTransactionAsync(task: () => Promise<void>): Promise<void> {
    if (this.inTransaction) return task(); // nested: join the running transaction
    return this.enqueue(async () => {
      this.inTransaction = true;
      try {
        await this.raw.withTransactionAsync(task);
      } finally {
        this.inTransaction = false;
      }
    });
  }

  getAllAsync<T>(sql: string, params: SQLite.SQLiteBindParams = []): Promise<T[]> {
    return this.raw.getAllAsync<T>(sql, params);
  }

  getFirstAsync<T>(sql: string, params: SQLite.SQLiteBindParams = []): Promise<T | null> {
    return this.raw.getFirstAsync<T>(sql, params);
  }
}

export type Db = SerializedDb;

let dbPromise: Promise<SerializedDb> | null = null;

/** Opens `dubix.db` (WAL, foreign keys on) and applies pending migrations in transactions. */
export function getDb(): Promise<SerializedDb> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const raw = await SQLite.openDatabaseAsync('dubix.db');
      await raw.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
      const row = await raw.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      let version = row?.user_version ?? 0;
      while (version < MIGRATIONS.length) {
        await raw.withTransactionAsync(async () => {
          await raw.execAsync(MIGRATIONS[version]);
          await raw.execAsync(`PRAGMA user_version = ${version + 1}`);
        });
        version++;
      }
      return new SerializedDb(raw);
    })().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

export type BindValue = SQLite.SQLiteBindValue;
