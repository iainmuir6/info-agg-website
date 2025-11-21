-- Create leagues table
-- This table stores all sports/league combinations with unique IDs
CREATE TABLE IF NOT EXISTS leagues (
    id SERIAL PRIMARY KEY,
    sport TEXT NOT NULL,
    league TEXT NOT NULL,
    display_name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(sport, league)
);

-- Create index on sport and league for faster lookups
CREATE INDEX IF NOT EXISTS idx_leagues_sport_league ON leagues(sport, league);
CREATE INDEX IF NOT EXISTS idx_leagues_is_active ON leagues(is_active);

-- Insert initial league data based on SPORT_CONFIGS
INSERT INTO leagues (sport, league, display_name) VALUES
    -- Football
    ('football', 'nfl', 'NFL'),
    ('football', 'college-football', 'College Football'),
    -- Basketball
    ('basketball', 'nba', 'NBA'),
    ('basketball', 'wnba', 'WNBA'),
    ('basketball', 'mens-college-basketball', 'Men''s College Basketball'),
    ('basketball', 'womens-college-basketball', 'Women''s College Basketball'),
    -- Baseball
    ('baseball', 'mlb', 'MLB'),
    ('baseball', 'college-baseball', 'College Baseball'),
    -- Hockey
    ('hockey', 'nhl', 'NHL'),
    -- Soccer
    ('soccer', 'eng.1', 'English Premier League')
ON CONFLICT (sport, league) DO NOTHING;

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_leagues_updated_at
    BEFORE UPDATE ON leagues
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

