"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

type Article = {
  id: number;
  source: string;
  section: string | null;
  title: string;
  abstract: string | null;
  byline: string | null;
  url: string;
  image_url: string | null;
  published_at: string | null;
};

const PAGE_SIZE = 20;

export default function NewsInfiniteScroll() {
  // Filter options are discovered from the data — a section or source with no
  // stories (or one the ETL no longer fetches) never appears as a chip.
  const [sections, setSections] = useState<string[]>(["All"]);
  const [sources, setSources] = useState<string[]>(["All"]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [section, setSection] = useState("All");
  const [source, setSource] = useState("All");

  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from("news_articles")
          .select("section, source")
          .limit(1000);
        const secs = new Set<string>();
        const srcs = new Set<string>();
        for (const row of data ?? []) {
          if (row.section) secs.add(String(row.section).toLowerCase());
          if (row.source) srcs.add(String(row.source).toLowerCase());
        }
        setSections(["All", ...[...secs].sort()]);
        setSources(["All", ...[...srcs].sort()]);
      } catch {
        // leave the defaults ("All" only) in place
      }
    })();
  }, []);

  const fetchArticles = useCallback(
    async (reset: boolean = false) => {
      const supabase = createClient();
      const currentOffset = reset ? 0 : offset;

      if (reset) setLoading(true);
      else setLoadingMore(true);

      try {
        let query = supabase
          .from("news_articles")
          .select("id, source, section, title, abstract, byline, url, image_url, published_at")
          .order("published_at", { ascending: false })
          .range(currentOffset, currentOffset + PAGE_SIZE - 1);

        if (section !== "All") query = query.eq("section", section);
        if (source !== "All") query = query.eq("source", source);

        const { data, error } = await query;

        if (error) throw error;

        const incoming = data ?? [];
        setArticles((prev) => (reset ? incoming : [...prev, ...incoming]));
        setOffset(currentOffset + incoming.length);
        setHasMore(incoming.length === PAGE_SIZE);
      } catch (err) {
        console.error("Error fetching articles:", err);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [offset, section, source]
  );

  // Reset on filter change
  useEffect(() => {
    setOffset(0);
    setHasMore(true);
    fetchArticles(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, source]);

  // Intersection observer for infinite scroll sentinel
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          fetchArticles(false);
        }
      },
      { rootMargin: "200px" }
    );

    if (sentinelRef.current) {
      observerRef.current.observe(sentinelRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [hasMore, loadingMore, loading, fetchArticles]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-6">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mr-1">
            Section
          </span>
          {sections.map((s) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 border transition-colors ${
                section === s
                  ? "border-news bg-news text-white"
                  : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
              }`}
              style={
                section === s
                  ? { borderColor: "hsl(220 90% 52%)", backgroundColor: "hsl(220 90% 52%)", color: "white" }
                  : {}
              }
            >
              {s}
            </button>
          ))}
        </div>
        <div className={`items-center gap-1 ${sources.length > 2 ? "flex" : "hidden"}`}>
          <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mr-1">
            Source
          </span>
          {sources.map((s) => (
            <button
              key={s}
              onClick={() => setSource(s)}
              className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 border transition-colors ${
                source === s
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Article list */}
      {loading ? (
        <div className="space-y-px bg-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-background p-4 animate-pulse">
              <div className="h-3 bg-secondary rounded w-1/4 mb-2" />
              <div className="h-4 bg-secondary rounded w-3/4 mb-1" />
              <div className="h-3 bg-secondary rounded w-full" />
            </div>
          ))}
        </div>
      ) : articles.length === 0 ? (
        <div className="border border-border p-12 text-center">
          <p className="text-xs font-mono text-muted-foreground tracking-wider">
            NO ARTICLES YET
          </p>
          <p className="text-xs font-mono text-muted-foreground/70 mt-3">
            The next scheduled sync should populate this page — check back shortly.
          </p>
        </div>
      ) : (
        <div className="space-y-px bg-border">
          {articles.map((article, i) => (
            <article
              key={article.id}
              className="bg-background group animate-fade-in-up"
              style={{ animationDelay: `${Math.min(i * 0.03, 0.3)}s` }}
            >
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex gap-0 hover:bg-secondary transition-colors"
              >
                {/* Article image */}
                {article.image_url ? (
                  <div className="w-24 h-20 shrink-0 overflow-hidden border-r border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={article.image_url}
                      alt=""
                      className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-300"
                    />
                  </div>
                ) : (
                  <div className="w-24 h-20 shrink-0 border-r border-border flex items-center justify-center">
                    <span className="text-[10px] font-mono text-muted-foreground/30 uppercase">
                      {article.source}
                    </span>
                  </div>
                )}

                {/* Content */}
                <div className="flex-1 p-4 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="text-[10px] font-mono uppercase tracking-widest"
                      style={{ color: "hsl(220 90% 52%)" }}
                    >
                      {article.source}
                    </span>
                    {article.section && (
                      <span className="text-[10px] font-mono text-muted-foreground uppercase">
                        · {article.section}
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-muted-foreground ml-auto shrink-0">
                      {formatDate(article.published_at)}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold leading-snug line-clamp-2 group-hover:underline">
                    {article.title}
                  </h3>
                  {article.abstract && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                      {article.abstract}
                    </p>
                  )}
                  {article.byline && (
                    <p className="text-[10px] font-mono text-muted-foreground mt-1.5">
                      {article.byline}
                    </p>
                  )}
                </div>
              </a>
            </article>
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-8" />

      {/* Loading more indicator */}
      {loadingMore && (
        <div className="py-6 flex items-center justify-center gap-3">
          <div className="w-1.5 h-1.5 bg-foreground animate-pulse-dot rounded-full" />
          <div className="w-1.5 h-1.5 bg-foreground animate-pulse-dot rounded-full stagger-2" />
          <div className="w-1.5 h-1.5 bg-foreground animate-pulse-dot rounded-full stagger-4" />
        </div>
      )}

      {!hasMore && articles.length > 0 && (
        <div className="py-6 text-center">
          <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">
            — End of Feed —
          </p>
        </div>
      )}
    </div>
  );
}
