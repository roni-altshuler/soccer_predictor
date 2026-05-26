/**
 * Screenshot harness for visual regression during the FotMob-inspired redesign.
 *
 * Usage:
 *   npm run shoot -- <phase-label>
 *
 * Example:
 *   npm run shoot -- phase-0-baseline
 *   npm run shoot -- phase-2-match-detail
 *
 * Output: scripts/screenshots/<phase>/<route>__<universe>__<variant>.png
 *
 * Variants per route:
 *   - desktop  : 1440x900
 *   - mobile   : 375x812
 *   - reduced  : 1440x900 with prefers-reduced-motion: reduce
 *
 * Universes:
 *   - men    : default (no ?gender= param)
 *   - women  : ?gender=women appended for gender-aware routes
 *
 * Boots `next dev` on port 3002 by default (avoiding :3000 used by the
 * concurrent uvicorn+next dev setup and :3001 commonly held by sibling
 * projects). Override with the `SHOOT_PORT` env var. Waits for the first
 * 200 before iterating. Kills the dev server on exit.
 *
 * NOTE: this harness does NOT start uvicorn on :8000, so any page whose
 * server route proxies the FastAPI backend will degrade (empty/error state).
 * That is acceptable — the harness captures visual regression of the UI
 * shell, not full data fidelity. Run `npm run dev` separately if you want
 * the backend live for richer screenshots.
 */
import { chromium, type Browser, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

// Default 3002 (3000 is the soccer_predictor dev FE; 3001 is commonly held by
// another project's dev server, e.g. f1_predictions). Override with SHOOT_PORT.
const PORT = Number(process.env.SHOOT_PORT ?? 3002);
const BASE = `http://localhost:${PORT}`;
const PHASE = process.argv[2] ?? "scratch";
const OUT_ROOT = path.resolve("scripts/screenshots", PHASE);

// Stable match ID from backend/data/predictions/predictions_2026-04.json
// (PSG vs Toulouse, 2026-04-03). Update if the match data layer rotates.
const STABLE_MATCH_ID = "746662";

type Route = {
  url: string;
  slug: string;
  gendered: boolean; // whether ?gender=women is meaningful here
};

const ROUTES: Route[] = [
  { url: "/", slug: "home", gendered: true },
  { url: "/matches", slug: "matches", gendered: true },
  { url: `/matches/${STABLE_MATCH_ID}`, slug: "match-detail", gendered: false },
  { url: "/leagues/eng.1", slug: "league-eng1", gendered: false },
  { url: "/leagues/eng.w.1", slug: "league-eng-w1", gendered: false },
  { url: "/predict", slug: "predict", gendered: true },
  { url: "/accuracy", slug: "accuracy", gendered: true },
  { url: "/simulator", slug: "simulator", gendered: true },
  { url: "/upcoming", slug: "upcoming", gendered: true },
  { url: "/news", slug: "news", gendered: true },
  { url: "/design-system", slug: "design-system", gendered: false },
  { url: "/about", slug: "about", gendered: false },
];

type Universe = "men" | "women";
type Variant = "desktop" | "mobile" | "reduced";

function buildUrl(route: Route, universe: Universe): string {
  if (universe === "women" && route.gendered) {
    const join = route.url.includes("?") ? "&" : "?";
    return `${BASE}${route.url}${join}gender=women`;
  }
  return `${BASE}${route.url}`;
}

async function waitForServer(url: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not respond on ${url} within ${timeoutMs}ms`);
}

async function shoot(
  browser: Browser,
  route: Route,
  universe: Universe,
  variant: Variant,
): Promise<void> {
  const viewport =
    variant === "mobile"
      ? { width: 375, height: 812 }
      : { width: 1440, height: 900 };

  const context = await browser.newContext({
    viewport,
    reducedMotion: variant === "reduced" ? "reduce" : "no-preference",
  });
  const page: Page = await context.newPage();
  try {
    const url = buildUrl(route, universe);
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    // wait for fonts to settle before snapping
    await page.evaluate(() => {
      const docWithFonts = document as Document & {
        fonts?: { ready: Promise<unknown> };
      };
      return docWithFonts.fonts?.ready;
    });
    // brief settle for animations and intersection-observer hydration
    await page.waitForTimeout(variant === "reduced" ? 200 : 800);
    const filename = `${route.slug}__${universe}__${variant}.png`;
    const out = path.join(OUT_ROOT, filename);
    await page.screenshot({ path: out, fullPage: true });
    console.log(`  shot ${url}  ->  ${path.relative(process.cwd(), out)}`);
  } catch (err) {
    console.warn(`  failed ${route.url} (${universe}/${variant}): ${(err as Error).message}`);
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  await mkdir(OUT_ROOT, { recursive: true });

  console.log(`[shoot] phase=${PHASE} → ${OUT_ROOT}`);
  console.log(`[shoot] starting next dev on :${PORT} ...`);

  const child: ChildProcess = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "development" },
  });

  child.stderr?.on("data", (chunk) => {
    const txt = chunk.toString();
    if (/error|failed/i.test(txt)) {
      process.stderr.write(`[next-dev] ${txt}`);
    }
  });

  const cleanup = () => {
    if (!child.killed) child.kill("SIGTERM");
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });

  try {
    await waitForServer(BASE, 120_000);
    console.log("[shoot] dev server ready, launching chromium ...");
    const browser = await chromium.launch({ headless: true });
    try {
      const universes: Universe[] = ["men", "women"];
      const variants: Variant[] = ["desktop", "mobile", "reduced"];
      for (const route of ROUTES) {
        for (const universe of universes) {
          // Skip the women variant for non-gendered routes to avoid duplicate output
          if (universe === "women" && !route.gendered) continue;
          for (const variant of variants) {
            await shoot(browser, route, universe, variant);
          }
        }
      }
    } finally {
      await browser.close();
    }
    console.log(`[shoot] done → ${OUT_ROOT}`);
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
