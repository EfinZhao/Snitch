let toastContainer = null;

function ensureContainer() {
  if (toastContainer) return;

  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;top:0;right:0;z-index:2147483647;pointer-events:none;";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Spline+Sans:wght@600;700&family=Be+Vietnam+Pro:wght@400;500&display=swap');

    .container {
      position: fixed;
      top: 16px;
      right: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    }

    .toast {
      pointer-events: all;
      display: flex;
      align-items: flex-start;
      gap: 11px;
      padding: 13px 14px 15px;
      border-radius: 12px;
      min-width: 290px;
      max-width: 340px;
      position: relative;
      overflow: hidden;
      font-family: 'Be Vietnam Pro', system-ui, sans-serif;
      box-shadow: 0 4px 24px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.08);
      animation: slideIn 0.28s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    }

    .toast.removing {
      animation: slideOut 0.2s ease forwards;
      pointer-events: none;
    }

    /* Distraction — red */
    .toast--distraction {
      background: #fff1f0;
      border: 1.5px solid #ba1a1a;
    }
    .toast--distraction::after {
      content: '';
      position: absolute;
      inset: 2px;
      border: 0.5px solid rgba(186,26,26,0.2);
      border-radius: 10px;
      pointer-events: none;
    }

    /* Warning — amber */
    .toast--warning {
      background: #fffbec;
      border: 1.5px solid #b45309;
    }
    .toast--warning::after {
      content: '';
      position: absolute;
      inset: 2px;
      border: 0.5px solid rgba(180,83,9,0.2);
      border-radius: 10px;
      pointer-events: none;
    }


    .icon {
      flex-shrink: 0;
      margin-top: 1px;
    }
    .icon--distraction { color: #ba1a1a; }
    .icon--warning     { color: #b45309; }


    .body { flex: 1; min-width: 0; }

    .title {
      font-family: 'Spline Sans', system-ui, sans-serif;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: -0.01em;
      line-height: 1.3;
      margin-bottom: 3px;
    }
    .title--distraction { color: #93000a; }
    .title--warning     { color: #92400e; }


    .message {
      font-size: 12px;
      color: #42474e;
      line-height: 1.45;
    }


    .wordmark {
      display: block;
      margin-top: 5px;
      font-family: 'Spline Sans', system-ui, sans-serif;
      font-size: 10px;
      font-weight: 600;
      font-style: italic;
      letter-spacing: -0.01em;
      color: #335f87;
    }


    .dismiss {
      flex-shrink: 0;
      background: none;
      border: none;
      cursor: pointer;
      padding: 2px;
      border-radius: 4px;
      color: #72777f;
      line-height: 0;
      transition: color 0.12s, background 0.12s;
      pointer-events: all;
      margin-top: -1px;
    }
    .dismiss:hover {
      color: #191c1d;
      background: rgba(0,0,0,0.07);
    }

    .progress {
      position: absolute;
      bottom: 0;
      left: 0;
      height: 2px;
      border-radius: 0 0 0 10px;
      animation: drain var(--dur, 6s) linear forwards;
    }
    .progress--distraction { background: #ba1a1a; }
    .progress--warning     { background: #b45309; }

    @keyframes slideIn {
      from { opacity: 0; transform: translateX(16px) scale(0.97); }
      to   { opacity: 1; transform: translateX(0)   scale(1);    }
    }
    @keyframes slideOut {
      from { opacity: 1; transform: translateX(0)   scale(1);    max-height: 120px; }
      to   { opacity: 0; transform: translateX(16px) scale(0.97); max-height: 0;     }
    }
    @keyframes drain {
      from { width: 100%; }
      to   { width: 0%;   }
    }
  `;

  toastContainer = document.createElement("div");
  toastContainer.className = "container";

  shadow.appendChild(style);
  shadow.appendChild(toastContainer);
}

function showToast({ type, title, message, duration = 7000 }) {
  ensureContainer();

  const iconSvg =
    type === "distraction"
      ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
      : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `
    <span class="icon icon--${type}">${iconSvg}</span>
    <div class="body">
      <div class="title title--${type}">${title}</div>
      <div class="message">${message}</div>
      <span class="wordmark">Snitch</span>
    </div>
    <button class="dismiss" aria-label="Dismiss">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
    <div class="progress progress--${type}" style="--dur:${duration}ms"></div>
  `;

  function remove() {
    toast.classList.add("removing");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  }

  const timer = setTimeout(remove, duration);
  toast.querySelector(".dismiss").addEventListener("click", () => {
    clearTimeout(timer);
    remove();
  }, { once: true });

  toastContainer.appendChild(toast);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SHOW_DISTRACTION_OVERLAY") {
    const body = message.message
      || (message.hostname
        ? `You visited <strong>${message.hostname}</strong> during your focus session. A strike has been logged.`
        : "A distraction was recorded in your focus session.");
    showToast({
      type: "distraction",
      title: message.title || "Distraction Detected",
      message: body,
      duration: 8000,
    });
  }

  if (message.type === "SHOW_WARNING_OVERLAY") {
    showToast({
      type: "warning",
      title: message.title || "Heads Up",
      message: message.message || "Refocus before it counts as a strike.",
      duration: 5000,
    });
  }
});
