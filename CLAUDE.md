# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Snitch is an accountability app with three independent components:

- **`frontend/snitch/`** — React/Vite web app (the main UI, mobile-first)
- **`chromeExtension/`** — Manifest V3 Chrome extension (vanilla JS, no build step)
- **`discord/`** — Python Discord bot using discord.py

These three components are not connected to each other yet; the frontend is currently a standalone UI with no backend.

## Frontend Commands

All commands run from `frontend/snitch/`:

```bash
npm run dev      # Start dev server (Vite HMR)
npm run build    # Type-check + build to dist/
npm run lint     # ESLint
npm run preview  # Preview production build
```

No test framework is set up yet.

## Frontend Architecture

**Stack:** React 19, TypeScript, Vite, Tailwind CSS v4 (via `@tailwindcss/vite` plugin — no `tailwind.config.js`, theme is defined entirely in `src/index.css` under `@theme`).

**Routing:** No router library. `App.tsx` owns a single `screen` state of type `Screen` (`'dashboard' | 'stats' | 'stakes' | 'settings'`) and conditionally renders one screen component at a time. All navigation is prop-drilled as `navigate: (screen: Screen) => void`. Adding a new screen requires updating `types.ts`, `App.tsx`'s render logic, and optionally the `NAV` array.

**Component structure:**
- `components/atoms/` — primitive UI: `Button`, `Card`, `Chip`, `ProgressBar`, `SectionDivider`
- `components/screens/` — full-page views: `FocusDashboard`, `FocusStats`, `FocusStakes`, `YouFailed`

**Design system:** Material You–inspired color tokens defined as CSS custom properties in `index.css`. All colors must use these tokens (e.g., `text-primary`, `bg-surface-container`, `border-outline-variant`). Two font families: `font-display` (Spline Sans) and `font-body` (Be Vietnam Pro). Custom CSS classes `btn-sketch` and `card-sketch` add the double-stroke sketch aesthetic to buttons and cards.

**FocusDashboard timer:** Tracks `totalSeconds` and `seconds` in state; `distractions` is an array of elapsed fractions (0–1) marking where on the arc each distraction occurred. The SVG arc uses `rotate(-90deg) scaleX(1)` so fraction 0 = top, draining clockwise. Distraction markers are rendered as red triangles at their arc position.

## Chrome Extension

No build step. Load `chromeExtension/` directly in Chrome via "Load unpacked." The background service worker (`background.js`) listens for tab URL changes and checks against a blocklist stored in `chrome.storage.local`. It logs visits and fires a notification for flagged sites.

## Discord Bot

Run from `discord/`:

```bash
pip install -r requirements.txt
python bot.py
```

Requires a `.env` file with `TOKEN=<discord-bot-token>`. Cogs are auto-loaded from `cogs/`. Currently only `cogs/general.py` exists (ping + sync commands). New cogs drop into `cogs/` and are picked up automatically.
