-- Migration: Add description column to playlists table
-- Date: 2025-09-11
-- Purpose: Allow playlists to have optional descriptions

ALTER TABLE playlists 
ADD COLUMN IF NOT EXISTS description TEXT;