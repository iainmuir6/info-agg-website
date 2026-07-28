import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/rbac";
import { UpdatePasswordForm } from "@/components/update-password-form";
import { SignOutButton } from "@/components/sign-out-button";
import { WatchlistStocks } from "@/components/watchlist-stocks";
import { WatchlistLeagues } from "@/components/watchlist-leagues";
import { FavoriteTeams, type FavoriteTeam } from "@/components/favorite-teams";
import { HomeSectionPrefs } from "@/components/home-section-prefs";
import { EtlTriggerButton } from "@/components/etl-trigger";

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border mb-6">
      <div className="px-4 py-2 border-b border-border">
        <span className="text-[10px] font-mono tracking-widest uppercase font-bold">{title}</span>
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
  const memberSince = createdAt
    ? new Date(createdAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";

  const [watchlistStocksRes, allLeaguesRes, watchlistLeaguesRes, favoriteTeamsRes, homePrefsRes] =
    await Promise.all([
      supabase
        .from("watchlist_stocks")
        .select("id, stock_id, stocks(ticker, name, stock_quotes(current_price, percent_change, fetched_at))")
        .eq("user_id", userId),
      supabase.from("leagues").select("id, display_name, sport, league").eq("is_active", true),
      supabase.from("watchlist_leagues").select("league_id").eq("user_id", userId),
      supabase
        .from("watchlist_teams")
        .select("id, team_name, leagues(league, display_name)")
        .eq("user_id", userId)
        .order("added_at", { ascending: true }),
      supabase
        .from("user_home_prefs")
        .select("section_order, hidden_sections")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const stocks = (watchlistStocksRes.data ?? []).map((row: any) => {
    const quotes = (row.stocks?.stock_quotes ?? []).sort(
      (a: any, b: any) => new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime()
    );
    const latest = quotes[0];
    return {
      id: row.id,
      stock_id: row.stock_id,
      ticker: row.stocks?.ticker ?? "",
      name: row.stocks?.name ?? "",
      current_price: latest ? parseFloat(latest.current_price) : null,
      percent_change: latest ? parseFloat(latest.percent_change) : null,
    };
  });

  const trackedLeagueIds = new Set((watchlistLeaguesRes.data ?? []).map((r: any) => r.league_id));
  const leagues = (allLeaguesRes.data ?? []).map((l: any) => ({
    id: l.id,
    display_name: l.display_name,
    sport: l.sport,
    tracked: trackedLeagueIds.has(l.id),
  }));

  const favoriteTeams: FavoriteTeam[] = (favoriteTeamsRes.data ?? []).map((row: any) => ({
    id: row.id,
    team_name: row.team_name,
    league: row.leagues?.league ?? "",
    league_label: (row.leagues?.league ?? "").toUpperCase(),
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black tracking-tighter" style={{ fontFamily: "Georgia, serif" }}>
          PROFILE
        </h1>
        <div className="mt-1 border-t-4 border-double border-border" />
      </div>

      <SectionCard title="Account">
        <div className="px-4 py-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono tracking-wider text-muted-foreground uppercase">Email</span>
            <span className="text-xs font-mono">{email}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono tracking-wider text-muted-foreground uppercase">Role</span>
            <span
              className="text-[10px] font-mono tracking-widest uppercase border px-2 py-0.5"
              style={admin
                ? { borderColor: "hsl(45 90% 52%)", color: "hsl(45 90% 52%)" }
                : { borderColor: "hsl(220 90% 52%)", color: "hsl(220 90% 52%)" }
              }
            >
              {admin ? "Super Admin" : "User"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono tracking-wider text-muted-foreground uppercase">Member since</span>
            <span className="text-xs font-mono">{memberSince}</span>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Command Center Layout">
        <HomeSectionPrefs
          initialOrder={homePrefsRes.data?.section_order ?? null}
          initialHidden={homePrefsRes.data?.hidden_sections ?? []}
        />
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <WatchlistStocks initialStocks={stocks} />
        <WatchlistLeagues initialLeagues={leagues} />
      </div>

      <SectionCard title="Favorite Teams">
        <FavoriteTeams initialTeams={favoriteTeams} />
      </SectionCard>

      {admin && (
        <SectionCard title="Admin">
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <span className="text-[11px] font-mono text-muted-foreground">
              Queue an intraday data refresh (runs on GitHub Actions, ~1 min)
            </span>
            <EtlTriggerButton />
          </div>
          <div className="px-4 py-3 border-t border-border flex items-center justify-between gap-4">
            <span className="text-[11px] font-mono text-muted-foreground">
              Per-domain sync status and row counts
            </span>
            <Link
              href="/dashboard"
              className="text-[10px] font-mono tracking-widest uppercase border border-border px-3 py-1.5 hover:border-foreground transition-colors"
            >
              Dashboard →
            </Link>
          </div>
        </SectionCard>
      )}

      <SectionCard title="Change Password">
        <div className="px-4 py-4">
          <UpdatePasswordForm />
        </div>
      </SectionCard>

      <div className="flex justify-end">
        <SignOutButton />
      </div>
    </div>
  );
}
