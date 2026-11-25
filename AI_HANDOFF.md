# 🤝 AI_HANDOFF.md — InkThreadHub Automation (sabhi AI pehle ye padhein)

> **Ye file har AI ke liye hai** (Claude, ChatGPT, Antigravity/Gemini, ya koi aur).
> Kaam shuru karne se **pehle** poori padho. Kaam ke **baad** update karo.
> Ek se zyada AI ek hi time pe kaam kar sakte hain, isliye neeche ke rules follow karna zaroori hai.

**Last updated:** 2026-11-25 · **By:** Claude (Claude Code, cloud) · **Branch:** `ccr-846e7376-yg4jhe`

---

## 0. 60-second summary

- **Brand:** InkThreadHub, Indian print-on-demand streetwear.
- **Goal:** Roz 10:00 AM IST bina haath lagaye ye ho: trend uthao → caption + hashtags + AI image → Facebook + Instagram post → Google Sheet me log → WhatsApp alert.
- **Budget:** ₹0/month. Koi paid tool nahi, credit card wala API nahi.
- **Abhi kahan hain:** WhatsApp alert server ka **code ready aur tested** (unit tests). **Deploy baaki hai** (user ka kaam). Baaki pipeline (Gemini, image, posting, Make.com) **abhi shuru nahi hui.**

---

## 1. Rules for every AI (zaroor follow karo)

1. **Pehle sync:** repo me kaam karne se pehle `git pull origin ccr-846e7376-yg4jhe`. Purane copy pe kaam mat karo.
2. **Pehle claim:** section 4 "🔒 Active work" me apna naam + task + time likho, commit + push karo. **Phir** kaam shuru.
3. **Claimed task mat chhedo.** Kisi aur AI ne claim kiya hai toh dusra task lo. 2 ghante se purana claim = stale, user se poochh ke le sakte ho.
4. **Kaam khatam:** section 4 se claim hatao, section 5 "📜 Work log" me **upar** entry daalo, section 3 status update karo, commit + push.
5. **Commit message format:** `[AI-NAAM] kya kiya`, jaise `[Claude] Add Gemini prompt`.
6. **Decisions badalne se pehle** section 6 padho. Wahan likhi baat user ne decide ki hai. Badalna ho toh pehle user se poochho.
7. **Secrets kabhi file / commit / chat me nahi.** Sirf naam likho (section 7). Value sirf Render / Make.com settings me jaati hai.
8. **Jo test nahi hua, use "done" mat likho.** `⏳ Pending` ya `🧪 Untested` likho.
9. **Repo access nahi hai?** (jaise phone pe ChatGPT) → user ko section 5 ke format me entry do. User khud paste karega. Code kabhi "memory" se mat likho. User se current file maango.
10. Language: user ke saath **simple Hinglish**, chhote sentences.

---

## 2. Architecture (final plan)

```
⏰ Make.com Scheduler (10:00 AM IST)
   ↓
📰 RSS (Google Alerts primary, Reddit backup)
   ↓
🔍 Google Sheet dedup (Source_URL pehle aaya? → STOP)
   ↓
🧠 Gemini API (free) → JSON: short_topic, caption_text, hashtags, flux_image_prompt
   ↓
🎨 Cloudflare Workers AI FLUX-1-schnell → base64 image
   ↓
☁️ Cloudinary (free) → public https .jpg (secure_url)
   ↓
🔀 Router → Facebook Page post (FB_Post_ID) + Instagram post (IG_Post_ID)
   ↓
📊 Google Sheet row: PUBLISHED / FAILED
   ↓
📱 WhatsApp alert: Make HTTP → Render server → Baileys (alag SIM) → 919194115127
```

**Google Sheet columns:**
`Run_ID | Date_IST | Source_URL | Short_Topic | Caption | Image_Prompt | Cloudinary_URL | FB_Post_ID | IG_Post_ID | Status | Error_Log`

**Make.com free:** 1,000 ops/month. ~9–11 ops per run → ~300/month.

---

## 3. 📊 Status board

| # | Part | Status | Kahan | Note |
|---|---|---|---|---|
| 1 | WhatsApp alert server (code) | ✅ Done, 19 unit tests pass | `whatsapp-alert-server/` | Details: `whatsapp-alert-server/STATUS.md` |
| 2 | Supabase project + `wa_auth` table | ✅ Done (user ne kiya, verified) | Supabase dashboard | RLS ON, no policy — intentional |
| 3 | Supabase secret key → Render | ⏳ User ka kaam | Render env | |
| 4 | Render deploy | ⏳ User ka kaam | render.com | `render.yaml` ready |
| 5 | Alag SIM pairing (`/pair`) | ⏳ User ka kaam | browser | |
| 6 | Live tests (alert, restart, unlink) | ⏳ Pending | — | Deploy ke baad |
| 7 | Gemini system prompt + JSON schema | ❌ Not started | — | **Next suggested** |
| 8 | Cloudflare FLUX + Cloudinary upload | ❌ Not started | — | |
| 9 | Google Sheet (headers) | ❌ Not started | Google Drive | |
| 10 | Make.com scenario (modules + mapping) | ❌ Not started | make.com | |
| 11 | Error handlers + dedup filter | ❌ Not started | make.com | |
| 12 | RSS sources finalize | ❌ Not started | — | |
| 13 | 3-day test run → full auto | ❌ Not started | — | |

Legend: ✅ done · 🟡 in progress · ⏳ waiting (user / test) · ❌ not started · 🧪 written but untested

---

## 4. 🔒 Active work (claims)

> Kaam shuru karne se pehle yahan line daalo. Khatam hone pe hatao.

