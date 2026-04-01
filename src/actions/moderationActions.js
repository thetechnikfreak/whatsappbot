import { load, save } from '../utils/storage.js';
import { getGroupSettings } from '../config.js';
import logger from '../utils/logger.js';

/**
 * Delete a message (bot must be admin).
 */
export async function deleteMessage(msg) {
  try {
    // Delete for everyone
    await msg.delete(true);
    logger.mod('Nachricht gelöscht');
    return true;
  } catch (err) {
    logger.error('Nachricht konnte nicht gelöscht werden:', err.message);
    return false;
  }
}

/**
 * Send a DM (private message) to a specific user by ID.
 */
async function sendDM(msg, userId, text) {
  try {
    const client = msg._client || msg.client;
    const contact = await client.getContactById(userId);
    const dmChat = await contact.getChat();
    await dmChat.sendMessage(text);
    return true;
  } catch (err) {
    logger.error('DM konnte nicht gesendet werden:', err.message);
    return false;
  }
}

/**
 * Get the warning count for a user in a group.
 */
export function getWarnings(groupId, userId) {
  const warnings = load('warnings.json', {});
  const key = `${groupId}:${userId}`;
  return warnings[key] || { count: 0, reasons: [] };
}

/**
 * Add a warning for a user. Returns the updated warning data.
 */
export function addWarning(groupId, userId, reason) {
  const warnings = load('warnings.json', {});
  const key = `${groupId}:${userId}`;
  if (!warnings[key]) {
    warnings[key] = { count: 0, reasons: [] };
  }
  warnings[key].count += 1;
  warnings[key].reasons.push({
    reason,
    timestamp: new Date().toISOString(),
  });
  save('warnings.json', warnings);
  return warnings[key];
}

/**
 * Reset warnings for a user in a group.
 */
export function resetWarnings(groupId, userId) {
  const warnings = load('warnings.json', {});
  const key = `${groupId}:${userId}`;
  delete warnings[key];
  save('warnings.json', warnings);
}

/**
 * Demote a user (remove admin status) in a group.
 * In groups where only admins can write, this effectively mutes them.
 */
export async function demoteUser(chat, userId, reason) {
  try {
    await chat.demoteParticipants([userId]);
    logger.mod(`Admin-Status entzogen: ${userId} - ${reason}`);
    return true;
  } catch (err) {
    logger.error(`Degradierung fehlgeschlagen für ${userId}:`, err.message);
    return false;
  }
}

/**
 * Promote a user (grant admin status) in a group.
 */
export async function promoteUser(chat, userId, reason) {
  try {
    await chat.promoteParticipants([userId]);
    logger.mod(`Admin-Status vergeben: ${userId} - ${reason}`);
    return true;
  } catch (err) {
    logger.error(`Beförderung fehlgeschlagen für ${userId}:`, err.message);
    return false;
  }
}

/**
 * Warn a user via DM. Returns whether the user should be demoted.
 */
export async function warnUser(chat, msg, userId, reason) {
  const groupId = chat.id._serialized;
  const settings = getGroupSettings(groupId);
  const warningData = addWarning(groupId, userId, reason);
  const remaining = settings.maxWarnings - warningData.count;

  const groupName = chat.name || 'der Gruppe';

  if (remaining <= 0) {
    // Max warnings reached → DM + demote
    await sendDM(msg, userId,
      `⛔ *Dein Admin-Status in "${groupName}" wurde entzogen.*\n\n` +
      `📋 Grund: ${reason}\n` +
      `⚠️ Du hattest ${warningData.count} Verwarnungen.\n` +
      `ℹ️ Da nur Admins schreiben können, kannst du jetzt keine Nachrichten mehr senden.`
    );
    return true; // Signal to demote
  }

  // Send warning via DM
  await sendDM(msg, userId,
    `⚠️ *Verwarnung in "${groupName}"*\n\n` +
    `📋 Grund: ${reason}\n` +
    `⚡ Verwarnungen: ${warningData.count}/${settings.maxWarnings}\n` +
    (remaining === 1
      ? `\n🚨 *Das ist deine letzte Warnung! Nächster Verstoß = Admin-Status wird entzogen!*`
      : `\nℹ️ Noch ${remaining} Verwarnungen bis dein Admin-Status entzogen wird.`)
  );

  let contact;
  try {
    contact = await msg.getContact();
  } catch {
    contact = null;
  }
  const name = contact?.pushname || contact?.name || userId.split('@')[0];

  logger.mod(`Verwarnung #${warningData.count} für ${name}: ${reason}`);
  return false;
}

/**
 * Handle a moderation violation: always delete message, warn user via DM, and potentially demote.
 */
export async function handleViolation(msg, chat, reason, severity) {
  const userId = msg.author || msg.from;

  // Always delete the offending message
  await deleteMessage(msg);

  // Warn via DM (or demote if ban severity or max warnings reached)
  if (severity === 'ban') {
    await sendDM(msg, userId,
      `⛔ *Dein Admin-Status in "${chat.name || 'der Gruppe'}" wurde wegen schwerem Verstoß entzogen.*\n\n` +
      `📋 Grund: ${reason}\n` +
      `ℹ️ Da nur Admins schreiben können, kannst du jetzt keine Nachrichten mehr senden.`
    );
    await demoteUser(chat, userId, reason);
  } else if (severity === 'delete' || severity === 'warning') {
    const shouldDemote = await warnUser(chat, msg, userId, reason);
    if (shouldDemote) {
      await demoteUser(chat, userId, reason);
    }
  }
}
