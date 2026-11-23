# InkThreadHub — Personal WhatsApp Alert Server (Baileys + Supabase)

Make.com pipeline → is server ko HTTP call → **alag SIM** wala WhatsApp → alert **sirf aapke number** pe.

```
Make.com ──POST /alert──► Render (ye server) ──Baileys──► Alag SIM WhatsApp ──► ALERT_TO (aapka phone)
                               │
                               └── session + Signal keys + lock → Supabase `wa_auth`
```

- Kharcha **₹0**: Render Free + Supabase Free.
- Sirf `ALERT_TO` pe message jata hai. Code me kisi aur number ka option hi nahi.
- Baileys **unofficial** hai. WhatsApp kabhi bhi linked device hata sakta hai.

---

## Kya kya bana hai

| Feature | Kaise |
|---|---|
| Session save | Creds **aur** saari Signal keys (pre-key, session, sender-key, app-state-sync-key, lid-mapping, device-list, tctoken) Supabase me. Update + delete dono. |
| Binary data | Baileys ka apna `BufferJSON` (installed v7.0.0-rc14 jaisa). App-state keys `proto` me wapas. |
| DB fail | Load fail → error, **fresh session kabhi nahi**. Write fail → 5 baar retry (0.5s → 8s). |
| Race safety | Saare writes ek queue me, ek ke baad ek. |
| Ek hi connection | Supabase lease lock (`__lease` row, 90s TTL, 30s renew). Deploy ke time 2 instance ek session nahi chalate. |
| Reconnect | 401 = logout → session saaf, naya QR. 515 = turant. 440 = 60s wait. 403 = 10 min wait, session nahi mitata. Baaki = 2s→60s backoff. |
| Secrets | API key sirf header / POST form me, URL me nahi. QR, creds, keys log nahi hote. Baileys logs `silent`. |

---

## Step 1 — Supabase ✅ (ho chuka)

- Project: `inkthreadhub-wa-alerts` (Mumbai)
- Table `public.wa_auth` bana hua hai, RLS ON, koi policy nahi. Ye sahi hai, sirf server access karega.
- "RLS Enabled No Policy" notice ignore karo. **RLS band mat karna.**

**Bacha hua kaam: secret key lo.**
Supabase → Project Settings → **API Keys** → **Secret keys** → `sb_secret_...` copy karo.
(Purane project me naam `service_role` hai. Wo bhi chalega.)
❌ Publishable / anon key **nahi** chalegi.
❌ Key ko chat, GitHub ya Make.com me mat daalna. **Sirf Render me.**

## Step 2 — API_KEY banao

Kam se kam 24 akshar ka random text. Example: https://www.uuidgenerator.net se 2 UUID jodo.
Ye Render aur Make.com dono me jayega.

## Step 3 — Render deploy

1. https://render.com → GitHub se login.
2. **New → Blueprint** → repo `Aiauto` → branch choose karo → `render.yaml` khud settings bharega.
3. Environment me ye daalo:

| Key | Value | Kahan se |
|---|---|---|
| `SUPABASE_URL` | `https://ueefxkomucnkvvmqrdmw.supabase.co` | pehle se bhara |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` | Step 1 |
| `API_KEY` | aapki random key | Step 2 |
| `SENDER_NUMBER` | alag SIM, `91` ke saath, jaise `91XXXXXXXXXX` | — |
| `ALERT_TO` | `919194115127` | pehle se bhara |
| `NODE_VERSION` | `22` | pehle se bhara |

4. **Apply**. 2–3 min me URL milega, jaise `https://inkthreadhub-wa-alert.onrender.com`.
5. Logs me dikhna chahiye: `Lease mila` → `Koi saved session nahi mila`.

## Step 4 — Alag SIM link karo (sirf pehli baar)

**Pairing code (aasaan):**
1. Browser me `https://<render-url>/pair` kholo → API_KEY daalo → Continue.
2. 8 akshar ka code milega.
3. Alag SIM phone → WhatsApp → ⋮ → **Linked devices** → **Link a device** → **Link with phone number instead** → code daalo.

**Ya QR:** `https://<render-url>/qr` → API_KEY → QR scan karo.

**Check:** `https://<render-url>/health`
```json
{"ok":true,"status":"open","store":"ok","lease":true}
```

