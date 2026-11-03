import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe.sequential("production server memory flow", () => {
  let tempDirectory: string;
  let dbPath: string;
  let server: typeof import("../src/server.js");

  beforeAll(async () => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "vesper-server-flow-"));
    dbPath = path.join(tempDirectory, "memory.db");
    process.env.SQLITE_DB = dbPath;
    process.env.VESPER_SKIP_AUTO_START = "1";
    process.env.VESPER_DISABLE_OPTIONAL_SERVICES = "1";
    process.env.VESPER_DISABLE_STARTUP_CONSOLIDATION = "1";
    server = await import("../src/server.js");
    await server.initializeConnections();
    await new Promise((resolve) => setImmediate(resolve));
  });

  afterAll(() => {
    server.closeConnectionsForTesting();
    delete process.env.SQLITE_DB;
    delete process.env.VESPER_SKIP_AUTO_START;
    delete process.env.VESPER_DISABLE_OPTIONAL_SERVICES;
    delete process.env.VESPER_DISABLE_STARTUP_CONSOLIDATION;
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("writes canonically, retrieves through FTS, and reports no phantom projection backlog", async () => {
    const stored = await server.processTool("store_memory", {
      content: "canonical outbox retrieval marker",
      memory_type: "semantic",
      namespace: "production-flow",
    });
    expect(stored.index_state).toBe("indexed");

    const retrieved = await server.processTool("retrieve_memory", {
      query: "outbox marker",
      namespace: "production-flow",
      routing_strategy: "full_text",
    });
    expect((retrieved.results as Array<{ id: string }>).map((row) => row.id)).toContain(
      stored.memory_id
    );

    const metadataExpired = await server.processTool("store_memory", {
      content: "metadata-only expired recent entry",
      memory_type: "semantic",
      namespace: "production-flow",
      metadata: { expired_at: Date.now() - 1 },
    });
    const canonicalPrecedence = await server.processTool("store_memory", {
      content: "canonical lifecycle overrides stale metadata",
      memory_type: "semantic",
      namespace: "production-flow",
      valid_until: Date.now() + 60_000,
      metadata: { valid_until: Date.now() - 1 },
    });
    const malformedLegacy = await server.processTool("store_memory", {
      content: "malformed metadata lifecycle remains auditable",
      memory_type: "semantic",
      namespace: "production-flow",
      metadata: {
        valid_until: "unknown",
        expired_at: "unknown",
        archived_at: "unknown",
      },
    });
    const recent = await server.processTool("list_recent", {
      namespace: "production-flow",
      limit: 10,
    });
    expect((recent.entries as Array<{ id: string }>).map((row) => row.id)).not.toContain(
      metadataExpired.memory_id
    );
    expect((recent.entries as Array<{ id: string }>).map((row) => row.id)).toContain(
      canonicalPrecedence.memory_id
    );
    expect((recent.entries as Array<{ id: string }>).map((row) => row.id)).toContain(
      malformedLegacy.memory_id
    );

    const db = new Database(dbPath, { readonly: true });
    try {
      expect(db.prepare("SELECT COUNT(*) AS count FROM index_outbox").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("preserves future-effective supersession history and rejects a branched chain", async () => {
    const oldFrom = Date.now() - 60_000;
    const replacementFrom = Date.now() + 60_000;
    const oldDecision = await server.processTool("store_decision", {
      content: "transport choice REST original",
      namespace: "decision-flow",
      valid_from: oldFrom,
    });
    const replacement = await server.processTool("store_decision", {
      content: "transport choice GraphQL replacement",
      namespace: "decision-flow",
      supersedes: oldDecision.decision_id,
      valid_from: replacementFrom,
    });

    const currentRecent = await server.processTool("list_recent", {
      namespace: "decision-flow",
      memory_type: "decision",
      limit: 5,
    });
    expect((currentRecent.entries as Array<{ id: string }>).map((row) => row.id)).toEqual([
      oldDecision.decision_id,
    ]);

    const before = await server.processTool("retrieve_memory", {
      query: "transport choice",
      namespace: "decision-flow",
      routing_strategy: "full_text",
      as_of: replacementFrom - 1,
    });
    expect((before.results as Array<{ id: string }>).map((row) => row.id)).toEqual([
      oldDecision.decision_id,
    ]);

    const after = await server.processTool("retrieve_memory", {
      query: "transport choice",
      namespace: "decision-flow",
      routing_strategy: "full_text",
      as_of: replacementFrom + 1,
    });
    expect((after.results as Array<{ id: string }>).map((row) => row.id)).toEqual([
      replacement.decision_id,
    ]);

    await expect(
      server.processTool("store_decision", {
        content: "transport choice branched replacement",
        namespace: "decision-flow",
        supersedes: oldDecision.decision_id,
        valid_from: replacementFrom,
      })
    ).rejects.toThrow("already been superseded");

    const db = new Database(dbPath, { readonly: true });
    try {
      const old = db
        .prepare("SELECT valid_until, metadata FROM memories WHERE id = ?")
        .get(oldDecision.decision_id) as { valid_until: number; metadata: string };
      expect(old.valid_until).toBe(replacementFrom);
      expect(JSON.parse(old.metadata)).toMatchObject({
        superseded_by: replacement.decision_id,
        superseded_at: replacementFrom,
      });
    } finally {
      db.close();
    }
  });

  it("shares lifecycle fields atomically and leaves target projections eligible for consolidation", async () => {
    const expiresAt = Date.now() + 3_600_000;
    const source = await server.processTool("store_memory", {
      content: "handoff lifecycle marker",
      memory_type: "episodic",
      namespace: "handoff-source",
      expired_at: expiresAt,
    });
    const handoff = await server.processTool("share_context", {
      source_namespace: "handoff-source",
      target_namespace: "handoff-target",
      query: "lifecycle marker",
      include_entities: false,
      include_skills: false,
    });
    expect(handoff.memories_shared).toBe(1);

    const db = new Database(dbPath, { readonly: true });
    try {
      const copied = db
        .prepare(
          `SELECT expired_at, consolidated_at FROM memories
           WHERE namespace = 'handoff-target'
             AND json_extract(metadata, '$.shared_from_memory_id') = ?`
        )
        .get(source.memory_id) as { expired_at: number; consolidated_at: number | null };
      expect(copied.expired_at).toBe(expiresAt);
      expect(copied.consolidated_at).toBeNull();

      const handoffRow = db
        .prepare("SELECT consolidated_at FROM memories WHERE id = ?")
        .get(handoff.handoff_id) as { consolidated_at: number | null };
      expect(handoffRow.consolidated_at).toBeNull();
    } finally {
      db.close();
    }
  });
});
