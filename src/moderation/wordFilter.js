import { getGroupSettings, getBadWords } from '../config.js';
import { analyzeText } from '../ai/geminiClient.js';
import logger from '../utils/logger.js';

/**
 * Normalize text for comparison: lowercase, remove accents/special chars.
 */
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\säöüß]/g, '')  // keep German umlauts
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Basic local check against the bad words list.
 */
function localCheck(text, badWords) {
  const normalized = normalize(text);
  const words = normalized.split(/\s+/);

  for (const bad of badWords) {
    // Check full phrase match
    if (normalized.includes(bad)) {
      return { found: true, word: bad };
    }
    // Check individual words
    for (const word of words) {
      if (word === bad) {
        return { found: true, word: bad };
      }
    }
  }
  return { found: false };
}

/**
 * Check a message for bad words / toxic content.
 * Returns { isViolation: boolean, reason: string, severity: 'safe'|'warning'|'delete'|'ban' }
 */
export async function checkWords(msg, groupId) {
  const settings = getGroupSettings(groupId);
  if (!settings.wordFilterEnabled) return { isViolation: false, severity: 'safe' };

  const text = msg.body || '';
  if (!text.trim()) return { isViolation: false, severity: 'safe' };

  const badWords = getBadWords(groupId);

  // ── Step 1: Local bad words check ──
  const local = localCheck(text, badWords);
  if (local.found) {
    logger.mod(`Verbotenes Wort erkannt: "${local.word}"`);
    return {
      isViolation: true,
      reason: `Verbotenes Wort erkannt: "${local.word}"`,
      severity: 'delete',
    };
  }

  // ── Step 2: AI-based analysis for obfuscated words / toxicity ──
  const aiResult = await analyzeText(text, 'bad_words_check');
  if (!aiResult.isSafe) {
    logger.mod(`AI Verstoß erkannt: ${aiResult.reason} (Schwere: ${aiResult.severity})`);
    return {
      isViolation: true,
      reason: aiResult.reason,
      severity: aiResult.severity,
    };
  }

  return { isViolation: false, severity: 'safe' };
}
