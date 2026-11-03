/**
 * Smart Query Router
 *
 * Implements intelligent routing logic from v3.0 plan:
 * 1. Always check working memory first (fast path)
 * 2. Classify query type using regex patterns
 * 3. Route to appropriate handler based on classification
 * 4. Fall back to hybrid search for complex queries
 */

import { WorkingMemoryLayer } from '../memory-layers/working-memory.js';
import { SemanticMemoryLayer } from '../memory-layers/semantic-memory.js';
import { SkillLibrary } from '../memory-layers/skill-library.js';
import { HybridSearchEngine } from '../retrieval/hybrid-search.js';
import { EmbeddingClient } from '../embeddings/client.js';

/**
 * Module-level dependencies - set via init()
 */
let workingMemoryLayer: WorkingMemoryLayer | null = null;
let semanticMemoryLayer: SemanticMemoryLayer | null = null;
let skillLibraryLayer: SkillLibrary | null = null;
let hybridSearchEngine: HybridSearchEngine | null = null;
let embeddingClientInstance: EmbeddingClient | null = null;

/**
 * Module-level SQLite dependency for direct queries
 */
let sqliteDb: any = null;

/**
 * Initialize the router with all dependencies
 */
export function init(deps: {
  workingMemory?: WorkingMemoryLayer;
  semanticMemory?: SemanticMemoryLayer;
  hybridSearch?: HybridSearchEngine;
  embeddingClient?: EmbeddingClient;
  sqlite?: any;
}): void {
  workingMemoryLayer = deps.workingMemory || null;
  if (deps.semanticMemory) semanticMemoryLayer = deps.semanticMemory;
  if (deps.hybridSearch) hybridSearchEngine = deps.hybridSearch;
  if (deps.embeddingClient) embeddingClientInstance = deps.embeddingClient;
  if (deps.sqlite) sqliteDb = deps.sqlite;
}

/**
 * Query type enumeration
 * Used to classify queries and route to appropriate handlers
 */
export enum QueryType {
  FACTUAL = "factual",
  PREFERENCE = "preference",
  PROJECT = "project",
  TEMPORAL = "temporal",
  SKILL = "skill",
  COMPLEX = "complex"
}

/**
 * Query classification result
 */
export interface ClassificationResult {
  type: QueryType;
  confidence: number;  // 0-1, indicates how certain the classification is
  matchedPattern?: string;  // The regex pattern that matched (for debugging)
}

/**
 * Context for routing decisions
 */
