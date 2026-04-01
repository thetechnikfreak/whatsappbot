import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Load a JSON file from the data directory.
 * Returns defaultValue if file doesn't exist.
 */
export function load(filename, defaultValue = {}) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error(`[Storage] Fehler beim Laden von ${filename}:`, err.message);
  }
  return defaultValue;
}

/**
 * Save data as JSON to the data directory.
 */
export function save(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[Storage] Fehler beim Speichern von ${filename}:`, err.message);
  }
}
