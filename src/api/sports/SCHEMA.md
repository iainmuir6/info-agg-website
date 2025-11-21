# Sports Database Schema

This document describes the database schema for storing sports data (news and scores) from ESPN API.

## Tables

### 1. `leagues`
Stores all sport/league combinations with unique IDs.

**Columns:**
- `id` (SERIAL PRIMARY KEY) - Unique identifier for each league
- `sport` (TEXT) - Sport name (e.g., 'football', 'basketball')
- `league` (TEXT) - League name (e.g., 'nfl', 'nba')
- `display_name` (TEXT) - Human-readable league name
- `is_active` (BOOLEAN) - Whether the league is currently active
- `created_at` (TIMESTAMP) - When the record was created
- `updated_at` (TIMESTAMP) - When the record was last updated

**Constraints:**
- UNIQUE(sport, league) - Prevents duplicate sport/league combinations

**Indexes:**
- `idx_leagues_sport_league` - For fast lookups by sport and league
- `idx_leagues_is_active` - For filtering active leagues

### 2. `sports_news`
Stores news articles for each league.

**Columns:**
- `id` (SERIAL PRIMARY KEY) - Unique identifier for each article
- `league_id` (INTEGER) - Foreign key to `leagues.id`
- `title` (TEXT) - Article headline
- `description` (TEXT) - Article description/summary
- `url` (TEXT) - Article URL (unique)
- `published_at` (TIMESTAMP) - When the article was published
- `source` (TEXT) - News source (default: 'ESPN')
- `image_url` (TEXT) - URL to article image (nullable)
- `created_at` (TIMESTAMP) - When the record was created
- `updated_at` (TIMESTAMP) - When the record was last updated

**Constraints:**
- FOREIGN KEY `league_id` REFERENCES `leagues(id)` ON DELETE CASCADE
- UNIQUE(url) - Prevents duplicate articles

**Indexes:**
- `idx_sports_news_league_id` - For filtering by league
- `idx_sports_news_published_at` - For sorting by publication date
- `idx_sports_news_created_at` - For sorting by insertion date
- `idx_sports_news_url` - For fast URL lookups

### 3. `sports_scores`
Stores game/match scores and schedule information.

**Columns:**
- `id` (SERIAL PRIMARY KEY) - Unique identifier for each game
- `league_id` (INTEGER) - Foreign key to `leagues.id`
- `event_id` (TEXT) - ESPN's event ID for the game
- `home_team` (TEXT) - Home team name
- `away_team` (TEXT) - Away team name
- `home_score` (INTEGER) - Home team score (nullable)
- `away_score` (INTEGER) - Away team score (nullable)
- `home_record` (TEXT) - Home team record (nullable)
- `away_record` (TEXT) - Away team record (nullable)
- `status` (TEXT) - Game status (e.g., 'Final', 'In Progress')
- `status_detail` (TEXT) - Detailed status information (nullable)
- `game_date` (TIMESTAMP) - Scheduled/actual game date and time
- `venue` (TEXT) - Venue name (nullable)
- `broadcast` (TEXT) - Broadcast network (nullable)
- `week` (INTEGER) - Week number for season (nullable)
- `season` (INTEGER) - Season year (nullable)
- `created_at` (TIMESTAMP) - When the record was created
- `updated_at` (TIMESTAMP) - When the record was last updated

**Constraints:**
- FOREIGN KEY `league_id` REFERENCES `leagues(id)` ON DELETE CASCADE
- UNIQUE(league_id, event_id) - Prevents duplicate games

**Indexes:**
- `idx_sports_scores_league_id` - For filtering by league
- `idx_sports_scores_event_id` - For looking up specific events
- `idx_sports_scores_game_date` - For sorting by game date
- `idx_sports_scores_season` - For filtering by season
- `idx_sports_scores_week` - For filtering by week
- `idx_sports_scores_status` - For filtering by game status
- `idx_sports_scores_league_date` - Composite index for league + date queries

## Relationships

```
leagues (1) ──< (many) sports_news
leagues (1) ──< (many) sports_scores
```

- Each league can have many news articles
- Each league can have many games/scores
- Deleting a league will cascade delete all associated news and scores

## Usage Examples

### Get all leagues
```sql
SELECT * FROM leagues WHERE is_active = true;
```

### Get latest news for a specific league
```sql
SELECT n.*, l.display_name as league_name
FROM sports_news n
JOIN leagues l ON n.league_id = l.id
WHERE l.sport = 'football' AND l.league = 'nfl'
ORDER BY n.published_at DESC
LIMIT 10;
```

### Get upcoming games for a league
```sql
SELECT s.*, l.display_name as league_name
FROM sports_scores s
JOIN leagues l ON s.league_id = l.id
WHERE l.sport = 'basketball' 
  AND l.league = 'nba'
  AND s.game_date > NOW()
ORDER BY s.game_date ASC;
```

### Get completed games with scores
```sql
SELECT s.*, l.display_name as league_name
FROM sports_scores s
JOIN leagues l ON s.league_id = l.id
WHERE s.status = 'STATUS_FINAL'
  AND s.home_score IS NOT NULL
  AND s.away_score IS NOT NULL
ORDER BY s.game_date DESC
LIMIT 20;
```

## Python Helper Functions

Use `sports_db_helper.py` to insert data:

```python
from sports_db_helper import get_supabase_client, sync_all_sports_data

# Sync all sports data
supabase = get_supabase_client()
stats = sync_all_sports_data(supabase, news_limit_per_sport=20)
```

## Environment Variables Required

- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for server-side operations (keep secret!)

