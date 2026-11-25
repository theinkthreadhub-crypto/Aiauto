# STATUS.md — whatsapp-alert-server (module status)

> Master status: repo root ka `AI_HANDOFF.md`. Ye file sirf is folder ki detail hai.
> Is folder me kaam karo toh yahan bhi update karo, aur `AI_HANDOFF.md` ke work log me entry daalo.

**Last updated:** 2026-11-25 · **By:** Claude · **Last code commit:** `2f076e2`

---

## Kya hai

Personal WhatsApp alert server. Make.com → `POST /alert` → Baileys (alag SIM) → **sirf** `ALERT_TO` (919194115127).
Stack: Node 22, `baileys@7.0.0-rc14` (pinned), Express 4, `@supabase/supabase-js@2`, Render Free.

## Features status

| Feature | File | Status |
|---|---|---|
| Creds + sab Signal keys Supabase me (update + delete) | `src/supabaseAuthState.js` | ✅ tested (fake DB) |
| Baileys `BufferJSON` serialization, app-state key → `proto` | `src/supabaseAuthState.js` | ✅ tested |
| Writes serial queue + retry (5x, 0.5s→8s) | `src/supabaseAuthState.js` | ✅ tested |
| DB load fail → throw, fresh session kabhi nahi | `src/supabaseAuthState.js` | ✅ tested |
| Single-instance lease (`__lease` row, TTL 90s, renew 30s) | `src/lease.js` | ✅ tested |
| Disconnect code → action (401/403/440/515/other) | `src/reconnect.js` | ✅ tested |
| Sirf `ALERT_TO` pe send (koi `to` param nahi) | `src/index.js` | ✅ code review |
| API key: header / POST form, timing-safe compare | `src/index.js` | 🧪 untested live |
| `/qr`, `/pair` pages (form-based, key URL me nahi) | `src/index.js` | 🧪 untested live |
| `/alert` formatted message + optional https image | `src/index.js` | 🧪 untested live |
| SIGTERM pe socket band + lease release | `src/index.js` | 🧪 untested live |

## Live tests (deploy ke baad)

| Test | Status |
|---|---|
| Render pe asli Supabase connect | ⏳ |
| Pehla pairing / QR login | ⏳ |
| `/alert` → message 919194115127 pe aaya | ⏳ |
| Restart → bina QR reconnect | ⏳ |
| Phone se unlink → `logged_out` → naya QR | ⏳ |
| Supabase paused → `store_error`, session safe | ⏳ |

Live test karo toh upar ⏳ ko ✅ / ❌ karo, date + AI naam ke saath.

## Endpoints

| Route | Auth | Kaam |
|---|---|---|
| `GET /health` | none | `{status, store, lease}` |
| `GET/POST /qr` | POST form `key` | QR page |
| `GET/POST /pair` | POST form `key` | Pairing code (`SENDER_NUMBER`) |
| `POST /alert` | header `x-api-key` | Make.com alert |
| `POST /send` | header `x-api-key` | Free text → sirf `ALERT_TO` |

## Mat todna (invariants)

- Kisi bhi endpoint me recipient number input **mat** jodna.
- `BAILEYS_LOG_LEVEL` default `silent`. `debug`/`trace` me keys log ho sakti hain.
- `clear()` lease row (`__lease`) ko nahi mitata.
- Load fail pe `initAuthCreds()` fallback **mat** lagana.
- `baileys` version badlo toh `npm test` + live restart test dobara.

## Commands

```bash
cd whatsapp-alert-server
npm ci
npm test     # 19 tests
npm start    # env: SUPABASE_URL, SUPABASE_SECRET_KEY, API_KEY (24+ chars)
```

## Known limits

Render Free 15 min idle pe sota hai (jaagne + connect 30–70s, Make timeout 120s). Supabase Free 7 din kam activity pe pause. Baileys unofficial. Alag SIM phone 14+ din offline = unlink.
