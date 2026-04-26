import { useState, useEffect } from "react";
import FocusDashboard from "./components/screens/FocusDashboard";
import FocusStats from "./components/screens/FocusStats";
import FocusSettings from "./components/screens/FocusSettings";
import DistractionMonitor from "./components/screens/DistractionMonitor";
import AuthScreen from "./components/screens/AuthScreen";
import StripeCardForm from "./components/StripeCardForm";
import { useCameraMonitor } from "./hooks/useCameraMonitor";
import { apiGet, apiPost } from "./api/client";
import type { Screen, StakeRead, UserProfile } from "./types";

const NAV = [
  {
    id: "dashboard" as Screen,
    label: "Home",
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
        <path d="M9 21V12h6v9" />
      </svg>
    ),
  },
  {
    id: "stats" as Screen,
    label: "Stats",
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    id: "monitor" as Screen,
    label: "Monitor",
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
    ),
  },
  {
    id: "settings" as Screen,
    label: "Settings",
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

const NAV_ACTIVE: Record<Screen, Screen> = {
  dashboard: "dashboard",
  stats: "stats",
  monitor: "monitor",
  settings: "settings",
};

// Detect if we just returned from Stripe — runs once at module init, cleans up the URL.
// 'return' = user completed or exited Connect onboarding
// 'refresh' = Stripe link expired, need a new one
function resolveInitialPath(): "return" | "refresh" | null {
  const { pathname } = window.location;
  if (pathname === "/connect/return") {
    window.history.replaceState(null, "", "/");
    return "return";
  }
  if (pathname === "/connect/refresh") {
    window.history.replaceState(null, "", "/");
    return "refresh";
  }
  return null;
}

const stripeReturn = resolveInitialPath();

type LaunchParams = {
  launchToken: string | null;
  autoStartStakeId: number | null;
};

function parseLaunchParams(): LaunchParams {
  const params = new URLSearchParams(window.location.search);
  const launchToken = params.get("launch_token");
  const autoStart = params.get("auto_start");
  const stakeIdRaw = params.get("stake_id");
  const autoStartStakeId =
    autoStart === "1" && stakeIdRaw && /^\d+$/.test(stakeIdRaw)
      ? Number(stakeIdRaw)
      : null;
  return {
    launchToken: launchToken && launchToken.length > 0 ? launchToken : null,
    autoStartStakeId,
  };
}

function clearLaunchParamsFromUrl(): void {
  if (!window.location.search) return;
  const params = new URLSearchParams(window.location.search);
  params.delete("launch_token");
  params.delete("auto_start");
  params.delete("stake_id");
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", next);
}

const OUTER = "h-dvh bg-surface-dim flex justify-center sm:py-8 lg:py-0";
const AUTH_OUTER = "h-dvh bg-surface flex justify-center items-center";
const AUTH_INNER = [
  "flex flex-col w-full h-full",
  "sm:max-w-[33vw] sm:max-h-[720px]",
  "bg-surface",
].join(" ");
const INNER = [
  "flex flex-col w-full h-full",
  "sm:max-w-[480px] sm:rounded-2xl sm:overflow-hidden",
  "lg:max-w-full lg:rounded-none",
  "bg-surface",
].join(" ");

const Spinner = ({ size = 28 }: { size?: number }) => (
  <svg
    className="animate-spin text-primary"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
  </svg>
);

// ── Shared shell (header + nav) ───────────────────────────────────────────────

function Shell({
  user,
  onSignOut,
  screen,
  onNavigate,
  children,
  showNav = true,
}: {
  user: UserProfile;
  onSignOut: () => void;
  screen: Screen;
  onNavigate: (s: Screen) => void;
  children: React.ReactNode;
  showNav?: boolean;
}) {
  return (
    <>
      <header className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-outline-variant bg-surface sticky top-0 z-40">
        <span className="font-display font-semibold text-xl text-primary italic tracking-tight select-none">
          Snitch
        </span>
        <button
          className="w-9 h-9 rounded-full border border-outline-variant bg-surface-container flex items-center justify-center hover:bg-surface-high transition-colors"
          aria-label="Sign out"
          onClick={onSignOut}
          title={`Signed in as @${user.username}`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-on-surface-variant"
          >
            <circle cx="10" cy="7" r="3.5" />
            <path d="M3 18c0-3.866 3.134-7 7-7s7 3.134 7 7" />
          </svg>
        </button>
      </header>

      <main className="flex-1 overflow-y-auto">{children}</main>

      {showNav && (
        <nav className="flex-shrink-0 border-t border-outline-variant bg-surface flex sm:rounded-b-2xl">
          {NAV.map(({ id, icon, label }) => {
            const active = NAV_ACTIVE[screen] === id;
            return (
              <button
                key={id}
                onClick={() => onNavigate(id)}
                className={[
                  "flex-1 flex flex-col items-center py-3 gap-0.5",
                  "text-xs font-body font-semibold uppercase tracking-wide transition-colors",
                  active
                    ? "text-primary"
                    : "text-on-surface-variant hover:text-on-surface",
                ].join(" ")}
              >
                <span className="leading-none">{icon}</span>
                {label}
              </button>
            );
          })}
        </nav>
      )}
    </>
  );
}

// ── Setup screen ──────────────────────────────────────────────────────────────
// Four steps, driven by localStorage flags so we survive the Stripe redirect
// without relying on webhooks having fired.
//
//   card       → collect payment method via Stripe Elements
//   connecting → launch Stripe Connect onboarding
//   verifying  → waiting / polling for stripe_account_enabled webhook
//   refreshing → onboarding link expired; auto-generate a new one

type SetupStep = "card" | "connecting" | "verifying" | "refreshing";

function getInitialStep(user: UserProfile): SetupStep {
  // Stripe told us the link expired → regenerate immediately
  if (stripeReturn === "refresh") return "refreshing";
  // We just came back from Stripe, or we already started onboarding → poll for account status
  const onboardingStarted = !!localStorage.getItem("snitch_onboarding_started");
  if (stripeReturn === "return" || onboardingStarted) return "verifying";
  // Card was confirmed (either via localStorage flag or webhook already fired)
  const cardDone =
    !!localStorage.getItem("snitch_card_done") || !!user.payment_method_last4;
  if (cardDone) return "connecting";
  return "card";
}

function SetupScreen({
  token,
  user,
  onSignOut,
  onSetupComplete,
}: {
  token: string;
  user: UserProfile;
  onSignOut: () => void;
  onSetupComplete: (updated: UserProfile) => void;
}) {
  const [step, setStep] = useState<SetupStep>(() => getInitialStep(user));
  const [cardClientSecret, setCardClientSecret] = useState<string | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [error, setError] = useState("");

  // Fetch a SetupIntent client_secret when on the card step
  useEffect(() => {
    if (step !== "card") return;
    apiPost<{ client_secret: string; customer_id: string }>(
      "/payments/setup-intent",
      {},
      token,
    )
      .then(({ client_secret }) => setCardClientSecret(client_secret))
      .catch(() => setError("Could not reach the server. Please try again."));
  }, [step, token]);

  // Poll GET /connect/status every 3 s on the verifying step.
  // This endpoint queries Stripe directly and updates stripe_account_enabled in the DB,
  // so it works without the webhook CLI running.
  useEffect(() => {
    if (step !== "verifying") return;
    const id = setInterval(() => {
      apiGet<{ charges_enabled: boolean; payouts_enabled: boolean }>(
        "/connect/status",
        token,
      )
        .then(({ charges_enabled, payouts_enabled }) => {
          if (charges_enabled && payouts_enabled) {
            // Fetch the full updated profile now that the DB has been synced
            return apiGet<UserProfile>("/users/me", token).then((updated) => {
              localStorage.removeItem("snitch_card_done");
              localStorage.removeItem("snitch_onboarding_started");
              onSetupComplete(updated);
            });
          }
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [step, token, onSetupComplete]);

  // Auto-generate a new onboarding link when Stripe says the old one expired
  useEffect(() => {
    if (step !== "refreshing") return;
    apiPost<{ url: string }>("/connect/onboarding-link", {}, token)
      .then(({ url }) => {
        window.location.href = url;
      })
      .catch(() => {
        setStep("connecting");
        setError("Could not generate a new setup link. Please try again.");
      });
  }, [step, token]);

  function handleCardSuccess() {
    localStorage.setItem("snitch_card_done", "1");
    setStep("connecting");
  }

  async function goToConnect() {
    setError("");
    setConnectLoading(true);
    try {
      localStorage.setItem("snitch_onboarding_started", "1");
      const { url } = await apiPost<{ url: string }>(
        "/connect/onboarding-link",
        {},
        token,
      );
      window.location.href = url;
    } catch {
      localStorage.removeItem("snitch_onboarding_started");
      setError("Could not reach the server. Please try again.");
      setConnectLoading(false);
    }
  }

  const wrap = (children: React.ReactNode) => (
    <div className={OUTER}>
      <div className={INNER}>
        <Shell
          user={user}
          onSignOut={onSignOut}
          screen="dashboard"
          onNavigate={() => {}}
          showNav={false}
        >
          {children}
        </Shell>
      </div>
    </div>
  );

  // ── Refreshing ──────────────────────────────────────────────────────────────
  if (step === "refreshing") {
    return wrap(
      <div className="flex flex-col items-center justify-center flex-1 gap-4 h-full">
        <Spinner />
        <p className="font-body text-sm text-on-surface-variant italic">
          Refreshing setup link…
        </p>
      </div>,
    );
  }

  // ── Verifying ───────────────────────────────────────────────────────────────
  if (step === "verifying") {
    return wrap(
      <div className="flex flex-col items-center justify-center flex-1 px-6 gap-6 text-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Spinner size={32} />
          <h1 className="font-display font-semibold text-2xl text-on-surface">
            Verifying your account
          </h1>
          <p className="font-body text-sm text-on-surface-variant leading-relaxed max-w-xs">
            Stripe is confirming your payout account. This usually takes a few
            seconds.
          </p>
        </div>
        {error && <p className="font-body text-sm text-error">{error}</p>}
        <button
          onClick={goToConnect}
          disabled={connectLoading}
          className="font-body text-sm text-on-surface-variant hover:text-on-surface underline underline-offset-2 transition-colors disabled:opacity-50"
        >
          {connectLoading
            ? "Redirecting…"
            : "Didn't finish onboarding? Try again"}
        </button>
      </div>,
    );
  }

  // ── Card step ───────────────────────────────────────────────────────────────
  if (step === "card") {
    return wrap(
      <div className="flex flex-col flex-1 px-6 py-8 gap-6">
        <div className="flex flex-col gap-1">
          <span className="text-3xl select-none">💳</span>
          <h1 className="font-display font-semibold text-2xl text-on-surface mt-2">
            Add a payment method
          </h1>
          <p className="font-body text-sm text-on-surface-variant leading-relaxed">
            Your card is only charged if you fail a focus session.
          </p>
        </div>
        {error && <p className="font-body text-sm text-error">{error}</p>}
        {!cardClientSecret ? (
          <div className="flex items-center justify-center py-8">
            <Spinner size={24} />
          </div>
        ) : (
          <StripeCardForm
            clientSecret={cardClientSecret}
            token={token}
            onSuccess={handleCardSuccess}
          />
        )}
      </div>,
    );
  }

  // ── Connect onboarding step ─────────────────────────────────────────────────
  return wrap(
    <div className="flex flex-col items-center justify-center flex-1 px-6 gap-6 text-center h-full">
      <div className="flex flex-col items-center gap-2">
        <span className="text-4xl select-none">🔒</span>
        <h1 className="font-display font-semibold text-2xl text-on-surface">
          Finish your setup
        </h1>
        <p className="font-body text-sm text-on-surface-variant leading-relaxed max-w-xs">
          Complete your Stripe payout account so your friends can receive their
          winnings if you get distracted.
        </p>
      </div>
      {error && <p className="font-body text-sm text-error">{error}</p>}
      <button
        onClick={goToConnect}
        disabled={connectLoading}
        className="btn-sketch relative inline-flex items-center justify-center gap-2 px-6 py-3 font-display font-semibold tracking-widest text-sm uppercase rounded-lg cursor-pointer transition-all duration-150 bg-primary-fixed text-primary border-primary disabled:opacity-40 w-full max-w-xs"
      >
        {connectLoading ? "Redirecting…" : "Complete Payout Setup"}
      </button>
      <button
        onClick={() => {
          apiGet<UserProfile>("/users/me", token)
            .then((updated) => {
              if (updated.stripe_account_enabled) onSetupComplete(updated);
            })
            .catch(() => {});
        }}
        className="font-body text-sm text-on-surface-variant hover:text-on-surface underline underline-offset-2 transition-colors"
      >
        I've already completed it
      </button>
    </div>,
  );
}

// ── Root app ──────────────────────────────────────────────────────────────────

export default function App() {
  const launchParams = parseLaunchParams();
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem("snitch_token"),
  );
  const [launchToken, setLaunchToken] = useState<string | null>(launchParams.launchToken);
  const [pendingAutoStartStakeId, setPendingAutoStartStakeId] = useState<number | null>(
    launchParams.autoStartStakeId,
  );
  const [user, setUser] = useState<UserProfile | null>(null);
  // userLoading only applies when a token exists and we haven't fetched the profile yet
  const [userLoading, setUserLoading] = useState(!!token);
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [dashboardRenderKey, setDashboardRenderKey] = useState(0);

  // Fetch user profile whenever the token changes
  useEffect(() => {
    if (!token) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUserLoading(true);
    apiGet<UserProfile>("/users/me", token)
      .then((u) => {
        setUser(u);
        setUserLoading(false);
      })
      .catch(() => {
        // Token expired or invalid — force re-auth
        localStorage.removeItem("snitch_token");
        setToken(null);
        setUserLoading(false);
      });
  }, [token]);

  // Secure bot launch: exchange a short-lived launch token for a real session token.
  // Important: this must run even if a token already exists, so launch links
  // override stale sessions from a different user.
  useEffect(() => {
    if (!launchToken) return;
    apiPost<{ access_token: string; token_type: string }>("/auth/launch-login", {
      launch_token: launchToken,
    })
      .then(({ access_token }) => {
        localStorage.setItem("snitch_token", access_token);
        setToken(access_token);
        setLaunchToken(null);
        clearLaunchParamsFromUrl();
      })
      .catch(() => {
        setLaunchToken(null);
        clearLaunchParamsFromUrl();
      });
  }, [token, launchToken]);

  // Launch flow: activate stake, then hydrate Home dashboard session state.
  useEffect(() => {
    if (!token || pendingAutoStartStakeId == null) return;
    const stakeId = pendingAutoStartStakeId;
    apiPost<StakeRead>(`/stakes/${stakeId}/activate`, {}, token)
      .catch(() => {
        // If already active, continue by fetching details.
        return null;
      })
      .then(async (activatedStake) => {
        const stake =
          activatedStake ??
          (await apiGet<StakeRead>(`/stakes/${stakeId}`, token));

        const elapsed = Math.max(0, stake.elapsed_seconds ?? 0);
        const remaining = Math.max(0, stake.duration_seconds - elapsed);
        localStorage.setItem(
          "snitch_session",
          JSON.stringify({
            stakeId: stake.id,
            endEpoch: Date.now() + remaining * 1000,
            durationSeconds: stake.duration_seconds,
            amountCents: stake.amount_cents,
            recipientUsernames: stake.recipients.map((r) => r.recipient_username),
            distractionFractions: [],
          }),
        );
        localStorage.removeItem("snitch_away_at");
        setScreen("dashboard");
        setDashboardRenderKey((k) => k + 1);
      })
      .finally(() => {
        setPendingAutoStartStakeId(null);
        clearLaunchParamsFromUrl();
      });
  }, [token, pendingAutoStartStakeId]);

  // Derive: if there is no token the cached user object should not be trusted
  const activeUser = token ? user : null;

  function signOut() {
    localStorage.removeItem("snitch_token");
    localStorage.removeItem("snitch_card_done");
    localStorage.removeItem("snitch_onboarding_started");
    setToken(null);
    setUser(null);
  }

  function handleAuthenticated(newToken: string) {
    localStorage.setItem("snitch_token", newToken);
    setToken(newToken);
  }

  const navigate = (s: Screen) => setScreen(s)

  const cameraMonitor = useCameraMonitor(token);

  // ── Loading splash ───────────────────────────────────────────────────────
  if (userLoading) {
    return (
      <div className={OUTER}>
        <div className={`${INNER} items-center justify-center`}>
          <Spinner />
        </div>
      </div>
    );
  }

  // ── Auth gate ────────────────────────────────────────────────────────────
  if (!token || !activeUser) {
    return (
      <div className={AUTH_OUTER}>
        <div className={AUTH_INNER}>
          <AuthScreen onAuthenticated={handleAuthenticated} />
        </div>
      </div>
    );
  }

  // ── Stripe onboarding gate ───────────────────────────────────────────────
  // stripe_account_enabled is set by the account.updated webhook after Stripe
  // confirms both charges_enabled and payouts_enabled.
  if (!activeUser.stripe_account_enabled) {
    return (
      <SetupScreen
        token={token}
        user={activeUser}
        onSignOut={signOut}
        onSetupComplete={setUser}
      />
    );
  }

  // ── Main app ─────────────────────────────────────────────────────────────
  return (
    <div className={OUTER}>
      <div className={INNER}>
        <Shell
          user={activeUser}
          onSignOut={signOut}
          screen={screen}
          onNavigate={navigate}
        >
          {screen === "dashboard" && (
            <FocusDashboard
              key={dashboardRenderKey}
              navigate={navigate}
              token={token}
              user={activeUser}
              cameraMonitor={cameraMonitor}
            />
          )}
          {screen === "stats" && (
            <FocusStats navigate={navigate} token={token} user={activeUser} />
          )}
          {screen === "monitor" && (
            <DistractionMonitor navigate={navigate} cameraMonitor={cameraMonitor} />
          )}
          {screen === "settings" && (
            <FocusSettings
              navigate={navigate}
              token={token}
              user={activeUser}
              onSignOut={signOut}
              onUserUpdate={setUser}
            />
          )}
        </Shell>
      </div>
    </div>
  );
}
