const siteInput = document.getElementById("siteInput");
const addBtn = document.getElementById("addBtn");
const inputError = document.getElementById("inputError");
const siteList = document.getElementById("siteList");
const emptyMsg = document.getElementById("emptyMsg");
const visitList = document.getElementById("visitList");
const emptyVisits = document.getElementById("emptyVisits");

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

  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
    .forEach((site) => {
      const li = document.createElement("li");
      li.className = "site-item";

      const span = document.createElement("span");
      span.className = "domain";
      span.textContent = site;

      const btn = document.createElement("button");
      btn.className = "remove-btn";
      btn.textContent = "\u00d7";
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

  visitLog.slice(0, 30).forEach((entry) => {
    const li = document.createElement("li");
    li.className = "visit-item";

    const urlSpan = document.createElement("span");
    urlSpan.className = "visit-url";
    urlSpan.textContent = entry.hostname || entry.url;

    const timeSpan = document.createElement("span");
    timeSpan.className = "visit-time";
    timeSpan.textContent = formatTimestamp(entry.timestamp);

    li.appendChild(urlSpan);
    li.appendChild(timeSpan);
    visitList.appendChild(li);
  });
}

function loadAll() {
  chrome.storage.local.get(["blocklist", "visitLog"], (result) => {
    renderSites(result.blocklist || []);
    renderVisits(result.visitLog || []);
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
    });
  });
}

function removeSite(domain) {
  chrome.storage.local.get(["blocklist"], (result) => {
    const blocklist = (result.blocklist || []).filter((s) => s !== domain);
    chrome.storage.local.set({ blocklist }, () => renderSites(blocklist));
  });
}

addBtn.addEventListener("click", addSite);
siteInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addSite();
});

loadAll();
