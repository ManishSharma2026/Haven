/**
 * services/knowledgeService.js
 * Dynamic fact checking — no hardcoded patterns.
 * Uses Llama3 + Wikipedia only.
 * 
 * Only answers directly for clear scientific/historical facts.
 * Current events always go to News API.
 */

"use strict";

const axios             = require("axios");
const { askLocalAI }    = require("./aiService");
const { safeJsonParse } = require("../utils/jsonUtils");

const DEBUG_MODE = process.env.DEBUG_MODE === "true";

// Signals that indicate a current news event — skip knowledge layer
const CURRENT_EVENT_PATTERNS = [
  /\b(today|yesterday|this week|this month|this year|breaking|latest|just|recently)\b/i,
  /\b(says|said|tells|told|announces|announced|claims|claimed|warns|warned|reports)\b/i,
  /\b(meeting|talks|deal|agreement|summit|conference|vote|election|attack|strike|raid)\b/i,
  /\b(president|minister|senator|governor|chancellor|secretary|official|spokesman)\b/i,
  /\b(leaves|stays|walks out|pulls out|withdraws|suspends|resigns|fired|appointed)\b/i,
  /\b(negotiat|sanction|ceasefire|treaty|diplomacy|bilateral|accord|pact)\b/i,
  /\b(war|conflict|crisis|emergency|shutdown|collapse|crash|surge|spike|drop|rise|fall)\b/i,
];

function looksLikeCurrentEvent(claim) {
  const matches = CURRENT_EVENT_PATTERNS.filter(r => r.test(claim)).length;
  return matches >= 2;
}

async function askLlamaAboutClaim(claim) {
  const prompt = `You are a fact-checking assistant with knowledge of established science, history, medicine, and geography.

Analyze this claim: "${claim}"

IMPORTANT RULES:
- Only say canAnswerDirectly=true for TIMELESS facts (scientific laws, historical events before 2020, geographic facts, mathematical truths)
- If the claim involves recent news, current politics, ongoing events, or anything that could change — say claimType="current_event" and canAnswerDirectly=false
- Be conservative — when in doubt, send it to news sources

Respond ONLY in this exact JSON format:
{
  "claimType": "known_fact" | "known_falsehood" | "current_event" | "opinion" | "unclear",
  "canAnswerDirectly": true | false,
  "verdict": "true" | "false" | "partially_true" | "needs_verification" | "opinion",
  "explanation": "2-3 sentence clear explanation",
  "confidence": 0-100,
  "consensusType": "scientific_consensus" | "historical_record" | "geographic_fact" | "medical_fact" | "mathematical_fact" | "current_news" | "opinion" | "unknown",
  "suggestWikipediaSearch": "search query if helpful, or empty string"
}`;

  const response = await askLocalAI(prompt, { temperature: 0.05 });
  return safeJsonParse(response);
}

async function searchWikipedia(query) {
  if (!query || !query.trim()) return null;

  try {
    const directRes = await axios.get(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query.replace(/\s+/g, "_"))}`,
      { timeout: 5000, headers: { "User-Agent": "Haven/1.0 (fact-checking browser extension)" } }
    );
    if (directRes.data?.extract) {
      return {
        found:   true,
        title:   directRes.data.title,
        extract: directRes.data.extract.slice(0, 600),
        url:     directRes.data.content_urls?.desktop?.page || "",
      };
    }
  } catch {}

  try {
    const searchRes = await axios.get("https://en.wikipedia.org/w/api.php", {
      params: { action: "query", list: "search", srsearch: query, format: "json", srlimit: 3, srprop: "snippet" },
      timeout: 5000,
    });
    const results = searchRes.data?.query?.search || [];
    if (results.length === 0) return { found: false };
    return {
      found:   true,
      title:   results[0].title,
      extract: results[0].snippet.replace(/<[^>]*>/g, "").slice(0, 400),
      url:     `https://en.wikipedia.org/wiki/${encodeURIComponent(results[0].title.replace(/ /g, "_"))}`,
    };
  } catch {
    return { found: false };
  }
}

