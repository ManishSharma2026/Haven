/**
 * services/misinformationService.js
 * All claim parsing, event modeling, News API search, article scoring,
 * confidence calculation, verdict building, and response assembly for Haven.
 *
 * Ported directly from server.js — behavior is unchanged.
 */

"use strict";

const axios = require("axios");
const { askLocalAI } = require("./aiService");
const { safeJsonParse } = require("../utils/jsonUtils");

// ---------------------------------------------------------------------------
// Env config
// ---------------------------------------------------------------------------

const NEWS_API_KEY = process.env.NEWS_API_KEY || "";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
const MAX_QUERY_COUNT = Number(process.env.MAX_QUERY_COUNT || 6);
const NEWS_LOOKBACK_DAYS = Number(process.env.NEWS_LOOKBACK_DAYS || 30);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 300000);
const DEBUG_MODE = process.env.DEBUG_MODE === "true";

// ---------------------------------------------------------------------------
// In-memory caches
// ---------------------------------------------------------------------------

const newsCache = new Map();
const aiCache = new Map();

function getCache(cache, key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function setCache(cache, key, value, ttlMs = CACHE_TTL_MS) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// ---------------------------------------------------------------------------
// Word sets
// ---------------------------------------------------------------------------

const QUERY_STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "been", "were",
  "will", "would", "could", "should", "about", "after", "before", "into", "over",
  "under", "only", "more", "than", "they", "them", "their", "what", "when",
  "where", "which", "while", "said", "says", "are", "was", "is", "being",
  "latest", "live", "updates", "update", "breaking", "report", "reports",
  "today", "tomorrow", "yesterday", "next", "day", "days", "week", "weeks",
  "month", "months", "year", "years", "official", "officials", "one", "two",
  "three", "four", "five", "of", "few", "since", "amid", "across", "within",
  "during", "through", "via", "pass", "claim", "claimed", "claims", "according",
  "reportedly", "statement", "statements", "liveblog", "live blog",
]);

const SCORE_STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "been", "were",
  "will", "would", "could", "should", "about", "after", "before", "into", "over",
  "under", "only", "more", "than", "they", "them", "their", "what", "when",
  "where", "which", "while", "said", "says", "are", "was", "is",
]);

const ATTRIBUTION_WORDS = new Set([
  "said", "says", "claim", "claimed", "claims", "according",
  "reportedly", "told", "announced", "stated",
]);

const LOCATION_HINTS = new Set([
  "strait", "gulf", "sea", "ocean", "port", "city", "state", "province",
  "country", "region", "border", "airport", "harbor", "harbour", "bay",
  "channel", "coast", "capital",
]);

const OBJECT_HINTS = new Set([
  "ship", "ships", "vessel", "vessels", "cargo", "boat", "boats",
  "missile", "missiles", "drone", "drones", "base", "bases", "facility",
  "facilities", "plant", "plants", "tank", "tanks", "pipeline", "pipelines",
  "election", "ballot", "tariff", "tariffs", "sanction", "sanctions",
  "troops", "hostages", "deal", "ceasefire",
]);

const TIME_HINTS = new Set([
  "today", "tomorrow", "yesterday", "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday", "sunday", "january", "february", "march",
  "april", "may", "june", "july", "august", "september", "october",
  "november", "december", "morning", "afternoon", "evening", "night",
]);

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
  ukraine: ["ukraine", "ukrainian", "kyiv", "kiev"],
  gaza: ["gaza", "gazan"],
  hamas: ["hamas"],
  houthis: ["houthis", "houthi"],
  trump: ["trump", "donald trump"],
  nato: ["nato"],
  eucommission: ["european commission"],
  whitehouse: ["white house"],
};

const ACTION_GROUPS = {
  talks: ["talks", "negotiations", "meeting", "meetings", "diplomatic", "discussion"],
  resume: ["resume", "restart", "renew", "continue", "reopen"],
  approve: ["approve", "approved", "approval", "authorize", "authorized"],
  acquire: ["acquire", "acquired", "buy", "bought", "purchase", "purchased", "takeover", "merger"],
  launch: ["launch", "launched", "unveiled", "introduced"],
  kill: ["kill", "killed", "dead", "death", "deaths", "fatality", "fatalities"],
  sue: ["sue", "sued", "lawsuit", "legal action"],
  win: ["win", "won", "victory", "beat", "defeated"],
  lose: ["lose", "lost", "defeat"],
  rise: ["rise", "rising", "increase", "increased", "surge", "jump", "up"],
  fall: ["fall", "fell", "drop", "dropped", "decline", "declined", "slump", "down"],
  drop: ["drop", "decline", "declined", "reduced", "reduction", "fall", "fell", "fewer", "less"],
  traffic: ["traffic", "flow", "shipping", "shipments", "transit", "passage", "movement"],
  fire: ["fire", "fired", "shoot", "shot", "shooting"],
  seize: ["seize", "seized", "capture", "captured", "boarded", "board", "took", "seizure"],
  arrest: ["arrest", "arrested", "detained", "custody"],
  ban: ["ban", "banned", "block", "blocked", "prohibit", "prohibited"],
  blockade: ["blockade", "blocked", "closure", "shut", "restriction"],
  warn: ["warn", "warning", "alert", "caution"],
  ceasefire: ["ceasefire", "truce", "pause"],
  election: ["election", "vote", "voting", "ballot", "polls"],
  strike: ["strike", "strikes", "attacked", "attack", "bombed", "airstrike"],
  sanction: ["sanction", "sanctions", "penalty", "penalties"],
  release: ["release", "released", "free", "freed"],
  deny: ["deny", "denied", "denies"],
  end: ["end", "ends", "ended", "expire", "expires", "expired"],
  extend: ["extend", "extends", "extended", "extension", "renew", "renewed"],
};

