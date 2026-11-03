-- Migration: Add summary field to skills table for lazy loading
-- Purpose: Enable token-efficient skill context injection
--
-- Changes:
-- 1. Add 'summary' column for lightweight skill descriptions (~20 words)
-- 2. Add 'is_archived' column to support soft deletion
-- 3. Add 'last_used' timestamp for tracking recent skill usage
-- 4. Add 'created_at' and 'last_modified' timestamps if not exists
-- 5. Add 'version' for skill versioning
-- 6. Add 'code', 'code_type', 'prerequisites', 'uses_skills', 'used_by_skills', 'created_from', 'notes'
--
-- Rollback: Run 001_rollback_skill_summary.sql

-- Add new columns to skills table (SQLite doesn't support multiple columns in one ALTER)
-- Using IF NOT EXISTS pattern for idempotency

-- Add summary column (lightweight description for context injection)
ALTER TABLE skills ADD COLUMN summary TEXT;

-- Add archival flag (for soft deletion)
ALTER TABLE skills ADD COLUMN is_archived INTEGER DEFAULT 0;

-- Add timestamps
ALTER TABLE skills ADD COLUMN last_used TEXT;
ALTER TABLE skills ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE skills ADD COLUMN last_modified TEXT DEFAULT CURRENT_TIMESTAMP;

-- Add versioning
ALTER TABLE skills ADD COLUMN version INTEGER DEFAULT 1;

-- Add extended skill information
ALTER TABLE skills ADD COLUMN code TEXT;
ALTER TABLE skills ADD COLUMN code_type TEXT DEFAULT 'reference';
ALTER TABLE skills ADD COLUMN prerequisites TEXT;  -- JSON array
ALTER TABLE skills ADD COLUMN uses_skills TEXT;    -- JSON array of skill IDs
ALTER TABLE skills ADD COLUMN used_by_skills TEXT; -- JSON array of skill IDs
ALTER TABLE skills ADD COLUMN created_from TEXT;   -- Conversation ID
ALTER TABLE skills ADD COLUMN notes TEXT;

-- Create index for lazy loading queries (archived flag + quality score)
CREATE INDEX IF NOT EXISTS idx_skills_lazy_loading
  ON skills(is_archived, avg_user_satisfaction DESC, success_count DESC);

-- Create index for last_used queries (finding recently used skills)
CREATE INDEX IF NOT EXISTS idx_skills_last_used
  ON skills(last_used DESC)
  WHERE is_archived = 0 AND last_used IS NOT NULL;

-- Create index for category-based summaries
CREATE INDEX IF NOT EXISTS idx_skills_category_quality
  ON skills(category, avg_user_satisfaction DESC, success_count DESC)
  WHERE is_archived = 0;

-- Update existing skills with auto-generated summaries
-- (Take first sentence of description, max 100 chars)
UPDATE skills
SET summary = CASE
  WHEN length(description) <= 100 THEN description
  ELSE substr(description, 1, 97) || '...'
END
WHERE summary IS NULL;

-- Set default timestamps for existing skills
UPDATE skills
SET created_at = CURRENT_TIMESTAMP
WHERE created_at IS NULL;

UPDATE skills
SET last_modified = CURRENT_TIMESTAMP
WHERE last_modified IS NULL;

-- Update is_archived flag (default to 0 for existing skills)
UPDATE skills
SET is_archived = 0
WHERE is_archived IS NULL;
