/**
 * routes/voiceRoutes.js
 * ElevenLabs TTS — keeps API key server-side.
 */

"use strict";

const express = require("express");
const router  = express.Router();
const axios   = require("axios");

const API_KEY  = process.env.ELEVENLABS_API_KEY  || "";
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "";
const DEBUG    = process.env.DEBUG_MODE === "true";

router.post("/speak", async (req, res) => {
  const { text } = req.body;
  if (!text)     return res.status(400).json({ error: "No text." });
  if (!API_KEY)  return res.status(500).json({ error: "ElevenLabs not configured." });

  const trimmed = text.slice(0, 400);
  if (DEBUG) console.log(`[voice] Speaking: "${trimmed.slice(0, 60)}..."`);

  try {
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
      {
        text: trimmed,
        model_id: "eleven_flash_v2_5",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      },
      {
        headers: {
          "xi-api-key":   API_KEY,
          "Content-Type": "application/json",
          "Accept":       "audio/mpeg",
        },
        responseType: "arraybuffer",
        timeout: 15000,
      }
    );

    res.set({
      "Content-Type":   "audio/mpeg",
      "Content-Length": response.data.byteLength,
      "Cache-Control":  "no-store",
    });
    res.send(Buffer.from(response.data));

  } catch (error) {
    if (DEBUG) {
      const msg = error.response?.data
        ? Buffer.from(error.response.data).toString("utf8")
        : error.message;
      console.error("[voice] ElevenLabs error:", msg);
    }
    res.status(500).json({ error: "Voice generation failed." });
  }
});

module.exports = router;