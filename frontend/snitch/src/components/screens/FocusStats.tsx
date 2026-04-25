import Card from "../atoms/Card";
import Chip from "../atoms/Chip";
import Button from "../atoms/Button";
import type { Screen } from "../../types";


const BAR_DATA = [
  { day: "Mon", hours: 0.8, active: false },
  { day: "Tue", hours: 1.2, active: false },
  { day: "Wed", hours: 3.2, active: true },
  { day: "Thu", hours: 0.4, active: false, penalty: true },
  { day: "Fri", hours: 0, active: false },
  { day: "Sat", hours: 0, active: false },
  { day: "Sun", hours: 0, active: false },
];
const MAX_HOURS = 4;

const SESSIONS = [
  {
    icon: "📐",
    title: "Calculus Review",
    subtitle: "Ch. 4 Integration",
    duration: "2h 15m",
    chip: { label: "Focused", variant: "success" as const },
    penalty: null,
  },
  {
    icon: "✍️",
    title: "History Essay",
    subtitle: "Drafting Intro",
    duration: "45m",
    chip: { label: "Distracted", variant: "warning" as const },
    penalty: "$5",
  }
];

export default function FocusStats({ navigate }: { navigate: (screen: Screen) => void }) {
  return (
    <div className="px-5 py-5 flex flex-col gap-4">
        {/* Page title + tagline */}
        <div>
          <h1 className="font-display font-semibold text-4xl text-on-surface leading-tight">
            Your Stats
          </h1>
        </div>

        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="font-body text-xs text-on-surface-variant tracking-wide uppercase">
                You saved
              </p>
              <p className="font-display font-semibold text-3xl text-on-surface mt-0.5">
                $420{" "}
              </p>
              <p className="font-body text-xs text-on-surface-variant mt-2">
                Maybe locking in is worth it after all?
              </p>
            </div>
            <span className="text-2xl">💰</span>
          </div>
        </Card>

        {/* Study penalties */}
        <Card accent="warning">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-body text-xs text-on-error-container tracking-wide uppercase font-semibold">
                You gave
              </p>
              <p className="font-display font-semibold text-3xl text-on-surface mt-0.5">
                $45{" "}
                <span className="text-sm font-body font-normal text-on-surface-variant">
                  to your friends
                </span>
              </p>
              <p className="font-body text-xs text-error mt-2">
                How kind. <span className="font-semibold">Now stop scrolling.</span>
              </p>
            </div>
            <span className="text-2xl">⚠️</span>
          </div>
        </Card>

        {/* Current streak */}
        <Card accent="info">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-body text-xs text-primary tracking-wide uppercase font-semibold">
                Current Streak
              </p>
              <p className="font-display font-semibold text-3xl text-on-surface mt-0.5">
                3{" "}
                <span className="text-sm font-body font-normal text-on-surface-variant">
                  days without distractions
                </span>
              </p>
              <p className="font-body text-xs text-on-surface-variant mt-2">
                Don't break it now.
              </p>
            </div>
            <span className="text-2xl">🔥</span>
          </div>
        </Card>

        {/* Weekly bar chart */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-semibold text-xl text-on-surface">
              This Week's Focus Hours
            </h2>
          </div>

          {/* Chart */}
          <div className="relative">
            {/* Y-axis labels */}
            <div className="absolute left-0 top-0 bottom-6 flex flex-col justify-between text-xs font-body text-on-surface-variant">
              {["4h", "3h", "2h", "1h", "0"].map((l) => (
                <span key={l}>{l}</span>
              ))}
            </div>
            {/* Bars */}
            <div className="ml-6 flex items-end gap-1.5 h-32">
              {BAR_DATA.map(({ day, hours, active, penalty }) => {
                const pct = (hours / MAX_HOURS) * 100;
                return (
                  <div
                    key={day}
                    className="flex-1 flex flex-col items-center gap-1"
                  >
                    {active && (
                      <span className="text-xs font-body font-semibold text-primary bg-primary-fixed border border-primary-fixed-dim rounded px-1">
                        {hours}h
                      </span>
                    )}
                    <div
                      className="w-full flex items-end"
                      style={{ height: "96px" }}
                    >
                      <div
                        className={[
                          "w-full rounded-sm transition-all",
                          active
                            ? "hatch-progress bg-primary-fixed-dim border border-primary"
                            : penalty
                              ? "bg-error-container border border-error"
                              : "bg-surface-high border border-outline-variant",
                        ].join(" ")}
                        style={{
                          height: `${pct}%`,
                          minHeight: hours > 0 ? "4px" : "0",
                        }}
                      />
                    </div>
                    <span className="text-xs font-body text-on-surface-variant">
                      {day}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="font-body italic text-xs text-on-surface-variant mt-3">
            "Wednesday looks okay. Thursday was a disaster."
          </p>
        </Card>

        {/* Recent sessions */}
        <div>
          <h2 className="font-display font-semibold text-xl text-on-surface mb-3">
            Recent Sessions
          </h2>
          <Card>
            <div className="flex flex-col divide-y divide-outline-variant">
              {SESSIONS.map((s, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="w-10 h-10 rounded-full border border-outline-variant bg-surface-container flex items-center justify-center text-lg flex-shrink-0">
                    {s.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-body font-semibold text-sm text-on-surface">
                        {s.title}
                      </span>
                      {s.penalty && (
                        <span className="text-xs font-body font-semibold text-error">
                          Penalty: {s.penalty}
                        </span>
                      )}
                    </div>
                    <p className="font-body text-xs text-on-surface-variant">
                      {s.subtitle}
                    </p>
                    {s.chip && (
                      <div className="mt-1">
                        <Chip variant={s.chip.variant}>{s.chip.label}</Chip>
                      </div>
                    )}
                  </div>
                  <span className="font-body text-xs text-on-surface-variant flex-shrink-0">
                    {s.duration}
                  </span>
                </div>
              ))}
            </div>
          </Card>
          <div className="mt-3">
            <Button variant="ghost" fullWidth onClick={() => navigate('dashboard')}>
              Log New Session
            </Button>
          </div>
        </div>
      </div>
  );
}
