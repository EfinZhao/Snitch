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
const toggleLabel = document.getElementById("toggleLabel");

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

function loadAll() {
  chrome.storage.local.get(["blocklist", "visitLog", "blockingEnabled"], (result) => {
    const blocklist = result.blocklist || [];
    const visitLog = result.visitLog || [];

    updateStats(blocklist, visitLog);
    renderSites(blocklist);
    renderVisits(visitLog);

    blockToggle.checked = !!result.blockingEnabled;
    toggleLabel.textContent = result.blockingEnabled ? "Blocking" : "Block";
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

addBtn.addEventListener("click", addSite);
siteInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addSite();
});

blockToggle.addEventListener("change", () => {
  const enabled = blockToggle.checked;
  chrome.storage.local.set({ blockingEnabled: enabled });
  toggleLabel.textContent = enabled ? "Blocking" : "Block";
});

siteInput.addEventListener("focus", () => {
  siteInput.parentElement.classList.add("focused");
});

siteInput.addEventListener("blur", () => {
  siteInput.parentElement.classList.remove("focused");
});

loadAll();
