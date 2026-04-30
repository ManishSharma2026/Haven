# Haven — detecting lies alongside you

A Chrome extension prototype that helps you verify what you see online in real time.

Haven is an early-stage AI-assisted verification tool currently in development. It is not meant to be a final judge of truth. Instead, it helps gather evidence, compare sources, analyze credibility signals, and explain uncertainty so users can think more critically about online information.

---

## What is Haven?

Haven is a browser extension prototype that brings misinformation detection and experimental AI image forensics directly into your browsing experience — no copy-pasting, no switching tabs, no friction.

The project is currently being improved, especially around claim accuracy, evidence quality, uncertainty handling, source reliability, and AI-assisted verdict generation.

Two lenses. One click.

---

## Features

### Misinformation Lens

The Misinformation Lens reads the current webpage and attempts to identify the core real-world claim being made.

Current capabilities include:

- Reads the current page headline and body text automatically
- Strips attribution phrases like “according to X” or “Trump says...” to isolate the real-world claim
- Builds a structured event model with actor, action, object, location, and time
- Generates targeted search queries using a local Llama3 AI model
- Searches News API for corroborating or conflicting articles
- Scores articles by relevance, source trust, and recency
- Returns an evidence-based verdict with a confidence estimate and explanation

Current verdict types:

- Strongly Corroborated
- Developing Support
- Weak Support
- Conflicting Coverage
- Unverified
- Outdated

---

### AI Lens

The AI Lens is an experimental image forensics feature for analyzing whether an online image may show signs of AI generation or manipulation.

Current capabilities include:

- Click any image on a webpage to analyze it
- Downloads the original file when possible to preserve EXIF, noise, and frequency data
- Falls back to screenshot crop when websites block downloads, such as Instagram, Getty, or CNN
- Runs a multi-stage forensic analysis pipeline

The current forensic pipeline includes:

1. EXIF metadata cross-validation
2. C2PA Content Credentials check
3. FFT frequency fingerprinting for possible GAN upsampling artifacts
4. Error Level Analysis
5. Noise uniformity and autocorrelation
6. Statistical analysis, including kurtosis, channel correlation, and histogram entropy
7. Face geometry checks, including skin texture, bilateral symmetry, and eye consistency
8. Scene complexity and color diversity
9. Pixel distribution analysis

Current verdict types:

- Likely AI Generated
- Suspicious
- Unclear
- Likely Real

---

## Current Status

Haven is currently a working prototype.

The browser extension, backend, local AI model connection, News API search, and image analysis pipeline are being actively developed.

The main focus right now is improving:

- Claim extraction accuracy
- Search query generation
- Evidence relevance scoring
- Source credibility scoring
- False positive and false negative handling
- Uncertainty-aware verdicts
- AI image forensics reliability
- Overall accuracy and trustworthiness of results

A separate research-focused project, **HavenBench**, will be used to evaluate Haven and other AI verification systems across misinformation, weak evidence, uncertainty, and prompt-injection failure cases.

---

## HavenBench Connection

Haven is the prototype.

HavenBench is the evaluation framework.

Haven explores what a browser-based AI verification assistant could look like. HavenBench studies where systems like Haven fail, especially around misinformation, weak evidence, uncertainty, and adversarial webpage content.

The goal of HavenBench is to turn Haven’s reliability challenges into a measurable research problem.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Extension | Vanilla JS · Manifest V3 · Chrome APIs |
| Auth | Supabase login, signup, forgot password, sessions |
| Backend | Node.js · Express · Axios |
| AI Local | Ollama · Llama3 for misinformation · LLaVA optional for image analysis |
| News | News API |
| Image Forensics | Python · Pillow · NumPy · SciPy · OpenCV |
| Content Credentials | C2PA |

---

## Project Structure

