import {
  getGroupSettings,
  updateGroupSetting,
  addBadWord,
  removeBadWord,
  getBadWords,
  isBotAdminAsync,
  addBotAdmin,
  removeBotAdmin,
  getBotAdmins,
} from '../config.js';
import {
  getWarnings,
  resetWarnings,
  warnUser,
  demoteUser,
  promoteUser,
} from '../actions/moderationActions.js';
import logger from '../utils/logger.js';

const COMMAND_PREFIX = '!';

/**
 * Process admin commands. Returns true if the message was a command.
 */
export async function handleCommand(msg, chat, client) {
  const body = (msg.body || '').trim();
  if (!body.startsWith(COMMAND_PREFIX)) return false;

  const parts = body.slice(COMMAND_PREFIX.length).split(/\s+/);
  const command = parts[0]?.toLowerCase();
  const args = parts.slice(1);
  const userId = msg.author || msg.from;
  const groupId = chat.id._serialized;

  // Check bot admin status for most commands
  const adminRequired = ['warn', 'demote', 'reset', 'toggle', 'addword', 'removeword', 'settings', 'admin', 'removeadmin', 'admins'];
  if (adminRequired.includes(command)) {
    const isAdmin = await isBotAdminAsync(groupId, userId, msg);
    if (!isAdmin) {
      await chat.sendMessage('❌ Nur Bot-Admins können diesen Befehl nutzen.');
      return true;
    }
  }

  switch (command) {
    case 'help':
    case 'hilfe': {
      await chat.sendMessage(
        `🤖 *WhatsApp Moderationsbot - Befehle*\n\n` +
        `📋 *Allgemein:*\n` +
        `• \`!help\` / \`!hilfe\` — Diese Hilfe anzeigen\n` +
        `• \`!status\` — Bot-Status & Einstellungen\n\n` +
        `👮 *Moderation (nur Bot-Admins):*\n` +
        `• \`!warn @nutzer [Grund]\` — Nutzer verwarnen\n` +
        `• \`!demote @nutzer [Grund]\` — Admin-Status entziehen\n` +
        `• \`!warnings @nutzer\` — Verwarnungen anzeigen\n` +
        `• \`!reset @nutzer\` — Verwarnungen zurücksetzen\n\n` +
        `👑 *Bot-Admin-Verwaltung (nur Bot-Admins):*\n` +
        `• \`!admin @nutzer\` — Als Bot-Admin hinzufügen\n` +
        `• \`!removeadmin @nutzer\` — Bot-Admin entfernen\n` +
        `• \`!admins\` — Bot-Admins anzeigen\n\n` +
        `⚙️ *Einstellungen (nur Bot-Admins):*\n` +
        `• \`!toggle spam|wörter|sticker an|aus\` — Feature an/ausschalten\n` +
        `• \`!addword <wort>\` — Wort zur Sperrliste hinzufügen\n` +
        `• \`!removeword <wort>\` — Wort von Sperrliste entfernen\n` +
        `• \`!wordlist\` — Gesperrte Wörter anzeigen`
      );
      return true;
    }

    case 'status': {
      const settings = getGroupSettings(groupId);
      const toggle = (v) => v ? '✅ An' : '❌ Aus';
      await chat.sendMessage(
        `🤖 *Bot-Status*\n\n` +
        `🛡️ Spam-Erkennung: ${toggle(settings.spamEnabled)}\n` +
        `🔤 Wort-Filter: ${toggle(settings.wordFilterEnabled)}\n` +
        `🖼️ Sticker-Moderation: ${toggle(settings.stickerModEnabled)}\n` +
        `📊 Sticker-Strenge: ${settings.stickerStrictness}\n` +
        `⚠️ Verwarnungen bis Degradierung: ${settings.maxWarnings}\n` +
        `⏱️ Spam-Zeitfenster: ${settings.spamTimeWindowMs / 1000}s\n` +
        `📨 Max Nachrichten: ${settings.spamMaxMessages}`
      );
      return true;
    }

    case 'warn': {
      const mentioned = await msg.getMentions();
      if (mentioned.length === 0) {
        await chat.sendMessage('❌ Bitte markiere einen Nutzer: `!warn @nutzer [Grund]`');
        return true;
      }
      const target = mentioned[0];
      const targetId = target.id._serialized;
      const reason = args.slice(1).join(' ') || 'Manuell verwarnt durch Admin';
      const shouldDemote = await warnUser(chat, msg, targetId, reason);
      if (shouldDemote) {
        await demoteUser(chat, targetId, reason);
      }
      return true;
    }

    case 'demote': {
      const mentioned = await msg.getMentions();
      if (mentioned.length === 0) {
        await chat.sendMessage('❌ Bitte markiere einen Nutzer: `!demote @nutzer [Grund]`');
        return true;
      }
      const target = mentioned[0];
      const targetId = target.id._serialized;
      const reason = args.slice(1).join(' ') || 'Manuell degradiert durch Admin';
      await chat.sendMessage(
        `⛔ *@${targetId.split('@')[0]}* wurde der Admin-Status entzogen.\n📋 Grund: ${reason}`,
        { mentions: [targetId] }
      );
      await demoteUser(chat, targetId, reason);
      return true;
    }

    case 'warnings':
    case 'verwarnungen': {
      const mentioned = await msg.getMentions();
      if (mentioned.length === 0) {
        await chat.sendMessage('❌ Bitte markiere einen Nutzer: `!warnings @nutzer`');
        return true;
      }
      const target = mentioned[0];
      const targetId = target.id._serialized;
      const data = getWarnings(groupId, targetId);
      if (data.count === 0) {
        await chat.sendMessage(`✅ @${targetId.split('@')[0]} hat keine Verwarnungen.`, { mentions: [targetId] });
      } else {
        const reasonList = data.reasons
          .map((r, i) => `  ${i + 1}. ${r.reason} (${new Date(r.timestamp).toLocaleDateString('de-DE')})`)
          .join('\n');
        await chat.sendMessage(
          `⚠️ *Verwarnungen für @${targetId.split('@')[0]}*: ${data.count}\n\n${reasonList}`,
          { mentions: [targetId] }
        );
      }
      return true;
    }

    case 'reset': {
      const mentioned = await msg.getMentions();
      if (mentioned.length === 0) {
        await chat.sendMessage('❌ Bitte markiere einen Nutzer: `!reset @nutzer`');
        return true;
      }
      const target = mentioned[0];
      const targetId = target.id._serialized;
      resetWarnings(groupId, targetId);
      await promoteUser(chat, targetId, 'Verwarnungen zurückgesetzt');
      await chat.sendMessage(
        `✅ Verwarnungen für @${targetId.split('@')[0]} zurückgesetzt und Admin-Status wiederhergestellt.`,
        { mentions: [targetId] }
      );
      return true;
    }

    case 'toggle': {
      const feature = args[0]?.toLowerCase();
      const state = args[1]?.toLowerCase();

      const featureMap = {
        'spam': 'spamEnabled',
        'wörter': 'wordFilterEnabled',
        'words': 'wordFilterEnabled',
        'sticker': 'stickerModEnabled',
        'stickers': 'stickerModEnabled',
      };

      const stateMap = {
        'an': true, 'on': true, 'ein': true,
        'aus': false, 'off': false,
      };

      if (!featureMap[feature] || stateMap[state] === undefined) {
        await chat.sendMessage(
          '❌ Nutzung: `!toggle spam|wörter|sticker an|aus`'
        );
        return true;
      }

      updateGroupSetting(groupId, featureMap[feature], stateMap[state]);
      const label = { spam: 'Spam-Erkennung', wörter: 'Wort-Filter', words: 'Wort-Filter', sticker: 'Sticker-Moderation', stickers: 'Sticker-Moderation' };
      await chat.sendMessage(
        `✅ ${label[feature]} ist jetzt ${stateMap[state] ? '✅ aktiviert' : '❌ deaktiviert'}.`
      );
      return true;
    }

    case 'addword': {
      const word = args.join(' ');
      if (!word) {
        await chat.sendMessage('❌ Nutzung: `!addword <wort>`');
        return true;
      }
      const added = addBadWord(groupId, word);
      await chat.sendMessage(
        added
          ? `✅ "${word}" zur Sperrliste hinzugefügt.`
          : `ℹ️ "${word}" ist bereits auf der Sperrliste.`
      );
      return true;
    }

    case 'removeword': {
      const word = args.join(' ');
      if (!word) {
        await chat.sendMessage('❌ Nutzung: `!removeword <wort>`');
        return true;
      }
      const removed = removeBadWord(groupId, word);
      await chat.sendMessage(
        removed
          ? `✅ "${word}" von der Sperrliste entfernt.`
          : `ℹ️ "${word}" war nicht auf der Sperrliste.`
      );
      return true;
    }

    case 'wordlist':
    case 'wortliste': {
      const words = getBadWords(groupId);
      if (words.length === 0) {
        await chat.sendMessage('ℹ️ Die Sperrliste ist leer.');
      } else {
        // Group in chunks to avoid message length limits
        const chunks = [];
        for (let i = 0; i < words.length; i += 30) {
          chunks.push(words.slice(i, i + 30).join(', '));
        }
        await chat.sendMessage(
          `📋 *Sperrliste* (${words.length} Wörter):\n\n${chunks.join('\n')}`
        );
      }
      return true;
    }

    case 'admin': {
      const mentioned = await msg.getMentions();
      if (mentioned.length === 0) {
        await chat.sendMessage('❌ Bitte markiere einen Nutzer: `!admin @nutzer`');
        return true;
      }
      const target = mentioned[0];
      const targetId = target.id._serialized;
      const added = addBotAdmin(groupId, targetId);
      await chat.sendMessage(
        added
          ? `👑 @${targetId.split('@')[0]} ist jetzt Bot-Admin.`
          : `ℹ️ @${targetId.split('@')[0]} ist bereits Bot-Admin.`,
        { mentions: [targetId] }
      );
      return true;
    }

    case 'removeadmin': {
      const mentioned = await msg.getMentions();
      if (mentioned.length === 0) {
        await chat.sendMessage('❌ Bitte markiere einen Nutzer: `!removeadmin @nutzer`');
        return true;
      }
      const target = mentioned[0];
      const targetId = target.id._serialized;
      const removed = removeBotAdmin(groupId, targetId);
      await chat.sendMessage(
        removed
          ? `✅ @${targetId.split('@')[0]} ist kein Bot-Admin mehr.`
          : `ℹ️ @${targetId.split('@')[0]} kann nicht entfernt werden (Super-Admin oder kein Bot-Admin).`,
        { mentions: [targetId] }
      );
      return true;
    }

    case 'admins': {
      const adminList = getBotAdmins(groupId);
      const formatted = adminList.map(id => `• @${id.split('@')[0]}`).join('\n');
      await chat.sendMessage(
        `👑 *Bot-Admins* (${adminList.length}):\n\n${formatted}`,
        { mentions: adminList }
      );
      return true;
    }

    default:
      return false;
  }
}

