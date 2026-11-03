/**
 * Conflict Detection - v3.0 Implementation
 *
 * Detect contradictions, temporal impossibilities, preference shifts.
 * Flag but never auto-resolve - honesty over guessing.
 * v0.5.0: Added namespace parameter for multi-agent isolation.
 */

import Database from 'better-sqlite3';

export interface Conflict {
  id: string;
  factId1: string;
  factId2: string;
  conflictType: 'temporal_overlap' | 'contradiction' | 'preference_shift';
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export class ConflictDetector {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Detect all types of conflicts within a namespace
   */
  detectAll(namespace: string = 'default'): Conflict[] {
    const conflicts: Conflict[] = [];

    // Check direct contradictions first (more specific than temporal overlaps)
    conflicts.push(...this.detectDirectContradictions(namespace));
    conflicts.push(...this.detectTemporalConflicts(namespace));
    conflicts.push(...this.detectPreferenceShifts(namespace));

    return conflicts;
  }

  /**
   * Temporal impossibilities
   */
  private detectTemporalConflicts(namespace: string): Conflict[] {
    const conflicts: Conflict[] = [];

    const results = this.db.prepare(`
      SELECT f1.*, f2.id as f2_id, f2.value as f2_value, f2.valid_from as f2_valid_from
      FROM facts f1
      JOIN facts f2 ON f1.entity_id = f2.entity_id AND f1.property = f2.property
      WHERE f1.id < f2.id
        AND f1.value != f2.value
        AND f1.namespace = ? AND f2.namespace = ?
        AND f1.valid_from <= COALESCE(f2.valid_until, '9999-12-31')
        AND COALESCE(f1.valid_until, '9999-12-31') >= f2.valid_from
        AND NOT (f1.valid_until IS NULL AND f2.valid_until IS NULL AND f1.valid_from = f2.valid_from)
    `).all(namespace, namespace) as any[];

    for (const row of results) {
      conflicts.push({
        id: 'conflict_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        factId1: row.id,
        factId2: row.f2_id,
        conflictType: 'temporal_overlap',
        description: `Temporal overlap: "${row.value}" and "${row.f2_value}" both claim to be true for ${row.property}`,
        severity: 'high',
      });
    }

    return conflicts;
  }

  /**
   * Direct contradictions
   */
  private detectDirectContradictions(namespace: string): Conflict[] {
    const conflicts: Conflict[] = [];

    const results = this.db.prepare(`
      SELECT f1.*, f2.id as f2_id, f2.value as f2_value
      FROM facts f1
      JOIN facts f2 ON f1.entity_id = f2.entity_id
      WHERE f1.id < f2.id
        AND f1.property = f2.property
        AND f1.value != f2.value
        AND f1.valid_until IS NULL
        AND f2.valid_until IS NULL
        AND f1.valid_from = f2.valid_from
        AND f1.namespace = ? AND f2.namespace = ?
    `).all(namespace, namespace) as any[];

    for (const row of results) {
      conflicts.push({
        id: 'conflict_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        factId1: row.id,
        factId2: row.f2_id,
        conflictType: 'contradiction',
        description: `Contradiction: "${row.value}" vs "${row.f2_value}" for ${row.property}`,
        severity: 'medium',
      });
    }

    return conflicts;
  }

  /**
   * Preference changes over time
   */
  private detectPreferenceShifts(namespace: string): Conflict[] {
    const conflicts: Conflict[] = [];

    const results = this.db.prepare(`
      SELECT e1.*, e2.id as e2_id, e2.name as e2_name, e2.created_at as e2_created
      FROM entities e1
      JOIN entities e2 ON e1.type = e2.type AND e1.type = 'preference'
      WHERE e1.id < e2.id
        AND e1.name != e2.name
        AND e1.description = e2.description
        AND e1.namespace = ? AND e2.namespace = ?
    `).all(namespace, namespace) as any[];

    for (const row of results) {
      const timeDiff = new Date(row.e2_created).getTime() - new Date(row.created_at).getTime();
      const daysDiff = timeDiff / (1000 * 60 * 60 * 24);

      if (daysDiff > 7) {
        conflicts.push({
          id: 'conflict_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
          factId1: row.id,
          factId2: row.e2_id,
          conflictType: 'preference_shift',
          description: `Preference shifted from "${row.name}" to "${row.e2_name}" over ${Math.round(daysDiff)} days`,
          severity: 'low',
        });
      }
    }

    return conflicts;
  }

  /**
   * Store detected conflict
   */
  storeConflict(conflict: Conflict, namespace: string = 'default'): void {
    this.db.prepare(`
      INSERT INTO conflicts (id, fact_id_1, fact_id_2, conflict_type, description, severity, resolution_status, namespace)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      conflict.id,
      conflict.factId1,
      conflict.factId2,
      conflict.conflictType,
      conflict.description,
      conflict.severity,
      'flagged',
      namespace
    );

    // Lower confidence on both facts
    this.db.prepare('UPDATE facts SET confidence = 0.5 WHERE id IN (?, ?)').run(
      conflict.factId1,
      conflict.factId2
    );
  }
}
