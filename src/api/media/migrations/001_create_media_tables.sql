-- Media Tables Migration
-- Author: IM
-- Date: 2026-03-04
-- Description: Creates tables for Spotify new releases and Reddit hot posts

-- ============================================================
-- SPOTIFY RELEASES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.spotify_releases (
    id SERIAL PRIMARY KEY,
    spotify_id TEXT NOT NULL,
    name TEXT NOT NULL,
    artists TEXT[] NOT NULL DEFAULT '{}',
    album_type TEXT,                               -- album, single, compilation
    release_date DATE,
    image_url TEXT,
    external_url TEXT,
    total_tracks INTEGER,
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT spotify_releases_spotify_id_unique UNIQUE (spotify_id)
);

CREATE INDEX IF NOT EXISTS idx_spotify_releases_release_date ON info_agg.spotify_releases(release_date DESC);
CREATE INDEX IF NOT EXISTS idx_spotify_releases_album_type ON info_agg.spotify_releases(album_type);
CREATE INDEX IF NOT EXISTS idx_spotify_releases_fetched_at ON info_agg.spotify_releases(fetched_at DESC);

ALTER TABLE info_agg.spotify_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to spotify_releases"
    ON spotify_releases FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "Allow service role full access to spotify_releases"
    ON spotify_releases FOR ALL
    TO service_role
    USING (true);

-- ============================================================
-- REDDIT POSTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.reddit_posts (
    id SERIAL PRIMARY KEY,
    post_id TEXT NOT NULL,
    subreddit TEXT NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    score INTEGER DEFAULT 0,
    upvote_ratio DECIMAL(5, 4),
    num_comments INTEGER DEFAULT 0,
    url TEXT,
    permalink TEXT,
    selftext TEXT,
    thumbnail_url TEXT,
    is_self BOOLEAN DEFAULT FALSE,
    flair TEXT,
    posted_at TIMESTAMP WITH TIME ZONE,
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT reddit_posts_post_id_unique UNIQUE (post_id)
);

CREATE INDEX IF NOT EXISTS idx_reddit_posts_subreddit ON info_agg.reddit_posts(subreddit);
CREATE INDEX IF NOT EXISTS idx_reddit_posts_score ON info_agg.reddit_posts(score DESC);
CREATE INDEX IF NOT EXISTS idx_reddit_posts_posted_at ON info_agg.reddit_posts(posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_reddit_posts_fetched_at ON info_agg.reddit_posts(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_reddit_posts_subreddit_score ON info_agg.reddit_posts(subreddit, score DESC);

ALTER TABLE info_agg.reddit_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to reddit_posts"
    ON reddit_posts FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "Allow service role full access to reddit_posts"
    ON reddit_posts FOR ALL
    TO service_role
    USING (true);
