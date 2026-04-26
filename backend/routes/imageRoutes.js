"use strict";

const express = require("express");
const router  = express.Router();
const path    = require("path");
const fs      = require("fs");
const axios   = require("axios");
const multer  = require("multer");
const { analyzeImage } = require("../services/imageService");

const DEBUG_MODE  = process.env.DEBUG_MODE === "true";
const UPLOADS_DIR = path.join(__dirname, "../uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer for screenshot fallback uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => cb(null, `haven_${Date.now()}_${Math.random().toString(36).slice(2)}.png`),
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// ---------------------------------------------------------------------------
// POST /analyze-image
// Body: JSON { url, pageUrl, screenshot }
// Tries URL download first, falls back to screenshot
// ---------------------------------------------------------------------------

router.post("/analyze-image", async (req, res) => {
  if (DEBUG_MODE) console.log("🖼️ /analyze-image endpoint hit");

  const { url, pageUrl, screenshot } = req.body;

  if (!url && !screenshot) {
    return res.status(400).json(errorResult("No image URL or screenshot provided."));
  }

  const tmpPath = path.join(UPLOADS_DIR, `haven_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
  const origName = url ? (path.basename(url.split("?")[0]) || "image.jpg") : "screenshot.png";

  // ── Try downloading original URL first ────────────────────────────────────
  if (url && !url.startsWith("data:")) {
    try {
      if (DEBUG_MODE) console.log(`[imageRoutes] Trying URL download: ${url.slice(0, 80)}`);

      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 8000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
          "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
          "Referer": pageUrl || url,
        },
        maxContentLength: 20 * 1024 * 1024,
      });

      fs.writeFileSync(tmpPath, Buffer.from(response.data));
      const sizeMb = (response.data.byteLength / 1024 / 1024).toFixed(2);

      if (DEBUG_MODE) console.log(`[imageRoutes] Downloaded: ${sizeMb}MB — analyzing original`);

      const result = await analyzeImage(tmpPath, origName);
      fs.unlink(tmpPath, () => {});
      return res.json({ ...result, source: "original" });

    } catch (downloadErr) {
      if (DEBUG_MODE) console.log(`[imageRoutes] URL download failed (${downloadErr.message}) — trying screenshot fallback`);
      if (fs.existsSync(tmpPath)) fs.unlink(tmpPath, () => {});
      // Fall through to screenshot
    }
  }

  // ── Screenshot fallback ───────────────────────────────────────────────────
  if (screenshot) {
    const screenshotPath = path.join(UPLOADS_DIR, `haven_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);

    try {
      if (DEBUG_MODE) console.log("[imageRoutes] Using screenshot fallback");

      // Decode base64 data URL
      const base64Data = screenshot.replace(/^data:image\/\w+;base64,/, "");
      const buffer     = Buffer.from(base64Data, "base64");
      fs.writeFileSync(screenshotPath, buffer);

      const result = await analyzeImage(screenshotPath, "screenshot.png");
      fs.unlink(screenshotPath, () => {});

      return res.json({
        ...result,
        source: "screenshot",
        explanation: result.explanation + " (Note: analyzed from screenshot — original file was not accessible)",
      });

    } catch (err) {
      if (fs.existsSync(screenshotPath)) fs.unlink(screenshotPath, () => {});
      if (DEBUG_MODE) console.error("[imageRoutes] Screenshot fallback failed:", err.message);
      return res.status(500).json(errorResult("Both URL download and screenshot analysis failed."));
    }
  }

  return res.status(400).json(errorResult("Could not access this image. The website may be blocking downloads."));
});

function errorResult(explanation) {
  return {
    status:           "Scan Failed",
    level:            "danger",
    confidence:       0,
    aiGeneratedRisk:  0,
    manipulationRisk: 0,
    explanation,
    signalsDetected:  [],
    technicalDetails: { fileType: "unknown", imageSize: "unknown", metadataFound: null, modelUsed: "none" },
    fileName:         null,
  };
}

module.exports = router;