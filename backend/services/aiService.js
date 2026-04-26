/**
 * services/aiService.js
 * Shared Ollama/local AI interface for Haven backend.
 */
 
const axios = require("axios");
 
const OLLAMA_URL =
  process.env.OLLAMA_URL || "http://localhost:11434/api/generate";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
const DEBUG_MODE = process.env.DEBUG_MODE === "true";
 
/**
 * Send a prompt to the local Ollama model and return the raw response string.
 * Returns null if Ollama is unreachable or returns an empty response.
 *
 * @param {string} prompt
 * @param {{ temperature?: number, timeout?: number }} [options]
 * @returns {Promise<string|null>}
 */
async function askLocalAI(prompt, options = {}) {
  try {
    const response = await axios.post(
      OLLAMA_URL,
      {
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.2,
        },
      },
      { timeout: options.timeout ?? REQUEST_TIMEOUT_MS }
    );
 
    return response.data?.response || null;
  } catch (error) {
    if (DEBUG_MODE) {
      if (error.code === "ECONNREFUSED") {
        console.error(
          `[aiService] Ollama is not running at ${OLLAMA_URL}. Falling back to keyword-only logic.`
        );
      } else {
        console.error("[aiService] Local AI error:", error.message);
      }
    }
    return null;
  }
}
 
module.exports = { askLocalAI };
 