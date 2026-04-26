/**
 * background.js
 * Haven service worker.
 * Gets image position from content script, captures tab screenshot,
 * crops to image bounds, and stores result.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "BG_START_IMAGE_SELECT") return;

  const tabId = message.tabId;

  chrome.storage.local.remove("havenImageResult");

  chrome.scripting.executeScript(
    { target: { tabId }, files: ["content.js"] },
    () => {
      void chrome.runtime.lastError;

      chrome.tabs.sendMessage(tabId, { type: "START_IMAGE_SELECT" }, async (response) => {
        void chrome.runtime.lastError;

        if (!response || !response.ok) {
          const result = { ok: false, reason: response?.reason || "no_response" };
          chrome.storage.local.set({ havenImageResult: result });
          chrome.runtime.sendMessage({ type: "IMAGE_SELECT_RESULT", ...result }, () => {
            void chrome.runtime.lastError;
          });
          return;
        }

        // We have the image src and its position on screen
        const { src, pageUrl, rect, dpr } = response;

        // Always capture screenshot crop — works on every site
        // Also pass the src URL so backend can try downloading original first
        try {
          const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
          const cropped = await cropImage(dataUrl, rect, dpr || 1);

          const result = {
            ok: true,
            src,           // original URL (backend will try this first)
            pageUrl,
            screenshot: cropped,  // fallback screenshot crop
            isCropped: true,
          };

          chrome.storage.local.set({ havenImageResult: result });
          chrome.runtime.sendMessage({ type: "IMAGE_SELECT_RESULT", ...result }, () => {
            void chrome.runtime.lastError;
          });
        } catch (err) {
          // Screenshot failed — just use the URL
          const result = { ok: true, src, pageUrl, screenshot: null };
          chrome.storage.local.set({ havenImageResult: result });
          chrome.runtime.sendMessage({ type: "IMAGE_SELECT_RESULT", ...result }, () => {
            void chrome.runtime.lastError;
          });
        }
      });
    }
  );

  return true;
});

async function cropImage(dataUrl, rect, dpr) {
  const response = await fetch(dataUrl);
  const blob     = await response.blob();
  const bitmap   = await createImageBitmap(blob);

  const sx = Math.max(0, Math.round(rect.x * dpr));
  const sy = Math.max(0, Math.round(rect.y * dpr));
  const sw = Math.min(Math.round(rect.width * dpr), bitmap.width - sx);
  const sh = Math.min(Math.round(rect.height * dpr), bitmap.height - sy);

  if (sw <= 0 || sh <= 0) throw new Error("Invalid crop dimensions");

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx    = canvas.getContext("2d");
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();

  const outBlob = await canvas.convertToBlob({ type: "image/png" });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(outBlob);
  });
}