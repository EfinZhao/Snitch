importScripts("config.js");

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

// Ask Gemini whether a domain is a distraction, based solely on Gemini's knowledge of the site.
// Cache key is the domain so repeated visits don't re-query.
async function classifyUrl(domain) {
  if (classifyCache.has(domain)) {
    console.log(`[Snitch classify] cache hit — ${domain} → ${classifyCache.get(domain) ? "BLOCK" : "allow"}`);
    return classifyCache.get(domain);
  }

  const prompt =
    `You are a focus session monitor. Using only your prior knowledge of the website "${domain}", ` +
    `decide if it is a distraction from productive work.\n\n` +
    `Block (YES): social media (Twitter/X, Instagram, TikTok, Facebook, Reddit), ` +
    `video/music streaming (YouTube, Netflix, Twitch, Spotify), online games, browser games, ` +
    `entertainment sites, gossip/tabloid news, shopping (Amazon, eBay).\n` +
    `Allow (NO): documentation, coding tools, GitHub, Stack Overflow, academic resources, ` +
    `productivity tools, work software, cloud consoles, email, search engines, news sites focused on tech/finance, ` +
    `any site you are not confident is primarily used for entertainment or leisure.\n` +
    `Do NOT consider page content — judge the site by what it is primarily known to be.\n` +
    `When unsure, answer NO. Only block sites you are highly confident are distractions.\n\n` +
    `Explain your reasoning in 1 sentence, then end your response with FINAL_ANSWER={YES} or FINAL_ANSWER={NO}.`;

  if (!GEMINI_API_KEY) {
    console.error("[Snitch classify] GEMINI_API_KEY is not set — config.js may not have loaded");
    return false;
  }

  console.log(`[Snitch classify] → Gemini  domain=${domain}`);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite-preview:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 200,
            temperature: 0,
          },
        }),
      }
    );
    if (!res.ok) {
      const errBody = await res.text();
      console.warn(`[Snitch classify] ✗ Gemini HTTP ${res.status} for ${domain}:`, errBody);
      return false;
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    console.log(`[Snitch classify] Gemini reasoning for ${domain}:\n${text}`);
    const match = text.match(/FINAL_ANSWER=\{(YES|NO)\}/i);
    const block = match ? match[1].toUpperCase() === "YES" : false;
    classifyCache.set(domain, block);
    console.log(`[Snitch classify] ← ${block ? "BLOCK" : "allow"}  ${domain}`);
    return block;
  } catch (err) {
    console.error(`[Snitch classify] Gemini call failed for ${domain}:`, err);
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

  // ── Camera alert from web app → in-page overlay + Chrome notification ───
  if (message.type === "SNITCH_ALERT") {
    chrome.storage.local.get(["activeSession"], (result) => {
      if (!result.activeSession) return;

      const now = Date.now();
      const isStrike = message.alertType === "strike";
      const categoryLabel =
        ALERT_CATEGORY_LABELS[message.category] || message.category;

      // Rate-limit warnings — don't spam every inference frame
      if (!isStrike) {
        if (now - lastWarningNotificationAt < WARNING_NOTIFICATION_COOLDOWN_MS) return;
        lastWarningNotificationAt = now;
      }

      const overlayTitle = isStrike ? "Strike Recorded" : "Heads Up";
      const overlayMsg = isStrike
        ? `${categoryLabel} detected. A strike has been added to your session.`
        : `${categoryLabel}. Refocus before it counts as a strike.`;

      // In-page overlay on the web app tab (highest priority)
      if (_sender?.tab?.id) {
        chrome.tabs.sendMessage(_sender.tab.id, {
          type: isStrike ? "SHOW_DISTRACTION_OVERLAY" : "SHOW_WARNING_OVERLAY",
          title: overlayTitle,
          message: overlayMsg,
          hostname: "",
        }).catch(() => {});
      }

      // Chrome notification as fallback
      chrome.notifications.create(`snitch-alert-${now}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: isStrike ? "Snitch — Strike Recorded" : "Snitch — Heads Up",
        message: overlayMsg,
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
  if (tab.url.startsWith("chrome-extension://") || tab.url.startsWith("chrome://")) return;

  const hostname = extractHostname(tab.url);
  if (!hostname) return;

  chrome.storage.local.get(
    ["blocklist", "visitLog", "blockingEnabled", "authToken", "activeSession"],
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

          // In-page overlay on the distraction tab (highest priority)
          chrome.tabs.sendMessage(tabId, {
            type: "SHOW_DISTRACTION_OVERLAY",
            hostname,
          }).catch(() => {});
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
      if (result.activeSession) {
        (async () => {
          const shouldAiBlock = await classifyUrl(hostname);
          if (!shouldAiBlock) return;

          // Flag as distraction but do not redirect — session is active
          if (!isFlagged) {
            reportDistraction(hostname, tab.url, result.authToken);
            notifyFrontendTabs({ type: "EXTENSION_DISTRACTION", hostname, url: tab.url });

            // In-page overlay on the distraction tab (highest priority)
            chrome.tabs.sendMessage(tabId, {
              type: "SHOW_DISTRACTION_OVERLAY",
              hostname,
            }).catch(() => {});

            chrome.notifications.create(`snitch-ai-${Date.now()}`, {
              type: "basic",
              iconUrl: "icons/icon128.png",
              title: "Snitch — Distraction Detected",
              message: `${hostname} was flagged as a distraction.`,
              priority: 2,
            });

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
