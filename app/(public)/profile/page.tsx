import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/rbac";
import { UpdatePasswordForm } from "@/components/update-password-form";
import { UpdateDisplayNameForm } from "@/components/update-display-name-form";
import { SignOutButton } from "@/components/sign-out-button";
import { EtlRunBreakdown } from "@/components/etl-run-breakdown";
import {
  cleanupTotal,
  parseDomains,
  tierLabel,
  STATUS_COLOR,
  type EtlRun,
} from "@/lib/etl-runs";
import { formatTime } from "@/lib/format-date";
import {
  FavoritesPanel,
  type FavoriteStock,
  type FavoriteTeamRow,
} from "@/components/favorites-panel";
import { HomeSectionPrefs } from "@/components/home-section-prefs";
import { EtlTriggerButton } from "@/components/etl-trigger";
import { formatDateLong } from "@/lib/format-date";
import { leagueLabel } from "@/lib/leagues";

/** Matches the chrome the self-contained watchlist cards already render, so a
 *  wrapped section and an unwrapped one are indistinguishable in the grid. */
function SectionCard({
  title,
  accent,
  className,
  meta,
  children,
}: {
  title: string;
  accent: string;
  className?: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`border border-border ${className ?? ""}`}>
      <div
        className="px-3 py-1.5 border-b border-border flex items-center justify-between gap-2"
        style={{ borderLeftColor: accent, borderLeftWidth: 3 }}
      >
        <span className="text-[10px] font-mono tracking-widest uppercase font-bold">{title}</span>
        {meta}
      </div>
      {children}
    </div>
  );
}

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims) redirect("/auth/login");

  const claims = claimsData.claims;
  const email = (claims.email as string | undefined) ?? "";
  const userId = claims.sub as string;
  const admin = await isSuperAdmin();

  // Account creation date comes from the user record — the JWT's iat is the
  // token issue time (i.e. last sign-in), which is what used to show here.
  const { data: userData } = await supabase.auth.getUser();
  const createdAt = userData?.user?.created_at;
  const memberSince = createdAt ? formatDateLong(createdAt) : "—";
  const displayName =
    (userData?.user?.user_metadata?.display_name as string | undefined) ?? "";

  // Latest ETL run for the admin section — full-row etl_runs access is
  // super_admin-only, so this is only fetched (and rendered) for admins.
  let latestRun: EtlRun | null = null;
  if (admin) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: r } = (await supabase
      .from("etl_runs")
      .select(
        "id, status, tier, triggered_by, started_at, finished_at, duration_seconds, stats, errors, cleanup",
      )
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle()) as { data: any };
    if (r) {
      latestRun = {
        id: r.id,
        status: r.status,
        tier: r.tier,
        triggered_by: r.triggered_by,
        started_at: r.started_at,
        finished_at: r.finished_at,
        duration_seconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
        errors: Array.isArray(r.errors) ? r.errors : [],
        domains: parseDomains(r.stats),
        cleanupTotal: cleanupTotal(r.cleanup),
      };
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  // NOTE: `watchlist_leagues` is deliberately not read here. Its only reader
  // was the "Tracked Leagues" toggle on this page — the Command Center gates
  // sports cards on an in-season date check, not on user league prefs — so the
  // control did nothing. Table and component are left in place; only the dead
  // UI is gone.
  const [watchlistStocksRes, favoriteTeamsRes, watchlistPodcastsRes, homePrefsRes] =
    await Promise.all([
      supabase
        .from("watchlist_stocks")
        .select("id, stock_id, stocks(ticker, name, stock_quotes(current_price, percent_change, quote_timestamp))")
        .eq("user_id", userId)
        .order("added_at", { ascending: true }),
      supabase
        .from("watchlist_teams")
        .select("id, team_name, leagues(league, display_name)")
        .eq("user_id", userId)
        .order("added_at", { ascending: true }),
      supabase
        .from("watchlist_podcasts")
        .select("id, show_id, name, image_url")
        .eq("user_id", userId)
        .order("added_at", { ascending: true }),
      supabase
        .from("user_home_prefs")
        .select("section_order, hidden_sections")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const stocks: FavoriteStock[] = (watchlistStocksRes.data ?? []).map((row: any) => {
    const quotes = (row.stocks?.stock_quotes ?? []).sort(
      (a: any, b: any) => new Date(b.quote_timestamp).getTime() - new Date(a.quote_timestamp).getTime()
    );
    const latest = quotes[0];
    return {
      stock_id: row.stock_id,
      ticker: row.stocks?.ticker ?? "",
      name: row.stocks?.name ?? "",
      current_price: latest ? parseFloat(latest.current_price) : null,
      percent_change: latest ? parseFloat(latest.percent_change) : null,
    };
  });

  const favoriteTeams: FavoriteTeamRow[] = (favoriteTeamsRes.data ?? []).map((row: any) => ({
    id: row.id,
    team_name: row.team_name,
    league: row.leagues?.league ?? "",
    league_label: leagueLabel(row.leagues?.league ?? ""),
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return (
    <div className="px-3 sm:px-6 py-3 sm:py-4 space-y-3">
      {/* ── Masthead — account facts live inline here instead of in their own
             card; three read-only key/value rows didn't earn a full panel ── */}
      <div>
        <div className="rule-double mb-2" />
        <div className="flex items-center justify-between gap-x-6 gap-y-2 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-xl font-black tracking-tight leading-none" style={{ fontFamily: "Georgia, serif" }}>
              PROFILE
            </h1>
            <p className="text-xs font-mono text-muted-foreground mt-1 truncate">{email}</p>
          </div>

          <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
            <div>
              <p className="text-[8px] font-mono tracking-widest text-muted-foreground uppercase">Role</p>
              <p
                className="text-[10px] font-mono tracking-wider uppercase font-bold mt-0.5"
                style={{ color: admin ? "hsl(45 90% 52%)" : "hsl(220 90% 52%)" }}
              >
                {admin ? "Super Admin" : "User"}
              </p>
            </div>
            <div>
              <p className="text-[8px] font-mono tracking-widest text-muted-foreground uppercase">Member since</p>
              <p className="text-[10px] font-mono mt-0.5">{memberSince}</p>
            </div>
            <SignOutButton />
          </div>
        </div>
      </div>

      {/* ── Two columns across the full viewport width: everything you act on
             day to day on the left, the Command Center layout editor parked in
             its own rail on the right. `items-start` keeps each panel at its
             natural height rather than stretching to match its neighbour. ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
        <div className="lg:col-span-2 space-y-3">
          <FavoritesPanel
            initialStocks={stocks}
            initialTeams={favoriteTeams}
            initialPodcasts={watchlistPodcastsRes.data ?? []}
          />

          {/* Account settings — the two single-field forms share a row rather
                 than stacking two near-empty full-width cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
            <SectionCard title="Display Name" accent="hsl(220 90% 52%)">
              <div className="px-3 py-2.5">
                <UpdateDisplayNameForm initialName={displayName} />
              </div>
            </SectionCard>

            <SectionCard title="Change Password" accent="hsl(220 90% 52%)">
              <div className="px-3 py-2.5">
                <UpdatePasswordForm />
              </div>
            </SectionCard>
          </div>

          {admin && (
            <SectionCard title="Admin" accent="hsl(45 90% 52%)">
              <div className="grid grid-cols-1 sm:grid-cols-2 sm:divide-x divide-border">
                <div className="px-3 py-2 flex items-center justify-between gap-3">
                  <span className="text-[11px] font-mono text-muted-foreground">
                    Queue an intraday data refresh (~1 min)
                  </span>
                  <EtlTriggerButton />
                </div>
                <div className="px-3 py-2 flex items-center justify-between gap-3 border-t border-border sm:border-t-0">
                  <span className="text-[11px] font-mono text-muted-foreground">
                    Per-domain sync status and row counts
                  </span>
                  <Link
                    href="/dashboard"
                    className="shrink-0 text-[10px] font-mono tracking-widest uppercase border border-border px-3 py-1.5 hover:border-foreground transition-colors"
                  >
                    Dashboard →
                  </Link>
                </div>
              </div>
            </SectionCard>
          )}

          {admin && (
            <SectionCard
              title="Latest ETL Run"
              accent="hsl(45 90% 52%)"
              meta={
                latestRun ? (
                  <span className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground tracking-wider flex-wrap justify-end">
                    <span className="uppercase">
                      {tierLabel(latestRun.tier)} · {latestRun.triggered_by}
                    </span>
                    <span className="tabular-nums">
                      {formatTime(latestRun.started_at, true)}
                      {latestRun.duration_seconds != null && ` · ${latestRun.duration_seconds}s`}
                    </span>
                    <span
                      className="text-[9px] font-mono tracking-widest uppercase font-bold px-1.5 py-0.5 border"
                      style={{
                        color: STATUS_COLOR[latestRun.status] ?? "hsl(0 0% 50%)",
                        borderColor: STATUS_COLOR[latestRun.status] ?? "hsl(0 0% 50%)",
                      }}
                    >
                      {latestRun.status}
                    </span>
                  </span>
                ) : null
              }
            >
              {!latestRun ? (
                <p className="px-3 py-4 text-[11px] font-mono text-muted-foreground">
                  No ETL run has been recorded yet.
                </p>
              ) : (
                <EtlRunBreakdown run={latestRun} />
              )}
            </SectionCard>
          )}
        </div>

        <SectionCard title="Command Center Layout" accent="hsl(220 90% 52%)">
          <HomeSectionPrefs
            initialOrder={homePrefsRes.data?.section_order ?? null}
            initialHidden={homePrefsRes.data?.hidden_sections ?? []}
          />
        </SectionCard>
      </div>
    </div>
  );
}