export interface RoutingContext {
  userId: string;
  conversationId: string;
  timestamp: Date;
  namespace?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Memory result from any layer
 */
export interface MemoryResult {
  id: string;
  source: "working" | "semantic" | "procedural" | "hybrid";
  content: string;
  similarity: number;  // 0-1 relevance score
  timestamp: Date;
  confidence?: number;  // For semantic layer facts
}

/**
 * Classify a query into one of the six query types
 *
 * Uses simple regex patterns to identify query intent without LLM calls.
 * Falls back to 'complex' for ambiguous queries.
 *
 * Patterns (in order of specificity):
 * - skill: "like before", "same as", "same way", "how you", "analyze"
 * - factual: "what is", "who is", "where is"
 * - temporal: "last week", "yesterday", "recently", etc.
 * - preference: "prefer", "want", "style", "favorite"
 * - project: "project", "working on", "decided", "building", "creating", "developing"
 * - complex: fallback for anything else
 */
export function classifyQuery(query: string): ClassificationResult {
  const normalizedQuery = query.toLowerCase().trim();

  // Pattern definitions with confidence scores
  // NOTE: More specific patterns should be checked first to avoid ambiguity
  const patterns = [
    // Skill patterns are most specific - check before preference and temporal
    {
      type: QueryType.SKILL,
      regex: /\b(like before|same as|same way|how you)\b/i,
      confidence: 0.85,
      label: "skill"
    },
    {
      type: QueryType.SKILL,
      regex: /\banalyze\b/i,
      confidence: 0.75,
      label: "skill_analyze"
    },
    // Temporal patterns - check before factual WH questions since temporal is more specific
    {
      type: QueryType.TEMPORAL,
      regex: /\b(last week|last month|last year|last time)\b/i,
      confidence: 0.95,
      label: "temporal_specific"
    },
    {
      type: QueryType.TEMPORAL,
      regex: /\b(yesterday|recently|earlier)\b/i,
      confidence: 0.9,
      label: "temporal"
    },
    {
      type: QueryType.TEMPORAL,
      regex: /\bbefore\b/i,
      confidence: 0.7,
      label: "temporal_before"
    },
    // Factual patterns (WH questions) - after temporal to avoid misclassifying temporal queries
    {
      type: QueryType.FACTUAL,
      regex: /\b(what|who|where)\s+(is|was|are|were)\b/i,
      confidence: 0.95,
      label: "factual_wh"
    },
    // Preference patterns
    {
      type: QueryType.PREFERENCE,
      regex: /\b(prefer|want|style|favorite)\b/i,
      confidence: 0.9,
      label: "preference"
    },
    // Note: 'like' as preference is checked but has lower confidence due to ambiguity
    {
      type: QueryType.PREFERENCE,
      regex: /\bhow do i like\b/i,
      confidence: 0.85,
      label: "preference_like"
    },
    // Project patterns
    {
      type: QueryType.PROJECT,
      regex: /\b(working on|decided|decide|decision)\b/i,
      confidence: 0.9,
      label: "project_specific"
    },
    {
      type: QueryType.PROJECT,
      regex: /\b(project|building|creating|developing)\b/i,
      confidence: 0.85,
      label: "project"
    }
  ];

  // Check each pattern in order
  for (const pattern of patterns) {
    if (pattern.regex.test(normalizedQuery)) {
      return {
        type: pattern.type,
        confidence: pattern.confidence,
        matchedPattern: pattern.label
      };
    }
  }

  // Default to complex query
  return {
    type: QueryType.COMPLEX,
    confidence: 0.5
  };
}

/**
 * Smart query router following v3.0 plan retrieval strategy
 *
 * Routing decision tree:
 * 1. Check working memory first (5ms, high confidence threshold)
 * 2. Classify query type with regex
 * 3. Route to appropriate handler:
 *    - factual: direct entity lookup
 *    - preference: preference retrieval
 *    - project: graph traversal with HippoRAG
 *    - temporal: time-based filtering
 *    - skill: skill library search
 *    - complex: hybrid search (dense + sparse + BM25)
 *
 * @param query - The user's query string
 * @param context - Routing context (user, conversation, etc.)
 * @returns Promise resolving to array of memory results
 *
 * @throws Error if query is empty or context is invalid
 */
export async function retrieve(
  query: string,
  context: RoutingContext
): Promise<MemoryResult[]> {
  // Input validation
  if (!query || query.trim().length === 0) {
    throw new Error("Query cannot be empty");
  }

  if (!context || !context.userId) {
    throw new Error("Valid routing context with userId is required");
  }

  // Step 1: ALWAYS check working memory first (5ms fast path)
  const recentMemories = await checkWorkingMemory(query, context);

  // High similarity threshold suggests cache hit - return immediately
  if (recentMemories.length > 0 && recentMemories[0].similarity > 0.85) {
    console.error(`[Router] Cache hit in working memory for query: "${query}"`);
    return recentMemories;
  }

  // Step 2: Classify query type using regex patterns
  const classification = classifyQuery(query);
  console.error(
    `[Router] Query classified as ${classification.type} ` +
    `(confidence: ${classification.confidence}, pattern: ${classification.matchedPattern})`
  );

  // Step 3: Route to appropriate handler based on classification
  let results: MemoryResult[] = [];

  switch (classification.type) {
    case QueryType.FACTUAL:
      results = await handleFactualQuery(query, context);
      break;

    case QueryType.PREFERENCE:
      results = await handlePreferenceQuery(query, context);
      break;

    case QueryType.PROJECT:
      results = await handleProjectQuery(query, context);
      break;

    case QueryType.TEMPORAL:
      results = await handleTemporalQuery(query, context);
      break;

    case QueryType.SKILL:
      results = await handleSkillQuery(query, context);
      break;

    case QueryType.COMPLEX:
    default:
      results = await handleComplexQuery(query, context);
      break;
  }

  return results;
}

/**
 * Check working memory for recent relevant memories
 *
 * Implementation stub - will integrate with Redis/Hopfield layer
 * Current behavior: returns empty array (no working memory yet)
 *
 * @param query - Search query
 * @param context - Routing context
 * @returns Recent memory results matching query
 */
async function checkWorkingMemory(
  query: string,
  _context: RoutingContext
): Promise<MemoryResult[]> {
  console.error(`[Router] Checking working memory for: "${query}"`);

  // Early return if working memory not available
  if (!workingMemoryLayer) {
    console.error(`[Router] Working memory layer not initialized`);
    return [];
  }

  try {
    // Search working memory using keyword matching (5ms fast path)
    const results = await workingMemoryLayer.search(query, 3);

    // Transform to MemoryResult format
    return results.map(r => ({
      id: r.memory.conversationId,
      source: "working" as const,
      content: r.memory.fullText,
      similarity: r.similarity,
      timestamp: r.memory.timestamp,
    }));
  } catch (err) {
    console.error(`[Router] Working memory search error:`, err);
    return [];
  }
}

/**
 * Handle factual queries
 *
 * Pattern: "What is X?", "Who is Y?", "Where is Z?"
 * Handler: Direct entity lookup in semantic memory
 *
 * Implementation stub
 *
 * @param query - The factual query
 * @param context - Routing context
 * @returns Entity information
 */
async function handleFactualQuery(
  query: string,
  context: RoutingContext
): Promise<MemoryResult[]> {
  console.error(`[Router] Handling factual query: "${query}"`);

  const namespace = context.namespace || 'default';

  // Step 1: Extract entity name from query
  const entityName = extractEntityName(query);

  if (entityName && semanticMemoryLayer) {
    try {
      const entity = semanticMemoryLayer.getEntity(entityName, namespace);

      if (entity) {
        const graphResults = semanticMemoryLayer.personalizedPageRankWithFacts(
          entity.id, 2, namespace
        );

        const results: MemoryResult[] = [];

        results.push({
          id: entity.id,
          source: "semantic" as const,
          content: `${entity.name} (${entity.type}): ${entity.description || 'No description'}`,
          similarity: 1.0,
          timestamp: new Date((entity as any).last_accessed || (entity as any).created_at || Date.now()),
          confidence: entity.confidence,
        });

        for (const fact of graphResults.facts.slice(0, 5)) {
          results.push({
            id: fact.id,
            source: "semantic" as const,
            content: `${fact.property}: ${fact.value}`,
            similarity: fact.confidence,
            timestamp: new Date(fact.valid_from || Date.now()),
            confidence: fact.confidence,
          });
        }

        for (const relEntity of graphResults.entities.slice(1, 4)) {
          results.push({
            id: relEntity.id,
            source: "semantic" as const,
            content: `${relEntity.name} (${relEntity.type}): ${relEntity.description || 'Related entity'}`,
            similarity: relEntity.relevanceScore,
            timestamp: new Date((relEntity as any).last_accessed || (relEntity as any).created_at || Date.now()),
            confidence: relEntity.confidence,
          });
        }

        if (results.length > 0) return results;
      }
    } catch (err) {
      console.error(`[Router] Entity lookup failed for "${entityName}":`, err instanceof Error ? err.message : String(err));
    }
  }

  // Fallback: delegate to semantic search
  return fallbackToSemanticSearch(query, namespace, 5);
}

/**
 * Handle preference queries
 *
 * Pattern: "How do I prefer X?", "What style do I like?"
 * Handler: Optimized direct SQLite lookup with temporal decay
 *
 * This function uses direct database queries instead of embedding generation
 * for improved latency (~50ms vs ~200ms).
 *
 * @param query - The preference query
 * @param context - Routing context
 * @returns User preference information
 */
async function handlePreferenceQuery(
  query: string,
  context: RoutingContext
): Promise<MemoryResult[]> {
  return handlePreferenceQueryDirect(query, context);
}

/**
 * Handle project queries
 *
 * Pattern: "What did we decide about X?", "What's the status on Y?"
 * Handler: Graph traversal with HippoRAG personalized PageRank
 *
 * Implementation stub
 *
 * @param query - The project query
 * @param context - Routing context
 * @returns Project-related information via graph traversal
 */
async function handleProjectQuery(
  query: string,
  context: RoutingContext
): Promise<MemoryResult[]> {
  console.error(`[Router] Handling project query: "${query}"`);

  const namespace = context.namespace || 'default';

  if (!semanticMemoryLayer) {
    return fallbackToSemanticSearch(query, namespace, 5);
  }

  // Extract project/entity name from query
  const entityName = extractEntityName(query);

  if (entityName) {
    try {
      const entity = semanticMemoryLayer.getEntity(entityName, namespace);

      if (entity) {
        const graphResults = semanticMemoryLayer.personalizedPageRankWithFacts(
          entity.id, 2, namespace
        );

        const results: MemoryResult[] = [];

        for (const e of graphResults.entities) {
          results.push({
            id: e.id,
            source: "semantic" as const,
            content: `${e.name} (${e.type}): ${e.description || ''}`,
            similarity: e.relevanceScore,
            timestamp: new Date((e as any).last_accessed || (e as any).created_at || Date.now()),
            confidence: e.confidence,
          });
        }

        if (graphResults.chains) {
          for (const chain of graphResults.chains) {
            results.push({
              id: chain.targetId,
              source: "semantic" as const,
              content: `[Chain] ${entity.name} -> ${chain.intermediaries.join(' -> ')} -> ${chain.targetName}`,
              similarity: chain.totalScore,
              timestamp: new Date(),
            });
          }
        }

        if (results.length > 0) return results;
      }
    } catch (err) {
      console.error(`[Router] Project graph traversal failed for "${entityName}":`, err instanceof Error ? err.message : String(err));
    }
  }

  // Fallback: search memories with project-related content
  return fallbackToSemanticSearch(query, namespace, 5);
}

/**
 * Handle temporal queries
 *
 * Pattern: "What were we working on last week?", "What was discussed yesterday?"
 * Handler: Time-based filtering from semantic memory
 *
 * Implementation stub
 *
 * @param query - The temporal query
 * @param context - Routing context
 * @returns Memories from specified time range
 */
async function handleTemporalQuery(
  query: string,
  context: RoutingContext
): Promise<MemoryResult[]> {
  console.error(`[Router] Handling temporal query: "${query}"`);

  const namespace = context.namespace || 'default';

  // Step 1: Parse temporal references
  const timeRange = parseTimeRange(query);

  if (timeRange && sqliteDb) {
    // Step 2: Query memories within time range
    const startMs = timeRange.startDate.getTime();
    const endMs = timeRange.endDate.getTime();

    const rows = sqliteDb.prepare(`
      SELECT id, content, memory_type, created_at, agent_id, task_id
      FROM memories
      WHERE namespace = ? AND created_at >= ? AND created_at <= ?
      ORDER BY created_at DESC
      LIMIT 10
    `).all(namespace, startMs, endMs) as any[];

    if (rows.length > 0) {
      return rows.map((row: any) => ({
        id: row.id,
        source: "semantic" as const,
        content: row.content,
        similarity: 0.9,
        timestamp: new Date(row.created_at),
        confidence: 0.9,
      }));
    }
  }

  // Fallback to semantic search
  return fallbackToSemanticSearch(query, namespace, 5);
}

/**
 * Handle skill queries
 *
 * Pattern: "Analyze this like before", "Same way as last time"
 * Handler: Skill library trigger-based search
 *
 * Uses SkillLibrary.search() for fast trigger matching without embedding.
 *
 * @param query - The skill query
 * @param context - Routing context
 * @returns Matching skills from skill library
 */
async function handleSkillQuery(
  query: string,
  context: RoutingContext
): Promise<MemoryResult[]> {
  return handleSkillQueryDirect(query, context);
}

/**
 * Handle complex queries
 *
 * Pattern: Ambiguous queries that don't match specific patterns
 * Handler: Hybrid search across all representations
 *
 * Hybrid search pipeline:
 * 1. Parallel search: dense embeddings + sparse vectors + BM25
 * 2. Reciprocal Rank Fusion (k=60) to combine results
 * 3. Light reranking with cross-encoder on top-10
 * 4. Return top-5 fused results
 *
 * Implementation stub
 *
 * @param query - The complex query
 * @param context - Routing context
 * @returns Hybrid search results
 */
async function handleComplexQuery(
  query: string,
  context: RoutingContext
): Promise<MemoryResult[]> {
  console.error(`[Router] Handling complex query with hybrid search: "${query}"`);

  const namespace = context.namespace || 'default';

  // Delegate to semantic search (dense vectors via Qdrant + RRF)
  return fallbackToSemanticSearch(query, namespace, 5);
}

/**
 * Extract entity name from a query
 *
 * Implementation stub for entity extraction
 * Will later integrate with NER or simple heuristics
 */
export function extractEntityName(query: string): string | null {
  const normalizedQuery = query.toLowerCase().trim();

  // Pattern: "What is X?", "Who is X?", "Where is X?"
  const whMatch = normalizedQuery.match(/\b(?:what|who|where)\s+(?:is|was|are|were)\s+(.+)$/i);
  if (whMatch && whMatch[1]) {
    return whMatch[1].trim().replace(/[\?\.\!]+$/, '').replace(/^(the|a|an)\s+/i, '').trim();
  }

  // Pattern: "Tell me about X", "Info on X"
  const aboutMatch = normalizedQuery.match(/\b(?:about|regarding|on)\s+(.+)$/i);
  if (aboutMatch && aboutMatch[1]) {
    return aboutMatch[1].trim().replace(/[\?\.\!]+$/, '').replace(/^(the|a|an)\s+/i, '').trim();
  }

  // Pattern: "X project", "X decision", "working on X"
  const projectMatch = normalizedQuery.match(/\b(?:working on|decided about|building)\s+(.+)$/i);
  if (projectMatch && projectMatch[1]) {
    return projectMatch[1].trim().replace(/[\?\.\!]+$/, '').replace(/^(the|a|an)\s+/i, '').trim();
  }

  return null;
}

/**
 * Extract domain/category from a query
 *
 * Delegates to extractPreferenceDomain for preference queries.
 * Used for preference and skill queries.
 *
 * @param query - The query string
 * @returns Extracted domain (lowercase) or null if not extractable
 */
export function extractDomain(query: string): string | null {
  return extractPreferenceDomain(query);
}

/**
 * Parse temporal references from query
 *
 * Implementation stub for temporal parsing
 * Will extract time ranges like "last week", "yesterday", etc.
 */
export interface TimeRange {
  startDate: Date;
  endDate: Date;
}

export function parseTimeRange(query: string): TimeRange | null {
  const normalizedQuery = query.toLowerCase().trim();
  const now = new Date();
  const endDate = new Date(now);

  // "yesterday"
  if (/\byesterday\b/.test(normalizedQuery)) {
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 1);
    startDate.setHours(0, 0, 0, 0);
    endDate.setDate(endDate.getDate() - 1);
    endDate.setHours(23, 59, 59, 999);
    return { startDate, endDate };
  }

