import { getGroupSettings } from '../config.js';
import { analyzeSpam } from '../ai/geminiClient.js';
import logger from '../utils/logger.js';

// In-memory message history per user per group
// Key: `${groupId}:${userId}` → Array of { text, timestamp }
const messageHistory = new Map();

const HISTORY_MAX_SIZE = 20;

/**
 * Get the history key for a user in a group.
 */
function historyKey(groupId, userId) {
  return `${groupId}:${userId}`;
}

/**
 * Clean up old entries from message history.
 */
function cleanHistory(key, timeWindowMs) {
  const history = messageHistory.get(key) || [];
  const cutoff = Date.now() - timeWindowMs;
  const filtered = history.filter(m => m.timestamp > cutoff);
  messageHistory.set(key, filtered.slice(-HISTORY_MAX_SIZE));
}

/**
 * Check a message for spam patterns.
 * Returns { isSpam: boolean, reason: string, useAI: boolean }
 */
export async function checkSpam(msg, groupId) {
  const settings = getGroupSettings(groupId);
  if (!settings.spamEnabled) return { isSpam: false };

  const userId = msg.author || msg.from;
  const key = historyKey(groupId, userId);
  const now = Date.now();

  // Add message to history
  if (!messageHistory.has(key)) messageHistory.set(key, []);
  messageHistory.get(key).push({
    text: msg.body || '',
    timestamp: now,
  });

  // Clean old entries
  cleanHistory(key, settings.spamTimeWindowMs);

  const history = messageHistory.get(key);

  // ── Check 1: Rate limiting (too many messages in time window) ──
  const recentMessages = history.filter(m => m.timestamp > now - settings.spamTimeWindowMs);
  if (recentMessages.length > settings.spamMaxMessages) {
    logger.mod(`Rate-Limit überschritten: ${userId} (${recentMessages.length} Nachrichten in ${settings.spamTimeWindowMs / 1000}s)`);
    return {
      isSpam: true,
      reason: `Spam erkannt: ${recentMessages.length} Nachrichten in ${settings.spamTimeWindowMs / 1000} Sekunden`,
      useAI: false,
    };
  }

  // ── Check 2: Duplicate messages ──
  if (msg.body && msg.body.length > 0) {
    const recent = history.slice(-settings.spamDuplicateThreshold);
    const allSame = recent.length >= settings.spamDuplicateThreshold &&
      recent.every(m => m.text === msg.body);
    if (allSame) {
      logger.mod(`Doppelte Nachricht erkannt: ${userId}`);
      return {
        isSpam: true,
        reason: 'Spam erkannt: Identische Nachrichten wiederholt',
        useAI: false,
      };
    }
  }

  // ── Check 3: AI-based spam detection ──
  if (recentMessages.length >= 2) {
    const contact = await msg.getContact();
    const name = contact.pushname || contact.name || userId;
    const aiResult = await analyzeSpam(recentMessages, name);
    if (aiResult.isSpam) {
      logger.mod(`AI Spam erkannt: ${userId} - ${aiResult.reason}`);
      return {
        isSpam: true,
        reason: aiResult.reason,
        useAI: true,
      };
    }
  }

  return { isSpam: false };
}
