/**
 * routes/voiceRoutes.js
 * Proxies text-to-speech requests to ElevenLabs.
 * Keeps the API key server-side and safe.
 */

"use strict";

const express = require("express");
const router  = express.Router();
const axios   = require("axios");

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "";
const DEBUG_MODE = process.env.DEBUG_MODE === "true";

router.post("/speak", async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: "No text provided." });
  }

  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) {
    return res.status(500).json({ error: "ElevenLabs not configured." });
  }

  // Keep text concise to save credits — max 400 chars
  const trimmed = text.slice(0, 400);

  if (DEBUG_MODE) {
    console.log(`[voiceRoutes] Speaking: "${trimmed.slice(0, 60)}..."`);
  }

  try {
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        text: trimmed,
        model_id: "eleven_flash_v2_5",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      },
      {
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        responseType: "arraybuffer",
        timeout: 15000,
      }
    );

    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": response.data.byteLength,
      "Cache-Control": "no-store",
    });

    res.send(Buffer.from(response.data));
  } catch (error) {
    if (DEBUG_MODE) {
      console.error("[voiceRoutes] ElevenLabs error:", error.response?.data || error.message);
    }
    res.status(500).json({ error: "Voice generation failed." });
  }
});

module.exports = router;