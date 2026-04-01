import { getGroupSettings } from '../config.js';
import { analyzeImage } from '../ai/geminiClient.js';
import logger from '../utils/logger.js';

/**
 * Check a sticker/image message for inappropriate content.
 * Downloads the media and sends it to Vision AI for analysis.
 * Returns { isViolation: boolean, reason: string, severity: 'safe'|'warning'|'delete' }
 */
export async function checkSticker(msg, groupId) {
  const settings = getGroupSettings(groupId);
  if (!settings.stickerModEnabled) {
    logger.info('Sticker-Moderation ist deaktiviert');
    return { isViolation: false, severity: 'safe' };
  }

  try {
    // Download the media
    logger.info(`Lade ${msg.type} herunter...`);
    const media = await msg.downloadMedia();

    if (!media || !media.data) {
      logger.warn('Media konnte nicht heruntergeladen werden');
      return { isViolation: false, severity: 'safe' };
    }

    logger.info(`Media heruntergeladen: ${media.mimetype}, ${Math.round(media.data.length * 3/4 / 1024)}KB`);

    // Send to Vision AI for analysis
    const result = await analyzeImage(
      media.data,
      media.mimetype || 'image/webp',
      settings.stickerStrictness
    );

    logger.info(`AI-Ergebnis: isSafe=${result.isSafe}, reason="${result.reason}", severity="${result.severity}"`);

    if (!result.isSafe) {
      logger.mod(`${msg.type}-Verstoß erkannt: ${result.reason} (Schwere: ${result.severity})`);
      return {
        isViolation: true,
        reason: result.reason,
        severity: result.severity,
      };
    }

    return { isViolation: false, severity: 'safe' };
  } catch (err) {
    logger.error(`${msg.type}-Analyse fehlgeschlagen:`, err.message);
    return { isViolation: false, severity: 'safe' };
  }
}
