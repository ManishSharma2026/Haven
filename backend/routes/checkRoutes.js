/**
 * routes/checkRoutes.js
 * Handles: GET /debug-ping, POST /test-ai, POST /check
 */

"use strict";

const express = require("express");
const router = express.Router();

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

const DEBUG_MODE = process.env.DEBUG_MODE === "true";
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

  if (!text) {
    return res.status(400).json({ error: "No text provided." });
  }

  const strippedText = stripAttribution(text);
  const eventModel = buildEventModel(strippedText);
  const aiClaim = await parseClaimWithAI(strippedText);
  const queryList = buildQueriesFromEvent(eventModel, aiClaim);

  if (DEBUG_MODE) {
    console.log("Original text:", text);
    console.log("Stripped text:", strippedText);
    console.log("Event model:", eventModel);
    console.log("AI claim parse:", aiClaim);
    console.log("Query list:", queryList);
  }

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
// POST /check
// ---------------------------------------------------------------------------
router.post("/check", async (req, res) => {
  if (DEBUG_MODE) console.log("🔥 /check endpoint hit");

  const text = cleanInputText(req.body?.text);
  const languageMode = req.body?.languageMode || "english";
  const responseStyle = req.body?.responseStyle || "medium";

  if (!text) {
    return res.status(400).json({
      status: "Scan Failed",
      level: "danger",
      confidence: 0,
      explanation: "No usable text was provided.",
      spokenSummary: "Scan failed. No usable text was provided.",
      sources: [],
    });
  }

  if (!NEWS_API_KEY) {
    return res.status(500).json({
      status: "Config Error",
      level: "danger",
      confidence: 0,
      explanation: "NEWS_API_KEY is missing from your environment.",
      spokenSummary: "Configuration error. News API key is missing.",
      sources: [],
    });
  }

  try {
    const strippedText = stripAttribution(text);
    const eventModel = buildEventModel(strippedText);
    const aiClaim = await parseClaimWithAI(strippedText);
    const queryList = buildQueriesFromEvent(eventModel, aiClaim);
    const language = languageMode === "any" ? null : "en";

    if (DEBUG_MODE) {
      console.log("\n--- NEW SCAN ---");
      console.log("Original text:", text);
      console.log("Stripped text:", strippedText);
      console.log("Event model:", JSON.stringify(eventModel, null, 2));
      console.log("AI claim parse:", JSON.stringify(aiClaim, null, 2));
      console.log("Query list:", queryList);
      console.log("Language mode:", languageMode);
      console.log("Response style:", responseStyle);
    }

    const searchResults = await Promise.all(
      queryList.map((query, index) => searchNews(query, index === 0 ? 12 : 8, language))
    );

    const resultBreakdown = searchResults.map((items, idx) => ({
      query: queryList[idx],
      count: items.length,
    }));

    const combinedArticles = dedupeArticles(searchResults.flat());

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
      .slice(0, 8);

    const aiMatches = await compareClaimToArticlesWithAI(aiClaim, scoredArticles);

    let verdict = buildFinalVerdictFromAI(scoredArticles, aiMatches || []);
    if (hasNewerOverride(scoredArticles)) {
      verdict = { resultType: "unverified", status: "Outdated Or Reversed", level: "warning" };
    }

    const confidence = computeConfidence(scoredArticles, aiMatches || []);
    const explanation = buildExplanation(verdict.resultType, eventModel, scoredArticles, responseStyle);
    const spokenSummary = buildSpokenSummary(verdict.status, confidence, explanation);

    if (DEBUG_MODE) {
      console.log("Search results by query:", resultBreakdown);
      console.log("Combined deduped articles:", combinedArticles.length);
      console.log("Relevant articles after filtering:", scoredArticles.length);
      scoredArticles.forEach((article, index) => {
        console.log(
          `${index + 1}. [score=${article._score.toFixed(2)}] ${inferCanonicalSource(article)} - ${article.title}`
        );
      });
      console.log("Has newer override:", hasNewerOverride(scoredArticles));
      console.log("Final verdict:", verdict);
      console.log("Confidence:", confidence);
      console.log("AI matches:", aiMatches);
    }

    return res.json({
      status: verdict.status,
      level: verdict.level,
      confidence,
      explanation,
      spokenSummary,
      sources: scoredArticles.slice(0, 5).map((article, index) => ({
        id: index + 1,
        title: article.title,
        source: inferCanonicalSource(article),
        originalSource: article.source?.name || "Unknown Source",
        url: article.url,
        publishedAt: article.publishedAt || null,
        score: Number(article._score.toFixed(2)),
        aiMatch: aiMatches?.find((item) => item.id === index + 1) || null,
        sameEventBucket: article._detail.sameEventBucket,
      })),
      debug: DEBUG_MODE
        ? {
            originalText: text,
            strippedText,
            eventModel,
            aiClaim,
            queryList,
            totalFetched: combinedArticles.length,
            matchedCount: scoredArticles.length,
            aiMatches,
            languageMode,
            responseStyle,
            resultBreakdown,
            newerOverride: hasNewerOverride(scoredArticles),
          }
        : undefined,
    });
  } catch (error) {
    console.error("Check error:", error.response?.data || error.message);

    if (error.response?.status === 429) {
      return res.status(429).json({
        status: "Limit Reached",
        level: "danger",
        confidence: 0,
        explanation: "Daily news lookup limit reached. Please try again later.",
        spokenSummary: "Haven reached the daily news lookup limit. Please try again later.",
        sources: [],
      });
    }

    return res.status(500).json({
      status: "Scan Failed",
      level: "danger",
      confidence: 0,
      explanation: "There was a problem checking this claim. Please try again.",
      spokenSummary: "Scan failed. There was a problem checking this claim.",
      sources: [],
    });
  }
});

module.exports = router;