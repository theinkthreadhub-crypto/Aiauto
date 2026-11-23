// In-memory Supabase/PostgREST fake: select/in/eq/neq/or/upsert/update/delete + error injection.
export function createFakeSupabase() {
  const rows = new Map(); // id -> { id, value, updated_at }
  const failures = []; // queue of { op, times }
  let calls = { select: 0, upsert: 0, update: 0, delete: 0 };

  const shouldFail = (op) => {
    const f = failures.find((x) => (x.op === op || x.op === '*') && x.times > 0);
    if (f) { f.times--; return { message: `injected ${op} failure` }; }
    return null;
  };

  const splitOr = (s) => { const out = []; let cur = '', q = false; for (const c of s) { if (c === '"') q = !q; if (c === ',' && !q) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; };
  const parseCond = (s) => { const [col, op, ...rest] = s.split('.'); let v = rest.join('.'); if (v.startsWith('"')) v = v.slice(1, -1); return { col, op, v }; };
  const test = (row, { col, op, v }) => {
    const x = row[col];
    if (op === 'eq') return x === v;
    if (op === 'neq') return x !== v;
    if (op === 'lt') return x < v;
    if (op === 'in') return v.includes(x);
    throw new Error('op ' + op);
  };

  function builder(op, payload, opts) {
    const filters = [];
    let wantSelect = op === 'select';
    const b = {
      select() { wantSelect = true; return b; },
      eq(col, v) { filters.push((r) => test(r, { col, op: 'eq', v })); return b; },
      neq(col, v) { filters.push((r) => test(r, { col, op: 'neq', v })); return b; },
      in(col, v) { filters.push((r) => test(r, { col, op: 'in', v })); return b; },
      or(expr) { const conds = splitOr(expr).map(parseCond); filters.push((r) => conds.some((c) => test(r, c))); return b; },
      then(resolve, reject) {
        try {
          calls[op]++;
          const err = shouldFail(op);
          if (err) return resolve({ data: null, error: err });
          const match = () => [...rows.values()].filter((r) => filters.every((f) => f(r)));
          if (op === 'select') return resolve({ data: match().map(({ id, value }) => ({ id, value })), error: null });
          if (op === 'upsert') {
            for (const r of [].concat(payload)) {
              if (rows.has(r.id) && opts?.ignoreDuplicates) continue;
              rows.set(r.id, { updated_at: new Date().toISOString(), ...rows.get(r.id), ...r });
            }
            return resolve({ data: null, error: null });
          }
          if (op === 'update') { const m = match(); m.forEach((r) => Object.assign(r, payload)); return resolve({ data: wantSelect ? m.map((r) => ({ id: r.id })) : null, error: null }); }
          if (op === 'delete') { match().forEach((r) => rows.delete(r.id)); return resolve({ data: null, error: null }); }
        } catch (e) { reject(e); }
      },
    };
    return b;
  }

  return {
    rows,
    calls,
    failNext(op, times = 1) { failures.push({ op, times }); },
    from() {
      return {
        select: () => builder('select'),
        upsert: (p, o) => builder('upsert', p, o),
        update: (p) => builder('update', p),
        delete: () => builder('delete'),
      };
    },
  };
}
