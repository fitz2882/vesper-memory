/**
 * Codex setup for `vesper install|configure|init --client codex`.
 *
 * Codex reads MCP servers from `$CODEX_HOME/config.toml` (default `~/.codex`)
 * and global instructions from `$CODEX_HOME/AGENTS.md`. Both files belong to
 * the user, so every edit here is scoped to what Vesper owns:
 *
 * - config.toml: only the `[mcp_servers.vesper]` table (and its subtables) is
 *   replaced. The file is parsed before and after the edit, and the write is
 *   refused unless everything outside that table is unchanged.
 * - AGENTS.md: only the text between Vesper's begin/end markers is replaced.
 *
 * Re-running is idempotent: identical input produces no write.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse } from "smol-toml";

export const CODEX_SERVER_NAME = "vesper";
export const AGENTS_BEGIN_MARKER =
  "<!-- vesper:begin (managed by `vesper init --client codex`; edits between these markers are replaced on re-run) -->";
export const AGENTS_END_MARKER = "<!-- vesper:end -->";
/** First heading of config/claude-rules/vesper.md, used to spot a manual copy. */
export const VESPER_RULES_HEADING = "# Vesper Memory Storage Guidelines";

export type WriteStatus = "created" | "updated" | "unchanged" | "removed" | "absent";

export interface FileChange {
  path: string;
  status: WriteStatus;
  /** Copy of the previous file, written before any change to an existing file. */
  backupPath?: string;
}

/** A refusal to edit a user file. The message says what to fix by hand. */
export class CodexConfigError extends Error {}

export function getCodexHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return env.CODEX_HOME || join(home, ".codex");
}

// ---------------------------------------------------------------------------
// TOML helpers
// ---------------------------------------------------------------------------

/** JSON string syntax is a subset of TOML basic-string syntax. */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
}

/** Split a TOML dotted key (`a."b.c".d`) into its parts, or null if it is not one. */
function parseDottedKey(source: string): string[] | null {
  const parts: string[] = [];
  let rest = source.trim();
  while (rest.length > 0) {
    let match: RegExpMatchArray | null;
    if ((match = rest.match(/^[A-Za-z0-9_-]+/))) {
      parts.push(match[0]);
    } else if ((match = rest.match(/^"((?:[^"\\]|\\.)*)"/))) {
      try {
        parts.push(JSON.parse(match[0]));
      } catch {
        return null;
      }
    } else if ((match = rest.match(/^'([^']*)'/))) {
      parts.push(match[1]);
    } else {
      return null;
    }
    rest = rest.slice(match[0].length).trimStart();
    if (rest.length === 0) break;
    if (!rest.startsWith(".")) return null;
    rest = rest.slice(1).trimStart();
    if (rest.length === 0) return null;
  }
  return parts.length > 0 ? parts : null;
}

