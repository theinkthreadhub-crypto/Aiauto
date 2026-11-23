// Single-instance lock (lease) — Supabase `wa_auth` table ki ek special row `__lease`.
// Render deploy ke time naya + purana instance thodi der saath chalte hain.
// Lease jiske paas hai, sirf wahi WhatsApp se connect karega.
import { AUTH_TABLE, LEASE_ID } from './supabaseAuthState.js';

const EPOCH = new Date(0).toISOString();

export function createLease(supabase, { owner, ttlMs = 90_000, table = AUTH_TABLE, now = () => Date.now() }) {
  if (!/^[A-Za-z0-9-]+$/.test(owner)) throw new Error('lease owner must be alphanumeric/dash');

  const check = (op, error) => {
    if (error) throw new Error(`Supabase lease ${op} failed: ${error.message}`);
  };

  return {
    owner,
    ttlMs,
    /** true = lease mil gaya / renew hua. false = kisi aur instance ke paas hai. Throw = DB error. */
    async acquire() {
      const { error: insErr } = await supabase
        .from(table)
        .upsert({ id: LEASE_ID, value: '', updated_at: EPOCH }, { onConflict: 'id', ignoreDuplicates: true });
      check('init', insErr);

      const t = now();
      const cutoff = new Date(t - ttlMs).toISOString();
      const { data, error } = await supabase
        .from(table)
        .update({ value: owner, updated_at: new Date(t).toISOString() })
        .eq('id', LEASE_ID)
        .or(`value.eq.${owner},updated_at.lt."${cutoff}"`)
        .select('id');
      check('acquire', error);
      return data.length === 1;
    },
    /** Shutdown pe lease chhodo, taaki naya instance turant le sake. */
    async release() {
      const { error } = await supabase
        .from(table)
        .update({ value: '', updated_at: EPOCH })
        .eq('id', LEASE_ID)
        .eq('value', owner);
      check('release', error);
    },
  };
}
