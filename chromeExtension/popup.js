const API_BASE = "http://localhost:8000/api";

const siteInput = document.getElementById("siteInput");
const addBtn = document.getElementById("addBtn");
const inputError = document.getElementById("inputError");
const siteList = document.getElementById("siteList");
const emptyMsg = document.getElementById("emptyMsg");
const visitList = document.getElementById("visitList");
const emptyVisits = document.getElementById("emptyVisits");
const flaggedCount = document.getElementById("flaggedCount");
const todayCount = document.getElementById("todayCount");
const streakCount = document.getElementById("streakCount");
const siteCountBadge = document.getElementById("siteCountBadge");
const blockToggle = document.getElementById("blockToggle");
const blockToggleWrap = document.getElementById("blockToggleWrap");
const toggleLabel = document.getElementById("toggleLabel");
const sessionPanel = document.getElementById("sessionPanel");
const sessionTimeDisplay = document.getElementById("sessionTimeDisplay");
const arcProgress = document.getElementById("arcProgress");
const arcTicks = document.getElementById("arcTicks");
const sessionStrikesBadge = document.getElementById("sessionStrikesBadge");
const sessionAmountLabel = document.getElementById("sessionAmountLabel");

const loginView = document.getElementById("loginView");
const mainView = document.getElementById("mainView");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");
const logoutBtn = document.getElementById("logoutBtn");

function normalizeDomain(raw) {
  let d = raw.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/^www\./, "");
  d = d.replace(/\/.*$/, "");
  return d;
}

function showError(msg) {
  inputError.textContent = msg;
  inputError.classList.remove("hidden");
  setTimeout(() => inputError.classList.add("hidden"), 3000);
}

