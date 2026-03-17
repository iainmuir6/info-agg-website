import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/rbac";
import { EtlTriggerButton } from "@/components/etl-trigger";

type DomainStat = {
  domain: string;
  accent: string;
  count: number | null;
  lastFetch: string | null;
};

async function getDomainStats(): Promise<DomainStat[]> {
  const supabase = await createClient();

  const [sportsRes, marketsRes, newsRes, mediaRes] = await Promise.all([
    supabase.from("sports_news").select("created_at", { count: "exact", head: false }).order("created_at", { ascending: false }).limit(1),
    supabase.from("stock_quotes").select("fetched_at", { count: "exact", head: false }).order("fetched_at", { ascending: false }).limit(1),
    supabase.from("news_articles").select("created_at", { count: "exact", head: false }).order("created_at", { ascending: false }).limit(1),
    supabase.from("spotify_releases").select("created_at", { count: "exact", head: false }).order("created_at", { ascending: false }).limit(1),
  ]);

  const lastOf = (res: { data: any[] | null }, key: string) =>
    res.data?.[0]?.[key] ?? null;

  return [
    {
      domain: "Sports",
      accent: "hsl(25 95% 50%)",
      count: sportsRes.count,
      lastFetch: lastOf(sportsRes, "created_at"),
    },
    {
      domain: "Markets",
      accent: "hsl(142 65% 42%)",
      count: marketsRes.count,
      lastFetch: lastOf(marketsRes, "fetched_at"),
    },
    {
      domain: "News",
      accent: "hsl(220 90% 52%)",
      count: newsRes.count,
      lastFetch: lastOf(newsRes, "created_at"),
    },
    {
      domain: "Media",
      accent: "hsl(340 78% 50%)",
      count: mediaRes.count,
      lastFetch: lastOf(mediaRes, "created_at"),
    },
  ];
}

function syncAge(isoDate: string | null): string {
  if (!isoDate) return "never";
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}

export default async function DashboardPage() {
  const admin = await isSuperAdmin();
  if (!admin) redirect("/");

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const email = (claimsData?.claims?.email as string | undefined) ?? "";

  const stats = await getDomainStats();

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black tracking-tighter" style={{ fontFamily: "Georgia, serif" }}>
          ADMIN DASHBOARD
        </h1>
        <div className="mt-1 border-t-4 border-double border-border" />
        <p className="mt-2 text-[10px] font-mono tracking-widest text-muted-foreground uppercase">
          {email}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {stats.map((s) => (
          <div key={s.domain} className="border border-border flex flex-col">
            <div
              className="px-3 py-1.5 border-b border-border"
              style={{ borderLeftColor: s.accent, borderLeftWidth: 3 }}
            >
              <span className="text-[10px] font-mono tracking-widest uppercase font-bold">
                {s.domain}
              </span>
            </div>
            <div className="px-3 py-3 flex-1 flex flex-col gap-1">
              <span className="text-2xl font-black tabular-nums">
                {s.count?.toLocaleString() ?? "—"}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground tracking-wider">
                RECORDS
              </span>
              <span className="mt-auto text-[10px] font-mono text-muted-foreground tracking-wider">
                {syncAge(s.lastFetch)}
              </span>
            </div>
            <div className="px-3 py-2 border-t border-border">
              <EtlTriggerButton domain={s.domain.toLowerCase() as any} />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">
          Run all domains:
        </span>
        <EtlTriggerButton />
      </div>
    </div>
  );
}
