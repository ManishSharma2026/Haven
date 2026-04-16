const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = 3000;

// Move this into .env later
const NEWS_API_KEY = "2bb1f632b24c4b61ad36c239b83e413b";

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Haven backend is running.");
});

/**
 * Stop words for building queries.
 * These are weak framing words and vague time/context words.
 */
const QUERY_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "have",
  "been",
  "were",
  "will",
  "would",
  "could",
  "should",
  "about",
  "after",
  "before",
  "into",
  "over",
  "under",
  "only",
  "more",
  "than",
  "they",
  "them",
  "their",
  "what",
  "when",
  "where",
  "which",
  "while",
  "said",
  "says",
  "are",
  "was",
  "is",
  "being",
  "latest",
  "live",
  "updates",
  "update",
  "breaking",
  "report",
  "reports",
  "hint",
  "hints",
  "today",
  "tomorrow",
  "yesterday",
  "next",
  "day",
  "days",
  "week",
  "weeks",
  "month",
  "months",
  "year",
  "years",
  "official",
  "officials",
  "one",
  "two",
  "three",
  "four",
  "five",
  "of",
  "few",
  "since",
  "amid",
  "across",
  "within",
  "during",
  "through",
  "via",
  "pass",
]);

/**
 * Lighter stop words for scoring.
 */
const SCORE_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "have",
  "been",
  "were",
  "will",
  "would",
  "could",
  "should",
  "about",
  "after",
  "before",
  "into",
  "over",
  "under",
  "only",
  "more",
  "than",
  "they",
  "them",
  "their",
  "what",
  "when",
  "where",
  "which",
  "while",
  "said",
  "says",
  "are",
  "was",
  "is",
]);

/**
 * Useful entity aliases.
 * Unknown important words can still become entities.
 */
const ENTITY_ALIASES = {
  us: ["us", "u.s", "united states", "america", "american", "washington"],
  uk: ["uk", "u.k", "united kingdom", "britain", "british"],
  eu: ["eu", "european union"],
  un: ["un", "u.n", "united nations"],
  china: ["china", "chinese", "beijing"],
  russia: ["russia", "russian", "moscow"],
  iran: ["iran", "iranian", "tehran"],
  israel: ["israel", "israeli", "jerusalem"],
  lebanon: ["lebanon", "lebanese", "beirut"],
};

/**
 * Generic action/event groups.
 */
const ACTION_GROUPS = {
  talks: [
    "talks",
    "negotiations",
    "meeting",
    "meetings",
    "diplomatic",
    "diplomacy",
    "discussion",
  ],
  resume: ["resume", "restart", "renew", "continue", "reopen"],
  approve: [
    "approve",
    "approved",
    "approval",
    "authorize",
    "authorized",
    "authorization",
    "cleared",
    "greenlit",
  ],
  acquire: [
    "acquire",
    "acquired",
    "buy",
    "bought",
    "purchase",
    "purchased",
    "takeover",
    "merger",
  ],
  launch: [
    "launch",
    "launched",
    "release",
    "released",
    "unveiled",
    "introduced",
  ],
  kill: ["kill", "killed", "dead", "death", "deaths", "fatality", "fatalities"],
  sue: ["sue", "sued", "lawsuit", "legal action"],
  win: ["win", "won", "victory", "beat", "defeated"],
  lose: ["lose", "lost", "defeat"],
  rise: ["rise", "rising", "increase", "increased", "surge", "jump", "up"],
  fall: [
    "fall",
    "fell",
    "drop",
    "dropped",
    "decline",
    "declined",
    "slump",
    "down",
  ],
  drop: [
    "drop",
    "decline",
    "declined",
    "reduced",
    "reduction",
    "fall",
    "fell",
    "fewer",
    "less",
  ],
  traffic: [
    "traffic",
    "flow",
    "shipping",
    "shipments",
    "transit",
    "passage",
    "movement",
  ],
  fire: ["fire", "fired", "dismissed", "terminated"],
  arrest: ["arrest", "arrested", "detained", "custody"],
  ban: ["ban", "banned", "block", "blocked", "prohibit", "prohibited"],
  blockade: ["blockade", "blocked", "closure", "shut", "restriction"],
  warn: ["warn", "warning", "alert", "caution"],
  ceasefire: ["ceasefire", "truce", "pause"],
  election: ["election", "vote", "voting", "ballot", "polls"],
  disaster: [
    "earthquake",
    "flood",
    "wildfire",
    "storm",
    "hurricane",
    "tornado",
  ],
};

