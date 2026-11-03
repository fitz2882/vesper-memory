import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { registerClaudeMcpServer } from "../src/utils/claude-mcp-config.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn(), execSync: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

function capturedArguments(): string[] {
  expect(execFileSync).toHaveBeenCalledOnce();
  const [executable, args, options] = vi.mocked(execFileSync).mock.calls[0];
  expect(executable).toBe("claude");
  expect(options).toEqual({ stdio: "ignore" });
  expect(execSync).not.toHaveBeenCalled();
  return args as string[];
}

function environmentArguments(args: string[]): Record<string, string> {
  const environment: Record<string, string> = {};
  for (let index = 7; index < args.indexOf("--"); index += 2) {
    expect(args[index]).toBe("-e");
    const separator = args[index + 1].indexOf("=");
    environment[args[index + 1].slice(0, separator)] = args[index + 1].slice(separator + 1);
  }
  return environment;
}

describe("Claude MCP registration argument boundary", () => {
  it("preserves the normal default configuration and stdio server command", () => {
    registerClaudeMcpServer({}, "/tmp/vesper/memory.db", "/opt/vesper/dist/server.js");
    const args = capturedArguments();
    expect(args.slice(0, 7)).toEqual(["mcp", "add", "vesper", "--transport", "stdio", "--scope", "user"]);
    expect(args.slice(-3)).toEqual(["--", "node", "/opt/vesper/dist/server.js"]);
    expect(environmentArguments(args)).toEqual({
      REDIS_HOST: "localhost", REDIS_PORT: "6379", QDRANT_URL: "http://localhost:6333",
      SQLITE_DB: "/tmp/vesper/memory.db", EMBEDDING_SERVICE_URL: "http://localhost:8000",
      POSTGRES_HOST: "localhost", POSTGRES_PORT: "5432", POSTGRES_DB: "memory",
      POSTGRES_USER: "postgres", NODE_ENV: "production", LOG_LEVEL: "info",
      AUTH_ENABLED: "false", MCP_API_KEY_TIER: "standard", MCP_API_KEY_SCOPES: "*",
      RATE_LIMIT_DEFAULT_TIER: "standard", RATE_LIMIT_FAIL_OPEN: "false",
    });
  });

  it.each([
    "value with spaces", 'value with "double" and \'single\' quotes',
    "literal; not-a-command | & > < * ?", "literal$(not-a-command)\x60not-a-command\x60",
    "literal=value\nnext line", "--another-option",
  ])("passes configuration and paths literally: %s", (value) => {
    const database = `/tmp/${value}/memory.db`;
    const server = `/tmp/${value}/server.js`;
    const supplied = {
      REDIS_HOST: value, REDIS_PORT: value, QDRANT_URL: value,
      EMBEDDING_SERVICE_URL: value, POSTGRES_HOST: value, POSTGRES_PORT: value,
      POSTGRES_DB: value, POSTGRES_USER: value, NODE_ENV: value, LOG_LEVEL: value,
      AUTH_ENABLED: value, MCP_API_KEY_TIER: value, MCP_API_KEY_SCOPES: value,
      RATE_LIMIT_DEFAULT_TIER: value, RATE_LIMIT_FAIL_OPEN: value,
      REDIS_PASSWORD: value, QDRANT_API_KEY: value, POSTGRES_PASSWORD: value,
      MCP_API_KEY_HASH: value, MCP_API_KEY_USER_ID: value,
    };
    registerClaudeMcpServer(supplied, database, server);
    const args = capturedArguments();
    expect(environmentArguments(args)).toEqual({ ...supplied, SQLITE_DB: database });
    expect(args.slice(-3)).toEqual(["--", "node", server]);
  });

  it("omits empty optional credentials and ignores unrelated environment keys", () => {
    registerClaudeMcpServer({ REDIS_PASSWORD: "", UNRELATED_KEY: "ignored" }, ":memory:", "/tmp/server.js");
    const environment = environmentArguments(capturedArguments());
    expect(environment).not.toHaveProperty("REDIS_PASSWORD");
    expect(environment).not.toHaveProperty("UNRELATED_KEY");
    expect(environment.SQLITE_DB).toBe(":memory:");
  });

  it("sanitizes credential-bearing subprocess failures without a shell fallback", () => {
    const secret = "synthetic-private-token";
    const diagnostic = `Command failed: claude mcp add vesper -e REDIS_PASSWORD=${secret}`;
    const failure = Object.assign(new Error(diagnostic), {
      stdout: Buffer.from(diagnostic), stderr: Buffer.from(diagnostic),
      output: [null, Buffer.from(diagnostic), Buffer.from(diagnostic)],
    });
    vi.mocked(execFileSync).mockImplementationOnce(() => { throw failure; });
    let caught: unknown;
    try {
      registerClaudeMcpServer({ REDIS_PASSWORD: secret }, ":memory:", "/tmp/server.js");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("Claude MCP registration failed. Check the configuration and retry.");
    expect(caught).not.toBe(failure);
    expect(caught).not.toHaveProperty("cause");
    expect(caught).not.toHaveProperty("stderr");
    expect(caught).not.toHaveProperty("stdout");
    expect(String(caught)).not.toContain(secret);
    expect((caught as Error).stack).not.toContain(secret);
    capturedArguments();
  });
});
