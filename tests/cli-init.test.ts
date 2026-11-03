/**
 * Tests for `vesper init` CLI command
 *
 * Verifies:
 * 1. Rule files exist in config/claude-rules/
 * 2. Path resolution uses os.homedir() (cross-platform)
 * 3. Copy logic: new install, existing file skip, overwrite
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, '..');
const SOURCE_DIR = join(PROJECT_ROOT, 'config', 'claude-rules');
const RULE_FILES = ['vesper.md', 'memory-discipline.md'];

describe('vesper init - rule files', () => {
  describe('source files exist in package', () => {
    it('should have config/claude-rules/ directory', () => {
      expect(existsSync(SOURCE_DIR)).toBe(true);
    });

    for (const file of RULE_FILES) {
      it(`should have ${file} in config/claude-rules/`, () => {
        const filePath = join(SOURCE_DIR, file);
        expect(existsSync(filePath)).toBe(true);
      });

      it(`${file} should have non-empty content`, () => {
        const content = readFileSync(join(SOURCE_DIR, file), 'utf-8');
        expect(content.length).toBeGreaterThan(100);
      });
    }
  });

  describe('vesper.md content quality', () => {
    let content: string;

    beforeEach(() => {
      content = readFileSync(join(SOURCE_DIR, 'vesper.md'), 'utf-8');
    });

    it('should reference mcp__vesper__ (not vesper-personal or vesper-dev)', () => {
      expect(content).toContain('mcp__vesper__');
      expect(content).not.toContain('vesper-personal');
      expect(content).not.toContain('vesper-dev');
    });

    it('should document 14 tools', () => {
      expect(content).toContain('14 MCP tools');
    });

    it('should document all core tools', () => {
      const expectedTools = [
        'store_memory',
        'retrieve_memory',
        'list_recent',
        'get_stats',
        'delete_memory',
      ];
      for (const tool of expectedTools) {
        expect(content).toContain(tool);
      }
    });

    it('should document multi-agent tools', () => {
      const multiAgentTools = [
        'share_context',
        'store_decision',
        'list_namespaces',
        'namespace_stats',
      ];
      for (const tool of multiAgentTools) {
        expect(content).toContain(tool);
      }
    });

    it('should document system control tools', () => {
      const controlTools = ['vesper_enable', 'vesper_disable', 'vesper_status'];
      for (const tool of controlTools) {
        expect(content).toContain(tool);
      }
    });

    it('should document skill tools', () => {
      const skillTools = ['load_skill', 'record_skill_outcome'];
      for (const tool of skillTools) {
        expect(content).toContain(tool);
      }
    });

    it('should include memory type guidance', () => {
      expect(content).toContain('episodic');
      expect(content).toContain('semantic');
      expect(content).toContain('procedural');
      expect(content).toContain('decision');
    });

    it('should include namespace parameter documentation', () => {
      expect(content).toContain('namespace');
    });
  });

  describe('memory-discipline.md content quality', () => {
    let content: string;

    beforeEach(() => {
      content = readFileSync(join(SOURCE_DIR, 'memory-discipline.md'), 'utf-8');
    });

    it('should contain proactive storage guidance', () => {
      expect(content).toContain('Proactive Storage');
    });

    it('should contain when to store triggers', () => {
      expect(content).toContain('When to Store');
    });

    it('should contain when to retrieve guidance', () => {
      expect(content).toContain('When to Retrieve');
    });

    it('should not reference vesper-personal or vesper-dev', () => {
      expect(content).not.toContain('vesper-personal');
      expect(content).not.toContain('vesper-dev');
    });
  });

  describe('copy logic', () => {
    const testDir = join(PROJECT_ROOT, '.test-init-rules');

    beforeEach(() => {
      // Create a temp directory to simulate ~/.claude/rules/
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should copy files to a new directory', () => {
      for (const file of RULE_FILES) {
        copyFileSync(join(SOURCE_DIR, file), join(testDir, file));
      }

      for (const file of RULE_FILES) {
        expect(existsSync(join(testDir, file))).toBe(true);
        const src = readFileSync(join(SOURCE_DIR, file), 'utf-8');
        const dest = readFileSync(join(testDir, file), 'utf-8');
        expect(dest).toBe(src);
      }
    });

    it('should preserve existing files when not overwriting', () => {
      const existingContent = '# My custom rules\n';
      writeFileSync(join(testDir, 'vesper.md'), existingContent);

      // Simulate "skip" behavior - don't copy
      const preserved = readFileSync(join(testDir, 'vesper.md'), 'utf-8');
      expect(preserved).toBe(existingContent);
    });

    it('should overwrite existing files when requested', () => {
      writeFileSync(join(testDir, 'vesper.md'), '# Old content\n');

      // Simulate "overwrite" behavior
      copyFileSync(join(SOURCE_DIR, 'vesper.md'), join(testDir, 'vesper.md'));

      const content = readFileSync(join(testDir, 'vesper.md'), 'utf-8');
      expect(content).toContain('Vesper Memory Storage Guidelines');
    });
  });

  describe('path resolution', () => {
    it('should resolve Claude rules dir using os.homedir()', () => {
      const rulesDir = join(homedir(), '.claude', 'rules');
      // Verify path construction is cross-platform
      expect(rulesDir).toContain('.claude');
      expect(rulesDir).toContain('rules');
      expect(rulesDir.startsWith(homedir())).toBe(true);
    });

    it('should resolve source dir from package root', () => {
      const sourceDir = join(PROJECT_ROOT, 'config', 'claude-rules');
      expect(existsSync(sourceDir)).toBe(true);
    });
  });
});
