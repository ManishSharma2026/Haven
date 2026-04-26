"use strict";

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  document.getElementById(id)?.classList.remove("hidden");
}

function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideError(id) {
  document.getElementById(id)?.classList.add("hidden");
}

function showSuccess(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.remove("hidden");
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  btn.disabled = loading;
  btn.textContent = loading ? "Please wait..." : btn.dataset.label;
}

document.getElementById("goSignup").addEventListener("click", () => {
  hideError("loginError"); showScreen("screenSignup");
});
document.getElementById("goLogin").addEventListener("click", () => {
  hideError("signupError"); hideError("signupSuccess"); showScreen("screenLogin");
});
document.getElementById("goForgot").addEventListener("click", () => {
  hideError("loginError"); showScreen("screenForgot");
});
document.getElementById("goLoginFromForgot").addEventListener("click", () => {
  hideError("forgotError"); hideError("forgotSuccess"); showScreen("screenLogin");
});

document.getElementById("loginBtn").dataset.label  = "Sign In";
document.getElementById("signupBtn").dataset.label = "Create Account";
document.getElementById("forgotBtn").dataset.label = "Send Reset Email";

document.getElementById("loginBtn").addEventListener("click", async () => {
  hideError("loginError");
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

document.getElementById("signupBtn").addEventListener("click", async () => {
  hideError("signupError"); hideError("signupSuccess");
  const email    = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  if (!email || !password) { showError("signupError", "Please enter your email and password."); return; }
  if (password.length < 6) { showError("signupError", "Password must be at least 6 characters."); return; }
  setLoading("signupBtn", true);
  try {
    await window.havenAuth.signUp(email, password);
    showSuccess("signupSuccess", "Account created! Check your email to confirm, then sign in.");
  } catch (err) {
    showError("signupError", err.message);
  } finally {
    setLoading("signupBtn", false);
  }
});

document.getElementById("forgotBtn").addEventListener("click", async () => {
  hideError("forgotError"); hideError("forgotSuccess");
  const email = document.getElementById("forgotEmail").value.trim();
  if (!email) { showError("forgotError", "Please enter your email address."); return; }
  setLoading("forgotBtn", true);
  try {
    await window.havenAuth.forgotPassword(email);
    showSuccess("forgotSuccess", "Reset email sent! Check your inbox.");
  } catch (err) {
    showError("forgotError", err.message);
  } finally {
    setLoading("forgotBtn", false);
  }
});

document.getElementById("signOutBtn").addEventListener("click", async () => {
  await window.havenAuth.signOut();
  showScreen("screenLogin");
});

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

function initMainApp() {
  const resultCard    = document.getElementById("resultCard");
  const resultText    = document.getElementById("resultText");
  const resultSubtext = document.getElementById("resultSubtext");
  const statusLabel   = document.getElementById("statusLabel");
  const lensText      = document.getElementById("lensText");
  const lensImage     = document.getElementById("lensImage");

  function setResult(rawStatus, subtext, label = "Status") {
    const { level, label: displayLabel } = mapStatus(rawStatus);
    resultCard.className      = `result-card ${level}`;
    resultText.textContent    = displayLabel;
    resultSubtext.textContent = subtext;
    statusLabel.textContent   = label;
  }

  function setScanning(title, subtext, label = "Status") {
    resultCard.className      = "result-card scanning";
    resultText.textContent    = title;
    resultSubtext.textContent = subtext;
    statusLabel.textContent   = label;
  }

  function clearLens() {
    document.querySelectorAll(".lens-row").forEach((r) =>
      r.classList.remove("lens-active", "lens-selecting")
    );
  }

  function activateLens(id) {
    clearLens();
    document.getElementById(id)?.classList.add("lens-active");
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  function isRestricted(url = "") {
    return ["chrome://", "chrome-extension://", "file://", "data://"].some((s) => url.startsWith(s));
  }

  // ── Check for pending image result ────────────────────────────────────────
  chrome.storage.local.get("havenImageResult", async (stored) => {
    if (!stored.havenImageResult) return;
    const result = stored.havenImageResult;
    await chrome.storage.local.remove("havenImageResult");

    activateLens("lensImage");

    if (!result.ok) {
      setResult("Unclear", "No image selected. Click AI Lens to try again.");
      return;
    }

    setScanning("Analysing", "Scanning the image...", "AI Lens");

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
      setResult(data.status, data.explanation + conf, "AI Lens");

    } catch {
      setResult("Scan Failed", "Make sure the Haven server is running.", "AI Lens");
    }
  });

  // ── Misinformation Lens ───────────────────────────────────────────────────
  lensText.addEventListener("click", async () => {
    activateLens("lensText");
    setScanning("Scanning", "Reading the current page...");

    let tab;
    try { tab = await getActiveTab(); }
    catch { setResult("Scan Failed", "Could not get the active tab."); clearLens(); return; }

    if (!tab?.id || isRestricted(tab.url)) {
      setResult("Scan Failed", "This page cannot be scanned."); clearLens(); return;
    }

    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    } catch {}

    chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_INFO" }, async (response) => {
      if (chrome.runtime.lastError || !response) {
        setResult("Scan Failed", "Could not read this page. Refresh and try again.");
        clearLens(); return;
      }

      const text = response.selectedText || response.heading || response.bodyText || response.title;
      if (!text) { setResult("Scan Failed", "No readable text found on this page."); return; }

      setScanning("Analysing", "Checking claim against news sources...");

      try {
        const res  = await fetch("http://localhost:3000/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const data = await res.json();
        setResult(data.status, data.explanation);
      } catch {
        setResult("Scan Failed", "Make sure the Haven server is running.");
      }
    });
  });

  // ── AI Lens ───────────────────────────────────────────────────────────────
  lensImage.addEventListener("click", async () => {
    let tab;
    try { tab = await getActiveTab(); }
    catch { setResult("Scan Failed", "Could not get the active tab.", "AI Lens"); return; }

    if (!tab?.id || isRestricted(tab.url)) {
      setResult("Scan Failed", "Image scanning not available on this page.", "AI Lens"); return;
    }

    chrome.runtime.sendMessage({ type: "BG_START_IMAGE_SELECT", tabId: tab.id });
    setTimeout(() => window.close(), 80);
  });
}

(async () => {
  const session = await window.havenAuth.getSession();
  if (session) {
    showScreen("screenMain");
    initMainApp();
  } else {
    showScreen("screenLogin");
  }
})();