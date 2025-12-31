-- Fix nullable user_id columns by making them NOT NULL with foreign key constraints

-- First, delete any existing records with NULL user_id (if any exist)
DELETE FROM portfolios WHERE user_id IS NULL;
DELETE FROM user_settings WHERE user_id IS NULL;
DELETE FROM watchlist WHERE user_id IS NULL;

-- Make user_id NOT NULL on all tables
ALTER TABLE portfolios 
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE user_settings 
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE watchlist 
  ALTER COLUMN user_id SET NOT NULL;