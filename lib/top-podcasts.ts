// Curated Top Podcasts list — Spotify's public API (client-credentials, no
// user OAuth) has no "top podcasts" discovery endpoint, so this is a
// hand-picked list off Spotify's own Podcast Charts page
// (open.spotify.com/genre/0JQ5DAB3zgCauRwnvdEQjJ), embedded live via
// Spotify's show iframe — no backend fetch/table needed, always current.

export type TopPodcast = { name: string; showId: string };

// Ordered roughly by mainstream popularity — the homepage panel shows the
// first 10, /media shows all of them (verified against Spotify's Search API,
// each ID resolved back to the intended show via oEmbed before landing here).
export const TOP_PODCASTS: TopPodcast[] = [
  { name: "The Joe Rogan Experience", showId: "4rOoJ6Egrf8K2IrywzwOMk" },
  { name: "Call Her Daddy", showId: "7bnjJ7Va1nM07Um4Od55dW" },
  { name: "The Daily", showId: "3IM0lmZxpFAY7CwMuv9H4g" },
  { name: "Crime Junkie", showId: "3DgfoleqaW61T2amZQKINx" },
  { name: "This Past Weekend w/ Theo Von", showId: "6PwE1CIZsgfrhX6Bw96PUN" },
  { name: "SmartLess", showId: "0Yzd0g8NYmn27k2HFNplv7" },
  { name: "Stuff You Should Know", showId: "0ofXAdFIQQRsCYj9754UFx" },
  { name: "Armchair Expert with Dax Shepard", showId: "6kAsbP8pxwaU2kPibKTuHE" },
  { name: "The Shawn Ryan Show", showId: "5eodRZd3qR9VT1ip1wI7xQ" },
  { name: "My Favorite Murder", showId: "0U9S5J2ltMaKdxIfLuEjzE" },
  { name: "Huberman Lab", showId: "79CkJF3UJTHFV8Dse3Oy0P" },
  { name: "Conan O'Brien Needs A Friend", showId: "3u26tlz7A3WyWRtXliX9a9" },
  { name: "WTF with Marc Maron", showId: "6L47MDMO3xuN2XBed7miEI" },
  { name: "Pod Save America", showId: "5JGorGvdwljJHTl6wpMXN3" },
  { name: "Freakonomics Radio", showId: "6z4NLXyHPga1UmSJsPK7G1" },
  { name: "Serial", showId: "5wMPFS9B5V7gg6hZ3UZ7hf" },
  { name: "The Bill Simmons Podcast", showId: "07SjDmKb9iliEzpNcN2xGD" },
  { name: "Radiolab", showId: "2hmkzUtix0qTqvtpPcMzEL" },
  { name: "Up First from NPR", showId: "2mTUnDkuKUkhiueKcVWoP0" },
  { name: "The Tim Ferriss Show", showId: "5qSUyCrk9KR69lEiXbjwXM" },
  { name: "The Journal.", showId: "0KxdEdeY2Wb3zr28dMlQva" },
  { name: "Good Hang with Amy Poehler", showId: "1z20EiwuKoDiftKxMVLde1" },
];

export function spotifyShowEmbedUrl(showId: string): string {
  return `https://open.spotify.com/embed/show/${showId}?utm_source=generator`;
}

export type SpotifyPlaylist = { name: string; playlistId: string };

export const SPOTIFY_HOME_PLAYLISTS: SpotifyPlaylist[] = [
  { name: "Top 100 Now", playlistId: "4hOKQuZbraPDIfaGbM3lKI" },
  { name: "Today's Top Hits", playlistId: "37i9dQZF1DXcBWIGoYBM5M" },
];
