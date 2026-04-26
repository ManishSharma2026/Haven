"use strict";

// ── Animated background ───────────────────────────────────────────────────────

(function initBackground() {
  const canvas = document.getElementById("bg");
  const ctx    = canvas.getContext("2d");

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();

  // Orbs
  const orbs = [
    { x: 0.15, y: 0.2,  r: 140, h: 260, speed: 0.00018 },
    { x: 0.85, y: 0.75, r: 120, h: 180, speed: 0.00024 },
    { x: 0.5,  y: 0.55, r: 100, h: 200, speed: 0.00020 },
    { x: 0.7,  y: 0.15, r: 80,  h: 300, speed: 0.00015 },
  ];

  let t = 0;

  function hsl(h, s, l, a) {
    return `hsla(${h},${s}%,${l}%,${a})`;
  }

  function draw(ts) {
    t = ts;
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Base dark background
    ctx.fillStyle = "#080c14";
    ctx.fillRect(0, 0, W, H);

    // Draw each orb
    orbs.forEach((orb, i) => {
      const drift = Math.sin(t * orb.speed + i * 1.3) * 0.08;
      const cx    = (orb.x + drift) * W;
      const cy    = (orb.y + Math.cos(t * orb.speed * 0.7 + i) * 0.06) * H;
      const hue   = (orb.h + t * 0.008 + i * 30) % 360;

      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, orb.r);
      grad.addColorStop(0,   hsl(hue, 70, 55, 0.18));
      grad.addColorStop(0.5, hsl(hue, 65, 45, 0.08));
      grad.addColorStop(1,   hsl(hue, 60, 35, 0));

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, orb.r, 0, Math.PI * 2);
      ctx.fill();
    });

    // Subtle grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.018)";
    ctx.lineWidth   = 0.5;
    const spacing   = 36;

    for (let x = 0; x < W; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y < H; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
})();


// ── Screen management ─────────────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  document.getElementById(id)?.classList.remove("hidden");
}

function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideEl(id) {
  document.getElementById(id)?.classList.add("hidden");
}

function showOk(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.remove("hidden");
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  btn.disabled = loading;
  btn.textContent = loading ? "Please wait…" : btn.dataset.label;
}

// ── Auth navigation ───────────────────────────────────────────────────────────

document.getElementById("goSignup").addEventListener("click", () => {
  hideEl("loginError"); showScreen("screenSignup");
});
document.getElementById("goLogin").addEventListener("click", () => {
  hideEl("signupError"); hideEl("signupSuccess"); showScreen("screenLogin");
});
document.getElementById("goForgot").addEventListener("click", () => {
  hideEl("loginError"); showScreen("screenForgot");
});
document.getElementById("goLoginFromForgot").addEventListener("click", () => {
  hideEl("forgotError"); hideEl("forgotSuccess"); showScreen("screenLogin");
});

document.getElementById("loginBtn").dataset.label  = "Sign In";
document.getElementById("signupBtn").dataset.label = "Create Account";
document.getElementById("forgotBtn").dataset.label = "Send Reset Email";

// ── Sign In ───────────────────────────────────────────────────────────────────

document.getElementById("loginBtn").addEventListener("click", async () => {
  hideEl("loginError");
  const email    = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  if (!email || !password) { showError("loginError", "Please enter your email and password."); return; }
  setLoading("loginBtn", true);
  try {
    await window.havenAuth.signIn(email, password);
    showScreen("screenMain");
    initMainApp();
  } catch (err) {
    showError("loginError", err.message);
  } finally {
    setLoading("loginBtn", false);
  }
});

document.getElementById("loginPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("loginBtn").click();
});

// ── Sign Up ───────────────────────────────────────────────────────────────────

document.getElementById("signupBtn").addEventListener("click", async () => {
  hideEl("signupError"); hideEl("signupSuccess");
  const email    = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  if (!email || !password) { showError("signupError", "Please enter your email and password."); return; }
  if (password.length < 6)  { showError("signupError", "Password must be at least 6 characters."); return; }
  setLoading("signupBtn", true);
  try {
    await window.havenAuth.signUp(email, password);
    showOk("signupSuccess", "Account created! Check your email to confirm, then sign in.");
  } catch (err) {
    showError("signupError", err.message);
  } finally {
    setLoading("signupBtn", false);
  }
});

// ── Forgot Password ───────────────────────────────────────────────────────────

