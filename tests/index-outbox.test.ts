import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import {
  IndexOutboxProcessor,
  initializeIndexOutboxSchema,
} from "../src/retrieval/index-outbox.js";

describe("durable index outbox", () => {
  const databases: Database.Database[] = [];

  afterEach(() => {
    for (const db of databases.splice(0)) db.close();
  });

  function openDatabase(): Database.Database {
    const db = new Database(":memory:");
    initializeIndexOutboxSchema(db);
    databases.push(db);
    return db;
  }

  it("commits an outbox mutation atomically with its canonical write", () => {
    const db = openDatabase();
    db.exec("CREATE TABLE memories (id TEXT PRIMARY KEY, content TEXT NOT NULL)");
    const outbox = new IndexOutboxProcessor(db, {});

    expect(() =>
      db.transaction(() => {
        db.prepare("INSERT INTO memories VALUES (?, ?)").run("rolled-back", "content");
        outbox.enqueue({
          memoryId: "rolled-back",
          operation: "upsert",
          namespace: "private",
          content: "content",
          memoryType: "semantic",
          createdAt: 1,
        });
        throw new Error("abort");
      })()
    ).toThrow("abort");

    expect(db.prepare("SELECT COUNT(*) AS count FROM memories").get()).toEqual({ count: 0 });
    expect(outbox.getPendingCount()).toBe(0);
  });

  it("treats intentionally unconfigured projections as already acknowledged", () => {
    const db = openDatabase();
    const outbox = new IndexOutboxProcessor(db, {});
    outbox.enqueue({
      memoryId: "fts-only",
      operation: "upsert",
      namespace: "default",
      content: "canonical FTS content",
      memoryType: "semantic",
      createdAt: 1,
    });

    expect(outbox.getPendingCount()).toBe(0);
    expect(outbox.getState("fts-only")).toBe("indexed");
  });

  it("does not resurrect an unconfigured projection when a pending mutation is coalesced", async () => {
    const db = openDatabase();
    const store = vi
      .fn()
      .mockRejectedValueOnce(new Error("redis offline"))
      .mockResolvedValueOnce(undefined);
    const outbox = new IndexOutboxProcessor(db, {
      workingMemory: { store, delete: vi.fn() } as never,
    });
    const mutation = {
      memoryId: "redis-only",
      operation: "upsert" as const,
      namespace: "default",
      content: "first",
      memoryType: "semantic",
      createdAt: 1,
    };
    outbox.enqueue(mutation);
    expect(await outbox.drain()).toMatchObject({ completed: 0, pending: 1 });
    outbox.enqueue({ ...mutation, content: "second", createdAt: 2 });

    const row = db
      .prepare("SELECT qdrant_pending, redis_pending FROM index_outbox WHERE memory_id = ?")
      .get(mutation.memoryId);
    expect(row).toEqual({ qdrant_pending: 0, redis_pending: 1 });
    expect(await outbox.drain()).toMatchObject({ completed: 1, pending: 0 });
  });

  it("preserves transient-outage upserts and delete tombstones for desired projections", async () => {
    const db = openDatabase();
    const outbox = new IndexOutboxProcessor(db, {
      projectionConfig: { qdrant: true, redis: true },
    });
    outbox.enqueue({
      memoryId: "offline-upsert",
      operation: "upsert",
      namespace: "default",
      content: "repair after restart",
      memoryType: "semantic",
      createdAt: 1,
    });
    outbox.enqueue({
      memoryId: "offline-delete",
      operation: "delete",
      namespace: "default",
      createdAt: 2,
    });

    expect(await outbox.drain()).toMatchObject({ completed: 0, pending: 2 });
    expect(
      db
        .prepare(
          `SELECT memory_id, operation, qdrant_pending, redis_pending
           FROM index_outbox ORDER BY memory_id`
        )
        .all()
    ).toEqual([
      {
        memory_id: "offline-delete",
        operation: "delete",
        qdrant_pending: 1,
        redis_pending: 1,
      },
      {
        memory_id: "offline-upsert",
        operation: "upsert",
        qdrant_pending: 1,
        redis_pending: 1,
      },
    ]);
  });

  it("can replay a delete without an embedding client once Qdrant recovers", async () => {
    const db = openDatabase();
    const deleteMemory = vi.fn().mockResolvedValue(undefined);
    const outbox = new IndexOutboxProcessor(db, {
      hybridSearch: { deleteMemory, upsertMemory: vi.fn() } as never,
      projectionConfig: { qdrant: true, redis: false },
    });
    outbox.enqueue({
      memoryId: "delete-without-embedding",
      operation: "delete",
      namespace: "default",
      createdAt: 3,
    });

    expect(await outbox.drain()).toMatchObject({ completed: 1, pending: 0 });
    expect(deleteMemory).toHaveBeenCalledWith("delete-without-embedding");
  });

  it("protects trusted projection fields from user metadata", async () => {
    const db = openDatabase();
    const upsertMemory = vi.fn().mockResolvedValue(undefined);
    const store = vi.fn().mockResolvedValue(undefined);
    const outbox = new IndexOutboxProcessor(db, {
      embeddingClient: { embed: vi.fn().mockResolvedValue([0.1, 0.2]) } as never,
      hybridSearch: { upsertMemory, deleteMemory: vi.fn() } as never,
      workingMemory: { store, delete: vi.fn() } as never,
    });
    outbox.enqueue({
      memoryId: "canonical-id",
      operation: "upsert",
      namespace: "trusted-ns",
      content: "trusted content",
      memoryType: "decision",
      agentId: "trusted-agent",
      taskId: "trusted-task",
      createdAt: 42,
      metadata: {
        namespace: "attacker-ns",
        content: "attacker content",
        memory_type: "episodic",
        agent_id: "attacker-agent",
      },
    });

    const result = await outbox.drain();

    expect(result).toMatchObject({ completed: 1, pending: 0 });
    expect(upsertMemory).toHaveBeenCalledWith(
      "canonical-id",
      [0.1, 0.2],
      expect.objectContaining({
        namespace: "trusted-ns",
        content: "trusted content",
        memory_type: "decision",
        agent_id: "trusted-agent",
        task_id: "trusted-task",
        created_at: 42,
      })
    );
    expect(store).toHaveBeenCalledOnce();
    expect(outbox.getState("canonical-id")).toBe("indexed");
  });

  it("retries only the projection that has not acknowledged the mutation", async () => {
    const db = openDatabase();
    const upsertMemory = vi.fn().mockResolvedValue(undefined);
    const redisStore = vi
      .fn()
      .mockRejectedValueOnce(new Error("redis offline"))
      .mockResolvedValueOnce(undefined);
    const outbox = new IndexOutboxProcessor(db, {
      embeddingClient: { embed: vi.fn().mockResolvedValue([1]) } as never,
      hybridSearch: { upsertMemory, deleteMemory: vi.fn() } as never,
      workingMemory: { store: redisStore, delete: vi.fn() } as never,
    });
    outbox.enqueue({
      memoryId: "retry-me",
      operation: "upsert",
      namespace: "default",
      content: "durable",
      memoryType: "episodic",
      createdAt: 7,
    });

    expect(await outbox.drain()).toMatchObject({ completed: 0, pending: 1 });
    expect(outbox.getState("retry-me")).toBe("pending");
    expect(await outbox.drain()).toMatchObject({ completed: 1, pending: 0 });
    expect(upsertMemory).toHaveBeenCalledOnce();
    expect(redisStore).toHaveBeenCalledTimes(2);
  });

  it("keeps delete tombstones until every derived index acknowledges them", async () => {
    const db = openDatabase();
    const deleteMemory = vi.fn().mockResolvedValue(undefined);
    const redisDelete = vi.fn().mockRejectedValue(new Error("redis offline"));
    const outbox = new IndexOutboxProcessor(db, {
      embeddingClient: { embed: vi.fn() } as never,
      hybridSearch: { upsertMemory: vi.fn(), deleteMemory } as never,
      workingMemory: { store: vi.fn(), delete: redisDelete } as never,
    });
    outbox.enqueue({
      memoryId: "deleted-id",
      operation: "delete",
      namespace: "private",
      createdAt: 9,
    });

    const result = await outbox.drain();

    expect(result).toMatchObject({ completed: 0, pending: 1 });
    expect(deleteMemory).toHaveBeenCalledWith("deleted-id");
    expect(redisDelete).toHaveBeenCalledWith("deleted-id", "private");
    expect(outbox.getState("deleted-id")).toBe("pending");
  });

  it("coalesces concurrent drains so a Redis projection is not duplicated", async () => {
    const db = openDatabase();
    let releaseStore!: () => void;
    const blockedStore = new Promise<void>((resolve) => {
      releaseStore = resolve;
    });
    const redisStore = vi.fn().mockReturnValue(blockedStore);
    const outbox = new IndexOutboxProcessor(db, {
      embeddingClient: { embed: vi.fn().mockResolvedValue([1]) } as never,
      hybridSearch: {
        upsertMemory: vi.fn().mockResolvedValue(undefined),
        deleteMemory: vi.fn(),
      } as never,
      workingMemory: { store: redisStore, delete: vi.fn() } as never,
    });
    outbox.enqueue({
      memoryId: "only-once",
      operation: "upsert",
      namespace: "default",
      content: "coalesced",
      memoryType: "semantic",
      createdAt: 10,
    });

    const first = outbox.drain();
    const second = outbox.drain();
    releaseStore();
    await Promise.all([first, second]);

    expect(redisStore).toHaveBeenCalledOnce();
    expect(outbox.getPendingCount()).toBe(0);
  });

  it("does not let an in-flight acknowledgement erase a newer mutation", async () => {
    const db = openDatabase();
    let releaseQdrant!: () => void;
    let markQdrantStarted!: () => void;
    const qdrantBlocked = new Promise<void>((resolve) => {
      releaseQdrant = resolve;
    });
    const qdrantStarted = new Promise<void>((resolve) => {
      markQdrantStarted = resolve;
    });
    const upsertMemory = vi
      .fn()
      .mockImplementationOnce(async () => {
        markQdrantStarted();
        await qdrantBlocked;
      })
      .mockResolvedValueOnce(undefined);
    const outbox = new IndexOutboxProcessor(db, {
      embeddingClient: { embed: vi.fn().mockResolvedValue([1]) } as never,
      hybridSearch: { upsertMemory, deleteMemory: vi.fn() } as never,
      workingMemory: {
        store: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn(),
      } as never,
    });
    outbox.enqueue({
      memoryId: "changing",
      operation: "upsert",
      namespace: "default",
      content: "old value",
      memoryType: "semantic",
      createdAt: 11,
    });

    const oldDrain = outbox.drain();
    await qdrantStarted;
    outbox.enqueue({
      memoryId: "changing",
      operation: "upsert",
      namespace: "default",
      content: "new value",
      memoryType: "semantic",
      createdAt: 12,
    });
    releaseQdrant();
    await oldDrain;

    expect(outbox.getState("changing")).toBe("pending");
    await outbox.drain();
    expect(outbox.getState("changing")).toBe("indexed");
    expect(upsertMemory).toHaveBeenCalledTimes(2);
    expect(upsertMemory.mock.calls[1][2]).toEqual(
      expect.objectContaining({ content: "new value", created_at: 12 })
    );
  });
});
