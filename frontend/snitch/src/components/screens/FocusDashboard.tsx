import { useState, useEffect, useRef } from "react";
import Button from "../atoms/Button";
import { apiPost, apiGet, apiPatch, ApiError } from "../../api/client";
import type { CameraMonitorState } from "../../hooks/useCameraMonitor";
import type { Screen, UserProfile, SessionRead } from "../../types";

const DEFAULT_SECONDS = 25 * 60;
const CX = 160,
  CY = 160,
  R = 148;
const MAX_STRIKES = 3;
const SYNC_INTERVAL_MS = 30_000;
const AWAY_LIMIT_MS = 30_000;
const SESSION_KEY = "snitch_session";
const AWAY_KEY = "snitch_away_at";
interface SessionSyncData {
  endEpoch: number
  totalSeconds: number
  distractionCount: number
  distractionFractions: number[]
  amountCents: number
}
function notifyExtension(active: boolean, sessionData?: SessionSyncData) {
  window.dispatchEvent(
    new CustomEvent("snitch-session", { detail: { active, ...(sessionData ?? {}) } }),
  );
}

function formatTime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function parseInput(raw: string): number | null {
  const minutes = parseFloat(raw.trim());
  if (isNaN(minutes) || minutes <= 0) return null;
  return Math.round(minutes * 60);
}

function fractionToPoint(fraction: number) {
  const angle = -fraction * 2 * Math.PI;
  return { x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle) };
}

function trianglePoints(cx: number, cy: number, size = 7): string {
  const inward = Math.sqrt((cx - CX) ** 2 + (cy - CY) ** 2);
  const nx = (CX - cx) / inward;
  const ny = (CY - cy) / inward;
  const px = -ny,
    py = nx;
  const tip = { x: cx + nx * size * 1.2, y: cy + ny * size * 1.2 };
  const l = { x: cx + px * size, y: cy + py * size };
  const r = { x: cx - px * size, y: cy - py * size };
  return `${tip.x},${tip.y} ${l.x},${l.y} ${r.x},${r.y}`;
}

type Recipient = { username: string };
type SearchResult = { id: number; username: string };

type PersistedSession = {
  sessionId: number;
  endEpoch: number; // absolute ms timestamp when the timer expires
  durationSeconds: number;
  amountCents: number;
  recipientUsernames: string[];
  distractionFractions: number[];
};

type SummaryData = {
  outcome: "completed" | "failed";
  reason: string;
  amountCents: number;
  strikes: number;
  totalSeconds: number;
  elapsedSeconds: number;
};

interface Props {
  navigate: (screen: Screen) => void;
  token: string;
  user: UserProfile;
  cameraMonitor: CameraMonitorState;
}

