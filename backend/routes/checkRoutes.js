/**
 * routes/checkRoutes.js
 * Handles: GET /debug-ping, POST /test-ai, POST /check
 *
 * Pipeline:
 * 1. Knowledge layer  — known facts, falsehoods, Wikipedia (returns immediately)
 * 2. Event modeling   — parse claim into structured event
 * 3. News API search  — keyword + semantic queries
 * 4. Semantic ranking — re-rank articles by meaning not just keywords
 * 5. AI comparison    — Llama3 compares claim to articles
 * 6. Verdict          — build final result
 */

"use strict";

const express = require("express");
const router  = express.Router();

const {
  cleanInputText,
  stripAttribution,
  buildEventModel,
  parseClaimWithAI,
  buildQueriesFromEvent,
  searchNews,
  dedupeArticles,
  isAllowedArticle,
  passesCoreMatch,
  scoreArticle,
  keepBestPerSource,
  compareClaimToArticlesWithAI,
  buildFinalVerdictFromAI,
  hasNewerOverride,
  computeConfidence,
  buildExplanation,
  buildSpokenSummary,
  inferCanonicalSource,
} = require("../services/misinformationService");

const {
  checkKnowledge,
  buildKnowledgeVerdict,
} = require("../services/knowledgeService");

const {
  rankArticlesBySemanticSimilarity,
} = require("../services/semanticService");

const DEBUG_MODE   = process.env.DEBUG_MODE === "true";
const NEWS_API_KEY = process.env.NEWS_API_KEY || "";

// ---------------------------------------------------------------------------
// GET /debug-ping
// ---------------------------------------------------------------------------

router.get("/debug-ping", (req, res) => {
  if (DEBUG_MODE) console.log("🔥 debug-ping route hit");
  res.json({ ok: true, message: "Debug route works" });
});

// ---------------------------------------------------------------------------
// POST /test-ai
// ---------------------------------------------------------------------------

router.post("/test-ai", async (req, res) => {
  if (DEBUG_MODE) console.log("🧪 /test-ai endpoint hit");

  const text = cleanInputText(req.body?.text);
  if (!text) return res.status(400).json({ error: "No text provided." });

  const strippedText = stripAttribution(text);
  const eventModel   = buildEventModel(strippedText);
  const aiClaim      = await parseClaimWithAI(strippedText);
  const queryList    = buildQueriesFromEvent(eventModel, aiClaim);

  return res.json({
    ok: true,
    originalText: text,
    strippedText,
    eventModel,
    aiClaim,
    queryList,
  });
});

// ---------------------------------------------------------------------------
// POST /check  — full pipeline
// ---------------------------------------------------------------------------

