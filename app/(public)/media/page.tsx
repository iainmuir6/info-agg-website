import { createClient } from "@/lib/supabase/server";

type SpotifyRelease = {
  id: number;
  spotify_id: string;
  name: string;
  artists: string[];
  album_type: string | null;
  release_date: string | null;
  image_url: string | null;
  external_url: string | null;
  total_tracks: number | null;
  fetched_at: string;
};

type RedditPost = {
  id: number;
  post_id: string;
  subreddit: string;
  title: string;
  author: string | null;
  score: number;
  upvote_ratio: number | null;
  num_comments: number;
  url: string | null;
  permalink: string | null;
  selftext: string | null;
  thumbnail_url: string | null;
  is_self: boolean;
  flair: string | null;
  posted_at: string | null;
};

async function getMediaData(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [releasesRes, postsRes] = await Promise.all([
    supabase
      .from("spotify_releases")
      .select("id, spotify_id, name, artists, album_type, release_date, image_url, external_url, total_tracks, fetched_at")
      .order("release_date", { ascending: false })
      .limit(40),
    supabase
      .from("reddit_posts")
      .select("id, post_id, subreddit, title, author, score, upvote_ratio, num_comments, url, permalink, selftext, thumbnail_url, is_self, flair, posted_at")
      .order("score", { ascending: false })
      .limit(50),
  ]);

  return {
    releases: (releasesRes.data ?? []) as SpotifyRelease[],
    posts: (postsRes.data ?? []) as RedditPost[],
  };
}

function formatScore(score: number) {
  if (score >= 1000) return `${(score / 1000).toFixed(1)}k`;
  return score.toString();
}

