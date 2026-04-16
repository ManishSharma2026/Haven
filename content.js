chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_PAGE_INFO") {
    const selectedText = window.getSelection().toString().trim();

    const heading =
      document.querySelector("article h1")?.innerText?.trim() ||
      document.querySelector("main h1")?.innerText?.trim() ||
      document.querySelector("h1")?.innerText?.trim() ||
      "";

    let paragraphNodes = Array.from(
      document.querySelectorAll("article p, main p"),
    );

    if (paragraphNodes.length === 0) {
      paragraphNodes = Array.from(document.querySelectorAll("p"));
    }

    const paragraphs = paragraphNodes
      .map((p) => p.innerText.trim())
      .filter((text) => {
        if (text.length < 40) return false;

        const lower = text.toLowerCase();

        // Filter obvious junk/footer/app text
        if (lower.includes("scan the qr code")) return false;
        if (lower.includes("download the cnn app")) return false;
        if (lower.includes("privacy policy")) return false;
        if (lower.includes("all rights reserved")) return false;
        if (lower.includes("warner bros")) return false;
        if (lower.includes("cable news network")) return false;

        return true;
      })
      .slice(0, 5);

    const bodyText = paragraphs.join(" ");

    sendResponse({
      title: document.title || "Untitled Page",
      selectedText,
      heading,
      bodyText,
    });
  }
});
