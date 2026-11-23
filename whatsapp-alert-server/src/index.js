// InkThreadHub — Personal WhatsApp Alert Server (Baileys + Supabase)
// Sender: alag SIM. Receiver: SIRF ALERT_TO (aapka number). Make.com HTTP se call karta hai.
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import express from 'express';
import pino from 'pino';
import QRCode from 'qrcode';
import { createClient } from '@supabase/supabase-js';
import makeWASocket, {
  Browsers,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from 'baileys';
import { useSupabaseAuthState } from './supabaseAuthState.js';
import { createLease } from './lease.js';
import { decideOnClose } from './reconnect.js';

const {
  PORT = 3000,
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
  API_KEY,
  ALERT_TO = '919194115127',
  SENDER_NUMBER = '',
  BRAND_NAME = 'InkThreadHub',
  BAILEYS_LOG_LEVEL = 'silent', // 'error' debugging ke liye. Kabhi 'debug'/'trace' mat karna — keys log ho sakti hain.
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !API_KEY) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SECRET_KEY aur API_KEY zaroori hain.');
  process.exit(1);
}
if (API_KEY.length < 24) {
  console.error('API_KEY kam se kam 24 characters ka rakho.');
  process.exit(1);
}
const ALERT_NUMBER = ALERT_TO.replace(/\D/g, '');
const ALERT_JID = `${ALERT_NUMBER}@s.whatsapp.net`;

const log = (...a) => console.log(new Date().toISOString(), ...a);
const baileysLogger = pino({ level: BAILEYS_LOG_LEVEL });
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------- State ----------------
const OWNER = randomUUID();
const lease = createLease(supabase, { owner: OWNER, ttlMs: 90_000 });
const LEASE_RENEW_MS = 30_000;
const LEASE_WAIT_MS = 5_000;

let sock = null;
let auth = null;
let status = 'starting'; // starting | waiting_lease | connecting | qr | open | reconnecting | logged_out | replaced | forbidden | store_error | stopping
let latestQR = null;
let holdsLease = false;
let storeOk = true;
let starting = false;
let stopping = false;
let attempt = 0;
let nextStartAt = 0;
let startTimer = null;
let leaseTimer = null;

const shortErr = (e) => String(e?.message || e).slice(0, 200);

// ---------------- WhatsApp socket ----------------
async function startSocket() {
  if (starting || sock || stopping || !holdsLease) return;
  starting = true;
  status = 'connecting';
  try {
    if (auth) {
      await auth.flush().catch(() => {}); // purane writes pehle khatam
    }
    const a = await useSupabaseAuthState(supabase, {
      onStoreError: () => {
        storeOk = false;
      },
    });
    storeOk = true;
    auth = a;
    if (a.isNew) log('Koi saved session nahi mila. QR / pairing code chahiye hoga.');
    else log('Saved session Supabase se load hua.');

    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    const s = makeWASocket({
      auth: { creds: a.state.creds, keys: makeCacheableSignalKeyStore(a.state.keys, baileysLogger) },
      version,
      logger: baileysLogger,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
    });
    sock = s;

    s.ev.on('creds.update', () => {
      a.saveCreds().catch((e) => log('Creds save failed:', shortErr(e)));
    });
    s.ev.on('connection.update', (u) => {
      onConnectionUpdate(s, a, u).catch((e) => log('connection.update handler error:', shortErr(e)));
    });
  } catch (e) {
    // DB load fail: fresh session NAHI banate. Thodi der baad retry.
    storeOk = false;
    status = 'store_error';
    log('Session load failed, retry hoga:', shortErr(e));
    scheduleStart(Math.min(60_000, 5_000 * 2 ** attempt++));
  } finally {
    starting = false;
  }
}

async function onConnectionUpdate(s, a, { connection, lastDisconnect, qr }) {
  if (s !== sock) return; // purana socket — ignore
  if (qr) {
    latestQR = qr;
    status = 'qr';
    log('Login chahiye: /qr ya /pair page kholo.'); // QR content log nahi hota
  }
  if (connection === 'open') {
    status = 'open';
    latestQR = null;
    attempt = 0;
    log('WhatsApp connected ✅');
  }
  if (connection === 'close') {
    sock = null;
    latestQR = null;
    const code = lastDisconnect?.error?.output?.statusCode;
    const d = decideOnClose(code, attempt++);
    status = d.status;
    log(`Connection closed (code ${code ?? 'n/a'}) → ${d.status}`);

    let delayMs = d.delayMs;
    if (d.clearSession) {
      a.detach();
      try {
        await a.clear();
        log('Logged-out session Supabase se saaf. Naya QR aayega.');
        attempt = 0;
      } catch (e) {
        // Clear fail: purana session rehne do, 30 sec baad retry. Fresh in-memory session nahi.
        status = 'store_error';
        delayMs = 30_000;
        log('Session clear failed, retry hoga:', shortErr(e));
      }
    }
    scheduleStart(delayMs);
  }
}

