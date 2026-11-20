// Demo-video engine: app-agnostic. Signs in once (session saved, never recorded), then records a scripted tour in a fresh
// context with a visible cursor, eased mouse moves, human typing, smooth scrolls and optional blurs, and converts the
// Playwright .webm to an H.264 MP4 with ffmpeg. A tour is a plain async function over the `Demo` helpers below.
// Docs and the reuse checklist: docs/demo-video.md.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";

export type Viewport = { width: number; height: number; scale: number };
export const DESKTOP: Viewport = { width: 1440, height: 900, scale: 2 };
export const PHONE: Viewport = { width: 390, height: 844, scale: 3 };

export type SignIn = (page: Page, baseUrl: string) => Promise<void>;

export type TourOptions = {
  name: string;
  baseUrl: string;
  outDir: string;
  viewport?: Viewport;
  colorScheme?: "light" | "dark";
  signIn: SignIn;
  /** Runs before the take: reset the account's state (earlier takes' chats, drafts) so every take starts the same. */
  prepare?: () => Promise<void>;
  /** CSS selectors blurred on every page for the whole take (public cuts). */
  blur?: string[];
  /** Plain-text swaps applied to the page as it renders: [find, replace]. For names a blur would hide too much of. */
  swaps?: [string, string][];
  tour: (d: Demo) => Promise<void>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The overlay cursor and the blur rules, installed in every document before the app's own scripts. */
function overlayScript(blur: string[], swaps: [string, string][]) {
  return `(() => {
    const BLUR = ${JSON.stringify(blur)};
    const SWAPS = ${JSON.stringify(swaps)};
    const install = () => {
      if (document.getElementById("__demo_cursor")) return;
      const c = document.createElement("div");
      c.id = "__demo_cursor";
      c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2.5 L4 19 L8.6 14.9 L11.6 21.5 L14.4 20.3 L11.4 13.8 L17.5 13.8 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none",
        transform: "translate(-100px,-100px)", transition: "none", filter: "drop-shadow(0 1px 2px rgba(0,0,0,.35))" });
      const ring = document.createElement("div");
      ring.id = "__demo_ring";
      Object.assign(ring.style, { position: "fixed", left: "0", top: "0", width: "36px", height: "36px", margin: "-18px 0 0 -18px",
        borderRadius: "50%", background: "rgba(59,130,246,.28)", zIndex: "2147483646", pointerEvents: "none", opacity: "0",
        transform: "scale(.3)", transition: "opacity .35s ease, transform .35s ease" });
      document.documentElement.append(ring, c);
      addEventListener("mousemove", (e) => { c.style.transform = "translate(" + (e.clientX - 4) + "px," + (e.clientY - 2) + "px)"; ring.style.left = e.clientX + "px"; ring.style.top = e.clientY + "px"; }, true);
      addEventListener("mousedown", () => { ring.style.transition = "none"; ring.style.opacity = "1"; ring.style.transform = "scale(.3)";
        requestAnimationFrame(() => { ring.style.transition = "opacity .45s ease, transform .45s ease"; ring.style.opacity = "0"; ring.style.transform = "scale(1.4)"; }); }, true);
      if (BLUR.length) {
        const s = document.createElement("style");
        s.textContent = BLUR.join(",") + "{filter:blur(7px)!important}";
        document.head.append(s);
      }
      if (SWAPS.length) {
        const swapNode = (n) => { let t = n.nodeValue; for (const [a, b] of SWAPS) if (t.includes(a)) t = t.split(a).join(b); if (t !== n.nodeValue) n.nodeValue = t; };
        const walk = (root) => { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); while (w.nextNode()) swapNode(w.currentNode); };
        walk(document.body);
        new MutationObserver((ms) => { for (const m of ms) { if (m.type === "characterData") swapNode(m.target); m.addedNodes.forEach((n) => n.nodeType === 3 ? swapNode(n) : n.nodeType === 1 && walk(n)); } })
          .observe(document.body, { subtree: true, childList: true, characterData: true });
      }
    };
    if (document.body) install(); else addEventListener("DOMContentLoaded", install);
  })();`;
}

export class Demo {
  private x = 0;
  private y = 0;
  /** When the first page finished settling: everything before it (blank frames, the first load) is trimmed off. */
  firstReady: number | null = null;
  private t0 = Date.now();
  /** Step log with video time, so a slow or stuck step is easy to find and trim. */
  log(what: string) {
    const ref = this.firstReady ?? this.t0;
    console.log(`${((Date.now() - ref) / 1000).toFixed(1).padStart(6)}s  ${what}`);
  }
  constructor(public page: Page, public baseUrl: string, private vp: Viewport) {
    this.x = vp.width / 2;
    this.y = vp.height / 2;
  }

  /** Hold on the current frame (the viewer reads it). */
  pause(ms = 1200) {
    return sleep(ms);
  }

  async goto(pathname: string, hold = 1200) {
    this.log(`goto ${pathname}`);
    await this.page.goto(this.baseUrl + pathname, { waitUntil: "networkidle" });
    await this.settle();
    await this.page.mouse.move(this.x, this.y);
    this.firstReady ??= Date.now();
    await sleep(hold);
  }

  /** Wait for fonts, pending images and the app's own load shells to finish. */
  async settle() {
    await this.page.evaluate(() => document.fonts.ready);
    // Capped: a page with a video embed never goes network-idle, and the default 30s wait would sit on camera.
    await this.page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
    await sleep(300);
  }

  /** Glide the cursor to a point on an eased path, as a hand would. */
  async moveTo(x: number, y: number, ms = 650) {
    const steps = Math.max(12, Math.round(ms / 16));
    const sx = this.x;
    const sy = this.y;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      await this.page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e);
      await sleep(ms / steps);
    }
    this.x = x;
    this.y = y;
  }

  /** Glide to an element's center (scrolling it into view first, smoothly) and hover it. */
  async hover(selector: string, ms = 650) {
    const el = this.page.locator(selector).first();
    await el.waitFor({ state: "visible" });
    await this.reveal(selector);
    const box = await el.boundingBox();
    if (!box) throw new Error(`no box for ${selector}`);
    await this.moveTo(box.x + box.width / 2, box.y + box.height / 2, ms);
  }

  async click(selector: string, hold = 900) {
    this.log(`click ${selector}`);
    await this.hover(selector);
    await sleep(180);
    // The page may still be settling after the scroll (a list growing above the target): re-aim until the pointer is
    // really over the target, or the click lands on a neighbour (it opened the wrong Game Flow game once).
    const el = this.page.locator(selector).first();
    for (let i = 0; i < 5; i++) {
      const box = await el.boundingBox();
      if (!box) break;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      if (Math.abs(x - this.x) > 2 || Math.abs(y - this.y) > 2) await this.moveTo(x, y, 250);
      const over = await el.evaluate((t, [px, py]) => { const hit = document.elementFromPoint(px, py); return !!hit && (t === hit || t.contains(hit)); }, [x, y] as const);
      if (over) break;
      await sleep(250);
    }
    await this.page.mouse.down();
    await sleep(90);
    await this.page.mouse.up();
    await sleep(250);
    await this.settle();
    await sleep(hold);
  }

  /**
   * Close a menu or popover the way a mouse user does: a click on empty space. (Escape used to leave the keyboard focus
   * ring on the menu's button; the Hub fixes that itself now, components/pointer-opened-menus.tsx.)
   */
  async clickAway(x: number, y: number, hold = 600) {
    this.log(`click away at ${x},${y}`);
    await this.moveTo(x, y, 450);
    await sleep(120);
    await this.page.mouse.down();
    await sleep(80);
    await this.page.mouse.up();
    await sleep(hold);
  }

  /** Type into a field at a human pace. */
  async type(selector: string, text: string, perKey = 55) {
    this.log(`type ${text}`);
    await this.click(selector, 200);
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      await sleep(perKey + Math.random() * perKey * 0.6);
    }
    await sleep(500);
  }

  /** Type into whatever has focus (a palette opened by a shortcut). */
  async typeKeys(text: string, perKey = 55) {
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      await sleep(perKey + Math.random() * perKey * 0.6);
    }
    await sleep(500);
  }

  /**
   * Wait for a streamed answer to finish: the text inside `selector` must grow, then hold still for `quietMs`.
   * The scroll follows the newest text so the viewer sees it arrive. Gives up after `maxMs`.
   */
  async waitForAnswer(selector = "main", quietMs = 2500, maxMs = 90_000) {
    this.log("wait for answer");
    const len = () => this.page.locator(selector).first().evaluate((e) => (e as HTMLElement).innerText.length).catch(() => 0);
    const start = await len();
    const t0 = Date.now();
    let last = start;
    let still = Date.now();
    while (Date.now() - t0 < maxMs) {
      await sleep(400);
      const n = await len();
      if (n !== last) {
        last = n;
        still = Date.now();
      } else if (n > start + 40 && Date.now() - still >= quietMs) break;
    }
    await sleep(600);
  }

  async press(key: string, hold = 900) {
    this.log(`press ${key}`);
    await this.page.keyboard.press(key);
    await sleep(250);
    await this.settle();
    await sleep(hold);
  }

  /** Smooth-scroll the window by dy pixels over ms. */
  async scrollBy(dy: number, ms = 1400) {
    // A string, not a function: tsx wraps named inner functions in a helper the page doesn't have.
    await this.page.evaluate(`new Promise((done) => {
      const start = scrollY, t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ${ms});
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        scrollTo(0, start + ${dy} * e);
        if (t < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    })`);
    await sleep(300);
  }

  async scrollToTop(ms = 1000) {
    const y = await this.page.evaluate(() => scrollY);
    if (y > 0) await this.scrollBy(-y, ms);
  }

  /** Bring an element into the middle band of the viewport with a smooth scroll, if it isn't already there. */
  async reveal(selector: string) {
    const box = await this.page.locator(selector).first().boundingBox();
    if (!box) return;
    const top = this.vp.height * 0.18;
    const bottom = this.vp.height * 0.82;
    if (box.y >= top && box.y + box.height <= bottom) return;
    await this.scrollBy(box.y - this.vp.height * 0.35, 900);
  }
}

