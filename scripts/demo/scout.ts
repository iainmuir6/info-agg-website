// Scouting pass before writing a tour: signs in as the demo login and saves a screenshot of each route, so the tour is
// written against what is really on screen.
//   DEMO_BASE_URL=https://… pnpm tsx scripts/demo/scout.ts user <outDir> /route /route ...
// Add FULL=1 for full-page screenshots.
import path from "node:path";
import { chromium } from "@playwright/test";
import { hubSignIn, type DemoAccount } from "./infohub";

const BASE = process.env.DEMO_BASE_URL ?? "https://info-agg-website.vercel.app";

async function main() {
  const [key, out, ...routes] = process.argv.slice(2);
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await ctx.newPage();
  await hubSignIn(key as DemoAccount)(page, BASE);
  for (const r of routes) {
    await page.goto(BASE + r, { waitUntil: "load" });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
    const file = path.join(out, `${key}${r.replace(/[/?=&]+/g, "_") || "_home"}.png`);
    await page.screenshot({ path: file, fullPage: process.env.FULL === "1" });
    console.log(r, "->", page.url().replace(BASE, ""), file);
  }
  await browser.close();
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
