# InkThreadHub — WhatsApp Alert Server (Baileys)

Make.com ka pipeline khatam hota hai → is server ko HTTP call → **alag SIM** wala WhatsApp → alert **+91 9194115127** pe.

```
Make.com ──HTTP POST /alert──► Render (ye server) ──Baileys──► Alag SIM WhatsApp ──► 919194115127
                                    │
                                    └── session Supabase me save (restart pe QR nahi)
```

**Kharcha: ₹0.** Render free + Supabase free (aapka existing account). Card nahi chahiye.

---

## Step 1 — Supabase table (session save karne ke liye)

1. https://supabase.com/dashboard → apna project kholo (naya bhi bana sakte ho, Region: **Mumbai**).
2. Left menu → **SQL Editor** → **New query**.
3. `supabase.sql` file ka poora text paste karo → **Run**. `wa_auth` table ban jayega.
4. **Project Settings → API Keys** (ya **Data API**):
   - **Project URL** copy karo → ye `SUPABASE_URL` hai.
   - **Secret key** (`sb_secret_...`) copy karo. Purane project me naam **service_role** hai. Ye `SUPABASE_SECRET_KEY` hai.

⚠️ Secret key ko kabhi website / Make.com / public jagah mat daalna. Sirf Render me.

⚠️ Supabase free project 7 din bina use ke **pause** ho jata hai. Roz ka alert use karta rahega, toh pause nahi hoga. Pipeline hafte bhar band rahe, toh dashboard se **Restore** dabao.

## Step 2 — API_KEY banao

Koi bhi lamba random text. Example banane ke liye: https://www.uuidgenerator.net → copy.
Ye password hai. Sirf Render aur Make.com me daalna hai. Kisi ko mat dikhana.

## Step 3 — Render pe deploy

1. https://render.com → **GitHub se sign up**.
2. **New → Blueprint** → repo `Aiauto` select karo → branch select karo.
   (Repo root ka `render.yaml` sab settings khud bhar dega.)
3. Env variables maangega:
   | Key | Value |
   |---|---|
   | `SUPABASE_URL` | Step 1 ka Project URL |
   | `SUPABASE_SECRET_KEY` | Step 1 ki secret key |
   | `API_KEY` | Step 2 wali key |
   | `SENDER_NUMBER` | Alag SIM ka number, `91` ke saath (jaise `91XXXXXXXXXX`) |
   | `ALERT_TO` | `919194115127` (pehle se bhara) |
4. **Apply** → 2–3 min me deploy. URL milega jaise `https://inkthreadhub-wa-alert.onrender.com`.

## Step 4 — Alag SIM wala WhatsApp link karo (sirf ek baar)

Alag SIM pe normal **WhatsApp** (ya WhatsApp Business) app install karke chalu rakho.

**Tareeka A — Pairing code (aasaan, phone pe hi):**
1. Browser me kholo: `https://<render-url>/pair?key=<API_KEY>`
2. 8 akshar ka code milega.
3. Alag SIM phone → WhatsApp → ⋮ → **Linked devices** → **Link a device** → **Link with phone number instead** → code daalo.

**Tareeka B — QR:**
1. Laptop pe kholo: `https://<render-url>/qr?key=<API_KEY>`
2. Alag SIM phone → **Linked devices** → **Link a device** → QR scan.

Check: `https://<render-url>/health` → `"status":"open"` aana chahiye.

## Step 5 — Test

ReqBin (https://reqbin.com) ya Make.com HTTP module se:

```
POST https://<render-url>/alert
Header: x-api-key: <API_KEY>
Header: Content-Type: application/json

{
  "status": "PUBLISHED",
  "run_id": "TEST-001",
  "date": "23-11-2026 10:00",
  "topic": "Oversized anime tees",
  "fb_post_id": "123",
  "ig_post_id": "456"
}
```

919194115127 pe aayega:
```
✅ InkThreadHub — Post Live

🆔 Run: TEST-001
📅 23-11-2026 10:00
🔥 Topic: Oversized anime tees
📘 FB: 123
📸 IG: 456
```

---

## Make.com me kaise lagana hai

**Module:** HTTP → *Make a request*

| Field | Value |
|---|---|
| URL | `https://<render-url>/alert` |
| Method | `POST` |
| Headers | `x-api-key` = `<API_KEY>` |
| Body type | Raw → `JSON (application/json)` |
| Timeout | **120** (Render free so jata hai, jaagne me ~50 sec) |
| Parse response | Yes |

**Success branch body:**
```json
{
  "status": "PUBLISHED",
  "run_id": "{{executionId}}",
  "date": "{{formatDate(now; "DD-MM-YYYY HH:mm"; "Asia/Kolkata")}}",
  "topic": "{{short_topic}}",
  "fb_post_id": "{{FB id}}",
  "ig_post_id": "{{IG id}}",
  "image_url": "{{Cloudinary secure_url}}"
}
```

**Error handler body:**
```json
{
  "status": "FAILED",
  "run_id": "{{executionId}}",
  "date": "{{formatDate(now; "DD-MM-YYYY HH:mm"; "Asia/Kolkata")}}",
  "module": "Gemini / Cloudflare / Cloudinary / Meta",
  "error": "{{error.message}}"
}
```

`image_url` diya toh alert ke saath post ki photo bhi aayegi.

---

## Endpoints

| Route | Kaam |
|---|---|
| `GET /health` | Status (`open` = connected) |
| `GET /qr?key=` | QR page (pehli baar) |
| `GET /pair?key=` | Pairing code (pehli baar) |
| `POST /alert` | Ready-made alert → `ALERT_TO` |
| `POST /send` | Apna text: `{ "message", "image_url" }` → sirf `ALERT_TO` |

Har POST pe header `x-api-key` zaroori.

---

## Ban se bachne ke rules

- Server **sirf `ALERT_TO`** (aapka number) pe message bhejta hai. Kisi aur number pe bhejne ka option code me hai hi nahi.

- Sender **sirf alag SIM**. 9194115127 ko kabhi is server se link mat karna.
- Din me 1–5 message tak. Bulk / unknown numbers ko mat bhejna.
- Alag SIM ka phone mahine me ek baar on karo, WhatsApp kholo. Linked device 14 din phone offline rahe toh logout ho jata hai.
- 9194115127 se alag SIM ko ek baar "Hi" bhej do. Dono ek-dusre ke contact me save rakho.

## Dikkat aaye toh

| Problem | Fix |
|---|---|
| `/health` me `qr` dikh raha | Session gaya. Step 4 dobara karo. |
| Make me timeout | HTTP module timeout 120 karo. |
| `401 Unauthorized` | `x-api-key` galat. |
| `503 WhatsApp not connected` | Render logs dekho. 1 min baad retry. |
| Render deploy fail / `Supabase:` error | URL + secret key check karo. `supabase.sql` run hua ya nahi dekho. Project paused toh Restore. |

**Optional:** Render ko jagaa rakhne ke liye https://uptimerobot.com (free) se `/health` pe har 10 min ping. Alert turant aayega.