async function askLlamaWithContext(claim, wikiContext) {
  const prompt = `You are a fact-checking assistant. Use the Wikipedia context below to verify this claim.

Claim: "${claim}"

Wikipedia context: "${wikiContext}"

Only answer directly if this is a timeless, established fact — not a current event.

Respond ONLY in this exact JSON format:
{
  "verdict": "true" | "false" | "partially_true" | "needs_verification",
  "explanation": "2-3 sentence explanation",
  "confidence": 0-100,
  "canAnswerDirectly": true | false
}`;

  const response = await askLocalAI(prompt, { temperature: 0.05 });
  return safeJsonParse(response);
}

async function checkKnowledge(claim) {
  if (DEBUG_MODE) console.log("[knowledgeService] Checking:", claim.slice(0, 80));

  // Fast path — if it looks like current news, skip directly to News API
  if (looksLikeCurrentEvent(claim)) {
    if (DEBUG_MODE) console.log("[knowledgeService] Current event detected — going to News API");
    return { answered: false, needsNews: true, claimType: "current_event" };
  }

  const llamaResult = await askLlamaAboutClaim(claim);

  if (DEBUG_MODE) console.log("[knowledgeService] Llama3:", llamaResult?.claimType, llamaResult?.verdict, `(${llamaResult?.confidence}%)`);

  // Strict threshold — only answer directly if very confident AND it's a timeless fact
  const isTimelessFact = ["known_fact", "known_falsehood"].includes(llamaResult?.claimType);
  const isHighConfidence = (llamaResult?.confidence || 0) >= 92;
  const isNotCurrentNews = llamaResult?.consensusType !== "current_news";

  if (llamaResult && llamaResult.canAnswerDirectly && isHighConfidence && isTimelessFact && isNotCurrentNews) {
    let wikiData = null;
    if (llamaResult.suggestWikipediaSearch) {
      wikiData = await searchWikipedia(llamaResult.suggestWikipediaSearch);
    }
    return {
      answered: true, claimType: llamaResult.claimType,
      verdict: llamaResult.verdict, explanation: llamaResult.explanation,
      confidence: llamaResult.confidence, consensusType: llamaResult.consensusType,
      needsNews: false, wikiData, source: llamaResult.consensusType || "AI Knowledge",
    };
  }

  // Moderate confidence — try Wikipedia for additional context
  if (llamaResult && isTimelessFact && (llamaResult?.confidence || 0) >= 70) {
    const searchQuery = llamaResult.suggestWikipediaSearch || claim.slice(0, 100);
    const wikiData    = await searchWikipedia(searchQuery);

    if (wikiData?.found && wikiData.extract) {
      const enriched = await askLlamaWithContext(claim, wikiData.extract);

      if (enriched && enriched.canAnswerDirectly && (enriched.confidence || 0) >= 88) {
        return {
          answered: true, claimType: llamaResult.claimType,
          verdict: enriched.verdict, explanation: enriched.explanation,
          confidence: enriched.confidence, needsNews: false,
          wikiData, source: "Wikipedia + AI",
        };
      }
    }
  }

  // Everything else goes to News API
  return { answered: false, needsNews: true, claimType: llamaResult?.claimType || "current_event" };
}

function buildKnowledgeVerdict(result) {
  const { verdict, explanation, confidence, claimType, consensusType, wikiData } = result;

  let status, level;
  if (claimType === "known_falsehood" || verdict === "false") { status = "Known Falsehood"; level = "danger"; }
  else if (verdict === "true" || claimType === "known_fact")  { status = "Established Fact"; level = "safe"; }
  else if (verdict === "partially_true")                      { status = "Partially True";   level = "warning"; }
  else if (claimType === "opinion")                           { status = "Opinion";          level = "warning"; }
  else                                                        { status = "Needs Verification"; level = "warning"; }

  const sourceLabel = (consensusType || "AI Knowledge").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    status, level,
    confidence:  confidence || 85,
    explanation: explanation + ` [Source: ${sourceLabel}]`,
    spokenSummary: `${status}. ${explanation}`,
    sources: wikiData?.found ? [{ id: 1, title: wikiData.title, source: "Wikipedia", url: wikiData.url, publishedAt: null, score: 10 }] : [],
    isKnowledgeVerdict: true,
  };
}

module.exports = { checkKnowledge, buildKnowledgeVerdict, searchWikipedia };