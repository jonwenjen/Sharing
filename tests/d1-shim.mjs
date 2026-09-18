// 以 node:sqlite 模擬 Cloudflare D1，讓 Worker 可在本機整合測試
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function createD1(schemaPath) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(schemaPath, 'utf8'));
  const norm = (a) => a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => stmt(sql, norm(a)),
    first: async () => { const r = db.prepare(sql).get(...args); return r ? { ...r } : null; },
    all: async () => ({ results: db.prepare(sql).all(...args).map((r) => ({ ...r })) }),
    run: async () => { db.prepare(sql).run(...args); return { success: true }; },
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      const out = [];
      db.exec('BEGIN');
      try { for (const s of list) out.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run()); db.exec('COMMIT'); }
      catch (e) { db.exec('ROLLBACK'); throw e; }
      return out;
    },
  };
}
