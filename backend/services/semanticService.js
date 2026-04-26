/**
 * services/semanticService.js
 * Real semantic search using nomic-embed-text via Ollama.
 * Compares meaning not just keywords.
 */

"use strict";

const axios = require("axios");

const OLLAMA_BASE   = (process.env.OLLAMA_URL || "http://localhost:11434/api/generate")
  .replace("/api/generate", "");
const EMBED_MODEL   = "nomic-embed-text";
const DEBUG_MODE    = process.env.DEBUG_MODE === "true";

// Cache embeddings to avoid re-computing same text
const embedCache = new Map();

// ---------------------------------------------------------------------------
// Get embedding vector for a piece of text
// ---------------------------------------------------------------------------

async function getEmbedding(text) {
  if (!text || !text.trim()) return null;

  const key = text.slice(0, 200);
  if (embedCache.has(key)) return embedCache.get(key);

  try {
    const response = await axios.post(
      `${OLLAMA_BASE}/api/embeddings`,
      { model: EMBED_MODEL, prompt: text.trim() },
      { timeout: 8000 }
    );

    const embedding = response.data?.embedding;
    if (!embedding || !Array.isArray(embedding)) return null;

    embedCache.set(key, embedding);
    return embedding;
  } catch (error) {
    if (DEBUG_MODE) {
      console.log("[semanticService] Embedding error:", error.message);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cosine similarity between two vectors
// ---------------------------------------------------------------------------

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;

  let dot  = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Rank articles by semantic similarity to the claim
// ---------------------------------------------------------------------------

async function rankArticlesBySemanticSimilarity(claim, articles) {
  if (!articles || articles.length === 0) return articles;

  const claimEmbedding = await getEmbedding(claim);

  if (!claimEmbedding) {
    if (DEBUG_MODE) console.log("[semanticService] No embedding — skipping semantic ranking");
    return articles.map((a) => ({ ...a, _semanticSimilarity: 0 }));
  }

  const scored = await Promise.all(
    articles.map(async (article) => {
      const articleText = [
        article.title       || "",
        article.description || "",
      ].join(" ").trim();

      const articleEmbedding = await getEmbedding(articleText);
      const similarity = articleEmbedding
        ? cosineSimilarity(claimEmbedding, articleEmbedding)
        : 0;

      return { ...article, _semanticSimilarity: similarity };
    })
  );

  return scored.sort((a, b) => b._semanticSimilarity - a._semanticSimilarity);
}

// ---------------------------------------------------------------------------
// Check if two texts are semantically similar (above threshold)
// ---------------------------------------------------------------------------

async function areSemanticallyRelated(textA, textB, threshold = 0.75) {
  const [embA, embB] = await Promise.all([getEmbedding(textA), getEmbedding(textB)]);
  if (!embA || !embB) return false;
  return cosineSimilarity(embA, embB) >= threshold;
}

module.exports = {
  getEmbedding,
  cosineSimilarity,
  rankArticlesBySemanticSimilarity,
  areSemanticallyRelated,
};