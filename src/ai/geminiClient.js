import Groq from 'groq-sdk';
import sharp from 'sharp';
import logger from '../utils/logger.js';

let groq = null;

const TEXT_MODEL = 'llama-3.3-70b-versatile';
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

/**
 * Initialize the Groq client with the API key.
 */
export function initGemini(apiKey) {
  if (!apiKey) {
    logger.error('Kein GROQ_API_KEY gesetzt! AI-Funktionen sind deaktiviert.');
    return false;
  }
  try {
    groq = new Groq({ apiKey });
    logger.info(`Groq AI erfolgreich initialisiert (Text: ${TEXT_MODEL}, Vision: ${VISION_MODEL})`);
    return true;
  } catch (err) {
    logger.error('Groq Initialisierung fehlgeschlagen:', err.message);
    return false;
  }
}

/**
 * Check if Groq is available.
 */
export function isAvailable() {
  return groq !== null;
}

/**
 * Helper to call Groq chat completions.
 */
async function chatCompletion(messages, model = TEXT_MODEL) {
  const response = await groq.chat.completions.create({
    model,
    messages,
    temperature: 0.1,
    max_tokens: 256,
    response_format: { type: 'json_object' },
  });
  return response.choices[0]?.message?.content || '';
}

/**
 * Analyze text for moderation (spam, bad words, toxicity).
 * Returns { isSafe: boolean, reason: string, severity: 'safe'|'warning'|'delete'|'ban' }
 */
export async function analyzeText(text, context = 'general') {
  if (!groq) return { isSafe: true, reason: 'AI nicht verfügbar', severity: 'safe' };

  const systemPrompt = `Du bist ein Moderationsbot für eine deutschsprachige WhatsApp-Gruppe.
Analysiere Nachrichten und entscheide, ob sie gegen die Gruppenregeln verstoßen.

Prüfe auf:
- Beleidigungen, Schimpfwörter (auch verschleierte wie "f*ck", "sch3iße", "hu.re.nsohn")
- Hassrede, Diskriminierung, Rassismus
- Bedrohungen oder Gewaltaufrufe
- Spam (sinnlose Wiederholungen, Werbung, Kettenbriefe)
- Toxisches Verhalten

Severity-Stufen:
- "safe": Nachricht ist in Ordnung
- "warning": Leichter Verstoß, Verwarnung angebracht
- "delete": Nachricht sollte gelöscht werden
- "ban": Schwerer Verstoß, Nutzer sollte entfernt werden

Antworte NUR mit JSON: {"isSafe": true/false, "reason": "kurze Begründung auf Deutsch", "severity": "safe|warning|delete|ban"}`;

  try {
    const response = await chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Kontext: ${context}\n\nNachricht: "${text}"` },
    ]);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { isSafe: true, reason: 'Konnte Antwort nicht parsen', severity: 'safe' };
  } catch (err) {
    logger.error('Groq Text-Analyse fehlgeschlagen:', err.message);
    return { isSafe: true, reason: 'AI-Fehler', severity: 'safe' };
  }
}

/**
 * Analyze spam patterns with AI.
 * Returns { isSpam: boolean, reason: string }
 */
export async function analyzeSpam(messages, senderName) {
  if (!groq) return { isSpam: false, reason: 'AI nicht verfügbar' };

  const messageList = messages.map((m, i) => `${i + 1}. "${m.text}" (vor ${Math.round((Date.now() - m.timestamp) / 1000)}s)`).join('\n');

  const systemPrompt = `Du bist ein Spam-Erkennungsbot für eine WhatsApp-Gruppe.
Analysiere die Nachrichten und entscheide, ob es sich um Spam handelt.

Prüfe auf:
- Massennachrichten (Flooding)
- Wiederholte identische oder sehr ähnliche Nachrichten
- Werbung, Links zu verdächtigen Seiten
- Kettenbriefe ("Leite diese Nachricht weiter...")
- Sinnloser Inhalt / Zeichenspam

Antworte NUR mit JSON: {"isSpam": true/false, "reason": "kurze Begründung auf Deutsch"}`;

  try {
    const response = await chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Letzte Nachrichten von "${senderName}":\n${messageList}` },
    ]);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { isSpam: false, reason: 'Konnte Antwort nicht parsen' };
  } catch (err) {
    logger.error('Groq Spam-Analyse fehlgeschlagen:', err.message);
    return { isSpam: false, reason: 'AI-Fehler' };
  }
}

/**
 * Convert image data to PNG for API compatibility.
 * Handles WebP (including animated) by extracting first frame and converting.
 */
async function convertToPng(base64Data) {
  try {
    const inputBuffer = Buffer.from(base64Data, 'base64');
    const pngBuffer = await sharp(inputBuffer, { animated: false })
      .png()
      .toBuffer();
    return pngBuffer.toString('base64');
  } catch (err) {
    logger.warn('Bildkonvertierung fehlgeschlagen, verwende Original:', err.message);
    return null;
  }
}

/**
 * Analyze a sticker/image for inappropriate content.
 * Converts WebP stickers to PNG before sending to Groq.
 * Returns { isSafe: boolean, reason: string, severity: 'safe'|'warning'|'delete' }
 */
export async function analyzeImage(base64Data, mimeType, strictness = 'relaxed') {
  if (!groq) return { isSafe: true, reason: 'AI nicht verfügbar', severity: 'safe' };

  // Convert to PNG for reliable API compatibility
  let imageData = base64Data;
  let imageMime = mimeType || 'image/webp';

  const pngData = await convertToPng(base64Data);
  if (pngData) {
    imageData = pngData;
    imageMime = 'image/png';
  }

  const strictnessGuide = {
    relaxed: 'Blockiere NUR eindeutig unangemessene Inhalte: explizite Nacktheit, echte Gewaltdarstellungen, Hassymbole (Hakenkreuz etc.). Normale Memes, Witze und harmlose Sticker sind OK.',
    moderate: 'Blockiere unangemessene Inhalte: Nacktheit, Gewalt, Hassymbole, und auch anstößige oder geschmacklose Inhalte. Normale Memes und Witze sind OK.',
    strict: 'Blockiere alles, was potenziell unangemessen sein könnte: Nacktheit, Gewalt, Hassymbole, anstößige Witze, und fragwürdige Inhalte.',
  };

  const systemPrompt = `Du bist ein Bild-Moderator für eine WhatsApp-Gruppe.
Analysiere das Sticker-Bild und entscheide, ob es unangemessen ist.

Richtlinie: ${strictnessGuide[strictness] || strictnessGuide.relaxed}

Antworte NUR mit JSON: {"isSafe": true/false, "reason": "kurze Begründung auf Deutsch", "severity": "safe|warning|delete"}`;

  try {
    const response = await groq.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analysiere dieses Sticker-Bild:' },
            {
              type: 'image_url',
              image_url: {
                url: `data:${imageMime};base64,${imageData}`,
              },
            },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 256,
    });

    const text = response.choices[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { isSafe: true, reason: 'Konnte Antwort nicht parsen', severity: 'safe' };
  } catch (err) {
    logger.error('Groq Bild-Analyse fehlgeschlagen:', err.message);
    return { isSafe: true, reason: 'AI-Fehler', severity: 'safe' };
  }
}
