import { SerializedDb } from '@/database/client';

/** Fake connection that fails exactly like SQLite when transactions interleave on one connection. */
function fakeConnection(log: string[]) {
  let open = false;
  const tick = () => new Promise((r) => setTimeout(r, 1));
  return {
    async withTransactionAsync(task: () => Promise<void>) {
      if (open) throw new Error('cannot start a transaction within a transaction');
      open = true;
      log.push('BEGIN');
      await tick();
      await task();
      if (!open) throw new Error('cannot commit - no transaction is active');
      log.push('COMMIT');
      open = false;
    },
    async runAsync(sql: string) {
      await tick();
      log.push(sql);
      return { changes: 1, lastInsertRowId: 0 };
    },
    async execAsync(sql: string) {
      await tick();
      log.push(sql);
    },
    getAllAsync: async () => [],
    getFirstAsync: async () => null,
  };
}

describe('SerializedDb', () => {
  it('runs overlapping transactions one after another (no "cannot commit" error)', async () => {
    const log: string[] = [];
    const db = new SerializedDb(fakeConnection(log) as never);
    await Promise.all([
      db.withTransactionAsync(async () => {
        await db.runAsync('A1');
        await db.runAsync('A2');
      }),
      db.withTransactionAsync(async () => {
        await db.runAsync('B1');
      }),
      db.runAsync('C'),
    ]);
    expect(log).toEqual(['BEGIN', 'A1', 'A2', 'COMMIT', 'BEGIN', 'B1', 'COMMIT', 'C']);
  });

  it('keeps the queue alive after a failed write', async () => {
    const log: string[] = [];
    const conn = fakeConnection(log);
    const db = new SerializedDb(conn as never);
    await expect(db.withTransactionAsync(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await db.runAsync('after');
    expect(log).toContain('after');
  });
});