  // "last week"
  if (/\blast\s+week\b/.test(normalizedQuery)) {
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 7);
    return { startDate, endDate: now };
  }

  // "last month"
  if (/\blast\s+month\b/.test(normalizedQuery)) {
    const startDate = new Date(now);
    startDate.setMonth(startDate.getMonth() - 1);
    return { startDate, endDate: now };
  }

  // "last year"
  if (/\blast\s+year\b/.test(normalizedQuery)) {
    const startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 1);
    return { startDate, endDate: now };
  }

  // "recently" / "last time" / "earlier" - last 3 days
  if (/\b(recently|last\s+time|earlier)\b/.test(normalizedQuery)) {
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 3);
    return { startDate, endDate: now };
  }

  return null;
}

/**
 * Extract preference domain from a query using regex patterns
 *
 * Patterns recognized:
 * - "my X style" -> X (coding, writing, etc.)
 * - "favorite X" -> X (language, framework, etc.)
 * - "prefer X" -> X (TypeScript, tabs, etc.)
 * - "like my X" -> X (coffee, code, etc.)
 *
 * @param query - The preference query
 * @returns Extracted domain (lowercase) or null if not extractable
 */
export function extractPreferenceDomain(query: string): string | null {
  const normalizedQuery = query.toLowerCase().trim();

  // Pattern definitions for domain extraction
  // Each pattern has a capture group for the domain noun
  // NOTE: Order matters - more specific patterns should come before generic ones
  const patterns = [
    // "my X style" pattern - captures word before "style"
    /\bmy\s+(\w+)\s+style\b/i,
    // "favorite X" pattern - captures word after "favorite"
    /\bfavorite\s+(\w+)\b/i,
    // "prefer my X" pattern - captures word after "my" (more specific than "prefer X")
    /\bprefer\s+my\s+(\w+)\b/i,
    // "prefer X" or "prefer X or Y" pattern - captures first word after "prefer"
    /\bprefer\s+(\w+)\b/i,
    // "like my X" pattern - captures word after "my"
    /\blike\s+my\s+(\w+)\b/i,
    // "my X formatted" or "my X preferences" pattern
    /\bmy\s+(\w+)\s+(formatted|preference|preferences)\b/i,
    // "X preference" pattern - captures word before "preference"
    /\b(\w+)\s+preference\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalizedQuery.match(pattern);
    if (match && match[1]) {
      return match[1].toLowerCase();
    }
  }

  return null;
}

