import { TOP_PODCASTS } from "@/lib/top-podcasts";

export type FavoritedPodcastRow = { show_id: string; name: string; image_url: string | null };

export type PodcastListItem = {
  showId: string;
  name: string;
  imageUrl: string | null;
  favorited: boolean;
};

/** Favorites first (including ones a user found via search, not just the
 *  curated set), then the remaining curated shows fill out the rest. */
export function buildPodcastList(favorites: FavoritedPodcastRow[]): PodcastListItem[] {
  const favoriteIds = new Set(favorites.map((f) => f.show_id));
  const favoriteItems: PodcastListItem[] = favorites.map((f) => ({
    showId: f.show_id,
    name: f.name,
    imageUrl: f.image_url,
    favorited: true,
  }));
  const curatedItems: PodcastListItem[] = TOP_PODCASTS.filter((p) => !favoriteIds.has(p.showId)).map((p) => ({
    showId: p.showId,
    name: p.name,
    imageUrl: null,
    favorited: false,
  }));
  return [...favoriteItems, ...curatedItems];
}
