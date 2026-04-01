import { load, save } from './utils/storage.js';

// ── Default bad words list (German) ──────────────────────────────────
const DEFAULT_BAD_WORDS = [
  'hurensohn', 'wichser', 'fotze', 'missgeburt', 'spast', 'spasti',
  'behindert', 'schwuchtel', 'kanake', 'nigger', 'neger', 'schlampe',
  'nutte', 'hure', 'arschloch', 'drecksau', 'bastard', 'fick dich',
  'fickdich', 'motherfucker', 'asshole', 'bitch', 'cunt', 'retard',
  'faggot', 'slut', 'whore',
];

// ── Default config ───────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  spamEnabled: true,
  wordFilterEnabled: true,
  stickerModEnabled: true,

  // Spam thresholds
  spamMaxMessages: 5,        // max messages allowed in the time window
  spamTimeWindowMs: 10_000,  // 10 seconds
  spamDuplicateThreshold: 3, // identical messages in a row

  // Warnings
  maxWarnings: 5,            // warnings before admin-status removal

  // Sticker strictness: 'relaxed' | 'moderate' | 'strict'
  stickerStrictness: 'relaxed',
};

/**
 * Load per-group settings, merging with defaults.
 */
export function getGroupSettings(groupId) {
  const all = load('settings.json', {});
  return { ...DEFAULT_SETTINGS, ...(all[groupId] || {}) };
}

/**
 * Update a specific setting for a group.
 */
export function updateGroupSetting(groupId, key, value) {
  const all = load('settings.json', {});
  if (!all[groupId]) all[groupId] = {};
  all[groupId][key] = value;
  save('settings.json', all);
}

/**
 * Get the bad words list for a group (default + custom).
 */
export function getBadWords(groupId) {
  const custom = load('custom_words.json', {});
  const groupWords = custom[groupId] || [];
  return [...new Set([...DEFAULT_BAD_WORDS, ...groupWords])];
}

/**
 * Add a custom bad word for a group.
 */
export function addBadWord(groupId, word) {
  const custom = load('custom_words.json', {});
  if (!custom[groupId]) custom[groupId] = [];
  const lower = word.toLowerCase().trim();
  if (!custom[groupId].includes(lower)) {
    custom[groupId].push(lower);
    save('custom_words.json', custom);
    return true;
  }
  return false;
}

/**
 * Remove a custom bad word for a group.
 */
export function removeBadWord(groupId, word) {
  const custom = load('custom_words.json', {});
  if (!custom[groupId]) return false;
  const lower = word.toLowerCase().trim();
  const idx = custom[groupId].indexOf(lower);
  if (idx !== -1) {
    custom[groupId].splice(idx, 1);
    save('custom_words.json', custom);
    return true;
  }
  return false;
}

export { DEFAULT_SETTINGS, DEFAULT_BAD_WORDS };

// ── Bot Admin System ─────────────────────────────────────────────────
// Super admin phone number (always bot admin in every group)
const SUPER_ADMIN_NUMBER = process.env.SUPERADMIN_NUMBER || '';

/**
 * Check if a user is a bot admin (sync check against stored IDs).
 */
export function isBotAdmin(groupId, userId) {
  // Check against @c.us format
  if (userId === `${SUPER_ADMIN_NUMBER}@c.us`) return true;
  const admins = load('botadmins.json', {});
  const groupAdmins = admins[groupId] || [];
  return groupAdmins.includes(userId);
}

/**
 * Check if a user is a bot admin (async, also resolves phone number for @lid users).
 */
export async function isBotAdminAsync(groupId, userId, msg) {
  // Fast sync check first
  if (isBotAdmin(groupId, userId)) return true;
  // Fallback: resolve phone number from contact (handles @lid format)
  try {
    const contact = await msg.getContact();
    const number = contact.number || contact.id?.user || '';
    if (number === SUPER_ADMIN_NUMBER) return true;
  } catch { }
  return false;
}

/**
 * Add a bot admin for a group.
 */
export function addBotAdmin(groupId, userId) {
  if (userId === `${SUPER_ADMIN_NUMBER}@c.us`) return false; // already permanent
  const admins = load('botadmins.json', {});
  if (!admins[groupId]) admins[groupId] = [];
  if (!admins[groupId].includes(userId)) {
    admins[groupId].push(userId);
    save('botadmins.json', admins);
    return true;
  }
  return false;
}

/**
 * Remove a bot admin for a group.
 */
export function removeBotAdmin(groupId, userId) {
  if (userId === `${SUPER_ADMIN_NUMBER}@c.us`) return false; // can't remove super admin
  const admins = load('botadmins.json', {});
  if (!admins[groupId]) return false;
  const idx = admins[groupId].indexOf(userId);
  if (idx !== -1) {
    admins[groupId].splice(idx, 1);
    save('botadmins.json', admins);
    return true;
  }
  return false;
}

/**
 * Get all bot admins for a group.
 */
export function getBotAdmins(groupId) {
  const admins = load('botadmins.json', {});
  const groupAdmins = admins[groupId] || [];
  const superAdminId = `${SUPER_ADMIN_NUMBER}@c.us`;
  return [superAdminId, ...groupAdmins.filter(a => a !== superAdminId)];
}
