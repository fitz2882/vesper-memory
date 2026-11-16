import { describe, expect, it } from "vitest";
import {
  buildMemoryBrief,
  briefCandidateLimit,
  contentTerms,
  estimateTokens,
  splitSentences,
  trimToRelevant,
  type BriefCandidate,
} from "../src/retrieval/memory-brief.js";

const candidate = (id: string, content: string, rank: number): BriefCandidate => ({
  id,
  content,
  memoryType: "semantic",
  createdAt: Date.UTC(2026, 10, rank),
  rank,
});

describe("memory brief", () => {
  it("packs memories in rank order with numbered refs that map to sources", () => {
    const brief = buildMemoryBrief(
      "where does the user work",
      [
        candidate("b", "The user prefers tabs over spaces.", 2),
        candidate("a", "The user works at Acme Logistics in Toronto.", 1),
      ],
      { tokenBudget: 200 }
    );
    const lines = brief.brief.split("\n");
    expect(lines[0]).toMatch(/^\[1\] \(2026-11-01\) The user works at Acme/);
    expect(lines[1]).toMatch(/^\[2\] \(2026-11-02\) The user prefers tabs/);
    expect(brief.sources.map((s) => [s.ref, s.id])).toEqual([
      [1, "a"],
      [2, "b"],
    ]);
    expect(brief.included_count).toBe(2);
    expect(brief.omitted_count).toBe(0);
  });

  it("never exceeds the token budget and reports what it left out", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      candidate(`m${i}`, `Memory number ${i} about the deploy pipeline and its flaky stage.`, i + 1)
    );
    const brief = buildMemoryBrief("deploy pipeline", many, {
      tokenBudget: 100,
      duplicateThreshold: 1.01,
    });
    expect(brief.token_estimate).toBeLessThanOrEqual(100);
    expect(brief.included_count).toBeGreaterThan(1);
    expect(brief.included_count + brief.omitted_count).toBe(50);
  });

  it("fills a gap with a later, shorter memory when the next one does not fit", () => {
    const brief = buildMemoryBrief(
      "x",
      [
        candidate("short1", "Short fact one.", 1),
        candidate("long", "word ".repeat(200).trim() + ".", 2),
        candidate("short2", "Short fact two.", 3),
      ],
      { tokenBudget: 100, maxTokensPerMemory: 1000 }
    );
    expect(brief.sources.map((s) => s.id)).toEqual(["short1", "short2"]);
  });

  it("drops near-duplicate memories", () => {
    const brief = buildMemoryBrief(
      "coffee",
      [
        candidate("a", "Dana drinks oat milk flat whites.", 1),
        candidate("b", "Dana drinks oat milk flat whites!", 2),
        candidate("c", "Dana's manager is Priya.", 3),
      ],
      { tokenBudget: 200 }
    );
    expect(brief.sources.map((s) => s.id)).toEqual(["a", "c"]);
    expect(brief.duplicate_count).toBe(1);
  });

  it("trims long memories to the opening sentence and the query-relevant sentences", () => {
    const content = [
      "Postmortem for the March outage.",
      "The team met on Tuesday.",
      "Lunch was pizza.",
      "Root cause was an expired TLS certificate on the ingress gateway.",
      "Weather was fine.",
      "Follow-up: automate certificate renewal.",
    ].join(" ");
    const { text, trimmed } = trimToRelevant(
      content,
      contentTerms("what caused the outage certificate"),
      30
    );
    expect(trimmed).toBe(true);
    expect(text).toContain("Postmortem for the March outage.");
    expect(text).toContain("expired TLS certificate");
    expect(text).not.toContain("pizza");
    expect(estimateTokens(text)).toBeLessThanOrEqual(34);
  });

  it("keeps short memories whole", () => {
    const { text, trimmed } = trimToRelevant("Port 6333 is Qdrant.", new Set(["redis"]), 120);
    expect(trimmed).toBe(false);
    expect(text).toBe("Port 6333 is Qdrant.");
  });

  it("keeps identifiers intact as query terms", () => {
    const terms = contentTerms("Why did ECONNREFUSED 127.0.0.1:6333 happen in src/server.ts?");
    const memoryTerms = contentTerms("Saw econnrefused from Qdrant.");
    expect([...terms].some((t) => memoryTerms.has(t) && t.startsWith("econnrefus"))).toBe(true);
    expect(terms.has("127.0.0.1:6333")).toBe(true);
    expect(terms.has("src/server.ts")).toBe(true);
  });

  it("splits sentences without breaking on decimals or file names", () => {
    expect(splitSentences("Use v0.6.2 now. Then run npm test.")).toEqual([
      "Use v0.6.2 now.",
      "Then run npm test.",
    ]);
  });

  it("returns an empty brief for no candidates", () => {
    const brief = buildMemoryBrief("anything", [], { tokenBudget: 600 });
    expect(brief.brief).toBe("");
    expect(brief.included_count).toBe(0);
  });

  it("sizes the candidate pool from the budget within the retriever's limit", () => {
    expect(briefCandidateLimit(5, 600)).toBe(40);
    expect(briefCandidateLimit(5, 1200)).toBe(80);
    expect(briefCandidateLimit(5, 8000)).toBe(100);
    expect(briefCandidateLimit(60, 300)).toBe(60);
  });
});