const CONTRADICTION_PAIRS = [
  ["seize", "release"],
  ["approve", "block"],
  ["win", "lose"],
  ["rise", "fall"],
  ["kill", "wound"],
  ["launch", "delay"],
  ["fire", "deny"],
  ["sanction", "lift"],
  ["end", "extend"],
  ["extend", "end"],
];

const TRUSTED_SOURCES = [
  "reuters", "associated press", "ap news", "bbc", "cnn",
  "new york times", "the new york times", "washington post", "the washington post",
  "npr", "guardian", "the guardian", "al jazeera", "bloomberg",
  "financial times", "wall street journal", "wsj", "abc news",
  "cbs news", "nbc news", "pbs", "economist", "the economist",
  "forbes", "time", "politico", "axios",
];

const WEAK_SOURCE_PATTERNS = [
  "blogspot", "substack", "freerepublic", "commondreams",
  "wnd.com", "ibtimes.com.au", "globalsecurity.org", "activistpost.com",
];

const BLOCKED_DOMAINS = [
  "wnd.com", "ibtimes.com.au", "globalsecurity.org", "activistpost.com",
];

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[-–—]/g, " ")
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/[^\w\s%$./']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(arr) {
  return [...new Set(arr)];
}

function tokenize(text, stopWords = new Set()) {
  return normalizeText(text)
    .split(" ")
    .filter((word) => word && !stopWords.has(word));
}

function extractNumbers(text) {
  const matches = String(text || "").match(/\b\d+(?:\.\d+)?%?\b|\$\d+(?:\.\d+)?\b/g);
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
  return (
    [
      "day", "days", "week", "weeks", "month", "months", "year", "years",
      "today", "tomorrow", "yesterday", "next", "one", "two", "three", "four", "five",
    ].includes(word) || TIME_HINTS.has(word)
  );
}

function cleanInputText(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 1200);
}

function recentDateIso(daysBack = NEWS_LOOKBACK_DAYS) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString();
}

function containsAnyPhrase(text, values) {
  const normalized = normalizeText(text);
  return values.some((value) => normalized.includes(normalizeText(value)));
}

// ---------------------------------------------------------------------------
// Attribution stripping
// ---------------------------------------------------------------------------

function stripAttribution(text) {
  let cleaned = String(text || "").trim();

  const tailPatterns = [
    /,\s*[^,]{1,60}\s+says$/i,
    /,\s*[^,]{1,60}\s+said$/i,
    /,\s*according to [^,]+$/i,
    /\s+-\s*[^-]{1,60}\s+says$/i,
    /\s+-\s*[^-]{1,60}\s+said$/i,
  ];

  const frontPatterns = [
    /^[^,]{1,60}\s+says\s+/i,
    /^[^,]{1,60}\s+said\s+/i,
    /^according to [^,]{1,60},?\s+/i,
  ];

  for (const pattern of tailPatterns) cleaned = cleaned.replace(pattern, "").trim();
  for (const pattern of frontPatterns) cleaned = cleaned.replace(pattern, "").trim();

  return cleaned;
}

// ---------------------------------------------------------------------------
// Source utilities
// ---------------------------------------------------------------------------

function inferCanonicalSource(article) {
  const rawSource = (article.source?.name || "").trim();
  const title = (article.title || "").toLowerCase();
  const domain = extractDomain(article.url || "");

  if (title.includes("reuters") || domain.includes("reuters.com")) return "Reuters";
  if (title.includes("associated press") || title.includes("ap news") || domain.includes("apnews.com")) return "Associated Press";
  if (title.includes("bloomberg") || domain.includes("bloomberg.com")) return "Bloomberg";
  if (title.includes("bbc") || domain.includes("bbc.com") || domain.includes("bbc.co.uk")) return "BBC";
  if (title.includes("cnn") || domain.includes("cnn.com")) return "CNN";
  if (title.includes("new york times") || domain.includes("nytimes.com")) return "The New York Times";
  if (title.includes("washington post") || domain.includes("washingtonpost.com")) return "The Washington Post";
  if (domain.includes("npr.org")) return "NPR";
  if (domain.includes("theguardian.com")) return "The Guardian";
  if (domain.includes("aljazeera.com")) return "Al Jazeera";
  if (domain.includes("ft.com")) return "Financial Times";
  if (domain.includes("wsj.com")) return "The Wall Street Journal";
  if (domain.includes("axios.com")) return "Axios";
  if (domain.includes("politico.com")) return "Politico";
  if (domain.includes("foxnews.com")) return "Fox News";
  if (domain.includes("businessinsider.com")) return "Business Insider";

  return rawSource || domain || "Unknown Source";
}

