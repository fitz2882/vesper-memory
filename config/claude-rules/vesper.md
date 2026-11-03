# Vesper Memory Storage Guidelines

## Available Tools

Vesper provides 14 MCP tools for memory management. All tools are prefixed with `mcp__vesper__`.

### Core Memory Tools

**1. `store_memory`** - Store new memories
- **When to use**: When you encounter information worth remembering across conversations
- **Parameters**:
  - `content` (required): The memory content to store
  - `memory_type` (required): "episodic", "semantic", "procedural", or "decision"
  - `metadata` (optional): Timestamp, source, tags, project, confidence
  - `namespace` (optional): Namespace for multi-agent isolation (default: "default")
  - `agent_id` (optional): ID of the agent storing this memory
  - `agent_role` (optional): Role of the agent (e.g., "orchestrator", "code-reviewer")
  - `task_id` (optional): Task ID this memory is associated with
- **Example**: Store user preferences, project decisions, learning moments
- **Performance**: ~10ms (includes automatic BGE-large embedding)

**2. `retrieve_memory`** - Query memories with smart routing
- **When to use**: When you need to recall past information, preferences, or patterns
- **Parameters**:
  - `query` (required): Search query or memory retrieval prompt
  - `routing_strategy` (optional): "fast_path", "semantic", "full_text", "graph", or "auto-select" (default)
  - `memory_types` (optional): Filter by ["episodic", "semantic", "procedural", "decision"]
  - `max_results` (optional): Max results to return (default: 5)
  - `namespace` (optional): Namespace for multi-agent isolation (default: "default")
  - `agent_id` (optional): Filter by agent ID
  - `task_id` (optional): Filter by task ID
  - `exclude_agent` (optional): Exclude memories from this agent
- **Example**: "What does the user prefer for testing?", "How did we solve the race condition?"
- **Performance**: 5ms (fast path) to 200ms (complex hybrid search)

**3. `list_recent`** - Get recent memory entries
- **When to use**: When you need context about recent conversations or activities
- **Parameters**:
  - `limit` (optional): Number of entries to return (default: 5)
  - `memory_type` (optional): Filter by type
  - `namespace` (optional): Namespace for multi-agent isolation (default: "default")
- **Example**: Get last 10 conversations for context
- **Performance**: ~5ms (working memory cache hit)

**4. `get_stats`** - System metrics and health
- **When to use**: Check memory system health, storage usage, retrieval performance
- **Parameters**:
  - `detailed` (optional): Include per-layer statistics (default: false)
  - `namespace` (optional): Namespace for multi-agent isolation (default: "default")
- **Performance**: ~10ms

**5. `delete_memory`** - Delete a memory by ID
- **When to use**: When a memory is outdated, incorrect, or no longer needed
- **Parameters**:
  - `memory_id` (required): The ID of the memory to delete
  - `namespace` (optional): Namespace for multi-agent isolation (default: "default")
- **Note**: Cleans up across all layers (SQLite, Qdrant, Redis) and orphaned facts

### Multi-Agent Tools

**6. `share_context`** - Share memories between namespaces
- **When to use**: For agent handoffs in multi-agent workflows
- **Parameters**:
  - `source_namespace` (required): Namespace to share from
  - `target_namespace` (required): Namespace to share to
  - `query` (optional): Semantic query to select relevant memories
  - `task_id` (optional): Filter source memories by task ID
  - `max_items` (optional): Max items to share (default: 10)
  - `include_entities` (optional): Include related entities (default: true)
  - `include_skills` (optional): Include matching skills (default: false)

**7. `store_decision`** - Store architectural/design decisions
- **When to use**: When recording important decisions with rationale
- **Parameters**:
  - `content` (required): The decision content
  - `namespace` (optional): Namespace for multi-agent isolation (default: "default")
  - `supersedes` (optional): ID of a previous decision this replaces
  - `agent_id` (optional): ID of the agent making this decision
  - `agent_role` (optional): Role of the agent
  - `task_id` (optional): Related task ID
- **Note**: Decisions have reduced temporal decay (4x slower) and automatic conflict detection

**8. `list_namespaces`** - Discover all namespaces
- **When to use**: To see what namespaces exist and their memory counts
- **Parameters**: None

**9. `namespace_stats`** - Per-namespace breakdown
- **When to use**: To get detailed stats for a specific namespace
- **Parameters**:
  - `namespace` (required): The namespace to get stats for

