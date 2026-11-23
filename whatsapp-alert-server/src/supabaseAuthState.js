// Baileys auth state (creds + Signal keys) ko Supabase table `wa_auth` me save karta hai.
//
// Safety rules:
// - DB read fail ho toh error throw hota hai. Kabhi bhi chupke se fresh session nahi banta.
// - Saare writes ek queue me, ek ke baad ek (same key pe delete + upsert race nahi hogi).
// - Temporary DB failure pe write retry hota hai.
// - Session values kabhi log nahi hote.
import { initAuthCreds, BufferJSON, proto } from 'baileys';

export const AUTH_TABLE = 'wa_auth';
export const LEASE_ID = '__lease';
const CREDS_ID = 'creds';
const CHUNK = 100;

export class AuthStoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthStoreError';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunks = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

export async function useSupabaseAuthState(
  supabase,
  { table = AUTH_TABLE, retries = 5, retryBaseMs = 500, onStoreError = () => {} } = {}
) {
  const fail = (op, error) => {
    const err = new AuthStoreError(`Supabase ${op} failed: ${error?.message || error}`);
    onStoreError(err);
    throw err;
  };

  // Write ko retry ke saath chalao (temporary network / DB failure).
  const withRetry = async (op, fn) => {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const { error } = await Promise.resolve().then(fn).catch((e) => ({ error: e }));
      if (!error) return;
      lastErr = error;
      if (attempt < retries) await sleep(retryBaseMs * 2 ** attempt);
    }
    fail(op, lastErr);
  };

  // Saare writes serial queue me.
  let queue = Promise.resolve();
  let detached = false;
  const enqueue = (fn) => {
    if (detached) return Promise.resolve(); // purane socket ke late writes ignore
    const p = queue.then(fn);
    queue = p.catch(() => {});
    return p;
  };

  const readMany = async (ids) => {
    const out = {};
    for (const part of chunks(ids, CHUNK)) {
      const { data, error } = await supabase.from(table).select('id, value').in('id', part);
      if (error) fail('read', error);
      for (const row of data) out[row.id] = JSON.parse(row.value, BufferJSON.reviver);
    }
    return out;
  };

  const writeMany = (rows) =>
    rows.length
      ? enqueue(async () => {
          const now = new Date().toISOString();
          for (const part of chunks(rows, CHUNK)) {
            const payload = part.map(([id, value]) => ({
              id,
              value: JSON.stringify(value, BufferJSON.replacer),
              updated_at: now,
            }));
            await withRetry('write', () => supabase.from(table).upsert(payload));
          }
        })
      : Promise.resolve();

  const removeMany = (ids) =>
    ids.length
      ? enqueue(async () => {
          for (const part of chunks(ids, CHUNK)) {
            await withRetry('delete', () => supabase.from(table).delete().in('id', part));
          }
        })
      : Promise.resolve();

  // Load: error aaya toh throw (fresh session NAHI banega).
  const existing = (await readMany([CREDS_ID]))[CREDS_ID];
  const creds = existing || initAuthCreds();

  return {
    isNew: !existing,
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const found = await readMany(ids.map((id) => `${type}-${id}`));
          const data = {};
          for (const id of ids) {
            let value = found[`${type}-${id}`] ?? null;
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          const upserts = [];
          const deletes = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) upserts.push([key, value]);
              else deletes.push(key);
            }
          }
          // Order fix: pehle deletes, phir upserts — dono queue me.
          await Promise.all([removeMany(deletes), writeMany(upserts)]);
        },
      },
    },
    saveCreds: () => writeMany([[CREDS_ID, creds]]),
    /** Pending writes khatam hone ka wait. */
    flush: () => queue,
    /** Iske baad naye writes ignore (purana socket band hone ke baad). */
    detach: () => {
      detached = true;
    },
    /** Logged-out session saaf karo. Lease row ko nahi chhedta. */
    clear: async () => {
      await queue;
      await withRetry('clear', () => supabase.from(table).delete().neq('id', LEASE_ID));
    },
  };
}
