/**
 * Lazy Loading for Skill Library
 *
 * Token-efficient skill loading system that reduces skill-related token usage by 80-90%.
 *
 * Strategy:
 * 1. Inject lightweight skill summaries (~50 tokens each) in MCP context
 * 2. Load full implementations only when explicitly invoked
 * 3. Cache loaded skills in working memory (Redis) for session
 *
 * Performance targets:
 * - Summary retrieval: <10ms
 * - Full load: <20ms
 * - Cache hit: <5ms
 * - Token reduction: 80-90%
 */

import Database from 'better-sqlite3';

/**
 * Lightweight skill summary for context injection
 *
 * Contains minimal information needed to identify and trigger a skill.
 * Approximately 50 tokens per summary.
 */
export interface SkillSummary {
  /** Unique identifier for the skill */
  id: string;

  /** Short, descriptive name (e.g., "Data Analysis", "Code Review") */
  name: string;

  /** One-line description of what the skill does (~20 words max) */
  summary: string;

  /** Category for grouping (e.g., "analysis", "writing", "coding") */
  category: string;

  /** Trigger keywords that activate this skill (max 5) */
  triggers: string[];

  /** Quality score: 0-1, based on success rate and satisfaction */
  quality_score: number;

  /** When this skill was last successfully used */
  last_used?: Date;
}

/**
 * Full skill implementation with complete details
 *
 * Loaded on-demand when a skill is explicitly invoked.
 * Contains all information needed to execute the skill.
 */
export interface FullSkill extends SkillSummary {
  /** Full description with context and usage examples */
  description: string;

  /** Executable code or reference to implementation */
  code?: string;

  /** Type of code: 'inline' TypeScript or 'reference' to function */
  code_type?: 'inline' | 'reference';

  /** Prerequisites or required context */
  prerequisites?: string[];

  /** Success tracking */
  success_count: number;
  failure_count: number;
  avg_user_satisfaction: number;

  /** Dependency tracking for composition */
  uses_skills?: string[]; // IDs of skills this depends on
  used_by_skills?: string[]; // IDs of skills that use this

  /** Metadata */
  created_from?: string; // Conversation ID where skill was extracted
  created_at: Date;
  last_modified: Date;
  version: number;
  notes?: string;
}

/**
 * Cache entry for a loaded skill in working memory
 */
export interface CachedSkill {
  skill: FullSkill;
  loaded_at: Date;
  access_count: number;
  ttl: number; // Time-to-live in seconds (default: 3600 = 1 hour)
}

/**
 * Skill invocation detection result
 *
 * Determines if a query is attempting to invoke a specific skill.
 */
export interface InvocationDetection {
  /** Whether a skill invocation was detected */
  is_invocation: boolean;

  /** The skill ID being invoked (if detected) */
  skill_id?: string;

  /** Confidence score: 0-1 */
  confidence: number;

  /** Pattern that matched (for debugging) */
  matched_pattern?: string;
}

/**
 * Lazy Loading Skill Library
 *
 * Extends the base SkillLibrary with lazy loading capabilities.
 */
