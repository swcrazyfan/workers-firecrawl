-- Add json column to results table if it doesn't exist
-- This is needed for existing databases that were created before the json column was added

-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN
-- So we'll use a workaround: try to add it and ignore errors

-- Add json column to results table
ALTER TABLE results ADD COLUMN json TEXT;