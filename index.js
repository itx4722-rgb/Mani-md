import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from 'baileys';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const PORT = Number(process.env.PORT || 3000);
const PANEL_PASSWORD = process.env.PANEL_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const OWNER_NAME = process.env.OWNER_NAME || 'Mani';
const OWNER_NUMBER = (process.env.OWNER_NUMBER || '923134169814').replace(/\D/g, '');
const BOT_NAME = process.env.BOT_NAME || 'Mini Mani';
const AUTH_DIR = path.join(__dirname, 'auth_info');

if (!PANEL_PASSWORD || PANEL_PASSWORD.length < 12) {
  console.error('Set PANEL_PASSWORD in .env (use at least 12 characters).');
  process.exit(1);
}
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('Set SESSION_SECRET in .env (use at least 32 characters).');
  process.exit(1);
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
app.use(session({
  name: 'mini_mani_panel',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 2 * 60 * 60 * 1000
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

let sock = null;
let connecting = false;
let latestPairingCode = null;
let connectionState = 'offline';
let lastError = '';
let lastConnectedAt = null;
let pairRequestedAt = 0;
let retryTimer = null;

function requireLogin(req, res, next) {
  if (req.session?.authenticated) return next();
  return res.status(401).json({ error: 'Please log in to the private panel first.' });
}

function safeStatus() {
  return {
    botName: BOT_NAME,
    state: connectionState,
    connectedAt: lastConnectedAt,
    hasSession: fs.existsSync(path.join(AUTH_DIR, 'creds.json')),
    pairingCode: latestPairingCode,
    error: lastError
  };
}

app.get('/api/status', requireLogin, (_req, res) => res.json(safeStatus()));

app.post('/api/login', (req, res) => {
  const password = String(req.body?.password || '');
  if (password.length > 500) return res.status(400).json({ error: 'Invalid password.' });
  if (password !== PANEL_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect panel password.' });
  }
  req.session.authenticated = true;
  res.json({ ok: true });
});

app.post('/api/logout', requireLogin, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.post('/api/pair', requireLogin, async (req, res) => {
  const phone = String(req.body?.phone || '').replace(/\D/g, '');
  if (!/^[1-9]\d{7,14}$/.test(phone)) {
    return res.status(400).json({ error: 'Enter phone number with country code, digits only. Example: 923001234567' });
  }
  if (connecting || (sock && connectionState === 'connected')) {
    return res.status(409).json({ error: 'Bot is already connecting or connected.' });
  }
  if (Date.now() - pairRequestedAt < 30000) {
    return res.status(429).json({ error: 'Please wait 30 seconds before requesting another pairing code.' });
  }
  pairRequestedAt = Date.now();
  connecting = true;
  latestPairingCode = null;
  lastError = '';
  connectionState = 'connecting';
  res.json({ ok: true, message: 'Pairing request started. Check the status panel shortly.' });

  try {
    await startBot(phone);
  } catch (err) {
    lastError = String(err?.message || err).slice(0, 240);
    connectionState = 'error';
    connecting = false;
    console.error('Pairing error:', lastError);
  }
});

async function startBot(phoneNumber = null) {
  if (sock) {
    try { sock.end(undefined); } catch {}
    sock = null;
  }
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  let version;
  try {
    const result = await fetchLatestBaileysVersion();
    version = result.version;
    console.log('Baileys WhatsApp Web version:', version.join('.'));
  } catch (e) {
    console.warn('Could not fetch latest WhatsApp Web version; using library default:', e.message);
  }

  sock = makeWASocket({
    auth: state,
    ...(version ? { version } : {}),
    printQRInTerminal: false,
    browser: ['Mini Mani', 'Chrome', '1.0.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'connecting') connectionState = 'connecting';
    if (connection === 'open') {
      connectionState = 'connected';
      connecting = false;
      latestPairingCode = null;
      lastError = '';
      lastConnectedAt = new Date().toISOString();
      console.log(`${BOT_NAME} connected.`);
    }
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      connecting = false;
      latestPairingCode = null;
      if (loggedOut) {
        connectionState = 'logged_out';
        lastError = 'WhatsApp logged out. Remove the session only if you intend to pair again.';
        sock = null;
        return;
      }
      connectionState = 'offline';
      sock = null;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        startBot(null).catch((err) => {
          lastError = String(err?.message || err).slice(0, 240);
          connectionState = 'error';
          console.error('Reconnect error:', lastError);
        });
      }, 4000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key?.fromMe) continue;
      const chatId = msg.key.remoteJid;
      if (!chatId || chatId === 'status@broadcast') continue;
      const text = extractText(msg.message).trim();
      if (!text.startsWith('!') && !text.startsWith('.')) continue;
      const command = text.slice(1).split(/\s+/)[0].toLowerCase();
      const prefix = text[0];
      let reply = '';
      if (command === 'menu' || command === 'help') {
        reply = `╭━━━〔 ✦ ${BOT_NAME.toUpperCase()} ✦ 〕━━━╮\n┃  Private Test Bot\n┣━━━━━━━━━━━━━━━━━━\n┃ ${prefix}menu  — Show commands\n┃ ${prefix}ping  — Check response\n┃ ${prefix}alive — Bot status\n┃ ${prefix}about — Bot information\n┃ ${prefix}owner — Owner contact\n╰━━━━━━━━━━━━━━━━━━╯\n\nPowered by Baileys v7 RC14`;
      } else if (command === 'ping') {
        reply = '🏓 Pong! Mini Mani is responding.';
      } else if (command === 'alive') {
        reply = `✅ ${BOT_NAME} is online.\n⏱️ Uptime: ${formatUptime(process.uptime())}`;
      } else if (command === 'about') {
        reply = `🤖 ${BOT_NAME}\nA private WhatsApp test bot built to check Baileys connectivity and basic commands.\n\nVersion: Baileys 7.0.0-rc14`;
      } else if (command === 'owner') {
        reply = `👑 Owner: ${OWNER_NAME}\n☎️ Contact: https://wa.me/${OWNER_NUMBER}`;
      }
      if (reply) {
        try { await sock.sendMessage(chatId, { text: reply }, { quoted: msg }); }
        catch (err) { console.error('Reply failed:', err.message); }
      }
    }
  });

  if (phoneNumber && !state.creds.registered) {
    // Wait until the socket has opened its websocket before requesting a pairing code.
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out while preparing pairing code. Try again.')), 25000);
      const handler = (update) => {
        if (update.connection === 'connecting') {
          clearTimeout(timeout);
          sock.ev.off('connection.update', handler);
          resolve();
        }
      };
      sock.ev.on('connection.update', handler);
    });
    const code = await sock.requestPairingCode(phoneNumber);
    latestPairingCode = String(code).match(/.{1,4}/g)?.join('-') || String(code);
    console.log('Pairing code generated. Enter it only in WhatsApp on your own phone.');
  } else if (state.creds.registered) {
    connecting = false;
  }
}

function extractText(message) {
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.buttonsResponseMessage?.selectedButtonId) return message.buttonsResponseMessage.selectedButtonId;
  return '';
}

function formatUptime(totalSeconds) {
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600) % 24;
  const d = Math.floor(totalSeconds / 86400);
  return `${d}d ${h}h ${m}m ${s}s`;
}

app.get('/health', (_req, res) => res.json({ ok: true, state: connectionState }));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`${BOT_NAME} panel listening on port ${PORT}`);
  if (fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) {
    startBot(null).catch((err) => {
      lastError = String(err?.message || err).slice(0, 240);
      connectionState = 'error';
      console.error('Startup error:', lastError);
    });
  }
});

function shutdown() {
  console.log('Shutting down Mini Mani...');
  try { sock?.end(undefined); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