export class LazyLoadingSkillLibrary {
  private db: Database.Database;
  private cacheKeyPrefix: string = 'skill:cache:';

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Get skill summaries for context injection
   *
   * Returns lightweight summaries of all non-archived skills,
   * sorted by quality score (satisfaction × success rate).
   *
   * @param limit - Maximum number of summaries to return (default: 20)
   * @param category - Optional category filter
   * @returns Array of SkillSummary objects
   */
  getSummaries(limit: number = 20, category?: string, namespace: string = 'default'): SkillSummary[] {
    let query = `
      SELECT
        id,
        name,
        summary,
        category,
        triggers,
        success_count,
        failure_count,
        avg_user_satisfaction,
        last_used
      FROM skills
      WHERE is_archived = 0 AND namespace = ?
    `;

    const params: any[] = [namespace];

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    // Calculate quality score as: avg_satisfaction × success_rate
    // Where success_rate = success_count / (success_count + failure_count)
    query += `
      ORDER BY
        (avg_user_satisfaction * (CAST(success_count AS REAL) / NULLIF(success_count + failure_count, 0))) DESC,
        avg_user_satisfaction DESC,
        success_count DESC
      LIMIT ?
    `;
    params.push(limit);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      summary: row.summary || this.generateSummary(row.name, row.description),
      category: row.category,
      triggers: JSON.parse(row.triggers || '[]'),
      quality_score: this.calculateQualityScore(
        row.avg_user_satisfaction,
        row.success_count,
        row.failure_count
      ),
      last_used: row.last_used ? new Date(row.last_used) : undefined,
    }));
  }

  /**
   * Load full skill implementation
   *
   * Retrieves complete skill details for execution.
   * Results should be cached in working memory.
   *
   * @param skillId - The skill ID to load
   * @returns FullSkill object or null if not found
   */
  loadFull(skillId: string): FullSkill | null {
    const stmt = this.db.prepare(`
      SELECT * FROM skills WHERE id = ? AND is_archived = 0
    `);

    const row = stmt.get(skillId) as any;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      summary: row.summary || this.generateSummary(row.name, row.description),
      description: row.description,
      category: row.category,
      triggers: JSON.parse(row.triggers || '[]'),
      code: row.code,
      code_type: row.code_type,
      prerequisites: row.prerequisites ? JSON.parse(row.prerequisites) : undefined,
      quality_score: this.calculateQualityScore(
        row.avg_user_satisfaction,
        row.success_count,
        row.failure_count
      ),
      success_count: row.success_count,
      failure_count: row.failure_count,
      avg_user_satisfaction: row.avg_user_satisfaction,
      uses_skills: row.uses_skills ? JSON.parse(row.uses_skills) : undefined,
      used_by_skills: row.used_by_skills ? JSON.parse(row.used_by_skills) : undefined,
      created_from: row.created_from,
      created_at: new Date(row.created_at),
      last_modified: new Date(row.last_modified),
      last_used: row.last_used ? new Date(row.last_used) : undefined,
      version: row.version,
      notes: row.notes,
    };
  }

  /**
   * Detect if a query is attempting to invoke a specific skill
   *
   * Uses pattern matching to identify skill invocations:
   * - Explicit: "use skill X", "invoke X", "run X"
   * - Implicit: "analyze this like before", "same as last time"
   * - By ID: References a skill ID directly
   *
   * @param query - The user query
   * @param summaries - Available skill summaries for matching
   * @returns InvocationDetection result
   */
  detectInvocation(query: string, summaries: SkillSummary[]): InvocationDetection {
    const normalizedQuery = query.toLowerCase().trim();

    // Pattern 1: Explicit invocation by name
    // "use skill Data Analysis", "invoke Code Review"
    const explicitPattern = /\b(use|invoke|run|execute)\s+(skill\s+)?(.+)/i;
    const explicitMatch = normalizedQuery.match(explicitPattern);

    if (explicitMatch) {
      const skillName = explicitMatch[3].trim();
      const matchingSkill = summaries.find(
        s => s.name.toLowerCase() === skillName
      );

      if (matchingSkill) {
        return {
          is_invocation: true,
          skill_id: matchingSkill.id,
          confidence: 0.95,
          matched_pattern: 'explicit_name',
        };
      }
    }

    // Pattern 2: Implicit invocation by trigger
    // "analyze this dataset", "review this code"
    for (const skill of summaries) {
      for (const trigger of skill.triggers) {
        if (normalizedQuery.includes(trigger.toLowerCase())) {
          return {
            is_invocation: true,
            skill_id: skill.id,
            confidence: 0.75,
            matched_pattern: `trigger:${trigger}`,
          };
        }
      }
    }

    // Pattern 3: Reference to previous skill
    // "like before", "same as last time", "same way"
    const referencePattern = /\b(like before|same as|same way|as before|previously)\b/i;
    if (referencePattern.test(normalizedQuery)) {
      // Return most recently used skill
      const recentSkill = summaries
        .filter(s => s.last_used)
        .sort((a, b) => (b.last_used?.getTime() || 0) - (a.last_used?.getTime() || 0))[0];

      if (recentSkill) {
        return {
          is_invocation: true,
          skill_id: recentSkill.id,
          confidence: 0.8,
          matched_pattern: 'reference_previous',
        };
      }
    }

    // Pattern 4: Skill ID reference
    // "skill_12345", direct ID in query
    const idPattern = /skill_[a-z0-9]+/i;
    const idMatch = normalizedQuery.match(idPattern);

    if (idMatch) {
      const skillId = idMatch[0];
      const matchingSkill = summaries.find(s => s.id === skillId);

      if (matchingSkill) {
        return {
          is_invocation: true,
          skill_id: skillId,
          confidence: 1.0,
          matched_pattern: 'skill_id',
        };
      }
    }

    // No invocation detected
    return {
      is_invocation: false,
      confidence: 0.0,
    };
  }

  /**
   * Calculate quality score for a skill
   *
   * Formula: avg_satisfaction × success_rate
   * Where success_rate = success_count / (success_count + failure_count)
   *
   * @param avgSatisfaction - Average user satisfaction (0-1)
   * @param successCount - Number of successful executions
   * @param failureCount - Number of failed executions
   * @returns Quality score (0-1)
   */
  private calculateQualityScore(
    avgSatisfaction: number,
    successCount: number,
    failureCount: number
  ): number {
    const totalExecutions = successCount + failureCount;

    if (totalExecutions === 0) {
      // No executions yet, return base satisfaction
      return avgSatisfaction * 0.5; // Penalize untested skills
    }

    const successRate = successCount / totalExecutions;
    return avgSatisfaction * successRate;
  }

  /**
   * Generate a one-line summary from name and description
   *
   * Used when summary field is not populated.
   * Truncates description to ~20 words.
   *
   * @param name - Skill name
   * @param description - Full description
   * @returns One-line summary
   */
  private generateSummary(name: string, description?: string): string {
    if (!description) {
      return name;
    }

    // Take first sentence or first 20 words, whichever is shorter
    const firstSentence = description.split(/[.!?]/)[0].trim();
    const words = firstSentence.split(/\s+/);

    if (words.length <= 20) {
      return firstSentence;
    }

    return words.slice(0, 20).join(' ') + '...';
  }
}