/**
 * Fallback to dense semantic search via embedding + Qdrant
 *
 * Used when specialized handlers can't find results.
 */
async function fallbackToSemanticSearch(
  query: string,
  namespace: string,
  maxResults: number
): Promise<MemoryResult[]> {
  if (!embeddingClientInstance || !hybridSearchEngine) {
    // Last resort: SQL text search
    if (sqliteDb) {
      const rows = sqliteDb.prepare(
        "SELECT id, content, memory_type, created_at FROM memories WHERE namespace = ? ORDER BY created_at DESC LIMIT ?"
      ).all(namespace, maxResults) as any[];

      return rows.map((row: any) => ({
        id: row.id,
        source: "semantic" as const,
        content: row.content,
        similarity: 0.5,
        timestamp: new Date(row.created_at),
      }));
    }
    return [];
  }

  try {
    const queryEmbedding = await embeddingClientInstance.embed(query);
    const qdrantFilter = {
      must: [{ key: "namespace", match: { value: namespace } }],
    };

    let searchResults = await hybridSearchEngine.hybridSearch(
      queryEmbedding, maxResults, qdrantFilter
    );

    // Backward compat: retry without filter for default namespace
    if (searchResults.length === 0 && namespace === 'default') {
      searchResults = await hybridSearchEngine.hybridSearch(queryEmbedding, maxResults);
    }

    return searchResults.map((r) => ({
      id: r.id,
      source: "hybrid" as const,
      content: (r.payload?.content as string) || '',
      similarity: r.fusedScore,
      timestamp: new Date((r.payload?.created_at as number) || Date.now()),
    }));
  } catch (err) {
    console.error(`[Router] Semantic search fallback failed:`, err);
    return [];
  }
}

