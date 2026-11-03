-- Rollback migration 001: Remove lazy loading columns from skills table
-- WARNING: This will drop the summary, is_archived, and timestamp columns
--
-- SQLite limitations:
-- - Cannot drop columns directly (requires table recreation)
-- - This script recreates the skills table without the new columns
--
-- Backup recommendation: Create a backup before running this rollback

-- Step 1: Create backup of current skills table
CREATE TABLE IF NOT EXISTS skills_backup AS SELECT * FROM skills;

-- Step 2: Drop new indexes
DROP INDEX IF EXISTS idx_skills_lazy_loading;
DROP INDEX IF EXISTS idx_skills_last_used;
DROP INDEX IF EXISTS idx_skills_category_quality;

-- Step 3: Recreate original skills table
DROP TABLE skills;

CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  triggers TEXT NOT NULL,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  avg_user_satisfaction REAL DEFAULT 0.5
);

-- Step 4: Restore data from backup (original columns only)
INSERT INTO skills (
  id,
  name,
  description,
  category,
  triggers,
  success_count,
  failure_count,
  avg_user_satisfaction
)
SELECT
  id,
  name,
  description,
  category,
  triggers,
  success_count,
  failure_count,
  avg_user_satisfaction
FROM skills_backup;

-- Step 5: Recreate original indexes
CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);

-- Optional: Drop backup table after successful rollback
-- DROP TABLE skills_backup;

-- Note: Uncomment the line above to clean up the backup after verifying rollback
