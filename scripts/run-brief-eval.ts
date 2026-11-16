#!/usr/bin/env tsx
/**
 * Brief-mode evaluation on LoCoMo (Maharana et al., ACL 2024).
 *
 * Question: at the same token budget, does a brief (wide retrieval packed
 * into the budget) put more of the needed evidence in front of the model than
 * today's top-5 whole memories?
 *
 * Each LoCoMo conversation becomes one namespace; each dialogue turn becomes
 * one memory dated by its session. Every question is run through the
 * production MemoryRetriever, then formatted three ways:
 *   - top5:      today's default, 5 whole memories (variable tokens)
 *   - whole@B:   whole memories in rank order until B tokens are used
 *   - brief@B:   buildMemoryBrief at B tokens (trimming + de-duplication)
 *
 * Metrics, per LoCoMo category:
 *   - evidence recall: share of labelled evidence turns present in the output
 *   - all-evidence:    share of questions with every evidence turn present
 *   - answer present:  normalised answer tokens all appear in the output
 *                      (short answers only, <= 6 content tokens)
 *   - tokens:          estimated tokens handed to the model
 *
 * LoCoMo is CC BY-NC 4.0 and is not committed here. Get it with
 *   git clone --depth 1 https://github.com/snap-research/locomo
 * and pass LOCOMO_PATH=<clone>/data/locomo10.json.
 *
 * Usage:
 *   LOCOMO_PATH=... npx tsx scripts/run-brief-eval.ts                   # BM25
 *   LOCOMO_PATH=... EMBEDDING_SERVICE_URL=http://localhost:8000 \
 *     npx tsx scripts/run-brief-eval.ts                                  # + dense, hybrid
 */

import Database from "better-sqlite3";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { MemoryRetriever, type RetrievalStrategy } from "../src/retrieval/memory-retriever.js";
import {
  buildMemoryBrief,
  briefCandidateLimit,
  estimateTokens,
  type BriefCandidate,
} from "../src/retrieval/memory-brief.js";
import { EmbeddingClient } from "../src/embeddings/client.js";
import type { DenseSearchResult } from "../src/retrieval/hybrid-search.js";

interface LocomoTurn {
  speaker: string;
  dia_id: string;
  text: string;
  blip_caption?: string;
}
interface LocomoQa {
  question: string;
  answer?: string | number;
  evidence?: string[];
  category: number;
}
interface LocomoSample {
  sample_id: string;
  qa: LocomoQa[];
  conversation: Record<string, unknown>;
}

const CATEGORY_NAMES: Record<number, string> = {
  1: "multi-hop",
  2: "temporal",
  3: "open-domain",
  4: "single-hop",
};
const BUDGETS = (process.env.BUDGETS || "300,600,1200").split(",").map(Number);
// SAMPLES=0-4 keeps conversations 0..4 (for tune/held-out splits).
const SAMPLE_RANGE = (process.env.SAMPLES || "").split("-").map(Number);
const OUTPUT_DIR = join(process.cwd(), "benchmarks/brief-eval/results");

function parseSessionDate(raw: unknown): number {
  // e.g. "1:56 pm on 8 May, 2023"
  const match = String(raw ?? "").match(
    /(\d{1,2}):(\d{2})\s*(am|pm)\s+on\s+(\d{1,2})\s+(\w+),?\s+(\d{4})/i
  );
  if (!match) return Date.UTC(2023, 0, 1);
  const [, h, m, ampm, day, month, year] = match;
  let hour = Number(h) % 12;
  if (ampm.toLowerCase() === "pm") hour += 12;
  const monthIndex = new Date(`${month} 1, 2000`).getMonth();
  return Date.UTC(Number(year), monthIndex, Number(day), hour, Number(m));
}

interface Memory {
  id: string;
  namespace: string;
  content: string;
  created: number;
}

function loadMemories(sample: LocomoSample): Memory[] {
  const conv = sample.conversation;
  const memories: Memory[] = [];
  for (const key of Object.keys(conv)) {
    const match = key.match(/^session_(\d+)$/);
    if (!match || !Array.isArray(conv[key])) continue;
    const created = parseSessionDate(conv[`${key}_date_time`]);
    for (const turn of conv[key] as LocomoTurn[]) {
      const image = turn.blip_caption ? ` [shared a photo: ${turn.blip_caption}]` : "";
      memories.push({
        id: `${sample.sample_id}:${turn.dia_id}`,
        namespace: sample.sample_id,
        content: `${turn.speaker}: ${turn.text}${image}`,
        created,
      });
    }
  }
  return memories;
}

