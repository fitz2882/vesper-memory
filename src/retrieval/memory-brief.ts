/**
 * Brief mode: pack the most relevant parts of many memories into a fixed
 * token budget, instead of returning a handful of whole memories.
 *
 * Idea borrowed from Memorilla (arXiv 2610.21375): look across a wide set of
 * memories, then hand the model only what this query needs, in a fixed
 * budget. Memorilla does this with learned soft tokens for one open-weight
 * model; Vesper does it in plain text so any model (Claude, Codex) can read
 * it. No LLM call: selection is deterministic and runs in well under a
 * millisecond for 100 candidates.
 *
 * Steps:
 *  1. The caller retrieves a wide candidate pool (rank order = relevance).
 *  2. Long memories are trimmed to their opening sentence plus the sentences
 *     that share terms with the query. Short memories are kept whole.
 *  3. Near-duplicate snippets are dropped.
 *  4. Snippets are packed in rank order until the token budget is full
 *     (first fit: a later, shorter snippet can still fill the gap).
 */

export interface BriefCandidate {
  id: string;
  content: string;
  memoryType: string;
  createdAt: string | number;
  rank: number;
}

export interface BriefOptions {
  /** Approximate token budget for the whole brief. */
  tokenBudget: number;
  /** Memories longer than this (in tokens) are trimmed to relevant sentences. */
  maxTokensPerMemory?: number;
  /** Jaccard similarity at or above which a snippet counts as a duplicate. */
  duplicateThreshold?: number;
}

export interface BriefSource {
  ref: number;
  id: string;
  memory_type: string;
  created_at: string | number;
  rank: number;
  trimmed: boolean;
}

export interface MemoryBrief {
  brief: string;
  sources: BriefSource[];
  token_estimate: number;
  token_budget: number;
  candidate_count: number;
  included_count: number;
  omitted_count: number;
  duplicate_count: number;
}

export const DEFAULT_BRIEF_TOKEN_BUDGET = 600;
export const MIN_BRIEF_TOKEN_BUDGET = 100;
export const MAX_BRIEF_TOKEN_BUDGET = 8000;
const DEFAULT_MAX_TOKENS_PER_MEMORY = 120;
const DEFAULT_DUPLICATE_THRESHOLD = 0.85;
const ELLIPSIS = " … ";

const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can could did do does for from had has have how i if in into is it " +
    "its me my of on or our she he her him his so that the their them then there these they this to was " +
    "we were what when where which who whom why will with would you your about after before again all am " +
    "any because being both each few more most other over same some such than too very just should now " +
    "ever also only own up down out off once here further while during through until against between"
  ).split(" ")
);

/** Rough token estimate (about 4 characters per token for English text). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function stem(word: string): string {
  // Identifiers (paths, versions, hosts, snake_case) are matched exactly.
  if (/[^\p{L}]/u.test(word)) return word;
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function contentTerms(text: string): Set<string> {
  const terms = new Set<string>();
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}_][\p{L}\p{N}_.\-:/]*/gu) ?? []) {
    const word = raw.replace(/[.\-:/]+$/, "");
    if (word.length < 2 || STOPWORDS.has(word)) continue;
    terms.add(stem(word));
  }
  return terms;
}

export function splitSentences(text: string): string[] {
  const parts = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}"'(\[])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : [text.trim()];
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const term of a) if (b.has(term)) shared++;
  return shared / (a.size + b.size - shared);
}

function formatDate(value: string | number): string {
  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

/**
 * Trim a memory to its opening sentence plus the sentences that share terms
 * with the query, keeping original order, within maxTokens.
 */
export function trimToRelevant(
  content: string,
  queryTerms: Set<string>,
  maxTokens: number
): { text: string; trimmed: boolean } {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (estimateTokens(normalized) <= maxTokens) return { text: normalized, trimmed: false };

  const sentences = splitSentences(normalized);
  const scored = sentences.map((sentence, index) => {
    const terms = contentTerms(sentence);
    let overlap = 0;
    for (const term of terms) if (queryTerms.has(term)) overlap++;
    return { index, sentence, overlap };
  });

  // Opening sentence first (it usually says what the memory is about), then
  // the sentences with the most query-term overlap.
  const order = [
    scored[0],
    ...scored
      .slice(1)
      .filter((s) => s.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap || a.index - b.index),
  ];
  const keep = new Set<number>();
  let used = 0;
  for (const item of order) {
    const cost = estimateTokens(item.sentence) + 1;
    if (keep.size > 0 && used + cost > maxTokens) continue;
    keep.add(item.index);
    used += cost;
  }

  let text = "";
  let previous = -1;
  for (const item of scored) {
    if (!keep.has(item.index)) continue;
    if (previous >= 0) text += item.index === previous + 1 ? " " : ELLIPSIS;
    text += item.sentence;
    previous = item.index;
  }
  // A single opening sentence longer than the cap is cut on a word boundary.
  if (estimateTokens(text) > maxTokens) {
    const cut = text.slice(0, maxTokens * 4);
    text = cut.slice(0, Math.max(cut.lastIndexOf(" "), maxTokens * 2)) + "…";
  }
  if (previous < scored.length - 1) text += ELLIPSIS.trimEnd();
  return { text, trimmed: true };
}

export function buildMemoryBrief(
  query: string,
  candidates: BriefCandidate[],
  options: BriefOptions
): MemoryBrief {
  const tokenBudget = options.tokenBudget;
  const maxTokensPerMemory = Math.min(
    options.maxTokensPerMemory ?? DEFAULT_MAX_TOKENS_PER_MEMORY,
    tokenBudget
  );
  const duplicateThreshold = options.duplicateThreshold ?? DEFAULT_DUPLICATE_THRESHOLD;
  const queryTerms = contentTerms(query);
  const ordered = [...candidates].sort((a, b) => a.rank - b.rank);

  const lines: string[] = [];
  const sources: BriefSource[] = [];
  const keptTerms: Set<string>[] = [];
  let used = 0;
  let duplicates = 0;

  for (const candidate of ordered) {
    const { text, trimmed } = trimToRelevant(candidate.content, queryTerms, maxTokensPerMemory);
    if (!text) continue;
    const terms = contentTerms(text);
    if (keptTerms.some((kept) => jaccard(kept, terms) >= duplicateThreshold)) {
      duplicates++;
      continue;
    }
    const ref = sources.length + 1;
    const date = formatDate(candidate.createdAt);
    const line = `[${ref}]${date ? ` (${date})` : ""} ${text}`;
    const cost = estimateTokens(line) + 1;
    if (used + cost > tokenBudget) continue; // first fit: a shorter one may still fit
    lines.push(line);
    keptTerms.push(terms);
    sources.push({
      ref,
      id: candidate.id,
      memory_type: candidate.memoryType,
      created_at: candidate.createdAt,
      rank: candidate.rank,
      trimmed,
    });
    used += cost;
  }

  const brief = lines.join("\n");
  return {
    brief,
    sources,
    token_estimate: estimateTokens(brief),
    token_budget: tokenBudget,
    candidate_count: candidates.length,
    included_count: sources.length,
    omitted_count: candidates.length - sources.length - duplicates,
    duplicate_count: duplicates,
  };
}

/** Size of the candidate pool to retrieve for a brief. */
export function briefCandidateLimit(maxResults: number, tokenBudget: number): number {
  // Enough candidates to fill the budget with short memories, never fewer
  // than the caller asked for, capped at the retriever's limit.
  return Math.min(100, Math.max(maxResults, 40, Math.ceil(tokenBudget / 15)));
}
