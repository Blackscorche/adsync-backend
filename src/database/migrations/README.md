# Database Migrations

## Overview
This directory contains SQL migration files that update the database schema over time.

## How the Smart Migration System Works
The `npm run migrate` command now does BOTH:
1. **If database is empty** → Creates all base tables from schema.sql
2. **If tables exist** → Only runs new migrations from this folder
3. **Tracks migrations** → Records what has run in a `migrations` table

## Creating a New Migration
1. Create a new `.sql` file in this directory
2. Name it with the next number in sequence (e.g., `002_add_new_feature.sql`)
3. Write your SQL commands in the file
4. Run `npm run migrate` to execute it

## Available Commands
- `npm run migrate` - Smart migration (creates tables if needed + runs migrations)
- `npm run seed` - Adds test data to the database

## Usage Scenarios

### Fresh Installation:
```bash
npm run migrate  # Creates all tables + runs migrations
npm run seed     # Add test data
```

### Existing Database:
```bash
npm run migrate  # Only runs new migrations
```

## Migration History
- `001_add_playlist_description.sql` - Adds description column to playlists table

## Best Practices
1. Always test migrations on a development database first
2. Keep migrations small and focused
3. Never modify an existing migration that has been run
4. Include both the change and any necessary data updates
5. Use `IF NOT EXISTS` and `IF EXISTS` clauses to make migrations idempotent