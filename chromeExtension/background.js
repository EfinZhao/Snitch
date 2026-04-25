const API_BASE = "http://localhost:8000/api";
const SESSION_CHECK_ALARM = "check-active-session";
const SESSION_CHECK_INTERVAL_MIN = 0.5; // 30 seconds

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

  chrome.alarms.create(SESSION_CHECK_ALARM, {
    periodInMinutes: SESSION_CHECK_INTERVAL_MIN,
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(SESSION_CHECK_ALARM, {
    periodInMinutes: SESSION_CHECK_INTERVAL_MIN,
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

function reportDistraction(hostname, url, token) {
  if (!token) return;
  fetch(`${API_BASE}/stakes/report-distraction`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ hostname, url }),
  }).catch(() => {});
}

async function checkActiveSession() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["authToken"], async (result) => {
      if (!result.authToken) {
        chrome.storage.local.set({ activeSession: false });
        resolve(false);
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/stakes?status=active`, {
          headers: { Authorization: `Bearer ${result.authToken}` },
        });

        if (!res.ok) {
          chrome.storage.local.set({ activeSession: false });
          resolve(false);
          return;
        }

        const stakes = await res.json();
        const hasActive = Array.isArray(stakes) && stakes.length > 0;
        chrome.storage.local.set({ activeSession: hasActive });
        resolve(hasActive);
      } catch {
        chrome.storage.local.set({ activeSession: false });
        resolve(false);
      }
    });
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SESSION_CHECK_ALARM) {
    checkActiveSession();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SESSION_UPDATE") {
    chrome.storage.local.set({ activeSession: !!message.active });
    sendResponse({ ok: true });
  }
});

function shouldBlock(result) {
  if (result.activeSession) return false;
  return result.blockingEnabled;
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  const hostname = extractHostname(tab.url);
  if (!hostname) return;

  chrome.storage.local.get(
    ["blocklist", "visitLog", "blockingEnabled", "authToken", "activeSession"],
    (result) => {
      const blocklist = result.blocklist || [];
      if (!isFlaggedSite(hostname, blocklist)) return;

      reportDistraction(hostname, tab.url, result.authToken);

      if (shouldBlock(result)) {
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
    }
  );
});
