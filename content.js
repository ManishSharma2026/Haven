if (typeof window.__havenLoaded === "undefined") {
  window.__havenLoaded = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    // ── Text scan ────────────────────────────────────────────────────────────
    if (message.type === "GET_PAGE_INFO") {
      const selectedText = window.getSelection().toString().trim();
      const heading =
        document.querySelector("article h1")?.innerText?.trim() ||
        document.querySelector("main h1")?.innerText?.trim() ||
        document.querySelector("h1")?.innerText?.trim() || "";

      let paragraphNodes = Array.from(document.querySelectorAll("article p, main p"));
      if (paragraphNodes.length === 0) paragraphNodes = Array.from(document.querySelectorAll("p"));

      const paragraphs = paragraphNodes
        .map((p) => p.innerText.trim())
        .filter((t) => t.length >= 40 && !t.toLowerCase().includes("privacy policy"))
        .slice(0, 5);

      sendResponse({
        title: document.title || "Untitled",
        selectedText,
        heading,
        bodyText: paragraphs.join(" "),
      });
      return true;
    }

    // ── Image click selector ─────────────────────────────────────────────────
    if (message.type === "START_IMAGE_SELECT") {
      ["haven-overlay","haven-banner","haven-highlight"].forEach((id) => {
        document.getElementById(id)?.remove();
      });

      const overlay = document.createElement("div");
      overlay.id = "haven-overlay";
      overlay.style.cssText = `
        position:fixed;inset:0;z-index:2147483647;
        cursor:crosshair;background:rgba(0,0,0,0.4);user-select:none;
      `;

      const banner = document.createElement("div");
      banner.id = "haven-banner";
      banner.style.cssText = `
        position:fixed;top:20px;left:50%;transform:translateX(-50%);
        background:rgba(17,24,39,0.96);color:#f9fafb;
        font-family:Arial,sans-serif;font-size:14px;font-weight:600;
        padding:10px 22px;border-radius:999px;
        border:1px solid rgba(99,102,241,0.5);
        box-shadow:0 8px 24px rgba(0,0,0,0.5);
        pointer-events:none;z-index:2147483647;white-space:nowrap;
      `;
      banner.textContent = "🔍 Click any image to scan it  ·  Esc to cancel";

      const highlight = document.createElement("div");
      highlight.id = "haven-highlight";
      highlight.style.cssText = `
        position:fixed;pointer-events:none;z-index:2147483646;
        border:3px solid #38bdf8;border-radius:6px;
        box-shadow:0 0 0 3px rgba(56,189,248,0.25);
        display:none;background:rgba(56,189,248,0.05);
        transition:all 0.08s ease;
      `;

      document.body.appendChild(highlight);
      document.body.appendChild(banner);
      document.body.appendChild(overlay);

      let hoveredImg = null;

      function cleanup() {
        overlay.remove();
        banner.remove();
        highlight.remove();
        document.removeEventListener("keydown", onKey);
      }

      overlay.addEventListener("mousemove", (e) => {
        overlay.style.pointerEvents = "none";
        const el = document.elementFromPoint(e.clientX, e.clientY);
        overlay.style.pointerEvents = "auto";

        const img = el && (el.tagName === "IMG" ? el : el.closest("img"));

        if (img && img.tagName === "IMG") {
          hoveredImg = img;
          const rect = img.getBoundingClientRect();
          highlight.style.display = "block";
          highlight.style.left   = (rect.left - 3) + "px";
          highlight.style.top    = (rect.top - 3) + "px";
          highlight.style.width  = (rect.width + 6) + "px";
          highlight.style.height = (rect.height + 6) + "px";
        } else {
          hoveredImg = null;
          highlight.style.display = "none";
        }
      });

      overlay.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        overlay.style.pointerEvents = "none";
        const el = document.elementFromPoint(e.clientX, e.clientY);
        overlay.style.pointerEvents = "auto";

        const img = el && (el.tagName === "IMG" ? el : el.closest("img"));

        if (!img || img.tagName !== "IMG") {
          banner.textContent = "⚠ Click directly on an image  ·  Esc to cancel";
          setTimeout(() => { banner.textContent = "🔍 Click any image to scan it  ·  Esc to cancel"; }, 1500);
          return;
        }

        const src = img.currentSrc || img.src || "";
        const rect = img.getBoundingClientRect();

        cleanup();

        sendResponse({
          ok:      true,
          src:     src.startsWith("data:") ? "" : src,
          pageUrl: window.location.href,
          rect: {
            x:      rect.left,
            y:      rect.top,
            width:  rect.width,
            height: rect.height,
          },
          dpr: window.devicePixelRatio || 1,
        });
      });

      function onKey(e) {
        if (e.key === "Escape") {
          cleanup();
          sendResponse({ ok: false, reason: "cancelled" });
        }
      }
      document.addEventListener("keydown", onKey);
      return true;
    }
  });
}