```text
Haven/
├── backend/
│   ├── server.js
│   ├── analyze.py              # image forensics pipeline
│   ├── routes/
│   │   ├── checkRoutes.js      # /check, /test-ai, /debug-ping
│   │   ├── imageRoutes.js      # /analyze-image
│   │   └── voiceRoutes.js      # /speak
│   ├── services/
│   │   ├── aiService.js
│   │   ├── imageService.js
│   │   ├── misinformationService.js
│   │   └── semanticService.js
│   ├── utils/
│   │   └── jsonUtils.js
│   └── venv/                   # Python virtual environment
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

Before running Haven, make sure you have:

- Node.js 18+
- Python 3.10+
- Ollama installed and running
- Chrome browser
- News API key
- Supabase project

---

### 1. Clone the repo

```bash
git clone https://github.com/yourusername/haven.git
cd haven
```

---

### 2. Set up the backend

```bash
cd backend
npm install
```

Create a `.env` file inside the `backend/` folder:

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

Optional voice settings:

```env
ELEVENLABS_API_KEY=your_key
ELEVENLABS_VOICE_ID=your_voice_id
```

---

### 3. Set up the Python environment

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install Pillow numpy scipy opencv-python
```

---

### 4. Pull local AI models

```bash
ollama pull llama3
```

Optional image model:

```bash
ollama pull llava
```

---

### 5. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Go to Settings → API Keys
3. Copy your Supabase URL and publishable key
4. Update `auth.js` with your Supabase URL and publishable key

---

### 6. Start the backend

In Terminal 1:

```bash
cd backend
source venv/bin/activate
node server.js
```

The backend should run at:

```text
http://localhost:3000
```

---

### 7. Load the Chrome extension

1. Open Chrome
2. Go to:

```text
chrome://extensions
```

3. Turn on Developer Mode
4. Click Load unpacked
5. Select the Haven project folder
6. Pin the extension to your browser toolbar

---

## How It Works

### Misinformation Flow

```text
Webpage text
   ↓
Content script extracts headline and body text
   ↓
Backend receives page content
   ↓
Local Llama3 model identifies the main claim
   ↓
System builds structured search queries
   ↓
News API retrieves related coverage
   ↓
Articles are scored by relevance, source trust, and recency
   ↓
Haven returns an uncertainty-aware verdict
```

---

### Image Analysis Flow

```text
User clicks image
   ↓
Extension attempts original image download
   ↓
If blocked, extension captures screenshot crop
   ↓
Backend runs Python forensic pipeline
   ↓
Image signals are scored
   ↓
Haven returns an experimental AI-image verdict
```

---

## Research Motivation

Haven explores how AI systems can assist users in evaluating online information without becoming overconfident or misleading.

The project focuses on questions such as:

- How should an AI system communicate uncertainty?
- When is evidence strong enough to support a claim?
- How can a browser-based AI assistant avoid overtrusting weak sources?
- How can AI verification systems handle conflicting coverage?
- How can these systems resist adversarial webpage content or prompt-injection attacks?
- What failure cases appear when AI is used for real-time misinformation analysis?

These questions are being explored further through HavenBench.

---

## Limitations

Haven is still a prototype and has important limitations:

- It may misidentify the main claim on a webpage
- It may retrieve articles that are related but not directly supportive
- It may overvalue certain sources depending on the scoring logic
- It may fail when a claim is too new, vague, local, or poorly covered
- Image forensics results are experimental and should not be treated as definitive
- The system should not be used as the only source of truth

Haven is designed to support human judgment, not replace it.

---

## Roadmap

Planned improvements include:

- Improve claim extraction accuracy
- Add better evidence relevance scoring
- Add semantic search for stronger article matching
- Add prompt-injection detection for webpage text
- Add stronger uncertainty handling
- Improve image forensics reliability
- Add HavenBench evaluation results
- Add charts and metrics for misinformation-checking performance
- Improve UI clarity and explanation quality
- Add exportable reports for analyzed claims and images

---

## Related Project

### HavenBench

HavenBench is a separate research-focused project for evaluating AI verification systems.

It will include:

- Benchmark claims dataset
- Python evaluation scripts
- Metrics for accuracy, uncertainty, and failure cases
- Prompt-injection test cases
- Weak-evidence and misleading-claim examples
- Failure-case documentation
- Research-style writeup

HavenBench is designed to measure where systems like Haven succeed, fail, and need improvement.

---

## License

This project is currently under active development. License details will be added as the project matures.
