/**
 * services/semanticService.js
 * Future-ready semantic search layer for Haven.
 *
 * Currently provides:
 *  - getEmbedding(text)           → stub (returns null, ready for Ollama embeddings)
 *  - cosineSimilarity(a, b)       → real implementation
 *  - rankArticlesBySemanticSimilarity(claim, articles) → ready to plug in
 *
 * To activate real embeddings later, swap the stub in getEmbedding() with an
 * Ollama /api/embeddings call or any external embedding model API.
 */

const axios = require("axios");

const OLLAMA_URL =
  process.env.OLLAMA_URL || "http://localhost:11434/api/generate";
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
const DEBUG_MODE = process.env.DEBUG_MODE === "true";

// ---------------------------------------------------------------------------
// Core math
// ---------------------------------------------------------------------------

/**
 * Compute cosine similarity between two numeric vectors.
 * Returns a value between -1 and 1 (1 = identical direction).
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;

  return dot / denom;
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

/**
 * Get a vector embedding for the given text.
 *
 * Currently a stub — returns null so the rest of the pipeline degrades
 * gracefully. To enable real embeddings:
 *
 *   1. Install an embedding model in Ollama:
 *        ollama pull nomic-embed-text
 *
 *   2. Uncomment the Ollama block below.
 *
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
async function getEmbedding(text) {
  if (!text || !text.trim()) return null;

  // ── STUB: return null until a real embedding model is configured ──────────
  // Uncomment the block below and set OLLAMA_EMBED_MODEL in .env to activate.
  // ─────────────────────────────────────────────────────────────────────────
  // try {
  //   const response = await axios.post(`${OLLAMA_URL.replace("/api/generate", "")}/api/embeddings`, {
  //     model: OLLAMA_EMBED_MODEL,
  //     prompt: text,
  //   }, { timeout: 10000 });
  //   return response.data?.embedding || null;
  // } catch (error) {
  //   if (DEBUG_MODE) console.error("[semanticService] Embedding error:", error.message);
  //   return null;
  // }

  return null;
}

// ---------------------------------------------------------------------------
// Semantic ranking
// ---------------------------------------------------------------------------

/**
 * Rank a list of articles by their semantic similarity to the given claim.
 *
 * If embeddings are not available (getEmbedding returns null), each article
 * receives a similarity score of 0 and the original order is preserved.
 * This means the function degrades gracefully without breaking anything.
 *
 * When embeddings ARE available, the returned list is sorted by descending
 * similarity and each article gains a `_semanticSimilarity` property.
 *
 * @param {string} claim  - The user's main claim text
 * @param {Array<object>} articles - Articles from News API (with .title, .description)
 * @returns {Promise<Array<object>>}
 */
async function rankArticlesBySemanticSimilarity(claim, articles) {
  if (!articles || articles.length === 0) return articles;

  const claimEmbedding = await getEmbedding(claim);

  if (!claimEmbedding) {
    if (DEBUG_MODE) {
      console.log(
        "[semanticService] No embedding available, skipping semantic ranking."
      );
    }
    return articles.map((article) => ({
      ...article,
      _semanticSimilarity: 0,
    }));
  }

  const scored = await Promise.all(
    articles.map(async (article) => {
      const articleText = [article.title || "", article.description || ""].join(
        " "
      );
      const articleEmbedding = await getEmbedding(articleText);

      const similarity = articleEmbedding
        ? cosineSimilarity(claimEmbedding, articleEmbedding)
        : 0;

      return {
        ...article,
        _semanticSimilarity: similarity,
      };
    })
  );

  return scored.sort((a, b) => b._semanticSimilarity - a._semanticSimilarity);
}

module.exports = {
  getEmbedding,
  cosineSimilarity,
  rankArticlesBySemanticSimilarity,
};