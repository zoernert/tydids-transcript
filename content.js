console.log("Content script loaded for tydids transcript.");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "TRANSCRIPT_UPDATE") {
    console.log("Transcript update received:", request.data);
    // Logic to display transcript on the page will be implemented here
  }
});
