// Info Hub specifics for the demo engine: where the demo login lives and how this app signs in.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { SignIn } from "./engine";

export type DemoAccount = "user";

/** Reads a login made by scripts/demo-accounts.ts (private/demo-accounts.json, git-ignored). */
export function account(key: DemoAccount): { email: string; password: string } {
  const file = path.join(process.cwd(), "private", "demo-accounts.json");
  if (!fs.existsSync(file)) throw new Error("no demo logins: run pnpm tsx scripts/demo-accounts.ts");
  const all = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!all[key]) throw new Error(`no ${key} login in private/demo-accounts.json`);
  return all[key];
}

/** The login form is a native POST to /auth/sign-in (components/login-form.tsx), so this waits for the navigation. */
export function hubSignIn(key: DemoAccount): SignIn {
  return async (page: Page, baseUrl: string) => {
    const { email, password } = account(key);
    await page.goto(`${baseUrl}/auth/login`);
    await page.fill("#email", email);
    await page.fill("#current-password", password);
    await page.click("button[type=submit]");
    await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30_000 });
  };
}
