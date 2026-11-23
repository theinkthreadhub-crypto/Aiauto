// InkThreadHub — WhatsApp Alert Server (Baileys)
// Sender: alag SIM. Receiver: ALERT_TO (business number). Make.com HTTP se call karta hai.
import express from 'express';
import pino from 'pino';
import QRCode from 'qrcode';
import { MongoClient } from 'mongodb';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from 'baileys';
import { useMongoAuthState } from './mongoAuthState.js';

const {
  PORT = 3000,
  MONGODB_URI,
  API_KEY,
  ALERT_TO = '919194115127',
  SENDER_NUMBER = '', // alag SIM ka number, pairing code ke liye (91XXXXXXXXXX)
  BRAND_NAME = 'InkThreadHub',
} = process.env;

if (!MONGODB_URI || !API_KEY) {
  console.error('MONGODB_URI aur API_KEY env variables zaroori hain.');
  process.exit(1);
}

const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });
const mongo = new MongoClient(MONGODB_URI);
await mongo.connect();
const authCollection = mongo.db('inkthreadhub').collection('wa_auth');

let sock = null;
let status = 'starting'; // starting | qr | open | closed
let latestQR = null;
let reconnectTimer = null;

async function startSocket() {
  const auth = await useMongoAuthState(authCollection);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  sock = makeWASocket({
    auth: auth.state,
    version,
    logger,
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
  });

  sock.ev.on('creds.update', auth.saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      latestQR = qr;
      status = 'qr';
      console.log('Naya QR ready. /qr?key=API_KEY kholo.');
    }
    if (connection === 'open') {
      status = 'open';
      latestQR = null;
      console.log('WhatsApp connected ✅');
    }
    if (connection === 'close') {
      status = 'closed';
      const code = lastDisconnect?.error?.output?.statusCode;
      console.warn('Connection closed. Code:', code);
      if (code === DisconnectReason.loggedOut) {
        // Phone se logout hua. Session saaf karo, naya QR aayega.
        await auth.clear();
      }
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(startSocket, 3000);
    }
  });
}

function waitForOpen(timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    if (status === 'open') return resolve();
    const started = Date.now();
    const t = setInterval(() => {
      if (status === 'open') {
        clearInterval(t);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(t);
        reject(new Error(`WhatsApp not connected (status: ${status})`));
      }
    }, 500);
  });
}

const toJid = (n) => `${String(n).replace(/\D/g, '')}@s.whatsapp.net`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendText(to, text, imageUrl) {
  await waitForOpen();
  const jid = toJid(to);
  // Thoda insaani jaisa behaviour: typing dikhao, phir bhejo.
  await sock.sendPresenceUpdate('composing', jid).catch(() => {});
  await sleep(1500 + Math.random() * 1500);
  await sock.sendPresenceUpdate('paused', jid).catch(() => {});
  const content = imageUrl ? { image: { url: imageUrl }, caption: text } : { text };
  const res = await sock.sendMessage(jid, content);
  return res?.key?.id;
}

function formatAlert(b) {
  const ok = String(b.status || '').toUpperCase() === 'PUBLISHED';
  const lines = [
    ok ? `✅ *${BRAND_NAME} — Post Live*` : `❌ *${BRAND_NAME} — Run FAILED*`,
    '',
    b.run_id && `🆔 Run: ${b.run_id}`,
    b.date && `📅 ${b.date}`,
    b.topic && `🔥 Topic: ${b.topic}`,
    b.fb_post_id && `📘 FB: ${b.fb_post_id}`,
    b.ig_post_id && `📸 IG: ${b.ig_post_id}`,
    !ok && b.module && `⚙️ Module: ${b.module}`,
    !ok && b.error && `⚠️ Error: ${String(b.error).slice(0, 500)}`,
  ].filter(Boolean);
  return lines.join('\n');
}

// ---------- HTTP ----------
const app = express();
app.use(express.json({ limit: '1mb' }));

const requireKey = (req, res, next) => {
  const key = req.get('x-api-key') || req.query.key;
  if (key !== API_KEY) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
};

app.get('/', (_req, res) => res.json({ ok: true, service: 'wa-alert', status }));
app.get('/health', (_req, res) => res.json({ ok: true, status }));

// Pehli baar link karne ke liye: browser me /qr?key=API_KEY kholo, alag SIM wale phone se scan karo.
app.get('/qr', requireKey, async (_req, res) => {
  if (status === 'open') return res.send('<h2>✅ Already connected</h2>');
  if (!latestQR) return res.send('<h2>QR abhi ready nahi. 10 sec baad refresh karo.</h2><script>setTimeout(()=>location.reload(),10000)</script>');
  const img = await QRCode.toDataURL(latestQR, { width: 320 });
  res.send(`<h2>WhatsApp → Linked devices → Link a device</h2><img src="${img}"/><p>QR 20 sec me badalta hai. Page auto refresh hoga.</p><script>setTimeout(()=>location.reload(),20000)</script>`);
});

// QR ki jagah pairing code: /pair?key=API_KEY  (SENDER_NUMBER env me hona chahiye)
app.get('/pair', requireKey, async (req, res) => {
  try {
    if (status === 'open') return res.json({ ok: true, message: 'Already connected' });
    const number = String(req.query.number || SENDER_NUMBER).replace(/\D/g, '');
    if (!number) return res.status(400).json({ ok: false, error: 'SENDER_NUMBER set karo' });
    const code = await sock.requestPairingCode(number);
    res.json({ ok: true, code, how: 'WhatsApp → Linked devices → Link with phone number → ye code daalo' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Generic: { "to": "919194115127", "message": "text", "image_url": "optional" }
app.post('/send', requireKey, async (req, res) => {
  try {
    const { to = ALERT_TO, message, image_url } = req.body || {};
    if (!message) return res.status(400).json({ ok: false, error: 'message required' });
    const id = await sendText(to, message, image_url);
    res.json({ ok: true, message_id: id });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

// Make.com ke liye ready-made alert:
// { status, run_id, date, topic, fb_post_id, ig_post_id, image_url, module, error }
app.post('/alert', requireKey, async (req, res) => {
  try {
    const b = req.body || {};
    const id = await sendText(ALERT_TO, formatAlert(b), b.image_url || undefined);
    res.json({ ok: true, message_id: id });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => console.log(`WA alert server on :${PORT}`));
startSocket().catch((e) => {
  console.error('Socket start failed:', e);
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await mongo.close().catch(() => {});
    process.exit(0);
  });
}