function buildDatabase(memories: Memory[]): Database.Database {
  const db = new Database(":memory:");
  db.exec(readFileSync(join(process.cwd(), "config/sqlite-schema.sql"), "utf8"));
  const insert = db.prepare(`
    INSERT INTO memories (id, content, memory_type, created_at, updated_at, valid_from, metadata, namespace)
    VALUES (?, ?, 'episodic', ?, ?, ?, '{}', ?)
  `);
  const tx = db.transaction((rows: Memory[]) => {
    for (const m of rows) insert.run(m.id, m.content, m.created, m.created, m.created, m.namespace);
  });
  tx(memories);
  return db;
}

class InMemoryDenseIndex {
  private readonly points: Array<{
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
  }> = [];
  add(id: string, vector: number[], payload: Record<string, unknown>): void {
    this.points.push({ id, vector, payload });
  }
  async denseSearch(
    queryVector: number[],
    topK: number = 5,
    filter?: Record<string, unknown>
  ): Promise<DenseSearchResult[]> {
    const must = (filter?.must as Array<{ key: string; match: Record<string, unknown> }>) ?? [];
    return this.points
      .filter((p) =>
        must.every(({ key, match }) => {
          const value = p.payload[key];
          if ("value" in match) return value === match.value;
          if ("any" in match) return (match.any as unknown[]).includes(value);
          return true;
        })
      )
      .map((p) => ({ id: p.id, score: cosine(queryVector, p.vector), payload: p.payload }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, topK) as DenseSearchResult[];
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function normalise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !["a", "an", "the", "and", "of", "on", "in", "to"].includes(w));
}

interface Tally {
  questions: number;
  evidenceTotal: number;
  evidenceFound: number;
  allEvidence: number;
  answerEligible: number;
  answerPresent: number;
  tokens: number;
}
const emptyTally = (): Tally => ({
  questions: 0,
  evidenceTotal: 0,
  evidenceFound: 0,
  allEvidence: 0,
  answerEligible: 0,
  answerPresent: 0,
  tokens: 0,
});

function score(
  tally: Tally,
  includedIds: Set<string>,
  outputText: string,
  evidence: string[],
  answer: string | undefined
): void {
  tally.questions++;
  const found = evidence.filter((id) => includedIds.has(id)).length;
  tally.evidenceTotal += evidence.length;
  tally.evidenceFound += found;
  if (found === evidence.length) tally.allEvidence++;
  if (answer !== undefined) {
    const answerTokens = normalise(answer);
    if (answerTokens.length > 0 && answerTokens.length <= 6) {
      tally.answerEligible++;
      const outputTokens = new Set(normalise(outputText));
      if (answerTokens.every((t) => outputTokens.has(t))) tally.answerPresent++;
    }
  }
  tally.tokens += estimateTokens(outputText);
}

function pct(n: number, d: number): string {
  return d === 0 ? "–" : `${((100 * n) / d).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const path = process.env.LOCOMO_PATH;
  if (!path) throw new Error("Set LOCOMO_PATH to locomo10.json (see header).");
  const allSamples = JSON.parse(readFileSync(path, "utf8")) as LocomoSample[];
  const samples =
    SAMPLE_RANGE.length === 2 ? allSamples.slice(SAMPLE_RANGE[0], SAMPLE_RANGE[1] + 1) : allSamples;
  const memories = samples.flatMap(loadMemories);
  const memoryIds = new Set(memories.map((m) => m.id));

  const strategies: RetrievalStrategy[] = ["full_text"];
  let denseIndex: InMemoryDenseIndex | undefined;
  let embedder: EmbeddingClient | undefined;
  const serviceUrl = process.env.EMBEDDING_SERVICE_URL;
  if (serviceUrl) {
    embedder = new EmbeddingClient({ serviceUrl });
    denseIndex = new InMemoryDenseIndex();
    for (const m of memories) {
      denseIndex.add(m.id, await embedder.embed(m.content), {
        namespace: m.namespace,
        memory_type: "episodic",
      });
    }
    strategies.push("semantic", "hybrid");
  }

  const arms = ["top5", ...BUDGETS.flatMap((b) => [`whole@${b}`, `brief@${b}`])];
  const results: Record<string, Record<string, Record<string, Tally>>> = {};
  let skippedQuestions = 0;
  let missingEvidence = 0;
  const latencies: number[] = [];

  for (const strategy of strategies) {
    const db = buildDatabase(memories);
    const now = Date.UTC(2030, 0, 1);
    const retriever = new MemoryRetriever({
      db,
      now: () => now,
      ...(embedder && denseIndex ? { embeddingClient: embedder, hybridSearch: denseIndex } : {}),
    });
    retriever.initialize();
    const byArm: Record<string, Record<string, Tally>> = {};
    for (const arm of arms) byArm[arm] = {};
    results[strategy] = byArm;

    for (const sample of samples) {
      for (const qa of sample.qa) {
        const name = CATEGORY_NAMES[qa.category];
        if (!name) continue; // category 5 (adversarial) has no evidence answer
        const evidence = (qa.evidence ?? [])
          .flatMap((e) => e.split(/[;,\s]+/))
          .filter(Boolean)
          .map((e) => `${sample.sample_id}:${e}`);
        const known = evidence.filter((id) => memoryIds.has(id));
        missingEvidence += evidence.length - known.length;
        if (known.length === 0) {
          skippedQuestions++;
          continue;
        }
        const answer = qa.answer === undefined ? undefined : String(qa.answer);
        const pool = briefCandidateLimit(5, Math.max(...BUDGETS));
        const started = performance.now();
        const response = await retriever.retrieve({
          query: qa.question,
          namespace: sample.sample_id,
          maxResults: pool,
          strategy,
        });
        const candidates: BriefCandidate[] = response.results.map((r) => ({
          id: r.id,
          content: r.content,
          memoryType: r.memoryType,
          createdAt: r.createdAt,
          rank: r.rank,
        }));

        for (const arm of arms) {
          let ids: Set<string>;
          let text: string;
          if (arm === "top5") {
            const packed = buildMemoryBrief(qa.question, candidates.slice(0, 5), {
              tokenBudget: 100000,
              maxTokensPerMemory: 100000,
              duplicateThreshold: 1.01,
            });
            ids = new Set(packed.sources.map((s) => s.id));
            text = packed.brief;
          } else {
            const [kind, b] = arm.split("@");
            const packed = buildMemoryBrief(
              qa.question,
              candidates,
              kind === "brief"
                ? { tokenBudget: Number(b) }
                : {
                    tokenBudget: Number(b),
                    maxTokensPerMemory: Number(b),
                    duplicateThreshold: 1.01,
                  }
            );
            ids = new Set(packed.sources.map((s) => s.id));
            text = packed.brief;
          }
          for (const key of [name, "all"]) {
            byArm[arm][key] ??= emptyTally();
            score(byArm[arm][key], ids, text, known, answer);
          }
        }
        latencies.push(performance.now() - started);
      }
    }
    db.close();
  }

  latencies.sort((a, b) => a - b);
  const p = (q: number) =>
    latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))];
  const categories = ["all", "multi-hop", "single-hop", "temporal", "open-domain"];
  let md = `# Brief-mode evaluation on LoCoMo\n\nGenerated: ${new Date().toISOString()}\n\n`;
  md += `Data: LoCoMo-10, ${samples.length} conversations, ${memories.length} turns stored as memories. `;
  md += `Skipped ${skippedQuestions} questions whose evidence ids are not in the data (${missingEvidence} unmatched ids); category 5 (adversarial) excluded.\n`;
  md += `Conversations: ${SAMPLE_RANGE.length === 2 ? process.env.SAMPLES : "all"}.\n`;
  md += `Retrieval: production MemoryRetriever, pool of ${briefCandidateLimit(5, Math.max(...BUDGETS))} candidates. Retrieval + packing P50/P95: ${p(0.5).toFixed(1)} / ${p(0.95).toFixed(1)} ms${serviceUrl ? " (includes query embedding)" : ""}.\n\n`;
  for (const strategy of strategies) {
    md += `## ${strategy}\n\n`;
    for (const cat of categories) {
      const n = results[strategy].top5[cat]?.questions ?? 0;
      md += `### ${cat} (n=${n})\n\n| Arm | Evidence recall | All evidence | Answer present | Avg tokens |\n|---|---|---|---|---|\n`;
      for (const arm of arms) {
        const t = results[strategy][arm][cat];
        if (!t) continue;
        md += `| ${arm} | ${pct(t.evidenceFound, t.evidenceTotal)} | ${pct(t.allEvidence, t.questions)} | ${pct(t.answerPresent, t.answerEligible)} (n=${t.answerEligible}) | ${(t.tokens / t.questions).toFixed(0)} |\n`;
      }
      md += `\n`;
    }
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const suffix = serviceUrl ? "all" : "bm25";
  if (process.env.NO_WRITE_RESULTS !== "1") {
    writeFileSync(join(OUTPUT_DIR, `results-${suffix}.md`), md);
    writeFileSync(join(OUTPUT_DIR, `results-${suffix}.json`), JSON.stringify(results, null, 2));
  }
  console.log(md);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
