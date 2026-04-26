"use strict";

try { require("@dotenvx/dotenvx").config(); } catch { require("dotenv").config(); }

const express = require("express");
const cors    = require("cors");

const checkRoutes = require("./routes/checkRoutes");
const imageRoutes = require("./routes/imageRoutes");
const voiceRoutes = require("./routes/voiceRoutes");

const app = express();

const PORT               = Number(process.env.PORT || 3000);
const NEWS_API_KEY       = process.env.NEWS_API_KEY || "";
const OLLAMA_URL         = process.env.OLLAMA_URL || "http://localhost:11434/api/generate";
const OLLAMA_MODEL       = process.env.OLLAMA_MODEL || "llama3";
const CACHE_TTL_MS       = Number(process.env.CACHE_TTL_MS || 300000);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
const DEBUG_MODE         = process.env.DEBUG_MODE === "true";

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use((req, res, next) => {
  const start = Date.now();
  if (DEBUG_MODE) console.log(`➡️  ${req.method} ${req.originalUrl}`);
  res.on("finish", () => {
    if (DEBUG_MODE) console.log(`✅ ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now()-start}ms)`);
  });
  next();
});

app.get("/", (req, res) => res.send("Haven backend is running."));
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "haven-backend",
    newsApiConfigured: Boolean(NEWS_API_KEY),
    ollamaUrl: OLLAMA_URL,
    ollamaModel: OLLAMA_MODEL,
    cacheTtlMs: CACHE_TTL_MS,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
  });
});

app.use("/", checkRoutes);
app.use("/", imageRoutes);
app.use("/", voiceRoutes);

const server = app.listen(PORT, () => {
  console.log(`\n🛡️  Haven backend running at http://localhost:${PORT}`);
  console.log(`   Health check  : GET  http://localhost:${PORT}/health`);
  console.log(`   Debug ping    : GET  http://localhost:${PORT}/debug-ping`);
  console.log(`   Test AI       : POST http://localhost:${PORT}/test-ai`);
  console.log(`   Fact-check    : POST http://localhost:${PORT}/check`);
  console.log(`   Image scan    : POST http://localhost:${PORT}/analyze-image`);
  console.log(`   Voice         : POST http://localhost:${PORT}/speak`);
  if (DEBUG_MODE) console.log("\n   🐛 DEBUG_MODE is ON\n");
});

// Keep process alive
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`❌ Port ${PORT} is already in use. Kill the existing process first.`);
    process.exit(1);
  } else {
    throw err;
  }
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
})