| AI | Task | Started (IST) | Files |
|---|---|---|---|
| — | (koi active claim nahi) | — | — |

---

## 5. 📜 Work log (naya sabse upar)

Format:
```
### YYYY-MM-DD HH:MM IST — [AI-NAAM] (tool/surface)
- Kya kiya:
- Files:
- Tested: haan/nahi + kaise
- Baaki / next:
```

### 2026-11-25 — [Claude] (Claude Code, cloud)
- Kya kiya: Multi-AI handoff system banaya.
- Files: `AI_HANDOFF.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `whatsapp-alert-server/STATUS.md`, `README.md`
- Tested: N/A (docs)
- Baaki / next: User deploy kare. Phir Gemini prompt.

### 2026-11-24 — [Claude] (Claude Code, cloud)
- Kya kiya: WhatsApp server hardened — writes serial + retry, DB fail pe fresh session nahi, single-instance lease lock, disconnect code ke hisaab se reconnect, API key sirf header/POST form, secrets log nahi.
- Files: `whatsapp-alert-server/src/*`, `whatsapp-alert-server/test/*`, `README.md`
- Tested: ✅ 19 unit tests (fake Supabase) + supabase-js request format local capture. ❌ Asli Supabase / WhatsApp nahi (cloud se blocked).
- Commit: `2f076e2`

### 2026-11-24 — [User + ChatGPT/other AI]
- Kya kiya: Supabase project `inkthreadhub-wa-alerts` (Mumbai) banaya, `wa_auth` table SQL run kiya, RLS ON verify kiya.
- Tested: ✅ table exists, 0 rows, service_role permissions OK.

### 2026-11-23 — [Claude] (Claude Code, cloud)
- Kya kiya: Architecture plan. Baileys alert server (pehle MongoDB, phir Supabase pe switch). `/send` sirf `ALERT_TO` pe lock. ChatGPT ke liye Supabase + Render prompts.
- Commits: `cca01a7` → `b4b3cd5` → `64184d9` → `2f7eb8f`

---

## 6. ✅ Decisions (user ne final kiye — bina poochhe mat badlo)

| Decision | Kyun | Rejected option |
|---|---|---|
| WhatsApp ke liye **Baileys + alag SIM** | Template approval nahi, free text + photo | Meta WhatsApp Cloud API |
| Alerts **sirf 919194115127** pe | Personal notification. Koi marketing nahi | Kisi aur number pe bhejna |
| Business number **sirf receiver**, kabhi Baileys se link nahi | Ban se bachao | — |
| Session storage **Supabase** | User ka existing account | MongoDB Atlas, Cloudflare D1 |
| Hosting **Render Free** | Free, card nahi | Oracle/AWS (card), laptop 24×7 |
| Orchestrator **Make.com Free** | No-code, 1,000 ops | n8n (future scale) |
| AI text **Gemini free** | Free, JSON mode | Paid OpenAI |
| Image **Cloudflare FLUX-1-schnell** | 10k neurons/day free | Paid image APIs |
| Image hosting **Cloudinary free** | IG ko public https URL chahiye | — |
| Gemini prompt me rule: **koi brand logo / copyrighted character nahi** | IG strike / trademark | — |

---

## 7. 🔑 Config & secrets (sirf NAAM — value kabhi nahi)

| Name | Kahan rehti hai | Status |
|---|---|---|
| `SUPABASE_URL` = `https://ueefxkomucnkvvmqrdmw.supabase.co` | `render.yaml` (public, OK) | ✅ |
| `SUPABASE_SECRET_KEY` | Render env only | ⏳ |
| `API_KEY` (server auth) | Render env + Make.com HTTP header | ⏳ |
| `SENDER_NUMBER` (alag SIM) | Render env | ⏳ |
| `ALERT_TO` = `919194115127` | `render.yaml` | ✅ |
| Gemini API key | Make.com | ❌ |
| Cloudflare account ID + API token | Make.com | ❌ |
| Cloudinary cloud name + upload preset | Make.com | ❌ |
| Meta (FB Page / IG) connection | Make.com | ❌ |

Supabase project ref: `ueefxkomucnkvvmqrdmw` · Region: Mumbai.

---

## 8. 📁 Repo map

```
Aiauto/
├── AI_HANDOFF.md          ← YE FILE (master status)
├── AGENTS.md / CLAUDE.md / GEMINI.md  ← sab AI ko yahan bhejte hain
├── README.md
├── render.yaml            ← Render Blueprint
└── whatsapp-alert-server/
    ├── STATUS.md          ← is module ka detail status
    ├── README.md          ← user ke liye setup guide (Hinglish)
    ├── supabase.sql       ← already run ho chuka
    ├── src/
    │   ├── index.js              ← Express server + Baileys socket
    │   ├── supabaseAuthState.js  ← creds + keys save/load
    │   ├── lease.js              ← single-instance lock
    │   └── reconnect.js          ← disconnect code → action
    └── test/                     ← `npm test` (node:test)
```

---

## 9. ⏭️ Next steps (priority order)

1. **User:** Supabase secret key → Render deploy → `/pair` → `/health` = `open` → test alert → restart test.
2. **AI:** Gemini system prompt + strict JSON schema (`short_topic`, `caption_text`, `hashtags`, `flux_image_prompt`).
3. **AI:** Cloudflare FLUX HTTP module + Cloudinary base64 upload config.
4. **AI + User:** Google Sheet banao, headers daalo.
5. **AI:** Make.com scenario module-by-module + field mapping.
6. **AI:** Error handlers + dedup filter.
7. 3 din test → full auto.
