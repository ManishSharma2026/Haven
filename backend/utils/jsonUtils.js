/**
 * utils/jsonUtils.js
 * Shared JSON parsing utilities for Haven backend.
 */

/**
 * Safely parses a JSON string. If direct parse fails, attempts to extract
 * the first JSON object or array found in the string (handles LLM preamble).
 * @param {string} value
 * @returns {object|array|null}
 */
function safeJsonParse(value) {
  if (!value || typeof value !== "string") return null;

  try {
    return JSON.parse(value);
  } catch {
    const match = value.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return null;

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

module.exports = { safeJsonParse };