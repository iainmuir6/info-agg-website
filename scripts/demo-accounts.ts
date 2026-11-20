// Makes (or refreshes) the demo-video login: a plain User (no project role, as the open sign-up makes one) whose
// login is in demo mode (app_metadata.demo), with a few favorites so the Command Center shows its personal touches.
// The app lists no people anywhere, so there is no hidden-accounts list to add it to.
// The password is generated here and written only to private/demo-accounts.json (git-ignored, mode 600); nothing secret
// is printed.
//   pnpm tsx scripts/demo-accounts.ts            create the account if missing, keep the existing password
//   pnpm tsx scripts/demo-accounts.ts --rotate   also give it a new password
// Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local.
// Docs: docs/demo-video.md.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ACCOUNTS = [
  {
    key: "user",
    email: "infohub.demo@example.com",
    name: "Demo User",
    demo: true,
    // Public market and sports names, picked to show the favorites stars; nothing of Iain's.
    tickers: ["NVDA", "AAPL", "MSFT"],
    teams: [
      { league: "nba", team: "Boston Celtics" },
      { league: "nfl", team: "Kansas City Chiefs" },
    ],
  },
] as const;
const OUT = path.join(process.cwd(), "private", "demo-accounts.json");

async function findUserId(db: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function main() {
  process.loadEnvFile(path.join(process.cwd(), ".env.local"));
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon } = process.env;
  if (!url || !key || !anon) throw new Error("missing Supabase settings in .env.local");
  const rotate = process.argv.includes("--rotate");
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const saved: Record<string, { email: string; password: string }> = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};

  for (const a of ACCOUNTS) {
    const have = saved[a.key]?.email === a.email ? saved[a.key].password : null;
    const password = have && !rotate ? have : randomBytes(18).toString("base64url");
    // As the open sign-up does: a confirmed auth user with no project role. display_name is what the masthead's
    // profile bubble and /profile read.
    const meta = { user_metadata: { display_name: a.name }, app_metadata: { demo: a.demo } };
    const made = await admin.auth.admin.createUser({ email: a.email, password, email_confirm: true, ...meta });
    let userId = made.data.user?.id ?? null;
    if (!userId) {
      userId = await findUserId(admin, a.email);
      if (!userId) throw new Error(`could not create or find ${a.key}: ${made.error?.message}`);
      const { error } = await admin.auth.admin.updateUserById(userId, { password, ...meta });
      if (error) throw error;
    }

    // Favorites, written as the account itself under RLS, the way the app's own star buttons write them.
    const me = createClient(url, anon, { auth: { persistSession: false }, db: { schema: "info_agg" } });
    const { error: inErr } = await me.auth.signInWithPassword({ email: a.email, password });
    if (inErr) throw inErr;
    const { data: stocks, error: sErr } = await me.from("stocks").select("id, ticker").in("ticker", [...a.tickers]);
    if (sErr) throw sErr;
    await me.from("watchlist_stocks").delete().eq("user_id", userId);
    if (stocks?.length) {
      const { error } = await me.from("watchlist_stocks").insert(stocks.map((s) => ({ user_id: userId, stock_id: s.id })));
      if (error) throw error;
    }
    const { data: leagues, error: lErr } = await me.from("leagues").select("id, league");
    if (lErr) throw lErr;
    await me.from("watchlist_teams").delete().eq("user_id", userId);
    const teamRows = a.teams
      .map((t) => ({ user_id: userId, league_id: leagues?.find((l) => l.league === t.league)?.id, team_name: t.team }))
      .filter((r) => r.league_id);
    if (teamRows.length) {
      const { error } = await me.from("watchlist_teams").insert(teamRows);
      if (error) throw error;
    }
    await me.auth.signOut({ scope: "local" });

    saved[a.key] = { email: a.email, password };
    console.log(
      `${a.key}: ${a.email} ${made.data.user ? "created" : "updated"} (plain user${a.demo ? ", demo mode" : ""}; ` +
        `${stocks?.length ?? 0} tickers, ${teamRows.length} teams favorited)`,
    );
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(saved, null, 2), { mode: 0o600 });
  fs.chmodSync(OUT, 0o600);
  console.log("logins saved to private/demo-accounts.json");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
