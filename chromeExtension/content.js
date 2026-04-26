// Forward full session state to background when the web app fires it
window.addEventListener("snitch-session", (e) => {
  if (!e.detail || typeof e.detail.active !== "boolean") return;
  chrome.runtime.sendMessage({ type: "SESSION_UPDATE", ...e.detail });
});

// Forward camera warnings/strikes to background for Chrome notifications
window.addEventListener("snitch-alert", (e) => {
  if (!e.detail) return;
  chrome.runtime.sendMessage({ type: "SNITCH_ALERT", ...e.detail });
});

// Relay extension-detected site distractions back to the web app
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "EXTENSION_DISTRACTION") {
    window.dispatchEvent(
      new CustomEvent("snitch-distraction", {
        detail: { hostname: message.hostname },
      })
    );
  }
});
