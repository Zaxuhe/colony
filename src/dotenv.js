import fs from "node:fs/promises";
import path from "node:path";

/**
 * Parse a dotenv file and return key-value pairs
 * @param {string} content - The content of the .env file
 * @returns {Record<string, string>}
 */
export function parseDotenv(content) {
  const result = {};
  const lines = content.split(/\r?\n/);

  for (let line of lines) {
    // Remove comments (lines starting with # or lines with # after value)
    line = line.trim();
    if (!line || line.startsWith("#")) continue;

    // Match KEY=VALUE or KEY="VALUE" or KEY='VALUE'
    const match = line.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = match[1].trim();
    let value = match[2].trim();

    // Handle quoted values
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
      // Unescape common escape sequences for double-quoted strings
      if (value.startsWith('"')) {
        value = value
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
      }
    } else {
      // Remove inline comments for unquoted values
      const commentIdx = value.indexOf(" #");
      if (commentIdx !== -1) {
        value = value.slice(0, commentIdx).trim();
      }
    }

    result[key] = value;
  }

  return result;
}

/**
 * Load a dotenv file from disk
 * @param {string} filePath - Path to the .env file
 * @returns {Promise<Record<string, string>>}
 */
export async function loadDotenv(filePath) {
  const content = await fs.readFile(path.resolve(filePath), "utf8");
  return parseDotenv(content);
}

/**
 * Load multiple dotenv files, with later files overriding earlier ones
 * @param {string[]} filePaths - Paths to .env files
 * @returns {Promise<Record<string, string>>}
 */
export async function loadDotenvFiles(filePaths) {
  const result = {};

  for (const filePath of filePaths) {
    try {
      const vars = await loadDotenv(filePath);
      Object.assign(result, vars);
    } catch (err) {
      // File doesn't exist - silently skip
      if (err.code !== "ENOENT") throw err;
    }
  }

  return result;
}
