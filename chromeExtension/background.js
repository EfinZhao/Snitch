const DEFAULT_BLOCKLIST = [
  "youtube.com",
  "tiktok.com",
  "reddit.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "facebook.com",
  "twitch.tv",
  "netflix.com",
  "discord.com",
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["blocklist", "visitLog"], (result) => {
    if (!result.blocklist) {
      chrome.storage.local.set({ blocklist: DEFAULT_BLOCKLIST });
    }
    if (!result.visitLog) {
      chrome.storage.local.set({ visitLog: [] });
    }
  });
});

function extractHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isFlaggedSite(hostname, blocklist) {
  return blocklist.some(
    (site) => hostname === site || hostname.endsWith("." + site)
  );
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  const hostname = extractHostname(tab.url);
  if (!hostname) return;

  chrome.storage.local.get(["blocklist", "visitLog", "blockingEnabled"], (result) => {
    const blocklist = result.blocklist || [];
    if (!isFlaggedSite(hostname, blocklist)) return;

    if (result.blockingEnabled) {
      const blockedUrl = chrome.runtime.getURL(
        `blocked.html?site=${encodeURIComponent(hostname)}`
      );
      if (tab.url !== blockedUrl) {
        chrome.tabs.update(tabId, { url: blockedUrl });
      }
      return;
    }

    chrome.action.setBadgeText({ text: "!", tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#335f87", tabId });
    chrome.action.setBadgeTextColor({ color: "#FFFFFF", tabId });

    chrome.notifications.create(`snitch-${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Snitch — Flagged Site",
      message: `You're visiting ${hostname}. This site is on your flagged list.`,
      priority: 2,
    });

    const visitLog = result.visitLog || [];
    visitLog.unshift({ url: tab.url, hostname, timestamp: Date.now() });

    if (visitLog.length > 200) visitLog.length = 200;

    chrome.storage.local.set({ visitLog });
  });
});
