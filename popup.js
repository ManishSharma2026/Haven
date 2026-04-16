const scanBtn = document.getElementById("scanBtn");
const resultCard = document.getElementById("resultCard");
const resultText = document.getElementById("resultText");
const resultSubtext = document.getElementById("resultSubtext");

scanBtn.addEventListener("click", async () => {
  resultCard.className = "result-card scanning";
  resultText.textContent = "Scanning";
  resultSubtext.textContent = "Reading the current page...";

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab || !tab.id) {
      throw new Error("No active tab found.");
    }

    const restrictedSchemes = [
      "chrome://",
      "chrome-extension://",
      "file://",
      "data://",
    ];

    const isRestricted = restrictedSchemes.some((scheme) =>
      tab.url.startsWith(scheme),
    );

    if (isRestricted) {
      resultCard.className = "result-card danger";
      resultText.textContent = "Scan Unavailable";
      resultSubtext.textContent =
        "This page cannot be scanned due to browser security restrictions.";
      return;
    }

    chrome.tabs.sendMessage(
      tab.id,
      { type: "GET_PAGE_INFO" },
      async (response) => {
        if (chrome.runtime.lastError || !response) {
          resultCard.className = "result-card danger";
          resultText.textContent = "Scan Failed";
          resultSubtext.textContent =
            "Could not connect to this page. Refresh the page and try again.";
          console.error(chrome.runtime.lastError);
          return;
        }

        const pageTitle = response.title || "";
        const selectedText = response.selectedText || "";
        const heading = response.heading || "";
        const bodyText = response.bodyText || "";

        const textToAnalyze = selectedText || heading || bodyText || pageTitle;

        resultSubtext.textContent = "Sending content for analysis...";

        try {
          const res = await fetch("http://localhost:3000/check", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              text: textToAnalyze,
            }),
          });

          const data = await res.json();

          resultCard.className = `result-card ${data.level}`;
          resultText.textContent = data.status;
          resultSubtext.textContent = data.explanation;
        } catch (fetchError) {
          resultCard.className = "result-card danger";
          resultText.textContent = "Backend Offline";
          resultSubtext.textContent =
            "Could not reach the local Haven server. Make sure backend/server.js is running.";
          console.error(fetchError);
        }
      },
    );
  } catch (error) {
    resultCard.className = "result-card danger";
    resultText.textContent = "Scan Failed";
    resultSubtext.textContent = "This page could not be scanned right now.";
    console.error(error);
  }
});
