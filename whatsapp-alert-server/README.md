# InkThreadHub — WhatsApp Alert Server (Baileys)

Make.com ka pipeline khatam hota hai → is server ko HTTP call → **alag SIM** wala WhatsApp → alert **+91 9194115127** pe.

```
Make.com ──HTTP POST /alert──► Render (ye server) ──Baileys──► Alag SIM WhatsApp ──► 919194115127
                                    │
                                    └── session MongoDB Atlas me save (restart pe QR nahi)
```

**Kharcha: ₹0.** Render free + MongoDB Atlas free. Card nahi chahiye.

---

## Step 1 — MongoDB Atlas (session save karne ke liye)

1. https://www.mongodb.com/cloud/atlas/register → Google se sign up.
2. **Create cluster** → **M0 Free** → Region: **Mumbai (ap-south-1)** → Create.
3. **Database Access** → Add user → username `inkbot`, strong password → Role: *Read and write to any database*.
4. **Network Access** → Add IP → `0.0.0.0/0` (Render ka IP fix nahi hota).
5. **Connect** → Drivers → string copy karo:
   ```
   mongodb+srv://inkbot:<PASSWORD>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
   `<PASSWORD>` ki jagah asli password daalo. Ye `MONGODB_URI` hai.

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
   | `MONGODB_URI` | Step 1 wali string |
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
| `POST /send` | Koi bhi message: `{ "to", "message", "image_url" }` |

Har POST pe header `x-api-key` zaroori.

---

## Ban se bachne ke rules

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
| Render deploy fail | Logs me `MONGODB_URI` error → string / password / Network Access check karo. |

**Optional:** Render ko jagaa rakhne ke liye https://uptimerobot.com (free) se `/health` pe har 10 min ping. Alert turant aayega.