## Step 5 — Test alert

ReqBin (https://reqbin.com) se:
```
POST https://<render-url>/alert
x-api-key: <API_KEY>
Content-Type: application/json

{"status":"PUBLISHED","run_id":"TEST-001","topic":"Oversized anime tees","fb_post_id":"123","ig_post_id":"456"}
```

## Step 6 — Restart test (zaroori)

Render → **Manual Deploy → Restart service**. 1 min baad `/health` → `"status":"open"`.
QR **nahi** maangna chahiye. Logs: `Saved session Supabase se load hua` → `WhatsApp connected ✅`.

---

## Make.com HTTP module

| Field | Value |
|---|---|
| URL | `https://<render-url>/alert` |
| Method | `POST` |
| Header | `x-api-key` = API_KEY |
| Body | Raw → JSON |
| Timeout | **120** |

Success body:
```json
{"status":"PUBLISHED","run_id":"{{executionId}}","date":"{{formatDate(now; \"DD-MM-YYYY HH:mm\"; \"Asia/Kolkata\")}}","topic":"{{short_topic}}","fb_post_id":"{{FB id}}","ig_post_id":"{{IG id}}","image_url":"{{Cloudinary secure_url}}"}
```
Error handler body:
```json
{"status":"FAILED","run_id":"{{executionId}}","module":"Gemini","error":"{{error.message}}"}
```
`image_url` sirf `https://` hona chahiye.

---

## `/health` ka matlab

| status | Matlab | Kya karein |
|---|---|---|
| `open` | Sab theek | — |
| `connecting` / `reconnecting` | Jud raha hai | 1 min ruko |
| `qr` | Link nahi hai | Step 4 |
| `logged_out` | Phone se unlink hua | Step 4 dobara |
| `waiting_lease` | Dusra instance chal raha (deploy ke time) | 1–2 min ruko |
| `replaced` | Kisi aur ne isi session se connect kiya | 1 min me khud retry |
| `forbidden` | Number restricted/banned | Alag SIM phone me WhatsApp kholo |
| `store_error` / `"store":"error"` | Supabase nahi mil raha | Supabase paused? → Resume |

---

## Testing status

| Check | Status |
|---|---|
| Creds + saari key types save/load (binary sahi) | ✅ Unit test |
| Key update + delete | ✅ Unit test |
| Restart pe saved state load (fake DB) | ✅ Unit test |
| DB read fail → fresh session nahi banta | ✅ Unit test |
| Temporary write fail → retry | ✅ Unit test |
| Logged-out → session saaf, lease bachta hai | ✅ Unit test |
| Lease: ek hi instance, expiry, release | ✅ Unit test |
| Reconnect decisions (401/403/440/515/408) | ✅ Unit test |
| supabase-js ki asli HTTP requests ka format | ✅ Local capture |
| Asli Supabase se connection | ⏳ **Pending** (Render pe) |
| Pehla QR / pairing login | ⏳ **Pending** |
| Restart ke baad bina QR connect | ⏳ **Pending** (Step 6) |
| Asli message 919194115127 pe | ⏳ **Pending** (Step 5) |
| Phone se unlink → naya QR | ⏳ **Pending** |

Tests chalane ke liye: `npm test`

---

## Imaandari se limits

- **Render Free 15 min bina traffic ke so jata hai.** So rahe server ka WhatsApp connection band rehta hai. Make.com call usse jagata hai. Jaagne + connect me 30–70 sec lagte hain. Isliye Make timeout 120.
- **24/7 guarantee nahi.** Render down, Supabase paused ya WhatsApp issue → alert miss ho sakta hai. Make.com ka Google Sheet log hi asli record hai.
- **Supabase Free 7 din kam activity pe pause.** Roz ka alert use active rakhta hai. Pause hua toh: Dashboard → organization → project → **Resume project**.
- **Saved session QR kam karta hai, rok nahi sakta.** WhatsApp linked device kabhi bhi hata sakta hai. Alag SIM phone 14+ din offline raha toh bhi.
- Alag SIM phone mahine me ek baar on karke WhatsApp kholo.
- Optional: UptimeRobot (free) se `/health` pe har 10 min ping → server jaga rahega. Render free 750 ghante/mahina deta hai, ek service ke liye kaafi.