function scheduleStart(delayMs) {
  clearTimeout(startTimer);
  nextStartAt = Date.now() + delayMs;
  startTimer = setTimeout(() => startSocket(), delayMs);
}

async function teardownSocket(reason) {
  const s = sock;
  sock = null;
  latestQR = null;
  clearTimeout(startTimer);
  if (s) {
    log('Socket band:', reason);
    try {
      s.end(undefined);
    } catch {}
  }
  if (auth) await auth.flush().catch(() => {});
}

// ---------------- Lease loop (ek hi instance connect kare) ----------------
async function leaseTick() {
  if (stopping) return;
  try {
    const ok = await lease.acquire();
    storeOk = true;
    if (ok && !holdsLease) log('Lease mila. Ye instance WhatsApp chalayega.');
    if (!ok && holdsLease) log('Lease kisi aur instance ke paas gaya.');
    holdsLease = ok;
    if (ok) {
      if (!sock && !starting && Date.now() >= nextStartAt) startSocket();
    } else {
      if (sock) await teardownSocket('lease lost');
      status = 'waiting_lease';
    }
  } catch (e) {
    // DB temporary fail: connection chalne do. Lease expire hua toh doosra le lega → 440 → handle.
    storeOk = false;
    log('Lease check failed:', shortErr(e));
  } finally {
    if (!stopping) leaseTimer = setTimeout(leaseTick, holdsLease ? LEASE_RENEW_MS : LEASE_WAIT_MS);
  }
}

// ---------------- Sending (SIRF ALERT_TO) ----------------
const FAIL_FAST = new Set(['qr', 'logged_out', 'forbidden']);

function waitForOpen(timeoutMs = 75_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (status === 'open' && sock) return resolve(sock);
      if (FAIL_FAST.has(status)) return reject(new Error(`WhatsApp not linked (status: ${status}). /pair se link karo.`));
      if (Date.now() - started > timeoutMs) return reject(new Error(`WhatsApp not connected (status: ${status})`));
      setTimeout(check, 500);
    };
    check();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendToMe(text, imageUrl) {
  const s = await waitForOpen();
  await s.sendPresenceUpdate('composing', ALERT_JID).catch(() => {});
  await sleep(1500 + Math.random() * 1500);
  await s.sendPresenceUpdate('paused', ALERT_JID).catch(() => {});
  const content = imageUrl ? { image: { url: imageUrl }, caption: text } : { text };
  const res = await s.sendMessage(ALERT_JID, content);
  return res?.key?.id;
}