/**
 * Initialize the preference handler with semantic memory dependency
 *
 * @param semanticMemory - SemanticMemoryLayer instance for preference lookups
 */
export function initPreferenceHandler(semanticMemory: SemanticMemoryLayer): void {
  semanticMemoryLayer = semanticMemory;
}

/**
 * Calculate temporal decay weight using exponential formula
 *
 * Decay formula: weight = e^(-days/30)
 * - Decays to 50% in ~21 days
 * - Decays to 10% in ~69 days
 *
 * @param lastAccessed - Date when the preference was last accessed
 * @returns Weight between 0 and 1
 */
function calculateTemporalDecay(lastAccessed: Date | string): number {
  const lastAccessedDate = typeof lastAccessed === 'string'
    ? new Date(lastAccessed)
    : lastAccessed;
  const now = new Date();
  const daysSinceAccess = (now.getTime() - lastAccessedDate.getTime()) / (1000 * 60 * 60 * 24);

  // Exponential decay with 30-day half-life
  return Math.exp(-daysSinceAccess / 30);
}

/**
 * Direct preference query handler - optimized for low latency
 *
 * This handler bypasses embedding generation by using direct SQLite lookup:
 * 1. Extract preference domain from query using regex
 * 2. Query semantic memory with domain filter (or get all preferences)
 * 3. Apply temporal decay weighting to prioritize recent preferences
 * 4. Return results sorted by weighted score
 *
 * Performance target: <50ms (vs ~200ms for embedding-based search)
 *
 * @param query - The preference query
 * @param _context - Routing context (userId, etc.)
 * @returns Array of MemoryResult objects
 */