function getAlbumTypeLabel(type: string | null) {
  if (!type) return null;
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export default async function MediaPage() {
  const supabase = await createClient();
  const { releases, posts } = await getMediaData(supabase);

  // Group reddit posts by subreddit
  const subreddits = [...new Set(posts.map((p) => p.subreddit))].sort();

  const hasSpotify = releases.length > 0;
  const hasReddit = posts.length > 0;
  const hasData = hasSpotify || hasReddit;

  return (
    <div className="px-6 py-6 space-y-8">
      {/* Page header */}
      <div>
        <div className="rule-double mb-3" />
        <div className="flex items-baseline justify-between">
          <h2
            className="text-2xl font-black tracking-tight"
            style={{ fontFamily: "Georgia, serif" }}
          >
            <span style={{ color: "hsl(340 78% 50%)" }}>◎</span> MEDIA
          </h2>
          <span className="text-xs font-mono text-muted-foreground">
            {releases.length} releases · {posts.length} posts
          </span>
        </div>
        <p className="text-xs font-mono text-muted-foreground mt-1 tracking-wider">
          SPOTIFY · REDDIT
        </p>
      </div>

      {!hasData ? (
        <div className="border border-border p-12 text-center">
          <p className="text-xs font-mono text-muted-foreground tracking-wider">
            NO MEDIA DATA YET
          </p>
          <p className="text-xs font-mono text-muted-foreground/70 mt-3">
            The next scheduled sync should populate this page — check back shortly.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-border">
          {/* Spotify New Releases */}
          <div className="bg-background">
            <div
              className="flex items-center gap-3 px-5 py-3 border-b border-border"
              style={{ borderLeftWidth: "3px", borderLeftColor: "hsl(340 78% 50%)" }}
            >
              <span
                className="text-xs font-mono font-bold tracking-widest uppercase"
                style={{ color: "hsl(340 78% 50%)" }}
              >
                ♫ Spotify — New Releases
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">
                {releases.length} albums
              </span>
            </div>

            {!hasSpotify ? (
              <div className="p-8 text-center">
                <p className="text-xs font-mono text-muted-foreground">No Spotify data yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {releases.map((release, i) => (
                  <a
                    key={release.id}
                    href={release.external_url ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-4 px-5 py-3 group hover:bg-secondary transition-colors animate-fade-in-up"
                    style={{ animationDelay: `${i * 0.03}s` }}
                  >
                    {/* Album art */}
                    {release.image_url ? (
                      <div className="w-12 h-12 shrink-0 overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={release.image_url}
                          alt=""
                          className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-300"
                        />
                      </div>
                    ) : (
                      <div
                        className="w-12 h-12 shrink-0 flex items-center justify-center"
                        style={{ backgroundColor: "hsl(340 78% 50% / 0.1)" }}
                      >
                        <span
                          className="text-lg"
                          style={{ color: "hsl(340 78% 50%)" }}
                        >
                          ♫
                        </span>
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold leading-snug line-clamp-1 group-hover:underline">
                        {release.name}
                      </p>
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {release.artists.join(", ")}
                      </p>
                    </div>

                    {/* Meta */}
                    <div className="shrink-0 text-right">
                      {release.album_type && (
                        <p
                          className="text-[10px] font-mono tracking-wider uppercase"
                          style={{ color: "hsl(340 78% 50%)" }}
                        >
                          {getAlbumTypeLabel(release.album_type)}
                        </p>
                      )}
                      {release.release_date && (
                        <p className="text-[10px] font-mono text-muted-foreground">
                          {new Date(release.release_date).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </p>
                      )}
                      {release.total_tracks != null && (
                        <p className="text-[10px] font-mono text-muted-foreground">
                          {release.total_tracks} tracks
                        </p>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Reddit Hot Posts */}
          <div className="bg-background">
            <div
              className="flex items-center gap-3 px-5 py-3 border-b border-border"
              style={{ borderLeftWidth: "3px", borderLeftColor: "hsl(25 95% 50%)" }}
            >
              <span
                className="text-xs font-mono font-bold tracking-widest uppercase"
                style={{ color: "hsl(25 95% 50%)" }}
              >
                ▲ Reddit — Top Posts
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">
                {subreddits.length} subreddits
              </span>
            </div>

            {!hasReddit ? (
              <div className="p-8 text-center">
                <p className="text-xs font-mono text-muted-foreground">No Reddit data yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {posts.map((post, i) => {
                  const link = post.is_self
                    ? post.permalink ?? post.url ?? "#"
                    : post.url ?? post.permalink ?? "#";

                  return (
                    <a
                      key={post.id}
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex gap-4 px-5 py-3 group hover:bg-secondary transition-colors animate-fade-in-up"
                      style={{ animationDelay: `${i * 0.02}s` }}
                    >
                      {/* Score */}
                      <div className="shrink-0 flex flex-col items-center justify-center w-10">
                        <span
                          className="text-[10px] font-mono font-bold"
                          style={{ color: "hsl(25 95% 50%)" }}
                        >
                          ▲
                        </span>
                        <span className="text-xs font-mono font-bold tabular-nums">
                          {formatScore(post.score)}
                        </span>
                      </div>

                      {/* Thumbnail */}
                      {post.thumbnail_url ? (
                        <div className="w-12 h-10 shrink-0 overflow-hidden">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={post.thumbnail_url}
                            alt=""
                            className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all"
                          />
                        </div>
                      ) : null}

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold leading-snug line-clamp-2 group-hover:underline">
                          {post.title}
                        </p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span
                            className="text-[10px] font-mono tracking-wider"
                            style={{ color: "hsl(25 95% 50%)" }}
                          >
                            r/{post.subreddit}
                          </span>
                          {post.author && (
                            <span className="text-[10px] font-mono text-muted-foreground">
                              · u/{post.author}
                            </span>
                          )}
                          <span className="text-[10px] font-mono text-muted-foreground">
                            · {post.num_comments} comments
                          </span>
                          {post.flair && (
                            <span className="text-[10px] font-mono px-1 bg-secondary text-muted-foreground">
                              {post.flair}
                            </span>
                          )}
                        </div>
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
