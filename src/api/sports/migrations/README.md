# Database Migrations

This directory contains SQL migration files for setting up the sports data database schema.

## Migration Files

1. **001_create_leagues_table.sql** - Creates the leagues table with all sport/league combinations
2. **002_create_sports_news_table.sql** - Creates the sports_news table for storing news articles
3. **003_create_sports_scores_table.sql** - Creates the sports_scores table for storing game scores and schedules

## Running Migrations

### Using Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Run each migration file in order (001, 002, 003)

### Using Supabase CLI

```bash
# If you have Supabase CLI installed
supabase db push
```

### Using psql

```bash
# Connect to your Supabase database
psql -h <your-db-host> -U postgres -d postgres

# Run migrations in order
\i src/data/migrations/001_create_leagues_table.sql
\i src/data/migrations/002_create_sports_news_table.sql
\i src/data/migrations/003_create_sports_scores_table.sql
```

## Schema Overview

### leagues
- Primary key: `id` (SERIAL)
- Unique constraint on `(sport, league)`
- Stores all sport/league combinations with display names

### sports_news
- Primary key: `id` (SERIAL)
- Foreign key: `league_id` → `leagues(id)`
- Unique constraint on `url` to prevent duplicate articles
- Stores news articles with title, description, URL, published date, etc.

### sports_scores
- Primary key: `id` (SERIAL)
- Foreign key: `league_id` → `leagues(id)`
- Unique constraint on `(league_id, event_id)` to prevent duplicate games
- Stores game/match information including scores, status, venue, etc.

## Notes

- All tables include `created_at` and `updated_at` timestamps
- The `updated_at` timestamp is automatically updated via triggers
- Foreign keys use `ON DELETE CASCADE` to maintain referential integrity
- Indexes are created for common query patterns

