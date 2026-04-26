const API_BASE = "http://localhost:8000/api";
const SESSION_CHECK_ALARM = "check-active-session";
const SESSION_CHECK_INTERVAL_MIN = 0.5; // 30 seconds
const WARNING_NOTIFICATION_COOLDOWN_MS = 30_000;

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

const ALERT_CATEGORY_LABELS = {
  out_of_frame: "Out of frame",
  phone_detected: "Phone in hand",
  looking_away: "Looking away",
};

// In-memory rate-limit timestamp for warning notifications
let lastWarningNotificationAt = 0;

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
  fetch(`${API_BASE}/sessions/report-distraction`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ hostname, url }),
  }).catch(() => {});
}

// Send a message to all Snitch frontend tabs (localhost)
function notifyFrontendTabs(message) {
  chrome.tabs.query({ url: ["http://localhost:*/*", "https://localhost:*/*"] }, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id != null) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    });
  });
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
        const res = await fetch(`${API_BASE}/sessions?status=active`, {
          headers: { Authorization: `Bearer ${result.authToken}` },
        });

        if (!res.ok) {
          chrome.storage.local.set({ activeSession: false });
          resolve(false);
          return;
        }

        const sessions = await res.json();
        const hasActive = Array.isArray(sessions) && sessions.length > 0;
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
  // ── Session state sync from web app ───────────────────────────────────
  if (message.type === "SESSION_UPDATE") {
    if (message.active) {
      chrome.storage.local.set({
        activeSession: true,
        sessionEndEpoch: message.endEpoch,
        sessionTotalSeconds: message.totalSeconds,
        sessionDistractionCount: message.distractionCount ?? 0,
        sessionDistractionFractions: message.distractionFractions ?? [],
        sessionAmountCents: message.amountCents ?? 0,
      });
    } else {
      chrome.storage.local.set({ activeSession: false });
    }
    sendResponse({ ok: true });
    return true;
  }

  // ── Camera alert from web app → Chrome notification ────────────────────
  if (message.type === "SNITCH_ALERT") {
    chrome.storage.local.get(["activeSession"], (result) => {
      if (!result.activeSession) return;

      const now = Date.now();
      const isStrike = message.alertType === "strike";
      const categoryLabel =
        ALERT_CATEGORY_LABELS[message.category] || message.category;

      // Rate-limit warnings — don't spam a notification every inference frame
      if (!isStrike) {
        if (now - lastWarningNotificationAt < WARNING_NOTIFICATION_COOLDOWN_MS) return;
        lastWarningNotificationAt = now;
      }

      chrome.notifications.create(`snitch-alert-${now}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: isStrike ? "Snitch — Distraction Recorded" : "Snitch — Heads up",
        message: isStrike
          ? `${categoryLabel} detected. A strike has been added to your session.`
          : `${categoryLabel}. Refocus before it counts as a strike.`,
        priority: isStrike ? 2 : 0,
        requireInteraction: isStrike,
      });
    });
    sendResponse({ ok: true });
    return true;
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

      // During an active session: relay the blocked-site visit to the frontend
      // so it can add an arc mark and increment the strike counter visually.
      if (result.activeSession) {
        notifyFrontendTabs({ type: "EXTENSION_DISTRACTION", hostname, url: tab.url });
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