function formatTimestamp(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;

  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function countTodayVisits(visitLog) {
  if (!visitLog || visitLog.length === 0) return 0;
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return visitLog.filter((v) => v.timestamp >= startOfDay).length;
}

function calcStreak(visitLog) {
  if (!visitLog || visitLog.length === 0) return 0;

  const daySet = new Set();
  visitLog.forEach((v) => {
    const d = new Date(v.timestamp);
    daySet.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  });

  let streak = 0;
  const now = new Date();
  let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  while (true) {
    const key = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`;
    if (!daySet.has(key)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function updateStats(blocklist, visitLog) {
  const sites = blocklist ? blocklist.length : 0;
  const today = countTodayVisits(visitLog);
  const streak = calcStreak(visitLog);

  flaggedCount.textContent = sites;
  todayCount.textContent = today;
  streakCount.textContent = streak;
  siteCountBadge.textContent = sites;
}

function renderSites(blocklist) {
  siteList.innerHTML = "";

  if (blocklist.length === 0) {
    emptyMsg.classList.remove("hidden");
    return;
  }

  emptyMsg.classList.add("hidden");

  blocklist
    .slice()
    .sort()
    .forEach((site, i) => {
      const li = document.createElement("li");
      li.className = "site-item";
      li.style.animationDelay = `${i * 30}ms`;

      const span = document.createElement("span");
      span.className = "domain";

      const dot = document.createElement("span");
      dot.className = "domain-dot";
      span.appendChild(dot);

      const text = document.createTextNode(site);
      span.appendChild(text);

      const btn = document.createElement("button");
      btn.className = "remove-btn";
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      btn.title = "Remove";
      btn.addEventListener("click", () => removeSite(site));

      li.appendChild(span);
      li.appendChild(btn);
      siteList.appendChild(li);
    });
}

function renderVisits(visitLog) {
  visitList.innerHTML = "";

  if (!visitLog || visitLog.length === 0) {
    emptyVisits.classList.remove("hidden");
    return;
  }

  emptyVisits.classList.add("hidden");

  visitLog.slice(0, 20).forEach((entry, i) => {
    const li = document.createElement("li");
    li.className = "visit-item";
    li.style.animationDelay = `${i * 30}ms`;

    const left = document.createElement("div");
    left.className = "visit-left";

    const indicator = document.createElement("span");
    indicator.className = "visit-indicator";

    const urlSpan = document.createElement("span");
    urlSpan.className = "visit-url";
    urlSpan.textContent = entry.hostname || entry.url;

    left.appendChild(indicator);
    left.appendChild(urlSpan);

    const timeSpan = document.createElement("span");
    timeSpan.className = "visit-time";
    timeSpan.textContent = formatTimestamp(entry.timestamp);

    li.appendChild(left);
    li.appendChild(timeSpan);
    visitList.appendChild(li);
  });
}

// ── Session arc timer ─────────────────────────────────────────────────────

const ARC_R = 76;
const ARC_CX = 90;
const ARC_CY = 90;
const ARC_CIRCUMFERENCE = 2 * Math.PI * ARC_R; // ≈ 477.52

let sessionTimerInterval = null;

function formatSessionTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function arcFractionToPoint(fraction) {
  const angle = -Math.PI / 2 + fraction * 2 * Math.PI;
  return {
    x: ARC_CX - ARC_R * Math.cos(angle),
    y: ARC_CY + ARC_R * Math.sin(angle),
  };
}

function arcTrianglePoints(cx, cy, size) {
  size = size || 5;
  const inward = Math.sqrt((cx - ARC_CX) ** 2 + (cy - ARC_CY) ** 2);
  if (inward === 0) return "";
  const nx = (ARC_CX - cx) / inward;
  const ny = (ARC_CY - cy) / inward;
  const px = -ny;
  const py = nx;
  const tip = { x: cx + nx * size * 1.2, y: cy + ny * size * 1.2 };
  const l = { x: cx + px * size, y: cy + py * size };
  const r = { x: cx - px * size, y: cy - py * size };
  return `${tip.x},${tip.y} ${l.x},${l.y} ${r.x},${r.y}`;
}

function renderSessionArc(endEpoch, totalSeconds, fractions, distractionCount, amountCents) {
  const now = Date.now();
  const secondsRemaining = Math.max(0, Math.ceil((endEpoch - now) / 1000));
  const elapsed = Math.max(0, totalSeconds - secondsRemaining);
  const elapsedFraction = totalSeconds > 0 ? elapsed / totalSeconds : 0;
  const isFailed = distractionCount >= 3;

  // Countdown text
  sessionTimeDisplay.textContent = formatSessionTime(secondsRemaining);
  sessionTimeDisplay.style.color = isFailed ? "var(--error)" : "var(--primary)";

  // Arc — dashoffset = 0 means full ring visible; increase offset to "drain" it
  arcProgress.style.strokeDashoffset = elapsedFraction * ARC_CIRCUMFERENCE;
  arcProgress.style.stroke = isFailed ? "var(--error)" : "var(--primary)";

  // Tick marks (red triangles at each distraction's arc position)
  arcTicks.innerHTML = "";
  (fractions || []).forEach((fraction) => {
    const pt = arcFractionToPoint(fraction);
    const points = arcTrianglePoints(pt.x, pt.y);
    if (!points) return;
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    poly.setAttribute("points", points);
    poly.setAttribute("fill", "#ef4444");
    arcTicks.appendChild(poly);
  });

  // Meta row
  sessionStrikesBadge.textContent = `${distractionCount} / 3 strikes`;
  sessionStrikesBadge.style.color = isFailed ? "var(--error)" : "var(--on-surface-variant)";
  sessionAmountLabel.textContent = `$${(amountCents / 100).toFixed(2)} on the line`;

  if (secondsRemaining === 0) {
    clearInterval(sessionTimerInterval);
    sessionTimerInterval = null;
    updateSessionUI(false, null);
  }
}

function startSessionTimer(endEpoch, totalSeconds, fractions, distractionCount, amountCents) {
  clearInterval(sessionTimerInterval);
  renderSessionArc(endEpoch, totalSeconds, fractions, distractionCount, amountCents);
  sessionTimerInterval = setInterval(() => {
    renderSessionArc(endEpoch, totalSeconds, fractions, distractionCount, amountCents);
  }, 1000);
}

function updateSessionUI(activeSession, data) {
  if (activeSession && data && data.sessionEndEpoch) {
    sessionPanel.classList.remove("hidden");
    blockToggleWrap.classList.add("locked");
    blockToggle.checked = false;
    toggleLabel.textContent = "Locked";
    startSessionTimer(
      data.sessionEndEpoch,
      data.sessionTotalSeconds || 1500,
      data.sessionDistractionFractions || [],
      data.sessionDistractionCount || 0,
      data.sessionAmountCents || 0
    );
  } else {
    sessionPanel.classList.add("hidden");
    clearInterval(sessionTimerInterval);
    sessionTimerInterval = null;
    if (!activeSession) {
      blockToggleWrap.classList.remove("locked");
    }
  }
}

function loadAllData(result) {
  const blocklist = result.blocklist || [];
  const visitLog = result.visitLog || [];

  updateStats(blocklist, visitLog);
  renderSites(blocklist);
  renderVisits(visitLog);

  const isSession = !!result.activeSession;
  updateSessionUI(isSession, result);

  if (!isSession) {
    blockToggle.checked = !!result.blockingEnabled;
    toggleLabel.textContent = result.blockingEnabled ? "Blocking" : "Block";
  }
}

function loadAll() {
  // Ask background to check for active sessions right now (don't rely on stale storage)
  chrome.runtime.sendMessage({ type: "CHECK_SESSION" }, (response) => {
    // Then load all data from storage
    chrome.storage.local.get(
      [
        "blocklist", "visitLog", "blockingEnabled", "activeSession",
        "sessionEndEpoch", "sessionTotalSeconds", "sessionDistractionCount",
        "sessionDistractionFractions", "sessionAmountCents",
      ],
      loadAllData
    );
  }).catch(() => {
    // Fallback if message fails
    chrome.storage.local.get(
      [
        "blocklist", "visitLog", "blockingEnabled", "activeSession",
        "sessionEndEpoch", "sessionTotalSeconds", "sessionDistractionCount",
        "sessionDistractionFractions", "sessionAmountCents",
      ],
      loadAllData
    );
  });
}

function addSite() {
  const domain = normalizeDomain(siteInput.value);

  if (!domain) {
    showError("Enter a domain name.");
    return;
  }

  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    showError("Invalid domain format.");
    return;
  }

  chrome.storage.local.get(["blocklist"], (result) => {
    const blocklist = result.blocklist || [];

    if (blocklist.includes(domain)) {
      showError("Already on the list.");
      return;
    }

    blocklist.push(domain);
    chrome.storage.local.set({ blocklist }, () => {
      siteInput.value = "";
      renderSites(blocklist);
      updateStats(blocklist, null);
      chrome.storage.local.get(["visitLog"], (r) => {
        updateStats(blocklist, r.visitLog || []);
      });
    });
  });
}

function removeSite(domain) {
  chrome.storage.local.get(["blocklist", "visitLog"], (result) => {
    const blocklist = (result.blocklist || []).filter((s) => s !== domain);
    chrome.storage.local.set({ blocklist }, () => {
      renderSites(blocklist);
      updateStats(blocklist, result.visitLog || []);
    });
  });
}

function showView(loggedIn) {
  if (loggedIn) {
    loginView.classList.add("hidden");
    mainView.classList.remove("hidden");
    blockToggleWrap.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
  } else {
    loginView.classList.remove("hidden");
    mainView.classList.add("hidden");
    blockToggleWrap.classList.add("hidden");
    logoutBtn.classList.add("hidden");
  }
}

function showLoginError(msg) {
  loginError.textContent = msg;
  loginError.classList.remove("hidden");
  setTimeout(() => loginError.classList.add("hidden"), 4000);
}

async function handleLogin() {
  const email = loginEmail.value.trim();
  const password = loginPassword.value;

  if (!email || !password) {
    showLoginError("Enter your email and password.");
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "SIGNING IN…";

  try {
    const body = new URLSearchParams({ username: email, password });
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      body,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.detail || "Login failed");
    }

    const { access_token } = await res.json();
    chrome.storage.local.set({ authToken: access_token, authEmail: email }, () => {
      showView(true);
      loadAll();
    });
  } catch (err) {
    showLoginError(err.message);
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "SIGN IN";
  }
}

function handleLogout() {
  chrome.storage.local.remove(["authToken", "authEmail"], () => {
    loginEmail.value = "";
    loginPassword.value = "";
    showView(false);
  });
}

addBtn.addEventListener("click", addSite);
siteInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addSite();
});

blockToggle.addEventListener("change", () => {
  const enabled = blockToggle.checked;
  chrome.storage.local.set({ blockingEnabled: enabled });
  toggleLabel.textContent = enabled ? "Blocking" : "Block";
});

loginBtn.addEventListener("click", handleLogin);
loginPassword.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleLogin();
});
logoutBtn.addEventListener("click", handleLogout);

siteInput.addEventListener("focus", () => {
  siteInput.parentElement.classList.add("focused");
});

siteInput.addEventListener("blur", () => {
  siteInput.parentElement.classList.remove("focused");
});

chrome.storage.local.get(["authToken"], (result) => {
  const loggedIn = !!result.authToken;
  showView(loggedIn);
  if (loggedIn) loadAll();
});

// React to session state changes while the popup is open
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if ("activeSession" in changes) {
    const isActive = !!changes.activeSession.newValue;
    if (!isActive) {
      updateSessionUI(false, null);
      chrome.storage.local.get(["blockingEnabled"], (r) => {
        blockToggle.checked = !!r.blockingEnabled;
        toggleLabel.textContent = r.blockingEnabled ? "Blocking" : "Block";
      });
    }
  }

  // Refresh arc when strike data updates mid-session
  const sessionDataKeys = ["sessionDistractionFractions", "sessionDistractionCount", "sessionAmountCents"];
  if (sessionDataKeys.some((k) => k in changes)) {
    chrome.storage.local.get(
      ["activeSession", "sessionEndEpoch", "sessionTotalSeconds", "sessionDistractionCount", "sessionDistractionFractions", "sessionAmountCents"],
      (result) => {
        if (result.activeSession) updateSessionUI(true, result);
      }
    );
  }
});
