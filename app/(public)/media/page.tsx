import { createClient } from "@/lib/supabase/server";
import { SPOTIFY_HOME_PLAYLISTS, spotifyShowEmbedUrl } from "@/lib/top-podcasts";
import { buildPodcastList } from "@/lib/podcast-list";
import { FavoritePodcastButton } from "@/components/favorite-podcast-button";

type YouTubeVideo = {
  id: string;
  video_id: string;
  title: string;
  channel_title: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  view_count: number | null;
  like_count: number | null;
  duration: string | null;
};

async function getMediaData(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase
    .from("youtube_videos")
    .select("id, video_id, title, channel_title, thumbnail_url, published_at, view_count, like_count, duration")
    .order("view_count", { ascending: false })
    .limit(30);

  return { videos: (data ?? []) as YouTubeVideo[] };
}

/** 1234567 → 1.2M */
function formatCount(n: number | null) {
  if (n == null) return null;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

/** ISO-8601 duration (PT1H2M3S) → 1:02:03 */
function formatDuration(iso: string | null) {
  if (!iso) return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const [h, mi, s] = [m[1] ? +m[1] : 0, m[2] ? +m[2] : 0, m[3] ? +m[3] : 0];
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(mi)}:${pad(s)}` : `${mi}:${pad(s)}`;
}

const SPOTIFY_EMBED_ALLOW =
  "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";

export default async function MediaPage() {
  const supabase = await createClient();
  const { videos } = await getMediaData(supabase);

  const { data: claimsData } = await supabase.auth.getClaims();
  const signedIn = !!claimsData?.claims;
  const userId = claimsData?.claims?.sub as string | undefined;
  const { data: favoriteRows } = signedIn
    ? await supabase.from("watchlist_podcasts").select("show_id, name, image_url").eq("user_id", userId!)
    : { data: null };
  const podcasts = buildPodcastList(favoriteRows ?? []);

  const hasYouTube = videos.length > 0;
  const hasData = hasYouTube || SPOTIFY_HOME_PLAYLISTS.length > 0 || podcasts.length > 0;

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-8">
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
            {videos.length} videos
          </span>
        </div>
        <p className="text-xs font-mono text-muted-foreground mt-1 tracking-wider">
          SPOTIFY · PODCASTS · YOUTUBE
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
          {/* YouTube Trending */}
          {hasYouTube && (
            <div className="bg-background lg:col-span-2">
              <div
                className="flex items-center gap-3 px-5 py-3 border-b border-border"
                style={{ borderLeftWidth: "3px", borderLeftColor: "hsl(0 72% 50%)" }}
              >
                <span
                  className="text-xs font-mono font-bold tracking-widest uppercase"
                  style={{ color: "hsl(0 72% 50%)" }}
                >
                  ▶ YouTube — Trending
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {videos.length} videos
                </span>
              </div>
              <div className="divide-y divide-border">
                {videos.map((v) => {
                  const views = formatCount(v.view_count);
                  const dur = formatDuration(v.duration);
                  return (
                    <a
                      key={v.id}
                      href={`https://www.youtube.com/watch?v=${v.video_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tap-row flex items-center gap-3 px-4 py-2.5 hover:bg-secondary transition-colors group"
                    >
                      {v.thumbnail_url && (
                        <div className="relative w-20 h-12 shrink-0 overflow-hidden bg-secondary">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={v.thumbnail_url}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                          {dur && (
                            <span className="absolute bottom-0 right-0 bg-black/80 text-white text-[8px] font-mono px-1 leading-tight">
                              {dur}
                            </span>
                          )}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold leading-snug line-clamp-2 group-hover:underline">
                          {v.title}
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground mt-1 truncate">
                          {v.channel_title}
                          {views && <span> · {views} views</span>}
                        </p>
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {/* Spotify — live playlist embeds */}
          <div className="bg-background lg:col-span-2">
            <div
              className="flex items-center gap-3 px-5 py-3 border-b border-border"
              style={{ borderLeftWidth: "3px", borderLeftColor: "hsl(340 78% 50%)" }}
            >
              <span
                className="text-xs font-mono font-bold tracking-widest uppercase"
                style={{ color: "hsl(340 78% 50%)" }}
              >
                ♫ Spotify
              </span>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {SPOTIFY_HOME_PLAYLISTS.map((p) => (
                <div key={p.playlistId}>
                  <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">
                    {p.name}
                  </p>
                  <iframe
                    src={`https://open.spotify.com/embed/playlist/${p.playlistId}?utm_source=generator`}
                    width="100%"
                    height="352"
                    allow={SPOTIFY_EMBED_ALLOW}
                    loading="lazy"
                    className="rounded-md border-0"
                    title={`Spotify playlist: ${p.name}`}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Top Podcasts — curated, live show embeds. Full-width + a
              multi-column grid packs far more shows into the same vertical
              space than a single stacked column would. */}
          <div className="bg-background lg:col-span-2">
            <div
              className="flex items-center gap-3 px-5 py-3 border-b border-border"
              style={{ borderLeftWidth: "3px", borderLeftColor: "hsl(142 65% 42%)" }}
            >
              <span
                className="text-xs font-mono font-bold tracking-widest uppercase"
                style={{ color: "hsl(142 65% 42%)" }}
              >
                🎙 Top Podcasts
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">
                {podcasts.length} shows
              </span>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {podcasts.map((p) => (
                <div key={p.showId} className="relative">
                  {signedIn && (
                    <FavoritePodcastButton
                      showId={p.showId}
                      name={p.name}
                      imageUrl={p.imageUrl}
                      initialFavorited={p.favorited}
                      signedIn={signedIn}
                      className="absolute top-1.5 right-1.5 z-10 bg-background/90 rounded-full w-5 h-5 flex items-center justify-center shadow"
                    />
                  )}
                  <iframe
                    src={spotifyShowEmbedUrl(p.showId)}
                    width="100%"
                    height="152"
                    allow={SPOTIFY_EMBED_ALLOW}
                    loading="lazy"
                    className="rounded-md border-0"
                    title={`Spotify podcast: ${p.name}`}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