function isTrustedSourceName(sourceName) {
  const s = sourceName.toLowerCase();
  return TRUSTED_SOURCES.some((trusted) => s.includes(trusted));
}

function isAllowedArticle(article) {
  const sourceName = inferCanonicalSource(article).toLowerCase();
  const domain = extractDomain(article.url || "");
  const title = normalizeText(article.title || "");

  if (BLOCKED_DOMAINS.some((blocked) => domain.includes(blocked) || sourceName.includes(blocked))) {
    return false;
  }
  if (title.includes("live updates") || title.includes("live blog")) return false;
  if (title.includes("opinion") || title.includes("editorial")) return false;

  return true;
}

function articleText(article) {
  return normalizeText(`${article.title || ""} ${article.description || ""}`);
}

// ---------------------------------------------------------------------------
// Phrase/token classification
// ---------------------------------------------------------------------------

function extractPhrases(text) {
  const words = normalizeText(text).split(" ").filter(Boolean);
  const phrases = [];

  for (let i = 0; i < words.length; i++) {
    const w1 = words[i];
    const w2 = words[i + 1];
    const w3 = words[i + 2];

    if (w1) phrases.push(w1);
    if (w1 && w2) phrases.push(`${w1} ${w2}`);
    if (w1 && w2 && w3) phrases.push(`${w1} ${w2} ${w3}`);
  }

  return unique(phrases);
}

function classifySingleToken(word) {
  if (!word || word.length < 2) return "ignore";
  if (QUERY_STOP_WORDS.has(word)) return "ignore";
  if (looksLikeTimeWord(word)) return "time";
  if (ATTRIBUTION_WORDS.has(word)) return "attribution";
  if (OBJECT_HINTS.has(word)) return "object";
  if (LOCATION_HINTS.has(word)) return "location";
  if (ENTITY_ALIASES[word]) return "entity";

  for (const [groupName, aliases] of Object.entries(ACTION_GROUPS)) {
    if (groupName === word || aliases.includes(word)) return "action";
  }

  return word.length >= 5 ? "candidate_entity" : "descriptor";
}

function classifyPhrase(phrase) {
  const p = normalizeText(phrase);
  const parts = p.split(" ").filter(Boolean);

  if (!p) return { type: "ignore", value: phrase };

  for (const [groupName, aliases] of Object.entries(ACTION_GROUPS)) {
    const normalizedAliases = aliases.map((a) => normalizeText(a));
    const exactPhraseMatch = normalizedAliases.includes(p) || groupName === p;
    const exactTokenMatch = parts.some((part) => normalizedAliases.includes(part));

    if (exactPhraseMatch || exactTokenMatch) {
      return { type: "action", value: groupName };
    }
  }

  if (parts.some((part) => ATTRIBUTION_WORDS.has(part))) return { type: "attribution", value: phrase };
  if (parts.some((part) => TIME_HINTS.has(part) || looksLikeTimeWord(part))) return { type: "time", value: phrase };
  if (parts.some((part) => LOCATION_HINTS.has(part))) return { type: "location", value: phrase };
  if (parts.some((part) => OBJECT_HINTS.has(part))) return { type: "object", value: phrase };

  const aliasMatched = Object.keys(ENTITY_ALIASES).some((key) => p.includes(key));
  if (aliasMatched) return { type: "entity", value: phrase };

  if (parts.length >= 2) {
    const badStarts = new Set(["and", "or", "but", "a", "an", "the", "on", "in", "of", "to", "after"]);
    const badParts = new Set(["evening", "morning", "afternoon", "night", "highly", "unlikely", "further", "extension", "shaky", "footing"]);
    const hasVerb = parts.some((part) => classifySingleToken(part) === "action");
    const startsBad = badStarts.has(parts[0]);
    const allBadish = parts.every((part) => badParts.has(part) || QUERY_STOP_WORDS.has(part));

    if (hasVerb || startsBad || allBadish) return { type: "descriptor", value: phrase };

    return { type: "candidate_entity", value: phrase };
  }

  return { type: classifySingleToken(p), value: phrase };
}

function pushRole(event, role, value) {
  if (!value) return;
  const normalized = normalizeText(value);
  if (!normalized) return;
  event[role].push(value);
}

// ---------------------------------------------------------------------------
// Event modeling
// ---------------------------------------------------------------------------

