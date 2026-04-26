# Haven — detecting lies alongside you

> A Chrome extension that helps you verify what you see online in real time.

![Haven](https://img.shields.io/badge/version-1.0-6c63ff?style=flat-square) ![Chrome](https://img.shields.io/badge/Chrome-Extension-3ecfcf?style=flat-square&logo=googlechrome) ![License](https://img.shields.io/badge/license-MIT-white?style=flat-square)

---

## What is Haven?

Haven is a browser extension that brings misinformation detection and AI image forensics directly into your browsing experience — no copy-pasting, no switching tabs, no friction.

Two lenses. One click.

---

## Features

### Misinformation Lens
- Reads the current page headline and body text automatically
- Strips attribution ("according to X", "Trump says...") to isolate the real-world claim
- Builds a structured event model — actor, action, object, location, time
- Generates targeted search queries using a local Llama3 AI model
- Searches News API for corroborating or conflicting articles
- Scores each article by relevance, source trust, and recency
- Returns a clear verdict with confidence score

**Verdicts:** Strongly Corroborated · Developing Support · Weak Support · Conflicting Coverage · Unverified · Outdated

### AI Lens
- Click any image on any page to analyse it
- Downloads the original file when possible (preserves EXIF, noise, frequency data)
- Falls back to screenshot crop when sites block downloads (Instagram, Getty, CNN)
- Runs a 9-stage forensic pipeline:
  - EXIF metadata cross-validation
  - C2PA Content Credentials check
  - FFT frequency fingerprinting (GAN upsampling artifacts)
  - Error Level Analysis (ELA)
  - Noise uniformity and autocorrelation
  - Statistical analysis (kurtosis, channel correlation, histogram entropy)
  - Face geometry (skin texture, bilateral symmetry, eye consistency)
  - Scene complexity and color diversity
  - Pixel distribution analysis

**Verdicts:** Likely AI Generated · Suspicious · Unclear · Likely Real

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Extension | Vanilla JS · Manifest V3 · Chrome APIs |
| Auth | Supabase (login, signup, forgot password, sessions) |
| Backend | Node.js · Express · Axios |
| AI (local) | Ollama · Llama3 (misinformation) · LLaVA (image, optional) |
| News | News API |
| Image forensics | Python · Pillow · NumPy · SciPy · OpenCV |
| Content credentials | C2PA |

---

## Project Structure

```
Haven/
├── backend/
│   ├── server.js
│   ├── analyze.py          ← image forensics pipeline
│   ├── routes/
│   │   ├── checkRoutes.js  ← /check, /test-ai, /debug-ping
│   │   ├── imageRoutes.js  ← /analyze-image
│   │   └── voiceRoutes.js  ← /speak
│   ├── services/
│   │   ├── aiService.js
│   │   ├── imageService.js
│   │   ├── misinformationService.js
│   │   └── semanticService.js
│   ├── utils/
│   │   └── jsonUtils.js
│   └── venv/               ← Python virtual environment
├── content.js
├── background.js
├── popup.html
├── popup.css
├── popup.js
├── auth.js
└── manifest.json
```

---

## Setup

### Prerequisites
- Node.js 18+
- Python 3.10+
- [Ollama](https://ollama.ai) installed and running
- Chrome browser

### 1. Clone the repo

```bash
git clone https://github.com/yourusername/haven.git
cd haven
```

### 2. Set up the backend

```bash
cd backend
npm install
```

Create a `.env` file in the `backend/` folder:

```env
PORT=3000
NEWS_API_KEY=your_news_api_key
OLLAMA_URL=http://localhost:11434/api/generate
OLLAMA_MODEL=llama3
DEBUG_MODE=false
CACHE_TTL_MS=300000
REQUEST_TIMEOUT_MS=20000
MAX_QUERY_COUNT=6
NEWS_LOOKBACK_DAYS=30
```

### 3. Set up Python environment

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install Pillow numpy scipy opencv-python
```

### 4. Pull AI models

```bash
ollama pull llama3
```

### 5. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Go to Settings → API Keys
3. Add to your `.env`:

```env
ELEVENLABS_API_KEY=your_key    # optional — voice feature
ELEVENLABS_VOICE_ID=your_voice_id
```

Update `auth.js` in the extension folder with your Supabase URL and publishable key.

### 6. Start the backend

In Terminal 1:
```bash
cd backend
source venv/bin/activate
node server.js
```

In Terminal 2:
```bash
ollama run llama3
```

### 7. Load the extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the root `Haven/` folder (where `manifest.json` is)

---

## API Keys Needed

| Service | Where to get it | Cost |
|---------|----------------|------|
| News API | [newsapi.org](https://newsapi.org) | Free tier: 100 req/day |
| Supabase | [supabase.com](https://supabase.com) | Free tier |
| ElevenLabs | [elevenlabs.io](https://elevenlabs.io) | Free tier: 10k chars/month |

---

## How It Works

```
User opens Haven popup
        ↓
Clicks Misinformation Lens or AI Lens
        ↓
        ├── Misinformation Lens
        │     ↓
        │   Reads page text
        │     ↓
        │   Strips attribution
        │     ↓
        │   Builds event model
        │     ↓
        │   Llama3 parses claim → search queries
        │     ↓
        │   News API search
        │     ↓
        │   Score + rank articles
        │     ↓
        │   Llama3 compares claim to articles
        │     ↓
        │   Verdict shown in popup
        │
        └── AI Lens
              ↓
            Click any image on page
              ↓
            Background captures image URL + screenshot crop
              ↓
            Backend tries URL download (original file)
            → Falls back to screenshot if blocked
              ↓
            analyze.py runs 9-stage forensic pipeline
              ↓
            Verdict shown in popup
```

---

## Roadmap

- [x] Misinformation detection with local AI
- [x] AI image forensics pipeline
- [x] Auth (login, signup, forgot password)
- [x] Click-to-select image scanning
- [x] Screenshot fallback for blocked sites
- [x] Animated futuristic UI
- [ ] Source Trace lens (article origin verification)
- [ ] Scan history saved per user
- [ ] Voice readout via ElevenLabs
- [ ] Semantic search for better claim matching
- [ ] Video frame analysis
- [ ] Mobile companion app

---

## Hackathon

Haven was built for a hackathon exploring the intersection of AI, media literacy, and browser tooling. The goal: make fact-checking and AI detection effortless for everyday users.

---

## License

MIT — feel free to use, modify, and build on Haven.

---

*Haven — keeping the source safe.*
