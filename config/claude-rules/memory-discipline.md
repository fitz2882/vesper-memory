# Memory Discipline

## Proactive Storage

Store important context to Vesper throughout the session, not just at the end. Context compaction can happen at any time and knowledge will be lost if not persisted.

### When to Store

**After completing significant work:**
- Feature implementation or bug fix completed
- Commit pushed to remote
- Build/test results that establish a baseline
- npm publish or deployment

**After decisions or discoveries:**
- Architectural decisions and rationale
- Gotchas, workarounds, or non-obvious fixes
- Configuration issues and their solutions
- Dependency or environment problems

**After user preferences are revealed:**
- Workflow preferences (tools, commands, process)
- Code style or quality standards
- Communication preferences

### How to Store

- Use `episodic` for events (completed task, fixed bug, published release)
- Use `semantic` for knowledge (gotchas, preferences, decisions)
- Use `procedural` for repeatable patterns (build steps, deployment process)
- Use `decision` for architectural/design decisions (reduced temporal decay)
- Always include relevant `tags` in metadata for retrieval
- Keep content concise but self-contained (readable without session context)

### When to Retrieve

- At session start: check for recent memories relevant to the project
- Before starting work: query for prior decisions, gotchas, or patterns
- When something feels familiar: search for past solutions
