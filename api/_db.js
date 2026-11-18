'use strict';
// Databáze: Postgres (Neon z Vercel Marketplace). Jedna tabulka "docs" (kolekce, id, JSON dokument).
// Rozhraní je záměrně stejné, jako mělo Firestore (collection/doc/get/set/create/update/delete,
// where '==', orderBy, limit, add, getAll, runTransaction), takže zbytek serveru zůstal beze změny.
// Transakce jsou skutečné (BEGIN … COMMIT), čtení v transakci zamyká řádek (FOR UPDATE).
//
// Data: Date se ukládá jako {"$d": ISO} a čte zpět jako Date s metodou toDate().
// Všechno jde do SQL jako parametry ($1, $2 …), nikdy slepením textu.

const crypto = require('crypto');

const enc = v => {
  if (v instanceof Date) return { $d: v.toISOString() };
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = enc(x);
    return o;
  }
  return v;
};
const dec = v => {
  if (Array.isArray(v)) return v.map(dec);
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === '$d' && typeof v.$d === 'string') {
      const d = new Date(v.$d);
      Object.defineProperty(d, 'toDate', { value: () => d });
      return d;
    }
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = dec(x);
    return o;
  }
  return v;
};

function setPath(obj, dotted, val) {
  const ks = dotted.split('.');
  let o = obj;
  for (const k of ks.slice(0, -1)) {
    if (!o[k] || typeof o[k] !== 'object' || Array.isArray(o[k])) o[k] = {};
    o = o[k];
  }
  o[ks.at(-1)] = val;
}

const codeError = (code, message) => Object.assign(new Error(message), { code });
const RETRYABLE = new Set(['40001', '40P01']); // serializace, deadlock

const cmp = (a, b) => {
  const x = a instanceof Date ? a.getTime() : a, y = b instanceof Date ? b.getTime() : b;
  if (x === y) return 0;
  if (x === undefined || x === null) return 1;
  if (y === undefined || y === null) return -1;
  return x < y ? -1 : 1;
};