document.getElementById("forgotBtn").addEventListener("click", async () => {
  hideEl("forgotError"); hideEl("forgotSuccess");
  const email = document.getElementById("forgotEmail").value.trim();
  if (!email) { showError("forgotError", "Please enter your email address."); return; }
  setLoading("forgotBtn", true);
  try {
    await window.havenAuth.forgotPassword(email);
    showOk("forgotSuccess", "Reset email sent! Check your inbox.");
  } catch (err) {
    showError("forgotError", err.message);
  } finally {
    setLoading("forgotBtn", false);
  }
});

// ── Sign Out ──────────────────────────────────────────────────────────────────

document.getElementById("signOutBtn").addEventListener("click", async () => {
  await window.havenAuth.signOut();
  closeDrop();
  showScreen("screenLogin");
});

// ── Haven trigger (account dropdown) ─────────────────────────────────────────

const havenTrigger = document.getElementById("havenTrigger");
const accountDrop  = document.getElementById("accountDrop");
const chevron      = document.getElementById("chevron");

function openDrop() {
  accountDrop.classList.remove("hidden");
  chevron.classList.add("open");
}

function closeDrop() {
  accountDrop.classList.add("hidden");
  chevron.classList.remove("open");
}

havenTrigger.addEventListener("click", () => {
  accountDrop.classList.contains("hidden") ? openDrop() : closeDrop();
});

document.addEventListener("click", (e) => {
  if (!havenTrigger.contains(e.target) && !accountDrop.contains(e.target)) {
    closeDrop();
  }
});

// ── Status mapping ────────────────────────────────────────────────────────────

const STATUS_MAP = {
  "Strongly Corroborated":      { label: "Strongly Corroborated", level: "safe"    },
  "Developing Support":         { label: "Developing Support",    level: "warning" },
  "Weak Support":               { label: "Weak Support",          level: "warning" },
  "Conflicting Coverage":       { label: "Conflicting Coverage",  level: "warning" },
  "Unverified / Needs Caution": { label: "Unverified",            level: "warning" },
  "Outdated Or Reversed":       { label: "Outdated",              level: "warning" },
  "Possibly AI-Generated":      { label: "Likely AI Generated",   level: "danger"  },
  "Likely Real":                { label: "Likely Real",           level: "safe"    },
  "Likely Authentic":           { label: "Likely Real",           level: "safe"    },
  "Suspicious":                 { label: "Suspicious",            level: "warning" },
  "Unclear":                    { label: "Unclear",               level: "warning" },
  "Scan Failed":                { label: "Scan Failed",           level: "danger"  },
};

function mapStatus(raw) {
  return STATUS_MAP[raw] || { label: raw, level: "warning" };
}

// ── Main app ──────────────────────────────────────────────────────────────────

