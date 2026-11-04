import { execFileSync } from "node:child_process";

/** Environment the Vesper stdio server is registered with, shared by every MCP client. */
export function buildVesperServerEnv(
  envVars: Record<string, string>,
  absoluteSqliteDb: string,
): Record<string, string> {
  const environment: Record<string, string> = {
    REDIS_HOST: envVars.REDIS_HOST || "localhost",
    REDIS_PORT: envVars.REDIS_PORT || "6379",
    QDRANT_URL: envVars.QDRANT_URL || "http://localhost:6333",
    SQLITE_DB: absoluteSqliteDb,
    EMBEDDING_SERVICE_URL: envVars.EMBEDDING_SERVICE_URL || "http://localhost:8000",
    POSTGRES_HOST: envVars.POSTGRES_HOST || "localhost",
    POSTGRES_PORT: envVars.POSTGRES_PORT || "5432",
    POSTGRES_DB: envVars.POSTGRES_DB || "memory",
    POSTGRES_USER: envVars.POSTGRES_USER || "postgres",
    NODE_ENV: envVars.NODE_ENV || "production",
    LOG_LEVEL: envVars.LOG_LEVEL || "info",
    AUTH_ENABLED: envVars.AUTH_ENABLED || "false",
    MCP_API_KEY_TIER: envVars.MCP_API_KEY_TIER || "standard",
    MCP_API_KEY_SCOPES: envVars.MCP_API_KEY_SCOPES || "*",
    RATE_LIMIT_DEFAULT_TIER: envVars.RATE_LIMIT_DEFAULT_TIER || "standard",
    RATE_LIMIT_FAIL_OPEN: envVars.RATE_LIMIT_FAIL_OPEN || "false",
  };
  for (const key of [
    "REDIS_PASSWORD", "QDRANT_API_KEY", "POSTGRES_PASSWORD",
    "MCP_API_KEY_HASH", "MCP_API_KEY_USER_ID",
  ]) {
    if (envVars[key]) environment[key] = envVars[key];
  }
  return environment;
}

/** Register the stdio server without interpreting configuration as shell syntax. */
export function registerClaudeMcpServer(
  envVars: Record<string, string>,
  absoluteSqliteDb: string,
  serverPath: string,
): void {
  const environment = buildVesperServerEnv(envVars, absoluteSqliteDb);

  // Each -e value is one argument, including spaces, quotes and shell metacharacters.
  const args = ["mcp", "add", "vesper", "--transport", "stdio", "--scope", "user"];
  for (const [key, value] of Object.entries(environment)) args.push("-e", `${key}=${value}`);
  args.push("--", "node", serverPath);
  try {
    // Child diagnostics and execFileSync errors can contain credential-bearing argv.
    execFileSync("claude", args, { stdio: "ignore" });
  } catch {
    throw new Error("Claude MCP registration failed. Check the configuration and retry.");
  }
}
