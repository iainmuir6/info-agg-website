import "server-only";

// Server-side Spotify show search (client-credentials flow) backing the
// "look up a podcast to favorite" UI. Read-only and user-triggered — not
// part of the ETL, so it isn't subject to the ETL's rate/perf constraints.

type CachedToken = { token: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) return null;

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;

  // Refresh a little early so a search never races an about-to-expire token.
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 30_000 };
  return cachedToken.token;
}

export type PodcastSearchResult = {
  showId: string;
  name: string;
  publisher: string | null;
  imageUrl: string | null;
};

/** Search Spotify shows (podcasts) by name. Returns [] on any failure —
 *  callers treat that the same as "no results" rather than surfacing
 *  Spotify-specific errors to the UI. */
export async function searchPodcasts(query: string, limit = 10): Promise<PodcastSearchResult[]> {
  const token = await getAccessToken();
  if (!token) return [];

  const params = new URLSearchParams({ q: query, type: "show", market: "US", limit: String(limit) });
  const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];

  const data = await res.json();
  const items = data?.shows?.items ?? [];
  return items.map((item: Record<string, unknown>) => ({
    showId: item.id,
    name: item.name,
    publisher: item.publisher ?? null,
    imageUrl: (item.images as { url?: string }[] | undefined)?.[0]?.url ?? null,
  }));
}


/** Cover art for a set of show IDs, keyed by ID.
 *
 *  The curated TOP_PODCASTS list carries only names and IDs, so the homepage
 *  card had a generic glyph where every other card shows artwork. Spotify's
 *  /v1/shows endpoint takes up to 50 IDs per request, so the whole list is one
 *  call — wrapped in unstable_cache by the caller so it is not re-fetched on
 *  every render. Returns {} on any failure; callers fall back to the glyph.
 */
export async function getShowImages(
  showIds: string[]
): Promise<Record<string, string>> {
  if (showIds.length === 0) return {};

  const token = await getAccessToken();
  if (!token) return {};

  const out: Record<string, string> = {};
  // 50 is Spotify's hard cap on this endpoint.
  for (let i = 0; i < showIds.length; i += 50) {
    const batch = showIds.slice(i, i + 50);
    try {
      const res = await fetch(
        `https://api.spotify.com/v1/shows?ids=${batch.join(",")}&market=US`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) continue;
      const data = (await res.json()) as {
        shows?: ({ id?: string; images?: { url?: string; width?: number }[] } | null)[];
      };
      for (const show of data.shows ?? []) {
        if (!show?.id) continue;
        // Smallest image that is still >= the ~24px the card renders, so the
        // browser is not decoding a 640px cover for a thumbnail.
        const images = [...(show.images ?? [])].sort(
          (a, b) => (a.width ?? 0) - (b.width ?? 0)
        );
        const pick = images.find((im) => (im.width ?? 0) >= 64) ?? images[images.length - 1];
        if (pick?.url) out[show.id] = pick.url;
      }
    } catch {
      // Leave this batch out; the glyph fallback covers it.
    }
  }
  return out;
}
