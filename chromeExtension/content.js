window.addEventListener("snitch-session", (e) => {
  if (!e.detail || typeof e.detail.active !== "boolean") return;
  chrome.runtime.sendMessage({ type: "SESSION_UPDATE", active: e.detail.active });
});