router.post("/check", async (req, res) => {
  if (DEBUG_MODE) console.log("🔥 /check endpoint hit");

  const text          = cleanInputText(req.body?.text);
  const languageMode  = req.body?.languageMode  || "english";
  const responseStyle = req.body?.responseStyle || "medium";

  if (!text) {
    return res.status(400).json({
      status: "Scan Failed", level: "danger", confidence: 0,
      explanation: "No usable text was provided.",
      spokenSummary: "Scan failed. No usable text was provided.",
      sources: [],
    });
  }

  if (!NEWS_API_KEY) {
    return res.status(500).json({
      status: "Config Error", level: "danger", confidence: 0,
      explanation: "NEWS_API_KEY is missing from your environment.",
      spokenSummary: "Configuration error. News API key is missing.",
      sources: [],
    });
  }

  try {
    const strippedText = stripAttribution(text);

    if (DEBUG_MODE) {
      console.log("\n--- NEW SCAN ---");
      console.log("Original:", text);
      console.log("Stripped:", strippedText);
    }

    // ── Layer 1: Knowledge check ───────────────────────────────────────────
    // Check if this is a known fact, falsehood, or Wikipedia-answerable claim
    // before hitting News API at all
    const knowledgeResult = await checkKnowledge(strippedText);

    if (DEBUG_MODE) {
      console.log("Knowledge check:", knowledgeResult.answered, knowledgeResult.claimType);
    }

    if (knowledgeResult.answered && !knowledgeResult.needsNews) {
      const verdict = buildKnowledgeVerdict(knowledgeResult);

      if (DEBUG_MODE) console.log("✅ Answered by knowledge layer:", verdict.status);

      return res.json({
        ...verdict,
        sources:          knowledgeResult.wikiResults
          ? knowledgeResult.wikiResults.slice(0, 3).map((w, i) => ({
              id:     i + 1,
              title:  w.title,
              source: "Wikipedia",
              url:    `https://en.wikipedia.org/wiki/${encodeURIComponent(w.title.replace(/ /g, "_"))}`,
              publishedAt: null,
              score: 10,
            }))
          : [],
        knowledgeVerdict: true,
      });
    }

    // ── Layer 2: Event modeling + AI claim parsing ─────────────────────────
    const eventModel = buildEventModel(strippedText);
    const aiClaim    = await parseClaimWithAI(strippedText);
    const queryList  = buildQueriesFromEvent(eventModel, aiClaim);
    const language   = languageMode === "any" ? null : "en";

    if (DEBUG_MODE) {
      console.log("Event model:", JSON.stringify(eventModel, null, 2));
      console.log("AI claim:", JSON.stringify(aiClaim, null, 2));
      console.log("Queries:", queryList);
    }

    // ── Layer 3: News API search ───────────────────────────────────────────
    const searchResults = await Promise.all(
      queryList.map((query, index) => searchNews(query, index === 0 ? 12 : 8, language))
    );

    const resultBreakdown = searchResults.map((items, idx) => ({
      query: queryList[idx],
      count: items.length,
    }));

    const combinedArticles = dedupeArticles(searchResults.flat());

    // ── Layer 4: Keyword scoring ───────────────────────────────────────────
    let scoredArticles = combinedArticles
      .filter(isAllowedArticle)
      .filter((article) => passesCoreMatch(eventModel, article))
      .map((article) => {
        const detail = scoreArticle(eventModel, article);
        return { ...article, _score: detail.totalScore, _detail: detail };
      })
      .filter((article) => article._score >= 7)
      .sort((a, b) => b._score - a._score);

    scoredArticles = keepBestPerSource(scoredArticles)
      .sort((a, b) => b._score - a._score)
      .slice(0, 12);

    // ── Layer 5: Semantic re-ranking ───────────────────────────────────────
    // Re-rank using nomic-embed-text embeddings (meaning not just keywords)
    // "Moscow strikes Kyiv" matches "Russia attacked Ukraine"
    if (scoredArticles.length > 0) {
      const claimForSemantic = aiClaim?.mainClaim || strippedText;

      const semanticRanked = await rankArticlesBySemanticSimilarity(
        claimForSemantic,
        scoredArticles
      );

      // Blend keyword score with semantic similarity
      scoredArticles = semanticRanked.map((article) => {
        const semanticBoost = (article._semanticSimilarity || 0) * 8;
        return {
          ...article,
          _score: article._score + semanticBoost,
          _semanticSim: article._semanticSimilarity || 0,
        };
      }).sort((a, b) => b._score - a._score).slice(0, 8);

      if (DEBUG_MODE) {
        console.log("After semantic re-ranking:");
        scoredArticles.forEach((a, i) => {
          console.log(`  ${i+1}. [kw=${(a._score - (a._semanticSim||0)*8).toFixed(1)} sem=${(a._semanticSim||0).toFixed(3)}] ${inferCanonicalSource(a)} - ${a.title?.slice(0,60)}`);
        });
      }
    }

    // ── Layer 6: AI comparison + verdict ──────────────────────────────────
    const aiMatches = await compareClaimToArticlesWithAI(aiClaim, scoredArticles);

    let verdict = buildFinalVerdictFromAI(scoredArticles, aiMatches || []);
    if (hasNewerOverride(scoredArticles)) {
      verdict = { resultType: "unverified", status: "Outdated Or Reversed", level: "warning" };
    }

    const confidence    = computeConfidence(scoredArticles, aiMatches || []);
    const explanation   = buildExplanation(verdict.resultType, eventModel, scoredArticles, responseStyle);
    const spokenSummary = buildSpokenSummary(verdict.status, confidence, explanation);

    if (DEBUG_MODE) {
      console.log("Total fetched:", combinedArticles.length);
      console.log("After filtering:", scoredArticles.length);
      console.log("Final verdict:", verdict);
      console.log("Confidence:", confidence);
    }

    return res.json({
      status: verdict.status,
      level:  verdict.level,
      confidence,
      explanation,
      spokenSummary,
      sources: scoredArticles.slice(0, 5).map((article, index) => ({
        id:             index + 1,
        title:          article.title,
        source:         inferCanonicalSource(article),
        originalSource: article.source?.name || "Unknown Source",
        url:            article.url,
        publishedAt:    article.publishedAt || null,
        score:          Number(article._score.toFixed(2)),
        semanticSim:    article._semanticSim ? Number(article._semanticSim.toFixed(3)) : 0,
        aiMatch:        aiMatches?.find((item) => item.id === index + 1) || null,
        sameEventBucket: article._detail.sameEventBucket,
      })),
      debug: DEBUG_MODE ? {
        originalText:    text,
        strippedText,
        eventModel,
        aiClaim,
        queryList,
        totalFetched:    combinedArticles.length,
        matchedCount:    scoredArticles.length,
        aiMatches,
        languageMode,
        responseStyle,
        resultBreakdown,
        newerOverride:   hasNewerOverride(scoredArticles),
        knowledgeResult,
      } : undefined,
    });

  } catch (error) {
    console.error("Check error:", error.response?.data || error.message);

    if (error.response?.status === 429) {
      return res.status(429).json({
        status: "Limit Reached", level: "danger", confidence: 0,
        explanation: "Daily news lookup limit reached. Please try again later.",
        spokenSummary: "Haven reached the daily news lookup limit.",
        sources: [],
      });
    }

    return res.status(500).json({
      status: "Scan Failed", level: "danger", confidence: 0,
      explanation: "There was a problem checking this claim. Please try again.",
      spokenSummary: "Scan failed.",
      sources: [],
    });
  }
});

module.exports = router;