function sendToBackground(message) {
  try {
    chrome.runtime.sendMessage(message);
  } catch {
    // Extension was reloaded — context is invalidated, silently drop the message
  }
}

// Forward full session state to background when the web app fires it
window.addEventListener("snitch-session", (e) => {
  if (!e.detail || typeof e.detail.active !== "boolean") return;
  sendToBackground({ type: "SESSION_UPDATE", ...e.detail });
});

// Forward camera warnings/strikes to background for Chrome notifications
window.addEventListener("snitch-alert", (e) => {
  if (!e.detail) return;
  sendToBackground({ type: "SNITCH_ALERT", ...e.detail });
});

// Relay extension-detected site distractions back to the web app
try {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "EXTENSION_DISTRACTION") {
      window.dispatchEvent(
        new CustomEvent("snitch-distraction", {
          detail: { hostname: message.hostname },
        })
      );
    }
  });
} catch {
  // Extension context already invalidated at inject time
}
