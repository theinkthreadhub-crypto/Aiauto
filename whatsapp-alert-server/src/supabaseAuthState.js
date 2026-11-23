// Baileys session ko Supabase table `wa_auth` me save karta hai.
// Render restart / sleep ke baad QR dobara scan nahi karna padega.
import { initAuthCreds, BufferJSON, proto } from 'baileys';

const TABLE = 'wa_auth';

export async function useSupabaseAuthState(supabase) {
  const check = ({ error }) => {
    if (error) throw new Error(`Supabase: ${error.message}`);
  };

  const readMany = async (ids) => {
    if (!ids.length) return {};
    const { data, error } = await supabase.from(TABLE).select('id, value').in('id', ids);
    if (error) throw new Error(`Supabase: ${error.message}`);
    const out = {};
    for (const row of data) out[row.id] = JSON.parse(row.value, BufferJSON.reviver);
    return out;
  };

  const writeMany = async (rows) => {
    if (!rows.length) return;
    check(
      await supabase.from(TABLE).upsert(
        rows.map(([id, value]) => ({ id, value: JSON.stringify(value, BufferJSON.replacer) }))
      )
    );
  };

  const removeMany = async (ids) => {
    if (!ids.length) return;
    check(await supabase.from(TABLE).delete().in('id', ids));
  };

  const creds = (await readMany(['creds'])).creds || initAuthCreds();

  return {
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
              value ? upserts.push([key, value]) : deletes.push(key);
            }
          }
          await Promise.all([writeMany(upserts), removeMany(deletes)]);
        },
      },
    },
    saveCreds: () => writeMany([['creds', creds]]),
    clear: async () => check(await supabase.from(TABLE).delete().neq('id', '')),
  };
}