function buildEventModel(text) {
  const cleanedText = normalizeText(text);
  const rawTokens = tokenize(cleanedText, QUERY_STOP_WORDS).slice(0, 20);
  const phrases = extractPhrases(text);
  const numbers = extractNumbers(text);

  const event = {
    actor: [], action: [], object: [], location: [],
    time: [], attribution: [], qualifiers: [],
  };

  const keywords = [];
  const strongKeywords = [];

  for (const token of rawTokens) {
    keywords.push(token);
    if (token.length >= 5 && !looksLikeTimeWord(token) && !QUERY_STOP_WORDS.has(token)) {
      strongKeywords.push(token);
    }

    const tokenType = classifySingleToken(token);
    if (tokenType === "action") {
      for (const [groupName, aliases] of Object.entries(ACTION_GROUPS)) {
        if (groupName === token || aliases.includes(token)) {
          pushRole(event, "action", groupName);
          break;
        }
      }
    } else if (tokenType === "object" || tokenType === "descriptor") {
      pushRole(event, "object", token);
    } else if (tokenType === "location") {
      pushRole(event, "location", token);
    } else if (tokenType === "time") {
      pushRole(event, "time", token);
    } else if (tokenType === "attribution") {
      pushRole(event, "attribution", token);
    } else if (tokenType === "entity") {
      pushRole(event, "actor", token);
    }
  }

  for (const phrase of phrases) {
    const result = classifyPhrase(phrase);

    if (result.type === "action") pushRole(event, "action", result.value);
    else if (result.type === "object") pushRole(event, "object", result.value);
    else if (result.type === "location") pushRole(event, "location", result.value);
    else if (result.type === "time") pushRole(event, "time", result.value);
    else if (result.type === "attribution") pushRole(event, "attribution", result.value);
    else if (result.type === "entity") pushRole(event, "actor", result.value);
    else if (result.type === "candidate_entity") {
      const lower = normalizeText(result.value);
      if ([...OBJECT_HINTS].some((hint) => lower.includes(hint))) {
        pushRole(event, "object", result.value);
      } else {
        pushRole(event, "actor", result.value);
      }
    }
  }

  return {
    cleanedText,
    keywords: unique(keywords).slice(0, 16),
    strongKeywords: unique(strongKeywords).slice(0, 8),
    numbers,
    event: {
      actor: unique(event.actor).slice(0, 5),
      action: unique(event.action).slice(0, 4),
      object: unique(event.object).slice(0, 5),
      location: unique(event.location).slice(0, 3),
      time: unique(event.time).slice(0, 3),
      attribution: unique(event.attribution).slice(0, 3),
      qualifiers: unique(event.qualifiers).slice(0, 3),
    },
  };
}

// ---------------------------------------------------------------------------
// Entity/action expansion
// ---------------------------------------------------------------------------

