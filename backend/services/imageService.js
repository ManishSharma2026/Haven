"use strict";

const fs        = require("fs");
const path      = require("path");
const { spawn } = require("child_process");

const DEBUG_MODE     = process.env.DEBUG_MODE === "true";
const ANALYZE_SCRIPT = path.join(__dirname, "../analyze.py");
const PYTHON_BIN     = path.join(__dirname, "../venv/bin/python3");

async function analyzeImage(filePath, originalName) {
  if (DEBUG_MODE) console.log(`[imageService] Analyzing: ${originalName}`);

  try {
    const result = await runPythonAnalysis(filePath);
    if (!result) return failedResult(originalName);

    if (DEBUG_MODE) {
      console.log(`[imageService] Status: ${result.status}, AI Risk: ${result.aiGeneratedRisk}`);
    }

    return { ...result, fileName: originalName };
  } catch (error) {
    if (DEBUG_MODE) console.error("[imageService] error:", error.message);
    return failedResult(originalName);
  }
}

function runPythonAnalysis(filePath) {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON_BIN, [ANALYZE_SCRIPT, filePath], {
      timeout: 12000,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (DEBUG_MODE && stderr) console.log("[imageService] Python stderr:", stderr.slice(0, 300));
      if (code !== 0 || !stdout.trim()) { resolve(null); return; }
      try {
        const result = JSON.parse(stdout.trim());
        resolve(result.error ? null : result);
      } catch { resolve(null); }
    });

    proc.on("error", (err) => {
      if (DEBUG_MODE) console.error("[imageService] spawn error:", err.message);
      resolve(null);
    });
  });
}

function failedResult(originalName) {
  return {
    status:           "Scan Failed",
    level:            "danger",
    confidence:       0,
    aiGeneratedRisk:  0,
    manipulationRisk: 0,
    explanation:      "Haven could not analyze this image. The server may have timed out.",
    signalsDetected:  [],
    technicalDetails: {
      fileType: "unknown", imageSize: "unknown",
      metadataFound: null, modelUsed: "error",
    },
    fileName: originalName,
  };
}

module.exports = { analyzeImage };