/** The key path of a `[table]` or `[[array.table]]` header line, or null. */
function tableHeaderPath(line: string): string[] | null {
  const match = line.match(/^\s*\[\[?([^[\]]+)\]\]?\s*(#.*)?$/);
  return match ? parseDottedKey(match[1]) : null;
}

function isVesperTable(path: string[]): boolean {
  return path.length >= 2 && path[0] === "mcp_servers" && path[1] === CODEX_SERVER_NAME;
}

/** Track whether a line leaves us inside a multi-line string, so headers inside strings are ignored. */
function nextMultilineState(line: string, state: '"""' | "'''" | null): '"""' | "'''" | null {
  let current = state;
  let index = 0;
  while (index < line.length) {
    if (current) {
      const end = line.indexOf(current, index);
      if (end < 0) return current;
      index = end + 3;
      current = null;
    } else {
      const basic = line.indexOf('"""', index);
      const literal = line.indexOf("'''", index);
      const comment = line.indexOf("#", index);
      const candidates = [basic, literal].filter((i) => i >= 0);
      if (candidates.length === 0) return null;
      const start = Math.min(...candidates);
      if (comment >= 0 && comment < start) return null;
      current = start === basic ? '"""' : "'''";
      index = start + 3;
    }
  }
  return current;
}

interface StripResult {
  lines: string[];
  /** Line index where the first Vesper table started, or -1. */
  insertAt: number;
}

function stripVesperTables(lines: string[]): StripResult {
  const out: string[] = [];
  let insertAt = -1;
  let skipping = false;
  let multiline: '"""' | "'''" | null = null;
  for (const line of lines) {
    if (!multiline) {
      const path = tableHeaderPath(line);
      if (path) {
        if (isVesperTable(path)) {
          if (insertAt < 0) insertAt = out.length;
          skipping = true;
        } else {
          skipping = false;
        }
      }
    }
    multiline = nextMultilineState(line, multiline);
    if (!skipping) out.push(line);
  }
  return { lines: out, insertAt };
}

function parseOrRefuse(content: string, what: string): Record<string, unknown> {
  try {
    return parse(content) as Record<string, unknown>;
  } catch (err) {
    const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
    throw new CodexConfigError(`${what} is not valid TOML (${reason}). Vesper did not modify it.`);
  }
}

function withoutVesper(config: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...config };
  const servers = copy.mcp_servers;
  if (servers && typeof servers === "object" && !Array.isArray(servers)) {
    const rest = { ...(servers as Record<string, unknown>) };
    delete rest[CODEX_SERVER_NAME];
    copy.mcp_servers = rest;
  }
  return copy;
}

function sameOutsideVesper(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const left = withoutVesper(a);
  const right = withoutVesper(b);
  // An emptied [mcp_servers] parent table is equivalent to an absent one.
  for (const side of [left, right]) {
    const servers = side.mcp_servers as Record<string, unknown> | undefined;
    if (servers && Object.keys(servers).length === 0) delete side.mcp_servers;
  }
  return isDeepStrictEqual(left, right);
}

function eolOf(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

/** Remove Vesper's table and prove nothing else changed. */
function removeVesperVerified(content: string): { stripped: string[]; insertAt: number; eol: string } {
  const eol = eolOf(content);
  const original = parseOrRefuse(content, "Codex config.toml");
  const { lines, insertAt } = stripVesperTables(content.split(/\r?\n/));
  const stripped = parseOrRefuse(lines.join(eol), "Codex config.toml without the Vesper table");
  const servers = stripped.mcp_servers as Record<string, unknown> | undefined;
  if (servers && typeof servers === "object" && CODEX_SERVER_NAME in servers) {
    throw new CodexConfigError(
      "config.toml defines the vesper MCP server in a form Vesper does not edit " +
        "(an inline table or dotted keys). Remove that definition and re-run, " +
        "or keep it and skip `--client codex`.",
    );
  }
  if (!sameOutsideVesper(original, stripped)) {
    throw new CodexConfigError(
      "Vesper could not separate its [mcp_servers.vesper] table from the rest of config.toml. " +
        "Vesper did not modify it; edit the vesper table by hand.",
    );
  }
  return { stripped: lines, insertAt, eol };
}

// ---------------------------------------------------------------------------
// config.toml: pure transforms
// ---------------------------------------------------------------------------

export interface CodexServerSpec {
  serverPath: string;
  environment: Record<string, string>;
  /** Executable Codex launches. Defaults to `node`, as in the Claude Code setup. */
  command?: string;
  /** Seconds Codex waits for the server to start; Codex's own default is 10. */
  startupTimeoutSec?: number;
}

export function renderCodexServerTable(spec: CodexServerSpec): string[] {
  const lines = [
    `[mcp_servers.${CODEX_SERVER_NAME}]`,
    "# Managed by `vesper install --client codex`. Re-running it replaces this table.",
    `command = ${tomlString(spec.command ?? "node")}`,
    `args = [${tomlString(spec.serverPath)}]`,
    `startup_timeout_sec = ${spec.startupTimeoutSec ?? 30}`,
  ];
  const entries = Object.entries(spec.environment);
  if (entries.length > 0) {
    lines.push("", `[mcp_servers.${CODEX_SERVER_NAME}.env]`);
    for (const [key, value] of entries) lines.push(`${tomlKey(key)} = ${tomlString(value)}`);
  }
  return lines;
}

/** Insert or replace Vesper's table in config.toml content. Throws CodexConfigError rather than guess. */
export function upsertCodexServer(content: string, spec: CodexServerSpec): string {
  const { stripped, insertAt, eol } = removeVesperVerified(content);
  const table = renderCodexServerTable(spec);
  let lines: string[];
  if (insertAt >= 0 && insertAt < stripped.length) {
    lines = [...stripped.slice(0, insertAt), ...table, "", ...stripped.slice(insertAt)];
  } else {
    const head = [...stripped];
    while (head.length > 0 && head[head.length - 1].trim() === "") head.pop();
    lines = head.length > 0 ? [...head, "", ...table, ""] : [...table, ""];
  }
  const result = lines.join(eol);

  const before = parseOrRefuse(content, "Codex config.toml");
  const after = parseOrRefuse(result, "Updated Codex config.toml");
  const expected: Record<string, unknown> = {
    command: spec.command ?? "node",
    args: [spec.serverPath],
    startup_timeout_sec: spec.startupTimeoutSec ?? 30,
  };
  if (Object.keys(spec.environment).length > 0) expected.env = { ...spec.environment };
  const written = (after.mcp_servers as Record<string, unknown> | undefined)?.[CODEX_SERVER_NAME];
  if (!sameOutsideVesper(before, after) || !isDeepStrictEqual(written, expected)) {
    throw new CodexConfigError("Vesper could not update config.toml safely. Vesper did not modify it.");
  }
  return result;
}

/** Remove Vesper's table from config.toml content; unchanged if it is absent. */
export function removeCodexServer(content: string): string {
  const { stripped, insertAt, eol } = removeVesperVerified(content);
  if (insertAt < 0) return content;
  // Drop the blank line that separated the removed table from what came before.
  const lines = [...stripped];
  if (insertAt >= lines.length) {
    // The table was last: end the file with a single newline.
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    if (lines.length > 0) lines.push("");
  } else if (insertAt > 0 && lines[insertAt - 1].trim() === "" && lines[insertAt].trim() === "") {
    lines.splice(insertAt - 1, 1);
  }
  return lines.join(eol);
}

export function hasCodexServer(content: string): boolean {
  try {
    const servers = (parse(content) as Record<string, unknown>).mcp_servers as Record<string, unknown> | undefined;
    return Boolean(servers && CODEX_SERVER_NAME in servers);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// AGENTS.md: pure transforms
// ---------------------------------------------------------------------------

interface MarkerSpan {
  start: number;
  end: number;
}

function findManagedBlock(content: string): MarkerSpan | null {
  const begin = content.search(/^<!-- vesper:begin\b.*-->[ \t]*$/m);
  const endMatch = /^<!-- vesper:end -->[ \t]*$/m.exec(content);
  if (begin < 0 && !endMatch) return null;
  if (begin < 0 || !endMatch || endMatch.index < begin) {
    throw new CodexConfigError(
      "AGENTS.md has an unmatched Vesper marker. Remove the vesper:begin/vesper:end lines and re-run.",
    );
  }
  return { start: begin, end: endMatch.index + endMatch[0].length };
}

export function renderManagedRules(rules: string, eol = "\n"): string {
  return [AGENTS_BEGIN_MARKER, rules.trim(), AGENTS_END_MARKER].join(eol).replace(/\r?\n/g, eol);
}

/** True when the Vesper rules appear outside the managed block, e.g. appended by hand from the README. */
export function hasUnmanagedVesperRules(content: string): boolean {
  const span = findManagedBlock(content);
  const outside = span ? content.slice(0, span.start) + content.slice(span.end) : content;
  return outside.includes(VESPER_RULES_HEADING);
}

export function upsertManagedRules(content: string, rules: string): string {
  const eol = eolOf(content);
  const block = renderManagedRules(rules, eol);
  const span = findManagedBlock(content);
  if (span) return content.slice(0, span.start) + block + content.slice(span.end);
  const head = content.replace(/\s+$/, "");
  return head.length > 0 ? `${head}${eol}${eol}${block}${eol}` : `${block}${eol}`;
}

export function removeManagedRules(content: string): string {
  const span = findManagedBlock(content);
  if (!span) return content;
  const before = content.slice(0, span.start).replace(/\s+$/, "");
  const after = content.slice(span.end).replace(/^\s+/, "");
  const eol = eolOf(content);
  if (!before) return after;
  return after ? `${before}${eol}${eol}${after}` : `${before}${eol}`;
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

/** Write via a temp file and rename, keeping the original file mode and a backup. */
function writeUserFile(path: string, content: string): string | undefined {
  mkdirSync(dirname(path), { recursive: true });
  let backupPath: string | undefined;
  let mode: number | undefined;
  if (existsSync(path)) {
    mode = statSync(path).mode & 0o777;
    backupPath = `${path}.vesper-backup`;
    copyFileSync(path, backupPath);
  }
  const temp = `${path}.vesper-tmp-${process.pid}`;
  writeFileSync(temp, content, mode === undefined ? undefined : { mode });
  renameSync(temp, path);
  return backupPath;
}

function applyChange(path: string, transform: (current: string) => string, removing: boolean): FileChange {
  const exists = existsSync(path);
  if (!exists && removing) return { path, status: "absent" };
  const current = exists ? readFileSync(path, "utf-8") : "";
  const next = transform(current);
  if (next === current) return { path, status: removing ? "absent" : "unchanged" };
  const backupPath = writeUserFile(path, next);
  return { path, status: removing ? "removed" : exists ? "updated" : "created", backupPath };
}

export function codexConfigPath(codexHome: string = getCodexHome()): string {
  return join(codexHome, "config.toml");
}

export function codexAgentsPath(codexHome: string = getCodexHome()): string {
  return join(codexHome, "AGENTS.md");
}

export function installCodexServer(spec: CodexServerSpec, codexHome: string = getCodexHome()): FileChange {
  return applyChange(codexConfigPath(codexHome), (current) => upsertCodexServer(current, spec), false);
}

export function uninstallCodexServer(codexHome: string = getCodexHome()): FileChange {
  return applyChange(codexConfigPath(codexHome), removeCodexServer, true);
}

export function installCodexRules(rules: string, codexHome: string = getCodexHome()): FileChange {
  return applyChange(codexAgentsPath(codexHome), (current) => upsertManagedRules(current, rules), false);
}

export function uninstallCodexRules(codexHome: string = getCodexHome()): FileChange {
  return applyChange(codexAgentsPath(codexHome), removeManagedRules, true);
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

export type McpClient = "claude" | "codex";

/** Parse `--client claude|codex|all` (repeatable, comma-separated). Defaults to Claude Code. */
export function parseClients(args: string[]): McpClient[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--client") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) throw new Error("--client needs a value: claude, codex or all");
      values.push(value);
      index++;
    } else if (arg.startsWith("--client=")) {
      values.push(arg.slice("--client=".length));
    }
  }
  if (values.length === 0) return ["claude"];
  const clients = new Set<McpClient>();
  for (const value of values.flatMap((v) => v.split(","))) {
    const name = value.trim().toLowerCase();
    if (name === "all" || name === "both") {
      clients.add("claude").add("codex");
    } else if (name === "claude" || name === "claude-code") {
      clients.add("claude");
    } else if (name === "codex") {
      clients.add("codex");
    } else {
      throw new Error(`Unknown client "${value}". Use claude, codex or all.`);
    }
  }
  return (["claude", "codex"] as McpClient[]).filter((client) => clients.has(client));
}