function initMainApp() {
  const resultCard  = document.getElementById("resultCard");
  const resultTitle = document.getElementById("resultText");
  const resultSub   = document.getElementById("resultSubtext");
  const statusLabel = document.getElementById("statusLabel");
  const lensText    = document.getElementById("lensText");
  const lensImage   = document.getElementById("lensImage");

  function setResult(rawStatus, subtext, label = "RESULT") {
    const { level, label: displayLabel } = mapStatus(rawStatus);
    resultCard.className  = `result-card ${level}`;
    resultTitle.textContent = displayLabel;
    resultSub.textContent   = subtext;
    statusLabel.textContent = label;
  }

  function setScanning(title, subtext, label = "SCANNING") {
    resultCard.className  = "result-card scanning";
    resultTitle.textContent = title;
    resultSub.textContent   = subtext;
    statusLabel.textContent = label;
  }

  function clearActiveLens() {
    document.querySelectorAll(".lens-row").forEach((r) => r.classList.remove("active-lens"));
  }

  function activateLens(id) {
    clearActiveLens();
    document.getElementById(id)?.classList.add("active-lens");
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  function isRestricted(url = "") {
    return ["chrome://", "chrome-extension://", "file://", "data://"].some((s) => url.startsWith(s));
  }

  // Show email in dropdown
  window.havenAuth.getSession().then((session) => {
    if (session?.email) {
      const el = document.getElementById("dropEmail");
      if (el) el.textContent = session.email;
    }
  });

  // ── Voice system ───────────────────────────────────────────────────────────
  let voiceEnabled  = false;
  let currentAudio  = null;
  const voiceBtn    = document.getElementById("voiceToggle");
  const voiceDesc   = document.getElementById("voiceDesc");

  async function loadVoicePref() {
    const stored = await chrome.storage.local.get("havenVoice");
    voiceEnabled  = stored.havenVoice !== false; // default ON
    updateVoiceUI();
  }

  function updateVoiceUI() {
    if (voiceEnabled) {
      voiceBtn.classList.add("on");
      voiceDesc.textContent = "Reads results aloud via ElevenLabs";
    } else {
      voiceBtn.classList.remove("on");
      voiceDesc.textContent = "Voice readout is off";
    }
  }

  voiceBtn.addEventListener("click", async () => {
    voiceEnabled = !voiceEnabled;
    await chrome.storage.local.set({ havenVoice: voiceEnabled });
    updateVoiceUI();
    if (!voiceEnabled && currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
  });

  async function speak(text) {
    if (!voiceEnabled || !text) return;
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }

    try {
      const res = await fetch("http://localhost:3000/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 400) }),
      });

      if (!res.ok) return;

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      currentAudio = new Audio(url);
      currentAudio.play();
      currentAudio.onended = () => { URL.revokeObjectURL(url); currentAudio = null; };
    } catch {
      // Voice failed silently
    }
  }

  loadVoicePref();

  // ── Pending image result ───────────────────────────────────────────────────
  chrome.storage.local.get("havenImageResult", async (stored) => {
    if (!stored.havenImageResult) return;
    const result = stored.havenImageResult;
    await chrome.storage.local.remove("havenImageResult");

    activateLens("lensImage");

    if (!result.ok) {
      setResult("Unclear", "No image selected. Click AI Lens to try again.", "AI LENS");
      return;
    }

    setScanning("Analysing", "Scanning the image…", "AI LENS");

    try {
      const res = await fetch("http://localhost:3000/analyze-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url:        result.src || "",
          pageUrl:    result.pageUrl || "",
          screenshot: result.screenshot || null,
        }),
      });
      const data = await res.json();
      const conf = data.confidence > 0 ? ` — ${data.confidence}% confidence` : "";
      setResult(data.status, data.explanation + conf, "AI LENS");
      speak(`${data.status}. ${data.explanation}`);
    } catch {
      setResult("Scan Failed", "Make sure the Haven server is running.", "AI LENS");
    }
  });

  // ── Misinformation Lens ────────────────────────────────────────────────────
  lensText.addEventListener("click", async () => {
    activateLens("lensText");
    setScanning("Scanning", "Reading the current page…", "MISINFO LENS");

    let tab;
    try { tab = await getActiveTab(); }
    catch { setResult("Scan Failed", "Could not get the active tab."); clearActiveLens(); return; }

    if (!tab?.id || isRestricted(tab.url)) {
      setResult("Scan Failed", "This page cannot be scanned."); clearActiveLens(); return;
    }

    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    } catch {}

    chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_INFO" }, async (response) => {
      if (chrome.runtime.lastError || !response) {
        setResult("Scan Failed", "Could not read this page. Refresh and try again.");
        clearActiveLens(); return;
      }

      const text = response.selectedText || response.heading || response.bodyText || response.title;
      if (!text) { setResult("Scan Failed", "No readable text found on this page."); return; }

      setScanning("Analysing", "Searching news sources and ranking articles…", "MISINFO LENS");

      try {
        const res  = await fetch("http://localhost:3000/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const data = await res.json();

        // Build detail with article stats
        let detail = data.explanation || "";

        if (data.knowledgeVerdict) {
          detail = data.explanation;
        } else if (data.sources && data.sources.length > 0) {
          const total   = data.debug?.totalFetched || "?";
          const matched = data.debug?.matchedCount || data.sources.length;
          detail += `\n\n📰 ${total} articles scanned · ${matched} relevant · ${data.sources.length} sources used`;
        }

        setResult(data.status, detail, "MISINFO LENS");
        speak(`${data.status}. ${data.explanation}`);
      } catch {
        setResult("Scan Failed", "Make sure the Haven server is running.", "MISINFO LENS");
      }
    });
  });

  // ── AI Lens ────────────────────────────────────────────────────────────────
  lensImage.addEventListener("click", async () => {
    let tab;
    try { tab = await getActiveTab(); }
    catch { setResult("Scan Failed", "Could not get the active tab.", "AI LENS"); return; }

    if (!tab?.id || isRestricted(tab.url)) {
      setResult("Scan Failed", "Not available on this page.", "AI LENS"); return;
    }

    chrome.runtime.sendMessage({ type: "BG_START_IMAGE_SELECT", tabId: tab.id });
    setTimeout(() => window.close(), 80);
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────

(async () => {
  const session = await window.havenAuth.getSession();
  if (session) {
    showScreen("screenMain");
    initMainApp();
  } else {
    showScreen("screenLogin");
  }
})();