function makeDb(pool) {
  let ready = null;
  const init = () => (ready ||= pool.query(
    'CREATE TABLE IF NOT EXISTS docs (col text NOT NULL, id text NOT NULL, data jsonb NOT NULL, PRIMARY KEY (col, id))',
  ).catch(e => { ready = null; throw e; }));

  const snap = (db, col, id, row) => ({
    id, exists: !!row, ref: db.collection(col).doc(id),
    data: () => (row ? dec(row.data) : undefined),
  });

  // ── operace nad jedním dokumentem; exec = pool.query nebo klient transakce ──
  const ops = db => ({
    async get(exec, col, id, lock) {
      const r = await exec(`SELECT data FROM docs WHERE col = $1 AND id = $2${lock ? ' FOR UPDATE' : ''}`, [col, id]);
      return snap(db, col, id, r.rows[0]);
    },
    async set(exec, col, id, data, opt) {
      const sql = opt?.merge
        ? 'INSERT INTO docs (col, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (col, id) DO UPDATE SET data = docs.data || EXCLUDED.data'
        : 'INSERT INTO docs (col, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (col, id) DO UPDATE SET data = EXCLUDED.data';
      await exec(sql, [col, id, JSON.stringify(enc(data))]);
    },
    async create(exec, col, id, data) {
      const r = await exec('INSERT INTO docs (col, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (col, id) DO NOTHING',
        [col, id, JSON.stringify(enc(data))]);
      if (r.rowCount === 0) throw codeError(6, 'Dokument už existuje');
    },
    async update(exec, col, id, fields) {
      const keys = Object.keys(fields);
      if (!keys.some(k => k.includes('.'))) {
        const r = await exec('UPDATE docs SET data = data || $3::jsonb WHERE col = $1 AND id = $2',
          [col, id, JSON.stringify(enc(fields))]);
        if (r.rowCount === 0) throw codeError(5, 'Dokument neexistuje');
        return;
      }
      const r = await exec('SELECT data FROM docs WHERE col = $1 AND id = $2 FOR UPDATE', [col, id]);
      if (!r.rows[0]) throw codeError(5, 'Dokument neexistuje');
      const data = r.rows[0].data;
      for (const k of keys) setPath(data, k, enc(fields[k]));
      await exec('UPDATE docs SET data = $3::jsonb WHERE col = $1 AND id = $2', [col, id, JSON.stringify(data)]);
    },
    async del(exec, col, id) {
      await exec('DELETE FROM docs WHERE col = $1 AND id = $2', [col, id]);
    },
  });

  const db = {};
  const O = ops(db);
  const direct = async (fn) => { await init(); return fn((t, p) => pool.query(t, p)); };

  class Ref {
    constructor(col, id) { this.col = col; this.id = id; }
    get() { return direct(x => O.get(x, this.col, this.id, false)); }
    set(data, opt) { return direct(x => O.set(x, this.col, this.id, data, opt)); }
    create(data) { return direct(x => O.create(x, this.col, this.id, data)); }
    update(fields) {
      if (Object.keys(fields).some(k => k.includes('.'))) return db.runTransaction(tx => { tx.update(this, fields); });
      return direct(x => O.update(x, this.col, this.id, fields));
    }
    delete() { return direct(x => O.del(x, this.col, this.id)); }
  }

  class Query {
    constructor(col, filters = [], order = null, lim = null) { this.col = col; this.filters = filters; this.order = order; this.lim = lim; }
    where(field, op, value) {
      if (op !== '==') throw new Error('Podporované je jen where(..., "==", ...)');
      return new Query(this.col, [...this.filters, [field, value]], this.order, this.lim);
    }
    orderBy(field, dir = 'asc') { return new Query(this.col, this.filters, [field, dir], this.lim); }
    limit(n) { return new Query(this.col, this.filters, this.order, n); }
    async get() {
      await init();
      const params = [this.col];
      let sql = 'SELECT id, data FROM docs WHERE col = $1';
      for (const [f, v] of this.filters) { params.push(JSON.stringify({ [f]: enc(v) })); sql += ` AND data @> $${params.length}::jsonb`; }
      let rows = (await pool.query(sql, params)).rows.map(r => ({ id: r.id, data: dec(r.data) }));
      if (this.order) {
        const [f, dir] = this.order;
        rows.sort((a, b) => cmp(a.data[f], b.data[f]) * (dir === 'desc' ? -1 : 1));
      }
      if (this.lim) rows = rows.slice(0, this.lim);
      const docs = rows.map(r => ({ id: r.id, exists: true, ref: new Ref(this.col, r.id), data: () => dec(enc(r.data)) }));
      return { docs, size: docs.length, empty: docs.length === 0, forEach: fn => docs.forEach(fn) };
    }
  }

  class Collection extends Query {
    constructor(col) { super(col); }
    doc(id) {
      if (typeof id !== 'string' || !id || id.length > 200) throw new Error('Neplatné id dokumentu');
      return new Ref(this.col, id);
    }
    async add(data) {
      const ref = new Ref(this.col, crypto.randomBytes(15).toString('base64url'));
      await ref.create(data);
      return ref;
    }
  }

  db.collection = col => new Collection(col);
  db.getAll = (...refs) => Promise.all(refs.map(r => r.get()));

  db.runTransaction = async fn => {
    await init();
    for (let attempt = 0; ; attempt++) {
      const client = await pool.connect();
      let broken = false;
      try {
        await client.query('BEGIN');
        const exec = (t, p) => client.query(t, p);
        // zápisy se řadí za sebe a provedou se před dalším čtením a před COMMIT (jako buffer ve Firestore)
        let chain = Promise.resolve(), failed = null;
        const flush = async () => { await chain; if (failed) throw failed; };
        const queue = op => { chain = chain.then(op).catch(e => { failed ||= e; }); return tx; };
        const tx = {
          get: async ref => { await flush(); return O.get(exec, ref.col, ref.id, true); },
          set: (ref, data, opt) => queue(() => O.set(exec, ref.col, ref.id, data, opt)),
          create: (ref, data) => queue(() => O.create(exec, ref.col, ref.id, data)),
          update: (ref, fields) => queue(() => O.update(exec, ref.col, ref.id, fields)),
          delete: ref => queue(() => O.del(exec, ref.col, ref.id)),
        };
        const result = await fn(tx);
        await flush();
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { broken = true; }
        if (RETRYABLE.has(err.code) && attempt < 3) continue;
        throw err;
      } finally {
        client.release(broken || undefined);
      }
    }
  };

  // úklid prošlých záznamů (rate limity a kódy pro přihlášení)
  db.cleanup = async () => {
    await init();
    await pool.query(
      `DELETE FROM docs WHERE (col = 'rate_limits' AND (data->>'resetAt')::bigint < $1)
         OR (col = 'admin_challenges' AND (data->'expiresAt'->>'$d')::timestamptz < now())`,
      [Date.now()],
    );
  };

  return db;
}

let pool = null, db = null;
function getDb() {
  if (db) return db;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL není nastavená');
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 12000 });
  pool.on('error', e => console.error('pg pool error:', e.message));
  db = makeDb(pool);
  return db;
}

module.exports = { makeDb, getDb };
