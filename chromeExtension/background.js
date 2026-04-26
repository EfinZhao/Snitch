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

// URL → bool classify cache, cleared between sessions
const classifyCache = new Map();

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

// Ask the backend whether a URL is a distraction during an active session.
// Always attempts page-content extraction; falls back gracefully.
// Cache key is the full URL so per-video/per-article results aren't conflated.
async function classifyUrl(tabId, url, domain, pageTitle, sessionId, token) {
  if (classifyCache.has(url)) {
    console.log(`[Snitch classify] cache hit — ${domain} → ${classifyCache.get(url) ? "BLOCK" : "allow"}`);
    return classifyCache.get(url);
  }

  let pageText = null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (document.body.innerText || "").slice(0, 600).trim(),
    });
    pageText = results?.[0]?.result || null;
  } catch {
    // scripting unavailable (e.g. chrome:// pages) — continue without it
  }

  const body = { domain, page_title: pageTitle || "" };
  if (pageText) body.page_text = pageText;

  console.log(`[Snitch classify] → POST /sessions/${sessionId}/classify  domain=${domain}  title="${pageTitle}"  pageText=${pageText ? pageText.length + " chars" : "none"}`);

  try {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}/classify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[Snitch classify] ✗ HTTP ${res.status} for ${domain}`);
      return false;
    }
    const data = await res.json();
    const block = !!data.block;
    classifyCache.set(url, block);
    console.log(`[Snitch classify] ← ${block ? "BLOCK" : "allow"}  ${domain}`);
    return block;
  } catch (err) {
    console.error(`[Snitch classify] fetch failed for ${domain}:`, err);
    return false;
  }
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
  // ── Check active session on demand (from popup) ─────────────────────────
  if (message.type === "CHECK_SESSION") {
    checkActiveSession().then((hasActive) => {
      sendResponse({ hasActive });
    });
    return true; // keep channel open for async response
  }

  // ── Session state sync from web app ───────────────────────────────────
  if (message.type === "SESSION_UPDATE") {
    if (message.active) {
      chrome.storage.local.set({
        activeSession: true,
        sessionId: message.sessionId,
        sessionEndEpoch: message.endEpoch,
        sessionTotalSeconds: message.totalSeconds,
        sessionDistractionCount: message.distractionCount ?? 0,
        sessionDistractionFractions: message.distractionFractions ?? [],
        sessionAmountCents: message.amountCents ?? 0,
      });
    } else {
      classifyCache.clear();
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
    ["blocklist", "visitLog", "blockingEnabled", "authToken", "activeSession", "sessionId"],
    (result) => {
      const blocklist = result.blocklist || [];
      const isFlagged = isFlaggedSite(hostname, blocklist);

      // ── Hard block (no active session, blocking enabled) ──────────────
      if (isFlagged && shouldBlock(result)) {
        const blockedUrl = chrome.runtime.getURL(
          `blocked.html?site=${encodeURIComponent(hostname)}`
        );
        if (tab.url !== blockedUrl) {
          chrome.tabs.update(tabId, { url: blockedUrl });
        }
        return;
      }

      // ── Manual blocklist notification ─────────────────────────────────
      if (isFlagged) {
        reportDistraction(hostname, tab.url, result.authToken);

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

      // ── AI classification during active session ────────────────────────
      if (result.activeSession && result.authToken && result.sessionId) {
        (async () => {
          const shouldAiBlock = await classifyUrl(
            tabId, tab.url, hostname, tab.title || "",
            result.sessionId, result.authToken
          );
          if (!shouldAiBlock) return;

          const blockedUrl = chrome.runtime.getURL(
            `blocked.html?site=${encodeURIComponent(hostname)}&ai=1`
          );
          chrome.tabs.update(tabId, { url: blockedUrl }).catch(() => {});

          // For sites not already on the manual blocklist, report + log the distraction
          if (!isFlagged) {
            reportDistraction(hostname, tab.url, result.authToken);
            notifyFrontendTabs({ type: "EXTENSION_DISTRACTION", hostname, url: tab.url });
            chrome.storage.local.get(["visitLog"], (r) => {
              const log = r.visitLog || [];
              log.unshift({ url: tab.url, hostname, timestamp: Date.now(), aiBlocked: true });
              if (log.length > 200) log.length = 200;
              chrome.storage.local.set({ visitLog: log });
            });
          }
        })();
      }
    }
  );
});
