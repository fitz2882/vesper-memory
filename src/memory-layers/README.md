# Memory Layers

This directory contains the multi-layered memory system for the AI Memory MCP Server, following the v3.0 "What Claude Actually Wants" architecture.

## Overview

The memory system is organized into three functional layers:

1. **Working Memory** (Recent Context)
2. **Semantic Memory** (Long-term Knowledge Graph)
3. **Procedural Memory** (Learned Skills)

Each layer serves a different purpose and uses different storage backends optimized for its access patterns.

## Layer 1: Working Memory

**File**: `working-memory.ts`

### Purpose
Instant access to active conversation threads. The fastest path for "We've discussed this before" queries.

### Implementation
- **Storage**: Redis with semantic embeddings
- **Capacity**: Last 5 conversations
- **TTL**: 7 days
- **Retrieval**: ~5ms associative recall
- **Eviction**: Auto-removes oldest when >5 conversations

### Interface

```typescript
interface WorkingMemory {
  conversationId: string;          // Unique conversation ID
  timestamp: Date;                 // When conversation occurred
  fullText: string;                // Complete conversation text
  embedding: number[];             // BGE-large embedding vector
  keyEntities: string[];           // Extracted entities
  topics: string[];                // High-level topics discussed
  userIntent: string;              // Primary user goal
}
```

### API

#### Store a conversation
```typescript
await store.store(memory);
```

#### Retrieve by conversation ID
```typescript
const memory = await store.get(conversationId);
```

#### Search by text query
```typescript
const results = await store.search('authentication', topK=3);
// Returns: WorkingMemorySearchResult[] sorted by similarity
```

#### Search by entities
```typescript
const results = await store.searchByEntities(['Database', 'Redis'], topK=3);
// Useful for: "We discussed X before"
```

#### Search by topics
```typescript
const results = await store.searchByTopics(['performance'], topK=3);
// Useful for: "What were we discussing about X topic?"
```

#### Get all conversations
```typescript
const all = await store.getAll(limit=10);
// Newest conversations first
```

#### Delete conversation
```typescript
await store.delete(conversationId);
```

#### Get statistics
```typescript
const stats = await store.getStats();
// {
//   totalConversations: number,
//   oldestConversation: Date | null,
//   newestConversation: Date | null,
//   totalTextSize: number
// }
```

### Key Features

1. **Automatic Eviction**: When you store the 6th conversation, the oldest is automatically deleted.
2. **Simple Similarity**: Uses entity overlap + topic overlap + text keyword overlap. Placeholder for embedding-based similarity.
3. **Flexible Retrieval**: Search by text, entities, or topics depending on query pattern.
4. **TTL Expiration**: All conversations expire after 7 days anyway, Redis will clean them up.

### Usage Example

```typescript
import { WorkingMemoryStore } from '@/memory-layers/working-memory';

// Create store
const store = new WorkingMemoryStore({
  redisUrl: 'redis://localhost:6379',
  maxConversations: 5,
  ttlDays: 7,
});

// Store a conversation
await store.store({
  conversationId: 'conv-123',
  timestamp: new Date(),
  fullText: 'Full conversation text here...',
  embedding: [],  // Will be filled by embedding service
  keyEntities: ['Project', 'Feature'],
  topics: ['architecture', 'design'],
  userIntent: 'Plan new feature',
});

// Retrieve recent conversations
const recent = await store.getAll(5);

// Search by query
const relevant = await store.search('how should we approach this?');

// Search by entity
const projectConvs = await store.searchByEntities(['MetricPilot']);
```

### Implementation Notes

- **Hopfield Network Placeholder**: The current implementation uses simple text/entity/topic similarity. Phase 2 will add Modern Hopfield Network for true associative recall.
- **Embedding Placeholder**: The `embedding` field is stored but not used in searches yet. Phase 2 will add BGE-large embeddings for semantic similarity.
- **Entity/Topic Extraction**: Currently uses simple heuristics (capitalized words, keyword matching). Phase 2 will use proper NER and semantic classifiers.

### Testing

Run the test suite:
```bash
npm test tests/working-memory.test.ts
```

Tests cover:
- Store and retrieve
- Text search with keyword matching
- Entity-based search
- Topic-based search
- Auto-eviction when capacity exceeded
- Statistics calculation
- Deletion

## Layer 2: Semantic Memory

**Status**: Coming in Phase 2 (Week 2-3)

Implementation will use:
- SQLite knowledge graph (entities, relationships, facts)
- HippoRAG for personalized PageRank
- Temporal decay and confidence scoring
- Nightly consolidation from working → semantic

## Layer 3: Procedural Memory

**Status**: Coming in Phase 2 (Week 5)

Implementation will use:
- Voyager-style skill library
- Executable code storage
- Success/failure tracking
- Semantic skill retrieval

## Architecture Decisions

### Why Redis for Working Memory?

1. **Speed**: Sub-5ms retrieval is critical for this layer
2. **Simplicity**: No complex schema, just JSON blobs
3. **Auto-eviction**: Can use ZSET with automatic cleanup
4. **Embedding-ready**: Can store vectors for future Hopfield network

### Why limit to 5 conversations?

- 80% of queries reference recent interactions
- 5 conversations = ~50-100K tokens of context
- Keeps working memory small and fast
- Older memories consolidate to semantic layer nightly

### Why simple similarity for now?

- Gets 80% accuracy with 1% of complexity
- Can always upgrade to embedding-based later
- Avoids dependency on external embedding service in MVP
- Degrades gracefully to semantic layer for complex queries

## Integration Points

### With Query Router
The router calls working memory first:
```typescript
const recent = await workingMemory.search(query);
if (recent.length > 0 && recent[0].similarity > 0.85) {
  return recent;  // Cache hit
}
// Fall back to semantic memory...
```

### With Consolidation Pipeline
Nightly consolidation moves working → semantic:
```typescript
const allConversations = await workingMemory.getAll();
for (const conv of allConversations) {
  await semanticMemory.consolidate(conv);
}
```

## Performance Targets

- **P50 latency**: <5ms (Redis hit)
- **P95 latency**: <30ms (full search)
- **Memory usage**: ~10-20MB for 5 conversations
- **TTL cleanup**: Automatic via Redis

## Future Enhancements

1. **Phase 2**: Add Modern Hopfield Network for true associative recall
2. **Phase 2**: Add BGE-large embeddings for semantic similarity
3. **Phase 2**: Add proper NER for entity extraction
4. **Phase 3**: Add semantic classifiers for topic extraction
5. **Phase 4**: Add temporal decay weighting
6. **Phase 4**: Add multi-modal support (images, code snippets)