function expandEntities(entities) {
  const expanded = new Set();
  for (const entity of entities) {
    expanded.add(entity);
    const pieces = normalizeText(entity).split(" ");
    for (const piece of pieces) {
      expanded.add(piece);
      if (ENTITY_ALIASES[piece]) {
        for (const alias of ENTITY_ALIASES[piece]) expanded.add(alias);
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
      for (const alias of ACTION_GROUPS[action]) expanded.add(alias);
    }
  }
  return [...expanded];
}

function detectPrimaryAnchor(eventModel) {
  const genericActors = new Set(["us", "uk", "eu", "un", "china", "russia", "iran", "israel", "lebanon", "trump"]);
  for (const actor of eventModel.event.actor) {
    const first = normalizeText(actor).split(" ")[0];
    if (!genericActors.has(first)) return actor;
  }
  return eventModel.event.actor[0] || eventModel.event.object[0] || null;
}

function detectEffectTerms(eventModel) {
  const text = normalizeText(
    [eventModel.cleanedText, ...eventModel.event.object, ...eventModel.event.location].join(" ")
  );
  const effects = [];

  if (/(ship|shipping|traffic|transit|flow|passage|vessel|cargo)/.test(text)) effects.push("traffic");
  if (/(few|less|fewer|drop|decline|reduced|fall)/.test(text)) effects.push("drop");

  return unique(effects);
}

// ---------------------------------------------------------------------------
// AI: parse claim
// ---------------------------------------------------------------------------

async function parseClaimWithAI(text) {
  const key = `parse:${normalizeText(text)}`;
  const cached = getCache(aiCache, key);
  if (cached) return cached;

  const prompt = `
You are helping a fact-checking assistant.

Analyze the headline or claim below and return JSON only.

Required JSON shape:
{
  "mainClaim": "string",
  "eventActor": ["string"],
  "eventAction": ["string"],
  "eventObject": ["string"],
  "eventLocation": ["string"],
  "eventTime": ["string"],
  "attributionSource": ["string"],
  "qualifiers": ["string"],
  "alternateFramings": ["string"],
  "searchQueries": ["string"]
}

Rules:
- Return valid JSON only.
- If the text includes attribution like "X says" or "according to X", do NOT make X the event actor unless X actually performed the event.
- Focus on the real-world event, not who is reporting it.
- Use short arrays.
- Keep alternateFramings to 4 items max.
- Keep searchQueries to 4 items max.
- Search queries should target the exact event and avoid broad topic summaries.
- Do not include markdown.

Claim:
"${cleanInputText(text)}"
`;

  const response = await askLocalAI(prompt, {
    temperature: 0.1,
    timeout: REQUEST_TIMEOUT_MS,
  });

  const parsed = safeJsonParse(response);
  if (!parsed) return null;

  const result = {
    mainClaim: parsed.mainClaim || text,
    eventActor: Array.isArray(parsed.eventActor) ? parsed.eventActor.slice(0, 4) : [],
    eventAction: Array.isArray(parsed.eventAction) ? parsed.eventAction.slice(0, 4) : [],
    eventObject: Array.isArray(parsed.eventObject) ? parsed.eventObject.slice(0, 4) : [],
    eventLocation: Array.isArray(parsed.eventLocation) ? parsed.eventLocation.slice(0, 3) : [],
    eventTime: Array.isArray(parsed.eventTime) ? parsed.eventTime.slice(0, 3) : [],
    attributionSource: Array.isArray(parsed.attributionSource) ? parsed.attributionSource.slice(0, 3) : [],
    qualifiers: Array.isArray(parsed.qualifiers) ? parsed.qualifiers.slice(0, 4) : [],
    alternateFramings: Array.isArray(parsed.alternateFramings) ? parsed.alternateFramings.slice(0, 4) : [],
    searchQueries: Array.isArray(parsed.searchQueries) ? parsed.searchQueries.slice(0, 4) : [],
  };

  setCache(aiCache, key, result);
  return result;
}

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

function buildQueriesFromEvent(eventModel, aiClaim = null) {
  const querySet = new Set();

  const actor = eventModel.event.actor[0] || "";
  const action = eventModel.event.action[0] || "";
  const object = eventModel.event.object[0] || "";
  const location = eventModel.event.location[0] || "";

  if (aiClaim?.searchQueries?.length) {
    for (const query of aiClaim.searchQueries) {
      if (query && query.trim().length >= 6) querySet.add(query.trim());
    }
  }

  if (aiClaim?.mainClaim) querySet.add(aiClaim.mainClaim.trim());

  if (aiClaim?.eventActor?.length && aiClaim?.eventAction?.length && aiClaim?.eventObject?.length) {
    querySet.add(`${aiClaim.eventActor[0]} ${aiClaim.eventAction[0]} ${aiClaim.eventObject[0]}`.trim());
    querySet.add(`${aiClaim.eventObject[0]} ${aiClaim.eventAction[0]} ${aiClaim.eventActor[0]}`.trim());
  }

  if (actor && action && object) {
    querySet.add(`${actor} ${action} ${object}`.trim());
    querySet.add(`${object} ${action} ${actor}`.trim());
  }

  if (actor && object) querySet.add(`${actor} ${object}`.trim());
  if (action && object) querySet.add(`${action} ${object}`.trim());
  if (actor && action) querySet.add(`${actor} ${action}`.trim());
  if (object && location) querySet.add(`${object} ${location}`.trim());
  if (actor && location) querySet.add(`${actor} ${location}`.trim());

  if (eventModel.strongKeywords.length >= 3) {
    querySet.add(eventModel.strongKeywords.slice(0, 4).join(" "));
  }

  if (aiClaim?.alternateFramings?.length) {
    for (const framing of aiClaim.alternateFramings) {
      if (framing && framing.trim().length >= 6) querySet.add(framing.trim());
    }
  }

  return [...querySet]
    .filter(Boolean)
    .map((q) => q.trim())
    .filter((q) => q.length >= 5)
    .slice(0, MAX_QUERY_COUNT);
}

// ---------------------------------------------------------------------------
// News API search
// ---------------------------------------------------------------------------

async function searchNews(query, pageSize = 8, language = "en") {
  if (!NEWS_API_KEY) return [];
  if (!query || !query.trim()) return [];

  const cacheKey = `news:${language || "any"}:${pageSize}:${query}`;
  const cached = getCache(newsCache, cacheKey);
  if (cached) return cached;

  try {
    const params = {
      q: query,
      sortBy: "publishedAt",
      pageSize,
      apiKey: NEWS_API_KEY,
      from: recentDateIso(NEWS_LOOKBACK_DAYS),
    };

    if (language) params.language = language;

    const response = await axios.get("https://newsapi.org/v2/everything", {
      params,
      timeout: REQUEST_TIMEOUT_MS,
    });

    const result = response.data?.articles || [];
    setCache(newsCache, cacheKey, result);
    return result;
  } catch (error) {
    if (DEBUG_MODE) {
      console.error(`[misinformationService] Search failed for query: ${query}`);
      console.error(error.response?.data || error.message);
    }
    return [];
  }
}

// ---------------------------------------------------------------------------
// Article filtering & deduplication
// ---------------------------------------------------------------------------

function dedupeArticles(articles) {
  const seen = new Set();
  return articles.filter((article) => {
    const key = normalizeText(`${article.title || ""} ${extractDomain(article.url || "")}`);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function keepBestPerSource(articles) {
  const bestBySource = new Map();
  for (const article of articles) {
    const sourceName = inferCanonicalSource(article).toLowerCase();
    const existing = bestBySource.get(sourceName);
    if (!existing || (article._score || 0) > (existing._score || 0)) {
      bestBySource.set(sourceName, article);
    }
  }
  return [...bestBySource.values()];
}

// ---------------------------------------------------------------------------
// Article scoring
// ---------------------------------------------------------------------------

function phraseMatchScore(eventModel, articleCombinedText) {
  const claimWords = unique([
    ...eventModel.keywords,
    ...eventModel.event.actor.flatMap((x) => tokenize(x)),
    ...eventModel.event.object.flatMap((x) => tokenize(x)),
    ...eventModel.event.action.flatMap((x) => tokenize(x)),
    ...eventModel.event.location.flatMap((x) => tokenize(x)),
  ]).filter((word) => word.length >= 4 && !looksLikeTimeWord(word));

  const article = normalizeText(articleCombinedText);
  let matchCount = 0;
  for (const word of claimWords) {
    if (article.includes(word)) matchCount += 1;
  }
  return matchCount;
}

function semanticLiteScore(eventModel, articleCombinedText) {
  const claimTokens = new Set(
    unique([
      ...eventModel.keywords,
      ...eventModel.event.actor.flatMap((x) => tokenize(x)),
      ...eventModel.event.action.flatMap((x) => tokenize(x)),
      ...eventModel.event.object.flatMap((x) => tokenize(x)),
      ...eventModel.event.location.flatMap((x) => tokenize(x)),
    ]).filter((word) => word.length >= 4 && !looksLikeTimeWord(word))
  );

  const articleTokens = new Set(
    tokenize(articleCombinedText, SCORE_STOP_WORDS).filter((word) => word.length >= 4)
  );

  let overlap = 0;
  for (const token of claimTokens) {
    if (articleTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(claimTokens.size, 1);
}

function contradictionPenalty(eventModel, articleCombinedText) {
  const article = normalizeText(articleCombinedText);
  let penalty = 0;
  for (const [left, right] of CONTRADICTION_PAIRS) {
    if (eventModel.event.action.includes(left) && article.includes(right)) penalty += 3;
    if (eventModel.event.action.includes(right) && article.includes(left)) penalty += 3;
  }
  return penalty;
}

function trustedSourceBonus(article) {
  return isTrustedSourceName(inferCanonicalSource(article).toLowerCase()) ? 5 : 0;
}

function weakSourcePenalty(article) {
  const sourceName = inferCanonicalSource(article).toLowerCase();
  const domain = extractDomain(article.url || "");
  for (const weak of WEAK_SOURCE_PATTERNS) {
    if (sourceName.includes(weak) || domain.includes(weak)) return 5;
  }
  return 0;
}

function recencyBonus(article) {
  const published = article.publishedAt ? new Date(article.publishedAt).getTime() : null;
  if (!published || Number.isNaN(published)) return 0;
  const ageDays = Math.max(0, (Date.now() - published) / (1000 * 60 * 60 * 24));
  if (ageDays <= 2) return 4;
  if (ageDays <= 7) return 3;
  if (ageDays <= 14) return 2;
  if (ageDays <= 30) return 1;
  return 0;
}

function getArticleAgeHours(article) {
  const published = article.publishedAt ? new Date(article.publishedAt).getTime() : null;
  if (!published || Number.isNaN(published)) return null;
  return (Date.now() - published) / (1000 * 60 * 60);
}

function splitRecentVsOlderArticles(articles, recentHours = 18) {
  const recent = [];
  const older = [];
  for (const article of articles) {
    const ageHours = getArticleAgeHours(article);
    if (ageHours !== null && ageHours <= recentHours) recent.push(article);
    else older.push(article);
  }
  return { recent, older };
}

function detectStatusChangeSignals(text) {
  const t = normalizeText(text);
  return {
    extensionPositive:
      t.includes("extended") || t.includes("extension approved") ||
      t.includes("extension granted") || t.includes("ceasefire extended"),
    extensionNegative:
      t.includes("highly unlikely") || t.includes("unlikely") ||
      t.includes("will not extend") || t.includes("no extension") ||
      t.includes("ceasefire ends"),
    activeNow:
      t.includes("still in effect") || t.includes("remains in effect") ||
      t.includes("currently active"),
  };
}

function hasNewerOverride(scoredArticles) {
  const { recent, older } = splitRecentVsOlderArticles(scoredArticles, 18);
  if (!recent.length || !older.length) return false;

  const recentText = recent.map((a) => articleText(a)).join(" ");
  const olderText = older.map((a) => articleText(a)).join(" ");
  const recentSignals = detectStatusChangeSignals(recentText);
  const olderSignals = detectStatusChangeSignals(olderText);

  if (olderSignals.extensionNegative && recentSignals.extensionPositive) return true;
  if (olderSignals.extensionNegative && recentSignals.activeNow) return true;
  return false;
}

function passesCoreMatch(eventModel, article) {
  const combined = articleText(article);

  const actorMatch =
    eventModel.event.actor.length === 0 ||
    containsAnyPhrase(combined, expandEntities(eventModel.event.actor));

  const actionMatch =
    eventModel.event.action.length === 0 ||
    containsAnyPhrase(combined, expandActions(eventModel.event.action));

  const objectMatch =
    eventModel.event.object.length === 0 ||
    containsAnyPhrase(combined, expandEntities(eventModel.event.object));

  const matches = [actorMatch, actionMatch, objectMatch].filter(Boolean).length;
  return matches >= 2;
}

function sameEventHeuristic(eventModel, article) {
  const combined = articleText(article);

  const actorMatch =
    eventModel.event.actor.length === 0 ||
    containsAnyPhrase(combined, expandEntities(eventModel.event.actor));
  const actionMatch =
    eventModel.event.action.length === 0 ||
    containsAnyPhrase(combined, expandActions(eventModel.event.action));
  const objectMatch =
    eventModel.event.object.length === 0 ||
    containsAnyPhrase(combined, expandEntities(eventModel.event.object));
  const locationMatch =
    eventModel.event.location.length === 0 ||
    containsAnyPhrase(combined, expandEntities(eventModel.event.location));

  const exactness = [actorMatch, actionMatch, objectMatch, locationMatch].filter(Boolean).length;

  if (actorMatch && actionMatch && objectMatch) return "same_event";
  if (exactness >= 2) return "same_topic";
  return "background";
}

function scoreArticle(eventModel, article) {
  const combinedText = articleText(article);
  const tokens = new Set(tokenize(combinedText, SCORE_STOP_WORDS));

  let actorScore = 0, actionScore = 0, objectScore = 0, locationScore = 0;
  let numberScore = 0, keywordScore = 0;

  const expandedActors = expandEntities(eventModel.event.actor);
  const expandedActions = expandActions(eventModel.event.action);
  const expandedObjects = expandEntities(eventModel.event.object);
  const expandedLocations = expandEntities(eventModel.event.location);
  const effectTerms = detectEffectTerms(eventModel);
  const expandedEffectTerms = expandActions(effectTerms);
  const primaryAnchor = detectPrimaryAnchor(eventModel);

  const anchorMatched =
    !primaryAnchor || containsAnyPhrase(combinedText, expandEntities([primaryAnchor]));

  if (expandedActors.length && containsAnyPhrase(combinedText, expandedActors)) actorScore += 4;
  if (expandedActions.length && containsAnyPhrase(combinedText, expandedActions)) actionScore += 4;
  if (expandedObjects.length && containsAnyPhrase(combinedText, expandedObjects)) objectScore += 5;
  if (expandedLocations.length && containsAnyPhrase(combinedText, expandedLocations)) locationScore += 2;
  if (expandedEffectTerms.length && containsAnyPhrase(combinedText, expandedEffectTerms)) objectScore += 2;

  for (const number of eventModel.numbers) {
    if (combinedText.includes(number)) numberScore += 2;
  }
  for (const keyword of eventModel.strongKeywords) {
    if (tokens.has(keyword)) keywordScore += 1;
  }

  const phraseScore = phraseMatchScore(eventModel, combinedText);
  const semanticScore = semanticLiteScore(eventModel, combinedText);
  const contradiction = contradictionPenalty(eventModel, combinedText);
  const trustBonus = trustedSourceBonus(article);
  const weakPenalty = weakSourcePenalty(article);
  const recentBonus = recencyBonus(article);
  const sameEventBucket = sameEventHeuristic(eventModel, article);

  let totalScore =
    actorScore + actionScore + objectScore + locationScore +
    numberScore + keywordScore + phraseScore +
    semanticScore * 5 + trustBonus + recentBonus -
    contradiction - weakPenalty;

  if (!anchorMatched) totalScore -= 3;
  if (sameEventBucket === "same_topic") totalScore -= 2;
  if (sameEventBucket === "background") totalScore -= 5;

  const hasActorSupport = eventModel.event.actor.length === 0 || actorScore >= 4;
  const hasActionSupport = eventModel.event.action.length === 0 || actionScore >= 4;
  const hasObjectSupport = eventModel.event.object.length === 0 || objectScore >= 5;
  const hasPhraseSupport = phraseScore >= 2;

  return {
    totalScore, actorScore, actionScore, objectScore, locationScore,
    numberScore, keywordScore, phraseScore, semanticScore,
    contradictionPenalty: contradiction, trustBonus, weakSourcePenalty: weakPenalty,
    recentBonus, canonicalSource: inferCanonicalSource(article), anchorMatched,
    sameEventBucket,
    hasCoreSupport: hasActorSupport && hasActionSupport && hasObjectSupport && hasPhraseSupport,
  };
}

// ---------------------------------------------------------------------------
// AI: compare claim to articles
// ---------------------------------------------------------------------------

async function compareClaimToArticlesWithAI(aiClaim, articles) {
  if (!aiClaim || !articles.length) return null;

  const compactArticles = articles.slice(0, 5).map((article, index) => ({
    id: index + 1,
    title: article.title || "",
    description: article.description || "",
    source: inferCanonicalSource(article),
  }));

  const prompt = `
You are helping a fact-checking assistant compare a claim against news articles.

Return JSON only in this exact shape:
{
  "matches": [
    {
      "id": 1,
      "sameEvent": true,
      "verdict": "supporting",
      "confidence": 0,
      "reason": "short string"
    }
  ]
}

Rules:
- verdict must be one of: supporting, partial, conflicting, unrelated
- confidence must be a number from 0 to 100
- Use the article ids given below
- Compare the real-world event, not just topical similarity
- Return valid JSON only

Claim summary:
${JSON.stringify(aiClaim, null, 2)}

Articles:
${JSON.stringify(compactArticles, null, 2)}
`;

  const response = await askLocalAI(prompt, {
    temperature: 0.1,
    timeout: REQUEST_TIMEOUT_MS,
  });

  const parsed = safeJsonParse(response);
  if (!parsed || !Array.isArray(parsed.matches)) return null;
  return parsed.matches;
}

// ---------------------------------------------------------------------------
// Verdict & confidence
// ---------------------------------------------------------------------------

function countUniqueSources(articles) {
  return new Set(
    articles.map((article) => inferCanonicalSource(article).toLowerCase())
  ).size;
}

function computeConfidence(relevantArticles, aiMatches = []) {
  if (!relevantArticles.length) return 20;

  const avgScore =
    relevantArticles.reduce((sum, article) => sum + article._score, 0) / relevantArticles.length;
  const uniqueSources = countUniqueSources(relevantArticles);
  const sameEventArticles = relevantArticles.filter(
    (article) => article._detail.sameEventBucket === "same_event"
  ).length;
  const supportingAiMatches = aiMatches.filter(
    (item) => item.sameEvent && item.verdict === "supporting"
  ).length;

  let confidence = 20;
  confidence += Math.min(avgScore * 1.5, 25);
  confidence += Math.min(uniqueSources * 5, 20);
  confidence += Math.min(sameEventArticles * 8, 24);
  confidence += Math.min(supportingAiMatches * 10, 20);

  if (sameEventArticles < 2) confidence = Math.min(confidence, 65);
  if (supportingAiMatches < 2) confidence = Math.min(confidence, 60);
  if (hasNewerOverride(relevantArticles)) confidence = Math.min(confidence, 35);

  return Math.max(0, Math.min(100, Math.round(confidence)));
}

function buildExplanation(resultType, eventModel, relevantArticles, responseStyle = "medium") {
  const primaryAnchor = detectPrimaryAnchor(eventModel) || "the claim";
  const uniqueSources = countUniqueSources(relevantArticles);
  const totalArticles = relevantArticles.length;

  // Get top source names
  const topSources = [...new Set(
    relevantArticles.slice(0, 3).map(a => inferCanonicalSource(a))
  )].join(", ");

  if (hasNewerOverride(relevantArticles)) {
    return `Haven found older coverage supporting this claim, but newer reporting from ${topSources} suggests the situation has changed or been reversed.`;
  }

  if (resultType === "strong") {
    return `Haven found strong corroboration across ${uniqueSources} sources including ${topSources}. Multiple articles closely match the core event described in the claim.`;
  }

  if (resultType === "developing") {
    if (topSources) {
      return `Haven found ${totalArticles} related articles from ${topSources}, but coverage of the exact claim is still developing. Not enough sources have confirmed the specific details yet.`;
    }
    return "Haven found related corroborating coverage, but support for the exact claim is still developing.";
  }

  if (resultType === "weak") {
    return `Haven found limited support — only ${totalArticles} article${totalArticles !== 1 ? "s" : ""} with partial relevance. Not enough corroboration to confidently verify this claim.`;
  }

  return `Haven searched ${totalArticles > 0 ? totalArticles + " articles but could" : "news sources but could"} not find strong corroboration. This claim may be too recent, too niche, or unverified.`;
}

function buildSpokenSummary(status, confidence, explanation) {
  return `${status}. Confidence ${confidence} percent. ${explanation}`;
}

function buildFinalVerdictFromAI(scoredArticles, aiMatches) {
  const uniqueSources = countUniqueSources(scoredArticles);

  if (!aiMatches || !aiMatches.length) {
    if (scoredArticles.length >= 4 && uniqueSources >= 3) return { resultType: "strong", status: "Strongly Corroborated", level: "safe" };
    if (scoredArticles.length >= 2 && uniqueSources >= 2) return { resultType: "developing", status: "Developing Support", level: "warning" };
    if (scoredArticles.length === 1) return { resultType: "weak", status: "Weak Support", level: "warning" };
    return { resultType: "unverified", status: "Unverified / Needs Caution", level: "warning" };
  }

  const supporting = aiMatches.filter((item) => item.sameEvent && item.verdict === "supporting").length;
  const partial = aiMatches.filter((item) => item.sameEvent && item.verdict === "partial").length;
  const conflicting = aiMatches.filter((item) => item.sameEvent && item.verdict === "conflicting").length;

  if (supporting >= 3 && uniqueSources >= 3) return { resultType: "strong", status: "Strongly Corroborated", level: "safe" };
  if (supporting + partial >= 2 && conflicting === 0) return { resultType: "developing", status: "Developing Support", level: "warning" };
  if (conflicting >= 2) return { resultType: "unverified", status: "Conflicting Coverage", level: "warning" };
  if (supporting === 1 || partial === 1) return { resultType: "weak", status: "Weak Support", level: "warning" };

  return { resultType: "unverified", status: "Unverified / Needs Caution", level: "warning" };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
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
  countUniqueSources,
};