const TRUSTED_SOURCES = [
  "reuters",
  "associated press",
  "ap news",
  "bbc",
  "cnn",
  "new york times",
  "the new york times",
  "washington post",
  "the washington post",
  "npr",
  "guardian",
  "the guardian",
  "al jazeera",
  "bloomberg",
  "financial times",
  "wall street journal",
  "wsj",
  "abc news",
  "cbs news",
  "nbc news",
  "pbs",
  "economist",
  "the economist",
  "forbes",
  "time",
  "politico",
  "axios",
];

const WEAK_SOURCE_PATTERNS = [
  "slashdot",
  "freerepublic",
  "juancole",
  "commondreams",
  "thechronicle.com.gh",
  "blogspot",
  "substack",
];

/**
 * Text helpers
 */
function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/[^\w\s%$./]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(arr) {
  return [...new Set(arr)];
}

function tokenize(text, stopWords = new Set()) {
  return normalizeText(text)
    .split(" ")
    .filter((word) => word.length > 0 && !stopWords.has(word));
}

function extractNumbers(text) {
  const matches = String(text || "").match(
    /\b\d+(?:\.\d+)?%?\b|\$\d+(?:\.\d+)?\b/g,
  );
  return matches ? unique(matches.map((m) => m.toLowerCase())) : [];
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function looksLikeTimeWord(word) {
  return [
    "day",
    "days",
    "week",
    "weeks",
    "month",
    "months",
    "year",
    "years",
    "today",
    "tomorrow",
    "yesterday",
    "next",
    "one",
    "two",
    "three",
    "four",
    "five",
  ].includes(word);
}

function isLikelyEntity(word) {
  if (!word || word.length < 4) return false;
  if (QUERY_STOP_WORDS.has(word)) return false;
  if (ACTION_GROUPS[word]) return false;

  const genericWords = new Set([
    "middle",
    "east",
    "conflict",
    "ships",
    "pass",
    "since",
    "few",
    "many",
    "more",
    "less",
    "amid",
    "global",
    "world",
    "international",
    "regional",
    "news",
    "live",
    "update",
    "updates",
  ]);

  if (genericWords.has(word)) return false;

  return true;
}

function isGoodDescriptor(word) {
  if (!word) return false;
  if (word.length < 4) return false;
  if (looksLikeTimeWord(word)) return false;
  if (QUERY_STOP_WORDS.has(word)) return false;
  if (ACTION_GROUPS[word]) return false;

  const badDescriptors = new Set([
    "middle",
    "east",
    "conflict",
    "global",
    "world",
    "international",
    "regional",
  ]);

  return !badDescriptors.has(word);
}

/**
 * Source helpers
 */
function inferCanonicalSource(article) {
  const rawSource = (article.source?.name || "").trim();
  const title = (article.title || "").toLowerCase();
  const domain = extractDomain(article.url || "");

  if (title.includes("reuters")) return "Reuters";
  if (title.includes("associated press") || title.includes("ap news")) {
    return "Associated Press";
  }
  if (title.includes("bloomberg")) return "Bloomberg";
  if (title.includes("bbc")) return "BBC";
  if (title.includes("cnn")) return "CNN";
  if (title.includes("new york times")) return "The New York Times";
  if (title.includes("washington post")) return "The Washington Post";

  if (domain.includes("reuters.com")) return "Reuters";
  if (domain.includes("apnews.com")) return "Associated Press";
  if (domain.includes("bloomberg.com")) return "Bloomberg";
  if (domain.includes("bbc.com") || domain.includes("bbc.co.uk")) return "BBC";
  if (domain.includes("cnn.com")) return "CNN";
  if (domain.includes("nytimes.com")) return "The New York Times";
  if (domain.includes("washingtonpost.com")) return "The Washington Post";
  if (domain.includes("npr.org")) return "NPR";
  if (domain.includes("theguardian.com")) return "The Guardian";
  if (domain.includes("aljazeera.com")) return "Al Jazeera";
  if (domain.includes("ft.com")) return "Financial Times";
  if (domain.includes("wsj.com")) return "The Wall Street Journal";
  if (domain.includes("axios.com")) return "Axios";
  if (domain.includes("politico.com")) return "Politico";
  if (domain.includes("time.com")) return "Time";
  if (domain.includes("forbes.com")) return "Forbes";

  return rawSource || domain || "Unknown Source";
}

function isTrustedSourceName(sourceName) {
  const s = sourceName.toLowerCase();
  return TRUSTED_SOURCES.some((trusted) => s.includes(trusted));
}

/**
 * Claim modeling
 */
function buildClaimModel(text) {
  const cleanedText = normalizeText(text);
  const rawTokens = tokenize(cleanedText, QUERY_STOP_WORDS);
  const keywords = unique(rawTokens).slice(0, 14);
  const numbers = extractNumbers(text);

  const entities = [];
  const actions = [];
  const descriptors = [];

  for (const word of keywords) {
    if (ENTITY_ALIASES[word]) {
      entities.push(word);
    } else if (ACTION_GROUPS[word]) {
      actions.push(word);
    } else if (looksLikeTimeWord(word)) {
      continue;
    } else if (isLikelyEntity(word)) {
      entities.push(word);
    } else if (isGoodDescriptor(word)) {
      descriptors.push(word);
    }
  }

  const strongKeywords = keywords.filter(
    (word) =>
      word.length >= 5 &&
      !looksLikeTimeWord(word) &&
      !QUERY_STOP_WORDS.has(word),
  );

  return {
    cleanedText,
    keywords,
    entities: unique(entities),
    actions: unique(actions),
    descriptors: unique(descriptors),
    numbers,
    strongKeywords,
  };
}

function expandEntities(entities) {
  const expanded = new Set();

  for (const entity of entities) {
    expanded.add(entity);

    if (ENTITY_ALIASES[entity]) {
      for (const alias of ENTITY_ALIASES[entity]) {
        expanded.add(alias);
      }
    }
  }

  return [...expanded];
}

function expandActions(actions) {
  const expanded = new Set();

  for (const action of actions) {
    expanded.add(action);

    if (ACTION_GROUPS[action]) {
      for (const alias of ACTION_GROUPS[action]) {
        expanded.add(alias);
      }
    }
  }

  return [...expanded];
}

function detectPrimaryAnchor(claim) {
  const genericEntities = new Set([
    "us",
    "uk",
    "eu",
    "un",
    "china",
    "russia",
    "iran",
    "israel",
    "lebanon",
  ]);

  for (const entity of claim.entities) {
    if (!genericEntities.has(entity)) {
      return entity;
    }
  }

  return claim.entities[0] || null;
}

function detectEffectTerms(claim) {
  const effectTerms = [];
  const text = `${claim.cleanedText} ${claim.descriptors.join(" ")}`;

  if (
    text.includes("ship") ||
    text.includes("shipping") ||
    text.includes("traffic") ||
    text.includes("transit") ||
    text.includes("flow")
  ) {
    effectTerms.push("traffic");
  }

  if (
    text.includes("few") ||
    text.includes("less") ||
    text.includes("fewer") ||
    text.includes("drop") ||
    text.includes("decline") ||
    text.includes("reduced") ||
    text.includes("fall")
  ) {
    effectTerms.push("drop");
  }

  return unique(effectTerms);
}

/**
 * Query building
 */
function buildQueries(claim) {
  const phraseParts = [
    ...claim.entities.slice(0, 2),
    ...claim.actions.slice(0, 2),
    ...claim.descriptors.slice(0, 2),
  ].filter(Boolean);

  const shortPhraseSeed =
    phraseParts.length > 0
      ? phraseParts
      : [
          ...claim.keywords
            .filter((word) => word.length >= 4 && !looksLikeTimeWord(word))
            .slice(0, 5),
        ];

  const shortPhraseQuery =
    shortPhraseSeed.length > 0
      ? `"${shortPhraseSeed.join(" ")}"`
      : `"${claim.cleanedText.split(" ").slice(0, 5).join(" ")}"`;

  const entityExpanded = expandEntities(claim.entities);
  const actionExpanded = expandActions(claim.actions);

  const entityQuery =
    entityExpanded.length > 0
      ? `(${entityExpanded.slice(0, 8).join(" OR ")})`
      : "";

  const actionQuery =
    actionExpanded.length > 0
      ? `(${actionExpanded.slice(0, 8).join(" OR ")})`
      : "";

  const descriptorQuery =
    claim.descriptors.length > 0
      ? `(${claim.descriptors.slice(0, 3).join(" OR ")})`
      : "";

  const structuredQuery = [entityQuery, actionQuery, descriptorQuery]
    .filter(Boolean)
    .join(" AND ");

  const broadKeywordQuery = [
    ...claim.entities,
    ...claim.actions,
    ...claim.descriptors,
  ]
    .filter((word) => word.length >= 4)
    .slice(0, 8)
    .join(" OR ");

  const fallbackQuery = [
    ...claim.entities.slice(0, 2),
    ...claim.actions.slice(0, 2),
    ...claim.descriptors.slice(0, 2),
  ]
    .filter((word) => word.length >= 4)
    .join(" ");

  return {
    shortPhraseQuery,
    structuredQuery,
    broadKeywordQuery,
    fallbackQuery,
  };
}

/**
 * News search
 */
async function searchNews(query, pageSize = 8, language = null) {
  if (!query || !query.trim()) {
    return [];
  }

  try {
    const params = {
      q: query,
      sortBy: "publishedAt",
      pageSize,
      apiKey: NEWS_API_KEY,
    };

    if (language) {
      params.language = language;
    }

    const response = await axios.get("https://newsapi.org/v2/everything", {
      params,
    });

    return response.data.articles || [];
  } catch (error) {
    console.error(`Search failed for query: ${query}`);
    console.error(error.response?.data || error.message);
    return [];
  }
}

function dedupeArticles(articles) {
  const seenTitles = new Set();

  return articles.filter((article) => {
    const normalizedTitle = normalizeText(article.title || "");

    if (!normalizedTitle || seenTitles.has(normalizedTitle)) {
      return false;
    }

    seenTitles.add(normalizedTitle);
    return true;
  });
}

function keepBestPerSource(articles) {
  const bestBySource = new Map();

  for (const article of articles) {
    const sourceName = inferCanonicalSource(article).toLowerCase();

    if (!bestBySource.has(sourceName)) {
      bestBySource.set(sourceName, article);
      continue;
    }

    const existing = bestBySource.get(sourceName);

    if ((article._score || 0) > (existing._score || 0)) {
      bestBySource.set(sourceName, article);
    }
  }

  return [...bestBySource.values()];
}

function articleText(article) {
  return normalizeText(`${article.title || ""} ${article.description || ""}`);
}

function containsAnyPhrase(text, values) {
  return values.some((value) => text.includes(value.toLowerCase()));
}

/**
 * Scoring helpers
 */
function phraseMatchScore(claimText, articleCombinedText) {
  const claimWords = tokenize(claimText, QUERY_STOP_WORDS).filter(
    (word) => word.length >= 4 && !looksLikeTimeWord(word),
  );

  const article = normalizeText(articleCombinedText);
  let matchCount = 0;

  for (const word of claimWords) {
    if (article.includes(word)) {
      matchCount += 1;
    }
  }

  return matchCount;
}

function semanticLiteScore(claim, articleCombinedText) {
  const claimTokens = new Set(
    tokenize(claim.cleanedText, QUERY_STOP_WORDS).filter(
      (word) => word.length >= 4 && !looksLikeTimeWord(word),
    ),
  );

  const articleTokens = new Set(
    tokenize(articleCombinedText, SCORE_STOP_WORDS).filter(
      (word) => word.length >= 4,
    ),
  );

  let overlap = 0;

  for (const token of claimTokens) {
    if (articleTokens.has(token)) {
      overlap += 1;
    }
  }

  const denominator = Math.max(claimTokens.size, 1);
  return overlap / denominator;
}

function contradictionPenalty(claim, articleCombinedText) {
  const article = normalizeText(articleCombinedText);
  let penalty = 0;

  if (claim.actions.includes("resume")) {
    if (
      article.includes("failed") ||
      article.includes("collapse") ||
      article.includes("collapsed") ||
      article.includes("breakdown") ||
      article.includes("stalled") ||
      article.includes("blocked")
    ) {
      penalty += 4;
    }
  }

  if (claim.actions.includes("win")) {
    if (
      article.includes("lost") ||
      article.includes("defeat") ||
      article.includes("defeated")
    ) {
      penalty += 4;
    }
  }

  if (claim.actions.includes("rise")) {
    if (
      article.includes("fell") ||
      article.includes("drop") ||
      article.includes("decline")
    ) {
      penalty += 3;
    }
  }

  if (claim.actions.includes("fall")) {
    if (
      article.includes("rise") ||
      article.includes("surge") ||
      article.includes("jump")
    ) {
      penalty += 3;
    }
  }

  return penalty;
}

function trustedSourceBonus(article) {
  const canonical = inferCanonicalSource(article).toLowerCase();
  if (isTrustedSourceName(canonical)) return 5;
  return 0;
}

function weakSourcePenalty(article) {
  const sourceName = inferCanonicalSource(article).toLowerCase();
  const domain = extractDomain(article.url || "");

  for (const weak of WEAK_SOURCE_PATTERNS) {
    if (sourceName.includes(weak) || domain.includes(weak)) {
      return 5;
    }
  }

  return 0;
}

function scoreArticle(claim, article) {
  const combinedText = articleText(article);
  const tokens = new Set(tokenize(combinedText, SCORE_STOP_WORDS));

  let entityScore = 0;
  let actionScore = 0;
  let effectScore = 0;
  let descriptorScore = 0;
  let numberScore = 0;
  let keywordScore = 0;

  const expandedEntities = expandEntities(claim.entities);
  const expandedActions = expandActions(claim.actions);
  const effectTerms = detectEffectTerms(claim);
  const expandedEffectTerms = expandActions(effectTerms);

  const primaryAnchor = detectPrimaryAnchor(claim);
  const anchorMatched =
    !primaryAnchor ||
    containsAnyPhrase(combinedText, expandEntities([primaryAnchor]));

  if (
    expandedEntities.length > 0 &&
    containsAnyPhrase(combinedText, expandedEntities)
  ) {
    entityScore += 3;
  }

  if (
    expandedActions.length > 0 &&
    containsAnyPhrase(combinedText, expandedActions)
  ) {
    actionScore += 3;
  }

  if (
    expandedEffectTerms.length > 0 &&
    containsAnyPhrase(combinedText, expandedEffectTerms)
  ) {
    effectScore += 3;
  }

  for (const descriptor of claim.descriptors) {
    if (tokens.has(descriptor)) {
      descriptorScore += 1;
    }
  }

  for (const number of claim.numbers) {
    if (combinedText.includes(number)) {
      numberScore += 2;
    }
  }

  for (const keyword of claim.strongKeywords) {
    if (tokens.has(keyword)) {
      keywordScore += 1;
    }
  }

  const phraseScore = phraseMatchScore(claim.cleanedText, combinedText);
  const semanticScore = semanticLiteScore(claim, combinedText);
  const contradiction = contradictionPenalty(claim, combinedText);
  const trustBonus = trustedSourceBonus(article);
  const weakPenalty = weakSourcePenalty(article);

  const totalScore =
    entityScore +
    actionScore +
    effectScore +
    descriptorScore +
    numberScore +
    keywordScore +
    phraseScore +
    semanticScore * 4 +
    trustBonus -
    contradiction -
    weakPenalty;

  const hasEntitySupport = claim.entities.length === 0 || entityScore >= 3;
  const hasActionSupport = claim.actions.length === 0 || actionScore >= 3;
  const hasPhraseSupport = phraseScore >= 2;
  const hasEffectSupport = effectTerms.length === 0 || effectScore >= 3;

  return {
    totalScore,
    entityScore,
    actionScore,
    effectScore,
    descriptorScore,
    numberScore,
    keywordScore,
    phraseScore,
    semanticScore,
    contradictionPenalty: contradiction,
    trustBonus,
    weakSourcePenalty: weakPenalty,
    canonicalSource: inferCanonicalSource(article),
    anchorMatched,
    hasCoreSupport:
      hasEntitySupport &&
      hasActionSupport &&
      hasPhraseSupport &&
      hasEffectSupport,
  };
}

/**
 * Result helpers
 */
function countUniqueSources(articles) {
  return new Set(
    articles.map((article) => inferCanonicalSource(article).toLowerCase()),
  ).size;
}

function computeConfidence(relevantArticles) {
  if (!relevantArticles.length) return 22;

  const avgScore =
    relevantArticles.reduce((sum, article) => sum + article._score, 0) /
    relevantArticles.length;

  const uniqueSources = countUniqueSources(relevantArticles);
  const strongPhraseMatches = relevantArticles.filter(
    (article) => article._detail.phraseScore >= 3,
  ).length;

  let confidence = 35;
  confidence += Math.min(avgScore * 3, 30);
  confidence += Math.min(uniqueSources * 6, 18);
  confidence += Math.min(strongPhraseMatches * 4, 12);

  return Math.max(0, Math.min(100, Math.round(confidence)));
}

function buildExplanation(
  resultType,
  claim,
  relevantArticles,
  responseStyle = "medium",
) {
  const primaryAnchor = detectPrimaryAnchor(claim);
  const anchorText = primaryAnchor ? primaryAnchor : "the claim";
  const uniqueSources = countUniqueSources(relevantArticles);

  if (resultType === "strong") {
    if (responseStyle === "short") {
      return `Haven found strong corroboration from multiple sources for ${anchorText}.`;
    }
    if (responseStyle === "detailed") {
      return `Haven found strong corroboration across ${uniqueSources} different sources. The retrieved articles align closely with the main entities and actions in the claim, and multiple outlets point to the same event rather than only a related topic.`;
    }
    return `Haven found strong corroboration across ${uniqueSources} different sources, with several articles closely matching the core claim.`;
  }

  if (resultType === "developing") {
    if (responseStyle === "short") {
      return `Haven found some support, but the exact claim is still developing.`;
    }
    if (responseStyle === "detailed") {
      return `Haven found related corroborating coverage from multiple sources, but support for the exact claim is still developing. Some articles align with the main event, while parts such as timing, attribution, or exact wording may still be limited or only partially confirmed.`;
    }
    return `Haven found related corroborating coverage, but support for the exact claim is still developing.`;
  }

  if (resultType === "weak") {
    if (responseStyle === "short") {
      return `Haven found limited support so far.`;
    }
    if (responseStyle === "detailed") {
      return `Haven found only limited support. One closely related article may align with the claim, but there is not enough corroboration from multiple strong sources to treat it as well confirmed yet.`;
    }
    return `Haven found limited support so far, with not enough corroboration to confidently verify the claim.`;
  }

  if (responseStyle === "short") {
    return `Haven could not find strong corroboration for this claim.`;
  }
  if (responseStyle === "detailed") {
    return `Haven could not find strong corroboration for this claim. The retrieved coverage may be loosely related, conflicting, or insufficient to verify the same event with confidence.`;
  }
  return `Haven could not find strong corroboration for this claim from the retrieved sources.`;
}

function buildSpokenSummary(status, confidence, explanation) {
  return `${status}. Confidence ${confidence} percent. ${explanation}`;
}

/**
 * Main route
 */
app.post("/check", async (req, res) => {
  const {
    text,
    languageMode = "english",
    responseStyle = "medium", // short | medium | detailed
  } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({
      status: "Scan Failed",
      level: "danger",
      confidence: 0,
      explanation: "No usable text was provided.",
      spokenSummary: "Scan failed. No usable text was provided.",
    });
  }

  try {
    const claim = buildClaimModel(text);
    const queries = buildQueries(claim);

    console.log("\n--- NEW SCAN ---");
    console.log("Original text:", text);
    console.log("Cleaned text:", claim.cleanedText);
    console.log("Claim model:", claim);
    console.log("Short phrase query:", queries.shortPhraseQuery);
    console.log("Structured query:", queries.structuredQuery);
    console.log("Broad keyword query:", queries.broadKeywordQuery);
    console.log("Fallback query:", queries.fallbackQuery);
    console.log("Language mode:", languageMode);
    console.log("Response style:", responseStyle);

    const language = languageMode === "any" ? null : "en";

    const [
      phraseArticles,
      structuredArticles,
      broadArticles,
      fallbackArticles,
    ] = await Promise.all([
      searchNews(queries.shortPhraseQuery, 12, language),
      searchNews(queries.structuredQuery, 20, language),
      searchNews(queries.broadKeywordQuery, 20, language),
      searchNews(queries.fallbackQuery, 12, language),
    ]);

    console.log("Phrase articles found:", phraseArticles.length);
    console.log("Structured articles found:", structuredArticles.length);
    console.log("Broad articles found:", broadArticles.length);
    console.log("Fallback articles found:", fallbackArticles.length);

    const combinedArticles = dedupeArticles([
      ...phraseArticles,
      ...structuredArticles,
      ...broadArticles,
      ...fallbackArticles,
    ]);

    let scoredArticles = combinedArticles
      .map((article) => {
        const score = scoreArticle(claim, article);

        return {
          ...article,
          _score: score.totalScore,
          _detail: score,
        };
      })
      .filter((article) => {
        return (
          article._score >= 8 &&
          article._detail.hasCoreSupport &&
          article._detail.anchorMatched
        );
      })
      .sort((a, b) => b._score - a._score);

    scoredArticles = keepBestPerSource(scoredArticles).sort(
      (a, b) => b._score - a._score,
    );

    console.log("Relevant articles after filtering:", scoredArticles.length);
    scoredArticles.forEach((article, index) => {
      console.log(
        `${index + 1}. [score=${article._score.toFixed(2)}] ${inferCanonicalSource(article)} - ${article.title}`,
      );
    });

    const uniqueSources = countUniqueSources(scoredArticles);
    const strongPhraseMatches = scoredArticles.filter(
      (article) => article._detail.phraseScore >= 3,
    ).length;
    const strongEffectMatches = scoredArticles.filter(
      (article) => (article._detail.effectScore || 0) >= 3,
    ).length;

    let resultType = "unverified";
    let status = "Unverified / Needs Caution";
    let level = "warning";

    if (
      scoredArticles.length >= 5 &&
      uniqueSources >= 4 &&
      strongPhraseMatches >= 3 &&
      strongEffectMatches >= 2
    ) {
      resultType = "strong";
      status = "Strongly Corroborated";
      level = "safe";
    } else if (scoredArticles.length >= 2 && uniqueSources >= 2) {
      resultType = "developing";
      status = "Developing Support";
      level = "warning";
    } else if (scoredArticles.length === 1) {
      resultType = "weak";
      status = "Weak Support";
      level = "warning";
    }

    const confidence = computeConfidence(scoredArticles);
    const explanation = buildExplanation(
      resultType,
      claim,
      scoredArticles,
      responseStyle,
    );
    const spokenSummary = buildSpokenSummary(status, confidence, explanation);

    return res.json({
      status,
      level,
      confidence,
      explanation,
      spokenSummary,
      debug: {
        claim,
        queries,
        totalFetched: combinedArticles.length,
        matchedCount: scoredArticles.length,
        uniqueSources,
        strongPhraseMatches,
        strongEffectMatches,
        languageMode,
        responseStyle,
      },
      sources: scoredArticles.slice(0, 5).map((article) => ({
        title: article.title,
        source: inferCanonicalSource(article),
        originalSource: article.source?.name || "Unknown Source",
        url: article.url,
        score: Number(article._score.toFixed(2)),
        breakdown: article._detail,
      })),
    });
  } catch (error) {
    console.error("NewsAPI error:", error.response?.data || error.message);

    if (error.response?.status === 429) {
      return res.status(429).json({
        status: "Limit Reached",
        level: "danger",
        confidence: 0,
        explanation:
          "Daily news lookup limit reached. Please try again tomorrow.",
        spokenSummary:
          "Haven reached the daily news lookup limit. Please try again tomorrow.",
      });
    }

    return res.status(500).json({
      status: "Scan Failed",
      level: "danger",
      confidence: 0,
      explanation: "There was a problem checking this claim. Please try again.",
      spokenSummary: "Scan failed. There was a problem checking this claim.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Haven backend running at http://localhost:${PORT}`);
});
