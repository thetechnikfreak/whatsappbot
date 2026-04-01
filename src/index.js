import 'dotenv/config';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';

import { initGemini } from './ai/geminiClient.js';
import { isBotAdminAsync } from './config.js';
import { checkSpam } from './moderation/spamDetector.js';
import { checkWords } from './moderation/wordFilter.js';
import { checkSticker } from './moderation/stickerModerator.js';
import { handleViolation } from './actions/moderationActions.js';
import { handleCommand } from './commands/adminCommands.js';
import logger from './utils/logger.js';

// ── Initialize Groq AI ───────────────────────────────────────────────
const aiReady = initGemini(process.env.GROQ_API_KEY);

// ── Create WhatsApp Client ───────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...(process.env.PUPPETEER_EXECUTABLE_PATH && { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH })
  },
});

// ── QR Code Event ────────────────────────────────────────────────────
client.on('qr', (qr) => {
  logger.info('QR-Code empfangen. Bitte mit WhatsApp scannen:');
  console.log('');
  qrcode.generate(qr, { small: true });
  console.log('');
});

// ── Ready Event ──────────────────────────────────────────────────────
client.on('ready', () => {
  logger.info('✅ Bot ist bereit und verbunden!');
  logger.info(`📱 Eingeloggt als: ${client.info.pushname}`);
  logger.info(`🤖 Groq AI: ${aiReady ? 'Aktiv' : 'Inaktiv (kein API-Key)'}`);
  console.log('');
  logger.info('Warte auf Nachrichten...');
});

// ── Authentication Events ────────────────────────────────────────────
client.on('authenticated', () => {
  logger.info('🔐 Authentifizierung erfolgreich');
});

client.on('auth_failure', (msg) => {
  logger.error('❌ Authentifizierung fehlgeschlagen:', msg);
  process.exit(1);
});

client.on('disconnected', (reason) => {
  logger.warn('🔌 Verbindung getrennt:', reason);
});

// ── Message Handler ──────────────────────────────────────────────────
client.on('message', async (msg) => {
  try {
    // Only process group messages
    const chat = await msg.getChat();
    if (!chat.isGroup) return;

    // Ignore messages from the bot itself
    if (msg.fromMe) return;

    const groupId = chat.id._serialized;

    // Debug: log message type
    logger.info(`Nachricht: Typ="${msg.type}" hasMedia=${msg.hasMedia} Body="${(msg.body || '').substring(0, 30)}"`);

    // ── Handle admin commands ──
    const isCommand = await handleCommand(msg, chat, client);
    if (isCommand) {
      logger.cmd(`Befehl verarbeitet: ${msg.body}`);
      return;
    }

    // ── Skip moderation for bot admins ──
    const userId = msg.author || msg.from;
    if (await isBotAdminAsync(groupId, userId, msg)) return;

    // ── Check for stickers and images ──
    if (msg.type === 'sticker' || msg.type === 'image') {
      const mediaResult = await checkSticker(msg, groupId);
      if (mediaResult.isViolation) {
        await handleViolation(msg, chat, mediaResult.reason, mediaResult.severity);
        return;
      }
      // If it's a sticker or image-only message (no text), skip word filter
      if (!msg.body || !msg.body.trim()) return;
    }

    // ── Check for spam ──
    const spamResult = await checkSpam(msg, groupId);
    if (spamResult.isSpam) {
      await handleViolation(msg, chat, spamResult.reason, 'delete');
      return;
    }

    // ── Check for bad words / toxicity (only text messages) ──
    if (msg.body && msg.body.trim()) {
      const wordResult = await checkWords(msg, groupId);
      if (wordResult.isViolation) {
        await handleViolation(msg, chat, wordResult.reason, wordResult.severity);
        return;
      }
    }
  } catch (err) {
    logger.error('Fehler bei Nachrichtenverarbeitung:', err.message);
  }
});

// ── Group membership events ──────────────────────────────────────────
client.on('group_join', async (notification) => {
  try {
    const chat = await notification.getChat();
    const contact = await notification.getContact();
    const name = contact.pushname || contact.name || 'Neues Mitglied';
    await chat.sendMessage(
      `👋 Willkommen *${name}*!\n\n` +
      `📋 Bitte halte dich an die Gruppenregeln.\n` +
      `ℹ️ Schreibe \`!help\` für Bot-Befehle.`
    );
    logger.info(`Neues Mitglied: ${name} in ${chat.name}`);
  } catch (err) {
    logger.error('Fehler bei Begrüßung:', err.message);
  }
});

// ── Graceful Shutdown ────────────────────────────────────────────────
async function shutdown() {
  logger.info('Bot wird heruntergefahren...');
  try {
    await client.destroy();
  } catch {
    // ignore
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ── Catch uncaught errors ────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err.message, err.stack);
});

// ── Start the Bot ────────────────────────────────────────────────────
logger.info('🚀 WhatsApp Moderationsbot startet...');
logger.info('──────────────────────────────────────');
client.initialize().catch((err) => {
  logger.error('❌ Client Initialisierung fehlgeschlagen:', err.message);
  logger.error(err.stack);
});