export default function FocusDashboard({ token, user, cameraMonitor }: Props) {
  const [totalSeconds, setTotalSeconds] = useState(DEFAULT_SECONDS);
  const [seconds, setSeconds] = useState(DEFAULT_SECONDS);
  const [running, setRunning] = useState(false);
  const [pendingRun, setPendingRun] = useState(false);
  const pendingEndEpochRef = useRef(0);
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const committingRef = useRef(false);

  const [distractions, setDistractions] = useState<number[]>([]);
  const [amountCents, setAmountCents] = useState(0);

  // Sessions / session
  const [amount, setAmount] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [locking, setLocking] = useState(false);
  const [lockError, setLockError] = useState("");

  // Post-session summary
  const [summary, setSummary] = useState<SummaryData | null>(null);

  // Add recipient modal
  const [showModal, setShowModal] = useState(false);
  const [recipientInput, setRecipientInput] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for stale-closure-safe event handlers (set up with [] deps)
  const sessionIdRef = useRef<number | null>(null);
  const secondsRef = useRef(DEFAULT_SECONDS);
  const totalSecondsRef = useRef(DEFAULT_SECONDS);
  const distractionsRef = useRef<number[]>([]);
  const amountCentsRef = useRef(0);
  const tokenRef = useRef(token);
  const startCameraRef = useRef(cameraMonitor.startCamera);
  const stopCameraRef = useRef(cameraMonitor.stopCamera);
  const handleExternalStrikeRef = useRef(cameraMonitor.handleExternalStrike);

  // Keep refs in sync after every render
  useEffect(() => {
    sessionIdRef.current = sessionId;
    secondsRef.current = seconds;
    totalSecondsRef.current = totalSeconds;
    distractionsRef.current = distractions;
    amountCentsRef.current = amountCents;
    tokenRef.current = token;
    startCameraRef.current = cameraMonitor.startCamera;
    stopCameraRef.current = cameraMonitor.stopCamera;
    handleExternalStrikeRef.current = cameraMonitor.handleExternalStrike;
  });

  // Once camera is active and models are loaded (or failed), start the timer
  useEffect(() => {
    if (!pendingRun) return;
    const ls = cameraMonitor.loadingState;
    const perm = cameraMonitor.permission;
    if (ls !== "ready" && ls !== "error" && perm !== "denied") return;
    const rem = Math.max(1, Math.floor((pendingEndEpochRef.current - Date.now()) / 1000));
    setSeconds(rem);
    setRunning(true);
    setPendingRun(false);
  }, [pendingRun, cameraMonitor.loadingState, cameraMonitor.permission]);

  // ── Session recovery on mount ───────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    let session: PersistedSession;
    try {
      session = JSON.parse(raw);
    } catch {
      localStorage.removeItem(SESSION_KEY);
      return;
    }

    const now = Date.now();
    const awayAtStr = localStorage.getItem(AWAY_KEY);

    const remaining = Math.max(0, Math.floor((session.endEpoch - now) / 1000));

    if (awayAtStr) {
      const awayMs = now - parseInt(awayAtStr);
      localStorage.removeItem(AWAY_KEY);
      if (awayMs > AWAY_LIMIT_MS) {
        localStorage.removeItem(SESSION_KEY);
        const elapsed = session.durationSeconds - remaining;
        /* eslint-disable react-hooks/set-state-in-effect */
        setSummary({
          outcome: "failed",
          reason: "You left the session for more than 30 seconds.",
          amountCents: session.amountCents,
          strikes: session.distractionFractions.length,
          totalSeconds: session.durationSeconds,
          elapsedSeconds: elapsed,
        });
        /* eslint-enable react-hooks/set-state-in-effect */
        notifyExtension(false);
        apiPost(
          `/sessions/${session.sessionId}/resolve`,
          { elapsed_seconds: elapsed },
          token,
        ).catch(() => {});
        return;
      }
    }

    if (remaining <= 0) {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(AWAY_KEY);
      /* eslint-disable react-hooks/set-state-in-effect */
      setSummary({
        outcome: "completed",
        reason: "Timer finished while you were away.",
        amountCents: session.amountCents,
        strikes: session.distractionFractions.length,
        totalSeconds: session.durationSeconds,
        elapsedSeconds: session.durationSeconds,
      });
      /* eslint-enable react-hooks/set-state-in-effect */
      notifyExtension(false);
      apiPost(
        `/sessions/${session.sessionId}/resolve`,
        { elapsed_seconds: session.durationSeconds },
        token,
      ).catch(() => {});
      return;
    }
    /* eslint-disable react-hooks/set-state-in-effect */
    setSessionId(session.sessionId);
    setTotalSeconds(session.durationSeconds);
    setSeconds(remaining);
    setDistractions(session.distractionFractions);
    setAmount((session.amountCents / 100).toFixed(2));
    setAmountCents(session.amountCents);
    setRecipients(session.recipientUsernames.map((u) => ({ username: u })));
    pendingEndEpochRef.current = session.endEpoch;
    startCameraRef.current().catch(() => {});
    setPendingRun(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // ── Visibility / beforeunload tracking ─────────────────────────────────
  useEffect(() => {
    function handleVisible() {
      const awayAtStr = localStorage.getItem(AWAY_KEY);
      if (!awayAtStr || sessionIdRef.current === null) {
        localStorage.removeItem(AWAY_KEY);
        return;
      }
      const awayMs = Date.now() - parseInt(awayAtStr);
      localStorage.removeItem(AWAY_KEY);

      if (awayMs > AWAY_LIMIT_MS) {
        const id = sessionIdRef.current;
        // Compute elapsed from endEpoch so it's accurate regardless of how long we were away
        let elapsed = totalSecondsRef.current - secondsRef.current;
        const raw = localStorage.getItem(SESSION_KEY);
        if (raw) {
          try {
            const s: PersistedSession = JSON.parse(raw);
            const rem = Math.max(
              0,
              Math.floor((s.endEpoch - Date.now()) / 1000),
            );
            elapsed = s.durationSeconds - rem;
          } catch {}
        }
        localStorage.removeItem(SESSION_KEY);
        setSummary({
          outcome: "failed",
          reason: "You left the session for more than 30 seconds.",
          amountCents: amountCentsRef.current,
          strikes: distractionsRef.current.length,
          totalSeconds: totalSecondsRef.current,
          elapsedSeconds: elapsed,
        });
        setRunning(false);
        setSessionId(null);
        stopCameraRef.current();
        apiPost(
          `/sessions/${id}/resolve`,
          { elapsed_seconds: elapsed },
          tokenRef.current,
        ).catch(() => {});
      } else {
        // Recompute remaining from endEpoch — source of truth
        const raw = localStorage.getItem(SESSION_KEY);
        if (raw) {
          try {
            const s: PersistedSession = JSON.parse(raw);
            const corrected = Math.max(
              0,
              Math.floor((s.endEpoch - Date.now()) / 1000),
            );
            setSeconds(corrected);
          } catch {}
        }
      }
    }

    function handleVisibilityChange() {
      // Camera keeps running in background tabs — only penalize actual tab closes (beforeunload)
      if (document.visibilityState === "visible") handleVisible();
    }

    function handleBeforeUnload() {
      if (sessionIdRef.current !== null) {
        localStorage.setItem(AWAY_KEY, String(Date.now()));
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const currentStatus = cameraMonitor.currentStatus;

  // ── Watch camera events for new distraction arc marks ──────────────────
  const lastProcessedEventIdRef = useRef(-1);
  useEffect(() => {
    const latest = cameraMonitor.events[0];
    if (!latest || latest.stage !== "distracted") return;
    if (latest.id <= lastProcessedEventIdRef.current) return;
    if (!sessionIdRef.current) return;
    lastProcessedEventIdRef.current = latest.id;
    addArcMark();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraMonitor.events]);

  // ── Extension distraction listener ─────────────────────────────────────
  // The Chrome extension posts blocked-site visits directly to the backend;
  // this listener receives the relay from content.js and updates the UI.
  useEffect(() => {
    function onExtensionDistraction() {
      if (!sessionIdRef.current) return;
      handleExternalStrikeRef.current("blocked_site");
      // Arc mark is added by the camera-events effect above when the new event lands
    }
    window.addEventListener("snitch-distraction", onExtensionDistraction);
    return () => window.removeEventListener("snitch-distraction", onExtensionDistraction);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Push session state to extension whenever it changes ────────────────
  useEffect(() => {
    if (!running || sessionId === null) return;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      const session: PersistedSession | null = raw ? JSON.parse(raw) : null;
      notifyExtension(true, {
        endEpoch: session?.endEpoch ?? Date.now() + seconds * 1000,
        totalSeconds,
        distractionCount: distractions.length,
        distractionFractions: distractions,
        amountCents,
      });
    } catch { /* ignore */ }
  // seconds intentionally excluded — we only need to sync on structural changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, sessionId, distractions, totalSeconds, amountCents]);

  // ── Timer tick ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (running && seconds > 0) {
      intervalRef.current = setInterval(() => {
        setSeconds(Math.max(0, Math.floor((pendingEndEpochRef.current - Date.now()) / 1000)));
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running, seconds]);

  // ── Auto-resolve when timer reaches 0 ──────────────────────────────────
  useEffect(() => {
    if (!running || seconds !== 0 || sessionId === null) return;
    const id = sessionId;
    const total = totalSeconds;
    const cents = amountCents;
    const strikes = distractions.length;
    const outcome = strikes >= MAX_STRIKES ? "failed" : "completed";
    const reason =
      outcome === "completed"
        ? "You stayed focused the whole time."
        : "Too many distractions.";
    /* eslint-disable react-hooks/set-state-in-effect */
    setRunning(false);
    setSessionId(null);
    setSummary({ outcome, reason, amountCents: cents, strikes, totalSeconds: total, elapsedSeconds: total });
    /* eslint-enable react-hooks/set-state-in-effect */
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(AWAY_KEY);
    stopCameraRef.current();
    notifyExtension(false);
    apiPost(`/sessions/${id}/resolve`, { outcome, elapsed_seconds: total }, token).catch(() => {});
  }, [
    running,
    seconds,
    sessionId,
    totalSeconds,
    token,
    amountCents,
    distractions.length,
  ]);

  // ── Periodic progress sync ──────────────────────────────────────────────
  useEffect(() => {
    if (!running || sessionId === null) return;
    const id = setInterval(() => {
      const elapsed = totalSeconds - seconds;
      apiPatch(
        `/sessions/${sessionId}`,
        { distraction_count: distractions.length, elapsed_seconds: elapsed },
        token,
      ).catch(() => {});
      // Keep distractions in localStorage up to date
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        try {
          const session: PersistedSession = JSON.parse(raw);
          session.distractionFractions = distractions;
          localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        } catch {}
      }
    }, SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [running, sessionId, distractions, seconds, totalSeconds, token]);

  // ── Time editing ────────────────────────────────────────────────────────
  function startEditing() {
    if (running) return;
    committingRef.current = false;
    setInputVal("");
    setEditing(true);
  }

  function commitEdit(val: string) {
    if (committingRef.current) return;
    committingRef.current = true;
    const parsed = parseInput(val);
    if (parsed !== null && parsed > 0) {
      setTotalSeconds(parsed);
      setSeconds(parsed);
    }
    setEditing(false);
    setInputVal("");
  }

  function handleInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commitEdit(inputVal);
    if (e.key === "Escape") {
      committingRef.current = true;
      setEditing(false);
      setInputVal("");
    }
  }

  function addArcMark() {
    const fraction =
      (totalSecondsRef.current - secondsRef.current) / totalSecondsRef.current;
    setDistractions((prev) => {
      const updated = [...prev, fraction];
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        try {
          const session: PersistedSession = JSON.parse(raw);
          session.distractionFractions = updated;
          localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        } catch {}
      }
      return updated;
    });
  }

  // ── Recipient search ────────────────────────────────────────────────────
  function openModal() {
    setRecipientInput("");
    setSearchResults([]);
    setShowModal(true);
  }
  function closeModal() {
    setShowModal(false);
    setRecipientInput("");
    setSearchResults([]);
  }

  function handleRecipientInputChange(val: string) {
    const clean = val.replace(/\s/g, "");
    setRecipientInput(clean);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (clean.length < 1) {
      setSearchResults([]);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await apiGet<SearchResult[]>(
          `/users/search?q=${encodeURIComponent(clean)}`,
          token,
        );
        setSearchResults(
          results.filter(
            (r) =>
              r.username !== user.username &&
              !recipients.some((rec) => rec.username === r.username),
          ),
        );
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  function addRecipient(username: string) {
    const clean = username.trim().replace(/^@/, "");
    if (!clean) return;
    const found = searchResults.find(
      (r) => r.username.toLowerCase() === clean.toLowerCase(),
    );
    if (!found) return;
    if (
      !recipients.some((r) => r.username.toLowerCase() === clean.toLowerCase())
    ) {
      setRecipients((prev) => [...prev, { username: found.username }]);
    }
    closeModal();
  }

  function removeRecipient(username: string) {
    setRecipients((prev) => prev.filter((r) => r.username !== username));
  }

  // ── Lock In → create + activate session ──────────────────────────────────
  async function handleLockIn() {
    setLockError("");
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setLockError("Enter an amount greater than $0.");
      return;
    }
    if (recipients.length === 0) {
      setLockError("Add at least one recipient.");
      return;
    }

    const cents = Math.round(amountNum * 100);
    setLocking(true);
    try {
      const session = await apiPost<SessionRead>(
        "/sessions",
        {
          amount_cents: cents,
          duration_seconds: totalSeconds,
          recipient_usernames: recipients.map((r) => r.username),
        },
        token,
      );
      await apiPost<SessionRead>(`/sessions/${session.id}/activate`, {}, token);
      setAmountCents(cents);
      setSessionId(session.id);
      // Request camera permission before starting the timer
      await startCameraRef.current();
      // endEpoch is set after camera is granted so model-loading time isn't counted
      const endEpoch = Date.now() + totalSeconds * 1000;
      pendingEndEpochRef.current = endEpoch;
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          sessionId: session.id,
          endEpoch,
          durationSeconds: totalSeconds,
          amountCents: cents,
          recipientUsernames: recipients.map((r) => r.username),
          distractionFractions: [],
        } satisfies PersistedSession),
      );
      localStorage.removeItem(AWAY_KEY);
      setLocking(false);
      setPendingRun(true);
    } catch (err) {
      setLocking(false)
      if (err instanceof ApiError) {
        if (err.status === 400) setLockError(err.message);
        else if (err.status === 404)
          setLockError("One or more recipients not found.");
        else setLockError("Could not start session. Try again.");
      } else {
        setLockError("Could not reach the server.");
      }
    }
  }

  function dismissSummary() {
    stopCameraRef.current();
    setSummary(null);
    setDistractions([]);
    setAmountCents(0);
    setAmount("");
    setRecipients([]);
    setSeconds(DEFAULT_SECONDS);
    setTotalSeconds(DEFAULT_SECONDS);
  }

  const circumference = 2 * Math.PI * R;
  const elapsed = (totalSeconds - seconds) / totalSeconds;

  const arcColor =
    currentStatus === "distracted"
      ? "#ef4444"
      : currentStatus === "warning"
        ? "#eab308"
        : "var(--color-primary-fixed-dim)";

  const canAddRecipient = searchResults.some(
    (r) => r.username.toLowerCase() === recipientInput.trim().toLowerCase(),
  );

  return (
    <div className="flex flex-col items-center px-8 py-10 gap-8 max-w-4xl mx-auto w-full">

      {/* Timer circle */}
      <div className="relative flex items-center justify-center mt-2">
        <div
          className="absolute rounded-full border-2 border-dashed border-outline-variant opacity-40"
          style={{ width: "348px", height: "348px" }}
        />
        <svg
          width="320"
          height="320"
          className="absolute pointer-events-none"
          style={{ transform: "rotate(-90deg) scaleX(1)" }}
        >
          <circle
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            stroke="var(--color-outline-variant)"
            strokeWidth="10"
            opacity="0.3"
          />
          <circle
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            stroke={arcColor}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={elapsed * circumference}
            style={{ transition: "stroke 0.4s ease" }}
          />
          {distractions.map((fraction, i) => {
            const pt = fractionToPoint(fraction);
            return (
              <polygon key={i} points={trianglePoints(pt.x, pt.y)} fill="#ef4444" />
            );
          })}
        </svg>

        <div
          className="flex flex-col items-center justify-center rounded-full bg-white shadow-lg relative z-10"
          style={{ width: "272px", height: "272px" }}
        >
          {editing ? (
            <input
              ref={(el) => { el?.focus(); }}
              type="text"
              inputMode="decimal"
              value={inputVal}
              placeholder="25"
              onChange={(e) => setInputVal(e.target.value.replace(/[^\d.]/g, ""))}
              onKeyDown={handleInputKey}
              onBlur={() => commitEdit(inputVal)}
              className="w-28 text-center font-display font-semibold text-5xl text-primary tabular-nums bg-transparent outline-none border-b-2 border-primary"
            />
          ) : (
            <button
              onClick={startEditing}
              disabled={running}
              className={[
                "font-display font-semibold text-5xl tabular-nums disabled:cursor-default transition-colors duration-300",
                running && (distractions.length >= MAX_STRIKES || currentStatus === "distracted")
                  ? "text-error"
                  : running && currentStatus === "warning"
                    ? "text-yellow-500"
                    : "text-primary",
              ].join(" ")}
            >
              {formatTime(seconds)}
            </button>
          )}
          <span className="text-on-surface-variant text-[11px] mt-2 tracking-widest uppercase font-body">
            {editing
              ? "minutes"
              : running
                ? (distractions.length > 0
                  ? `${distractions.length} distraction${distractions.length > 1 ? "s" : ""}`
                  : currentStatus === "warning"
                    ? "⚠ warning"
                    : "session active")
                : "deep focus session"}
          </span>
        </div>
      </div>

      {/* Info cards */}
      <div className="flex gap-5 w-full max-w-2xl">

        {/* On the line */}
        <div className="flex-1 bg-white/90 rounded-2xl border border-outline-variant p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="font-body text-sm text-on-surface-variant font-medium">On the line</span>
            <div className="w-7 h-7 rounded-full bg-primary-fixed flex items-center justify-center flex-shrink-0">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
              </svg>
            </div>
          </div>
          <div className="font-display font-bold text-3xl text-on-surface tabular-nums mb-1">
            ${amount || "0.00"}
          </div>
          {!running ? (
            <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-outline-variant">
              <span className="font-body text-on-surface-variant text-xs">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="bg-transparent font-body text-sm text-on-surface w-20 outline-none placeholder:text-outline-variant tabular-nums"
              />
              <span className="font-body text-xs text-on-surface-variant">on the line</span>
            </div>
          ) : (
            <p className="font-body text-xs text-on-surface-variant">
              Stake increases as you complete goals
            </p>
          )}
        </div>

        {/* Doubters */}
        <div className="flex-1 bg-white/90 rounded-2xl border border-outline-variant p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="font-body text-sm text-on-surface-variant font-medium">Doubters</span>
            {!running && (
              <button
                onClick={openModal}
                className="w-7 h-7 rounded-full bg-primary-fixed flex items-center justify-center hover:bg-primary-container transition-colors flex-shrink-0"
                title="Add doubter"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <line x1="19" y1="8" x2="19" y2="14" />
                  <line x1="22" y1="11" x2="16" y2="11" />
                </svg>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {recipients.map(({ username }, i) => {
              const sessionFailed = running && distractions.length >= MAX_STRIKES;
              const base = Math.floor(amountCents / recipients.length);
              const share = i === recipients.length - 1
                ? amountCents - base * (recipients.length - 1)
                : base;
              return (
                <div key={username} className="flex flex-col items-center gap-0.5">
                  <button
                    onClick={() => { if (!running) removeRecipient(username); }}
                    title={running ? `@${username}` : `@${username} — click to remove`}
                    className={[
                      "w-10 h-10 rounded-full border-2 flex items-center justify-center text-xs font-display font-semibold transition-colors duration-300",
                      sessionFailed
                        ? "border-error bg-error-container text-on-error-container"
                        : "border-primary bg-primary-fixed text-primary",
                    ].join(" ")}
                  >
                    {username.slice(0, 2).toUpperCase()}
                  </button>
                  {running && sessionFailed && (
                    <span className="font-display font-semibold text-[10px] tabular-nums text-error">
                      ${(share / 100).toFixed(2)}
                    </span>
                  )}
                </div>
              );
            })}
            {!running && (
              <button
                onClick={openModal}
                className="w-10 h-10 rounded-full border-2 border-dashed border-outline-variant flex items-center justify-center text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
              >
                +
              </button>
            )}
          </div>
          <p className="font-body text-xs text-on-surface-variant mt-3">
            {recipients.length === 0
              ? "Add people to hold you accountable"
              : `${recipients.length} ${recipients.length === 1 ? "person" : "people"} waiting for you to fail`}
          </p>
        </div>
      </div>

      {lockError && (
        <p className="font-body text-sm text-error text-center max-w-xs">
          {lockError}
        </p>
      )}

      {running ? (
        <div className="flex items-center justify-center gap-2 font-body text-sm text-on-surface-variant">
          <span className="w-2 h-2 rounded-full bg-error animate-pulse flex-shrink-0" />
          Session in progress — stay focused
        </div>
      ) : pendingRun ? (
        <div className="flex items-center justify-center gap-2 font-body text-sm text-on-surface-variant">
          <svg className="animate-spin flex-shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
          Loading detection models… ({cameraMonitor.loadingStep}/4)
        </div>
      ) : (
        <Button
          variant="primary"
          onClick={handleLockIn}
          disabled={locking}
          className="min-w-[200px] !rounded-full !py-4 !text-base !tracking-wider"
        >
          {locking ? "Starting…" : "Lock In"}
        </Button>
      )}

      {import.meta.env.DEV && running && (
        <button
          onClick={() => { addArcMark(); }}
          className="text-xs text-error border border-error rounded px-3 py-1 opacity-60 hover:opacity-100 transition-opacity"
        >
          [dev] distracted
        </button>
      )}

      <p className="font-body text-xs text-on-surface-variant opacity-50 pb-2">
        Snitch Engine v1.0 • Active Monitoring {running ? "Enabled" : "Standby"}
      </p>

      {/* Add recipient modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-72 bg-surface rounded-2xl px-6 pt-6 pb-6 flex flex-col gap-4 shadow-xl">
            <h2 className="font-display font-semibold text-xl text-on-surface">
              Add Recipient
            </h2>

            <div className="flex items-center gap-2 border-b-2 border-primary pb-2">
              <span className="font-body text-on-surface-variant">@</span>
              <input
                ref={(el) => { el?.focus(); }}
                type="text"
                placeholder="username"
                value={recipientInput}
                onChange={(e) => handleRecipientInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addRecipient(recipientInput);
                  if (e.key === "Escape") closeModal();
                }}
                className="flex-1 bg-transparent font-body text-lg text-on-surface outline-none placeholder:text-outline-variant"
              />
              {searching && (
                <svg
                  className="animate-spin text-primary flex-shrink-0"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
              )}
            </div>

            {searchResults.length > 0 && (
              <div className="flex flex-col gap-1 max-h-40 overflow-y-auto -mx-2">
                {searchResults.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => addRecipient(r.username)}
                    className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-container transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-full bg-primary-fixed border border-primary flex items-center justify-center text-xs font-display font-semibold text-primary flex-shrink-0">
                      {r.username.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="font-body text-sm text-on-surface">
                      @{r.username}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {recipientInput.trim() && !searching && searchResults.length === 0 && (
              <p className="font-body text-xs text-on-surface-variant text-center">
                No users found.
              </p>
            )}

            <div className="flex gap-3">
              <Button variant="ghost" fullWidth onClick={closeModal}>
                Cancel
              </Button>
              <Button
                variant="primary"
                fullWidth
                onClick={() => addRecipient(recipientInput)}
                disabled={!canAddRecipient}
              >
                Add
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Session summary overlay */}
      {summary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative w-full max-w-sm mx-4 bg-surface rounded-3xl px-6 pt-8 pb-6 flex flex-col gap-5 shadow-2xl">
            <div className="text-center">
              <div className={`text-5xl mb-3 font-bold ${summary.outcome === "completed" ? "text-primary" : "text-error"}`}>
                {summary.outcome === "completed" ? "✓" : "✗"}
              </div>
              <h2 className="font-display font-bold text-2xl text-on-surface">
                {summary.outcome === "completed" ? "Session Complete" : "Session Failed"}
              </h2>
              <p className="font-body text-sm text-on-surface-variant mt-1">
                {summary.reason}
              </p>
            </div>

            <div className="flex flex-col gap-3 bg-surface-container rounded-2xl px-4 py-4">
              <SummaryRow
                label="Time focused"
                value={`${formatTime(Math.max(0, summary.elapsedSeconds - summary.strikes * 10))} / ${formatTime(summary.totalSeconds)}`}
              />
              <SummaryRow label="Distractions" value={String(summary.strikes)} />
              <SummaryRow
                label={summary.outcome === "completed" ? "Amount kept" : "Amount lost"}
                value={`$${(summary.amountCents / 100).toFixed(2)}`}
                valueClass={summary.outcome === "completed" ? "text-primary" : "text-error"}
              />
              {summary.outcome === "failed" && recipients.length > 0 && (
                <>
                  <div className="border-t border-outline-variant" />
                  <div className="flex items-start justify-around gap-2 flex-wrap">
                    {recipients.map(({ username }, i) => {
                      const base = Math.floor(summary.amountCents / recipients.length);
                      const share = i === recipients.length - 1
                        ? summary.amountCents - base * (recipients.length - 1)
                        : base;
                      return (
                        <div key={username} className="flex flex-col items-center gap-1">
                          <div className="w-10 h-10 rounded-full border-2 border-error bg-error-container flex items-center justify-center text-xs font-display font-semibold text-on-error-container">
                            {username.slice(0, 2).toUpperCase()}
                          </div>
                          <span className="font-body text-xs text-on-surface-variant">
                            @{username}
                          </span>
                          <span className="font-display font-semibold text-sm text-error">
                            ${(share / 100).toFixed(2)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <Button variant="primary" fullWidth onClick={dismissSummary}>
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  valueClass = "text-on-surface",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="font-body text-sm text-on-surface-variant">{label}</span>
      <span className={`font-display font-semibold ${valueClass}`}>
        {value}
      </span>
    </div>
  );
}