function formatAlert(b) {
  const ok = String(b.status || '').toUpperCase() === 'PUBLISHED';
  return [
    ok ? `✅ *${BRAND_NAME} — Post Live*` : `❌ *${BRAND_NAME} — Run FAILED*`,
    '',
    b.run_id && `🆔 Run: ${b.run_id}`,
    b.date && `📅 ${b.date}`,
    b.topic && `🔥 Topic: ${b.topic}`,
    b.fb_post_id && `📘 FB: ${b.fb_post_id}`,
    b.ig_post_id && `📸 IG: ${b.ig_post_id}`,
    !ok && b.module && `⚙️ Module: ${b.module}`,
    !ok && b.error && `⚠️ Error: ${String(b.error).slice(0, 500)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const validImageUrl = (u) => !u || /^https:\/\/\S+$/i.test(String(u));

// ---------------- HTTP ----------------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

const keyHash = createHash('sha256').update(API_KEY).digest();
const keyOk = (k) => typeof k === 'string' && timingSafeEqual(createHash('sha256').update(k).digest(), keyHash);
// Sirf header ya POST body — URL me key nahi (logs me na aaye).
const requireKey = (req, res, next) =>
  keyOk(req.get('x-api-key') || req.body?.key) ? next() : res.status(401).json({ ok: false, error: 'Unauthorized' });

app.get('/', (_req, res) => res.json({ ok: true, service: 'inkthreadhub-wa-alert' }));
app.get('/health', (_req, res) => res.json({ ok: true, status, store: storeOk ? 'ok' : 'error', lease: holdsLease }));

const page = (body) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<meta name="referrer" content="no-referrer"><title>InkThreadHub WA</title>` +
  `<body style="font-family:system-ui;max-width:420px;margin:24px auto;padding:0 16px">${body}</body>`;
const keyForm = (action, label) =>
  page(`<h2>${label}</h2><form method="post" action="${action}"><input name="key" type="password" placeholder="API_KEY" style="width:100%;padding:10px" required><br><br><button style="padding:10px 16px">Continue</button></form>`);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

app.get('/qr', (_req, res) => res.send(keyForm('/qr', 'QR se link karo')));
app.post('/qr', requireKey, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const again = `<form id="f" method="post" action="/qr"><input type="hidden" name="key" value="${escapeHtml(req.body.key || '')}"></form>`;
  if (status === 'open') return res.send(page('<h2>✅ Already connected</h2>'));
  if (!latestQR) {
    return res.send(page(`<h2>QR abhi ready nahi (status: ${escapeHtml(status)})</h2><p>10 sec me refresh…</p>${again}<script>setTimeout(()=>f.submit(),10000)</script>`));
  }
  const img = await QRCode.toDataURL(latestQR, { width: 320 });
  res.send(page(`<h2>WhatsApp → Linked devices → Link a device</h2><img src="${img}" style="width:100%"><p>QR 20 sec me badalta hai. Page khud refresh hoga.</p>${again}<script>setTimeout(()=>f.submit(),20000)</script>`));
});

app.get('/pair', (_req, res) => res.send(keyForm('/pair', 'Pairing code se link karo')));
app.post('/pair', requireKey, async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (status === 'open') return res.send(page('<h2>✅ Already connected</h2>'));
    const number = SENDER_NUMBER.replace(/\D/g, '');
    if (!number) return res.status(400).send(page('<h2>Render me SENDER_NUMBER set karo.</h2>'));
    if (!sock || status !== 'qr') {
      return res.status(503).send(page(`<h2>Abhi ready nahi (status: ${escapeHtml(status)})</h2><p>20 sec baad dobara try karo.</p>`));
    }
    const code = await sock.requestPairingCode(number);
    res.send(page(`<h2>Code: <code style="font-size:28px">${escapeHtml(code)}</code></h2><p>Alag SIM phone → WhatsApp → Linked devices → Link a device → <b>Link with phone number instead</b> → ye code daalo.</p>`));
  } catch (e) {
    res.status(500).send(page(`<h2>Error</h2><p>${escapeHtml(shortErr(e))}</p>`));
  }
});

// Free text — SIRF ALERT_TO pe. { "message": "...", "image_url": "https://..." }
app.post('/send', requireKey, async (req, res) => {
  const { message, image_url } = req.body || {};
  if (!message) return res.status(400).json({ ok: false, error: 'message required' });
  if (!validImageUrl(image_url)) return res.status(400).json({ ok: false, error: 'image_url must be https' });
  try {
    res.json({ ok: true, message_id: await sendToMe(String(message).slice(0, 3000), image_url) });
  } catch (e) {
    res.status(503).json({ ok: false, status, error: shortErr(e) });
  }
});

// Make.com alert: { status, run_id, date, topic, fb_post_id, ig_post_id, image_url, module, error }
app.post('/alert', requireKey, async (req, res) => {
  const b = req.body || {};
  if (!validImageUrl(b.image_url)) return res.status(400).json({ ok: false, error: 'image_url must be https' });
  try {
    res.json({ ok: true, message_id: await sendToMe(formatAlert(b), b.image_url || undefined) });
  } catch (e) {
    res.status(503).json({ ok: false, status, error: shortErr(e) });
  }
});

// JSON parse error etc. — body log mat karo.
app.use((err, _req, res, _next) => res.status(400).json({ ok: false, error: shortErr(err) }));

const server = app.listen(PORT, () => {
  log(`Server :${PORT}. Instance ${OWNER.slice(0, 8)}. Alerts sirf ****${ALERT_NUMBER.slice(-4)} pe.`);
  leaseTick();
});

// ---------------- Shutdown (Render deploy / sleep) ----------------
async function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  status = 'stopping';
  log(`${sig} mila. Band ho raha hai…`);
  clearTimeout(leaseTimer);
  await teardownSocket('shutdown');
  if (holdsLease) await lease.release().catch((e) => log('Lease release failed:', shortErr(e)));
  server.close();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (e) => log('Unhandled rejection:', shortErr(e)));
