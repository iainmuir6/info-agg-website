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