async function signInOnce(browser: Browser, o: TourOptions, statePath: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await o.signIn(page, o.baseUrl);
  await ctx.storageState({ path: statePath });
  await ctx.close();
}

/**
 * Record one tour. Returns the MP4 path.
 * Frames come from Chrome's own screencast (CDP Page.startScreencast) at full device-pixel size, each stamped on arrival;
 * ffmpeg's concat demuxer holds each frame until the next one and resamples to 30 fps. (Playwright's recordVideo was
 * dropped: at deviceScaleFactor 2 it draws the page into the top-left quarter of the frame, and its VP8 is soft.)
 */
export async function record(o: TourOptions): Promise<string> {
  const vp = o.viewport ?? DESKTOP;
  fs.mkdirSync(o.outDir, { recursive: true });
  const raw = path.join(o.outDir, `.raw-${o.name}`);
  fs.rmSync(raw, { recursive: true, force: true });
  fs.mkdirSync(raw, { recursive: true });
  const statePath = path.join(o.outDir, `.session-${o.name}.json`);
  // Real Chrome, not Playwright's Chromium: Chromium has no H.264, so Vimeo and most embedded video won't play.
  // --force-device-scale-factor: without it headless screencast frames come at CSS-pixel size whatever the context's scale.
  const browser = await chromium.launch({
    channel: "chrome",
    args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars", `--force-device-scale-factor=${vp.scale}`],
  });
  let ctx: BrowserContext | null = null;
  try {
    await o.prepare?.();
    await signInOnce(browser, o, statePath);
    ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.scale,
      colorScheme: o.colorScheme ?? "light",
      storageState: statePath,
    });
    await ctx.addInitScript({ content: overlayScript(o.blur ?? [], o.swaps ?? []) });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    const frames: { file: string; at: number }[] = [];
    let n = 0;
    cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
      const file = path.join(raw, `f${String(n++).padStart(6, "0")}.jpg`);
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      frames.push({ file, at: Date.now() });
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: vp.width * vp.scale, maxHeight: vp.height * vp.scale, everyNthFrame: 1 });
    const demo = new Demo(page, o.baseUrl, vp);
    await o.tour(demo);
    await sleep(1200);
    await cdp.send("Page.stopScreencast").catch(() => {});
    const end = Date.now();
    await ctx.close();
    ctx = null;

    // Keep from the last frame before the first page settled; hold each frame until the next arrives.
    const start = demo.firstReady ?? frames[0]?.at ?? end;
    let first = frames.findIndex((f) => f.at >= start);
    if (first > 0) first -= 1;
    const kept = frames.slice(Math.max(0, first));
    if (!kept.length) throw new Error("no frames were captured");
    const list = kept
      .map((f, i) => {
        const from = Math.max(f.at, start);
        const to = i + 1 < kept.length ? kept[i + 1].at : end;
        return `file '${f.file}'\nduration ${Math.max(0.001, (to - from) / 1000).toFixed(3)}`;
      })
      .join("\n");
    const listFile = path.join(raw, "frames.txt");
    fs.writeFileSync(listFile, `${list}\nfile '${kept[kept.length - 1].file}'\n`);
    const mp4 = path.join(o.outDir, `${o.name}.mp4`);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-movflags", "+faststart", mp4]);
    fs.rmSync(raw, { recursive: true, force: true });
    fs.rmSync(statePath, { force: true });
    return mp4;
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    await browser.close();
  }
}