### System Control Tools

**10. `vesper_enable`** - Enable Vesper memory system
- **When to use**: For A/B benchmarking or after disabling
- **Note**: Memory system is enabled by default

**11. `vesper_disable`** - Disable Vesper (pass-through mode)
- **When to use**: For A/B benchmarking or testing without memory
- **Note**: All memory operations will be bypassed

**12. `vesper_status`** - Check if Vesper is enabled/disabled
- **When to use**: Verify system state before operations

### Skill Tools

**13. `load_skill`** - Load full skill implementation on-demand
- **When to use**: When a skill summary needs complete details for execution
- **Parameters**:
  - `skill_id` (required): The ID of the skill to load
  - `namespace` (optional): Namespace for multi-agent isolation (default: "default")

**14. `record_skill_outcome`** - Record skill execution feedback
- **When to use**: After executing a skill to track success/failure
- **Parameters**:
  - `skill_id` (required): ID of the skill to record feedback for
  - `outcome` (required): "success" or "failure"
  - `satisfaction` (optional): User satisfaction score 0-1 (required for success)
  - `namespace` (optional): Namespace for multi-agent isolation (default: "default")

---

## When to Store Memories

Use the `store_memory` tool when you encounter information worth remembering across conversations. Apply judgment - store meaningful information, not trivial details.

### Store These Types of Information

**Preferences & Settings** (memory_type: semantic)
- Tool preferences, coding style, workflow choices
- Communication preferences (verbosity, emoji use, explanation style)
- Technology stack preferences
- Examples: "User prefers Vitest over Jest", "Likes detailed explanations with examples"

**Project Decisions** (memory_type: decision)
- Architecture choices and rationale
- Design decisions and trade-offs considered
- Technology selections and why
- Examples: "Chose PostgreSQL over MongoDB for transaction guarantees", "Using microservices for scaling"

**Learning Moments** (memory_type: episodic)
- Solutions to non-trivial problems
- Mistakes and how they were fixed
- Patterns that worked or failed
- Examples: "Race condition in Redis cache fixed with Lua scripts", "Avoid premature optimization in hot paths"

**Context & Background** (memory_type: semantic)
- Project goals and constraints
- Domain knowledge and terminology
- User background and expertise level
- Examples: "Building SaaS for small businesses", "User has 5 years TypeScript experience"

### When NOT to Store

- Trivial facts already in documentation
- Temporary/session-specific information
- Information likely to change frequently
- Obvious or universal programming knowledge
- Every single code change or minor detail

### Storage Approach

**Balanced proactivity**:
- Store when information would be valuable in future conversations
- Use judgment - ask yourself "would this help me serve the user better next time?"
- Don't store just because something was mentioned - store because it's *memorable*
- Consolidate related information rather than creating many small memories

### Memory Types

- `episodic`: Specific events, conversations, problem-solving instances
- `semantic`: Facts, preferences, knowledge, decisions
- `procedural`: Skills, patterns, how-to knowledge
- `decision`: Architectural/design decisions (reduced temporal decay)

### Example Storage Patterns

```
User: "I prefer functional programming style with pure functions"
-> Store: memory_type=semantic, "User prefers functional programming with pure functions"

User: "We decided to use Redis for caching because we need sub-5ms reads"
-> Store: memory_type=decision, "Project uses Redis for caching (requirement: <5ms reads)"

User: "That bug was caused by async race condition, fixed with mutex"
-> Store: memory_type=episodic, "Race condition bug fixed with mutex pattern"

User: "The button is blue"
-> Don't store: Trivial UI detail, likely to change
```

### Metadata to Include

Always add helpful metadata:
- `timestamp`: When this was learned
- `source`: Where it came from (conversation, code, docs)
- `tags`: Relevant topics for retrieval
- `project`: Project name if applicable
- `confidence`: How certain you are (low/medium/high)

## Usage

When you decide to store a memory, call the MCP tool:

```typescript
mcp__vesper__store_memory({
  "content": "User prefers TypeScript over JavaScript for type safety",
  "memory_type": "semantic",
  "metadata": {
    "timestamp": "2026-02-02T22:45:00Z",
    "source": "conversation",
    "tags": ["preference", "typescript", "languages"],
    "confidence": "high"
  }
})
```

Remember: **Quality over quantity**. Store information that makes you a better assistant over time.