export async function handlePreferenceQueryDirect(
  query: string,
  _context: RoutingContext
): Promise<MemoryResult[]> {
  console.error(`[Router] Handling preference query (optimized): "${query}"`);

  if (!semanticMemoryLayer) {
    console.error(`[Router] Semantic memory layer not initialized for preference queries`);
    return [];
  }

  // Step 1: Extract domain from query
  const domain = extractPreferenceDomain(query);
  console.error(`[Router] Extracted preference domain: ${domain || 'none'}`);

  // Step 2: Get preferences from semantic memory (filtered by domain if available)
  const preferences = semanticMemoryLayer.getPreferences(domain || undefined);

  if (preferences.length === 0) {
    console.error(`[Router] No preferences found for domain: ${domain || 'all'}`);
    return [];
  }

  // Step 3: Apply temporal decay weighting and transform to MemoryResult
  const weightedResults: MemoryResult[] = preferences.map((pref: any) => {
    const decayWeight = calculateTemporalDecay(pref.last_accessed || pref.created_at);
    const confidenceWeight = pref.confidence || 1.0;

    // Combined score: temporal decay * confidence
    const similarity = decayWeight * confidenceWeight;

    return {
      id: pref.id,
      source: "semantic" as const,
      content: pref.description || pref.name,
      similarity,
      timestamp: new Date(pref.last_accessed || pref.created_at),
      confidence: pref.confidence
    };
  });

  // Step 4: Sort by similarity (descending) and return
  return weightedResults.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Initialize the skill handler with skill library dependency
 *
 * @param skillLibrary - SkillLibrary instance for skill lookups
 */
export function initSkillHandler(skillLibrary: SkillLibrary): void {
  skillLibraryLayer = skillLibrary;
}

/**
 * Direct skill query handler - optimized for low latency with lazy loading
 *
 * This handler uses trigger-based matching in SkillLibrary:
 * 1. Detect if query is invoking a specific skill
 * 2. If invocation detected, load full skill implementation
 * 3. Otherwise, return lightweight summaries for context
 * 4. Calculate similarity based on match score and satisfaction
 *
 * Performance target: <20ms (summary), <30ms (full load)
 * Token reduction: 80-90% (summaries vs full descriptions)
 *
 * @param query - The skill query
 * @param _context - Routing context (userId, etc.)
 * @returns Array of MemoryResult objects
 */
export async function handleSkillQueryDirect(
  query: string,
  _context: RoutingContext
): Promise<MemoryResult[]> {
  console.error(`[Router] Handling skill query (lazy loading): "${query}"`);

  if (!skillLibraryLayer) {
    console.error(`[Router] Skill library not initialized for skill queries`);
    return [];
  }

  // Early return for empty/whitespace queries
  if (!query || query.trim().length === 0) {
    return [];
  }

  // Step 1: Detect if this is a skill invocation
  const invocation = skillLibraryLayer.detectInvocation(query);

  if (invocation.is_invocation && invocation.skill_id) {
    console.error(
      `[Router] Skill invocation detected: ${invocation.skill_id} ` +
      `(confidence: ${invocation.confidence}, pattern: ${invocation.matched_pattern})`
    );

    // Load full skill implementation for invocation
    const fullSkill = skillLibraryLayer.loadFull(invocation.skill_id);

    if (fullSkill) {
      return [{
        id: fullSkill.id,
        source: "procedural" as const,
        content: `${fullSkill.name}: ${fullSkill.description}`,
        similarity: invocation.confidence,
        timestamp: fullSkill.last_used || new Date(),
        confidence: fullSkill.avg_user_satisfaction,
      }];
    }
  }

  // Step 2: No invocation - return lightweight summaries
  console.error(`[Router] No invocation detected, returning skill summaries`);

  // Get skill summaries (lightweight, ~50 tokens each)
  const summaries = skillLibraryLayer.getSummaries(10);

  // Filter summaries by trigger matching
  const matchingSummaries = summaries.filter(summary => {
    const queryLower = query.toLowerCase();
    return summary.triggers.some(trigger =>
      queryLower.includes(trigger.toLowerCase()) ||
      trigger.toLowerCase().includes(queryLower)
    ) || summary.name.toLowerCase().includes(queryLower);
  });

  if (matchingSummaries.length === 0) {
    console.error(`[Router] No matching skill summaries found for: "${query}"`);
    return [];
  }

  // Transform to MemoryResult format
  const results: MemoryResult[] = matchingSummaries.map((summary) => {
    return {
      id: summary.id,
      source: "procedural" as const,
      content: `${summary.name}: ${summary.summary}`, // Use summary instead of full description
      similarity: summary.quality_score,
      timestamp: summary.last_used || new Date(),
      confidence: summary.quality_score,
    };
  });

  console.error(
    `[Router] Found ${results.length} matching skill summaries ` +
    `(token reduction: ~${Math.round((1 - results.length / 10) * 100)}%)`
  );

  // Already sorted by quality score
  return results;
}
