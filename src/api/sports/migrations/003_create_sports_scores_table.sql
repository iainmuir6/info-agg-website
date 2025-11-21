-- Create sports_scores table
-- This table stores game/match scores and schedule information
CREATE TABLE IF NOT EXISTS sports_scores (
    id SERIAL PRIMARY KEY,
    league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    home_score INTEGER,
    away_score INTEGER,
    home_record TEXT,
    away_record TEXT,
    status TEXT,
    status_detail TEXT,
    game_date TIMESTAMP WITH TIME ZONE,
    venue TEXT,
    broadcast TEXT,
    week INTEGER,
    season INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(league_id, event_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_sports_scores_league_id ON sports_scores(league_id);
CREATE INDEX IF NOT EXISTS idx_sports_scores_event_id ON sports_scores(event_id);
CREATE INDEX IF NOT EXISTS idx_sports_scores_game_date ON sports_scores(game_date DESC);
CREATE INDEX IF NOT EXISTS idx_sports_scores_season ON sports_scores(season DESC);
CREATE INDEX IF NOT EXISTS idx_sports_scores_week ON sports_scores(week);
CREATE INDEX IF NOT EXISTS idx_sports_scores_status ON sports_scores(status);
CREATE INDEX IF NOT EXISTS idx_sports_scores_league_date ON sports_scores(league_id, game_date DESC);

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_sports_scores_updated_at
    BEFORE UPDATE ON sports_scores
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

