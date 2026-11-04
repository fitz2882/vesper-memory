import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import {
  AGENTS_BEGIN_MARKER,
  AGENTS_END_MARKER,
  CodexConfigError,
  getCodexHome,
  hasCodexServer,
  hasUnmanagedVesperRules,
  installCodexRules,
  installCodexServer,
  parseClients,
  removeCodexServer,
  removeManagedRules,
  uninstallCodexRules,
  uninstallCodexServer,
  upsertCodexServer,
  upsertManagedRules,
  VESPER_RULES_HEADING,
} from "../src/utils/codex-config.js";

const spec = { serverPath: "/Users/dave/.vesper/dist/server.js", environment: { NODE_ENV: "production" } };

function vesperOf(content: string): unknown {
  return (parse(content) as { mcp_servers?: Record<string, unknown> }).mcp_servers?.vesper;
}

const EXISTING = `# my codex settings
model = "gpt-5-codex"
approval_policy = "on-request"

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"] # inline comment

[mcp_servers.github.env]
GITHUB_TOKEN = "keep-me"

[profiles.fast]
model = "fast-model"
`;

describe("parseClients", () => {
  it("defaults to Claude Code", () => expect(parseClients([])).toEqual(["claude"]));
  it.each([
    [["--client", "codex"], ["codex"]],
    [["--client=codex"], ["codex"]],
    [["--client", "all"], ["claude", "codex"]],
    [["--client", "codex,claude"], ["claude", "codex"]],
    [["--client", "codex", "--client", "claude-code"], ["claude", "codex"]],
    [["--client", "CODEX"], ["codex"]],
  ])("parses %j", (args, expected) => expect(parseClients(args)).toEqual(expected));
  it("rejects unknown or missing values", () => {
    expect(() => parseClients(["--client", "cursor"])).toThrow(/Unknown client/);
    expect(() => parseClients(["--client"])).toThrow(/needs a value/);
    expect(() => parseClients(["--client", "--force"])).toThrow(/needs a value/);
  });
});

describe("getCodexHome", () => {
  it("respects CODEX_HOME", () => expect(getCodexHome({ CODEX_HOME: "/x/codex" }, "/home/u")).toBe("/x/codex"));
  it("defaults to ~/.codex", () => expect(getCodexHome({}, "/home/u")).toBe(join("/home/u", ".codex")));
});

describe("upsertCodexServer", () => {
  it("creates a valid table in an empty file", () => {
    const result = upsertCodexServer("", spec);
    expect(vesperOf(result)).toEqual({
      command: "node",
      args: [spec.serverPath],
      startup_timeout_sec: 30,
      env: { NODE_ENV: "production" },
    });
  });

  it("appends without changing a byte of existing content", () => {
    const result = upsertCodexServer(EXISTING, spec);
    expect(result.startsWith(EXISTING)).toBe(true);
    expect(hasCodexServer(result)).toBe(true);
  });

  it("is idempotent", () => {
    const once = upsertCodexServer(EXISTING, spec);
    expect(upsertCodexServer(once, spec)).toBe(once);
  });

  it("replaces a hand-written table in place, including its subtables", () => {
    const manual = `model = "m"

[mcp_servers.vesper]
command = "node"
args = ["/old/path/server.js"]
env = { NODE_ENV = "production" }

[mcp_servers.other]
command = "other"
`;
    const result = upsertCodexServer(manual, spec);
    expect(result).not.toContain("/old/path");
    expect(result.indexOf("[mcp_servers.vesper]")).toBeLessThan(result.indexOf("[mcp_servers.other]"));
    expect((parse(result) as any).mcp_servers.other).toEqual({ command: "other" });
    expect((vesperOf(result) as any).args).toEqual([spec.serverPath]);
    expect(upsertCodexServer(result, spec)).toBe(result);

    const moved = upsertCodexServer(result, { ...spec, serverPath: "/new/server.js" });
    expect((vesperOf(moved) as any).args).toEqual(["/new/server.js"]);
    expect(moved.match(/\[mcp_servers\.vesper\]/g)).toHaveLength(1);
  });

  it("recognises a quoted table name", () => {
    const result = upsertCodexServer(`[mcp_servers."vesper"]\ncommand = "old"\n`, spec);
    expect((vesperOf(result) as any).command).toBe("node");
    expect(result).not.toContain('"old"');
  });

  it("ignores a table header inside a multi-line string", () => {
    const tricky = `notes = """
[mcp_servers.vesper]
not a header
"""
`;
    const result = upsertCodexServer(tricky, spec);
    expect((parse(result) as any).notes).toContain("[mcp_servers.vesper]");
    expect(hasCodexServer(result)).toBe(true);
  });

  it("escapes paths and values literally", () => {
    const odd = 'C:\\Users\\Dave "D" O\'Brien\\server.js';
    const result = upsertCodexServer("", { serverPath: odd, environment: { "WEIRD.KEY": 'a"b\nc', REDIS_PASSWORD: "p$w" } });
    expect((vesperOf(result) as any).args).toEqual([odd]);
    expect((vesperOf(result) as any).env).toEqual({ "WEIRD.KEY": 'a"b\nc', REDIS_PASSWORD: "p$w" });
  });

  it("keeps CRLF line endings", () => {
    const crlf = EXISTING.replace(/\n/g, "\r\n");
    const result = upsertCodexServer(crlf, spec);
    expect(result.startsWith(crlf)).toBe(true);
    expect(result.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("refuses invalid TOML", () => {
    expect(() => upsertCodexServer("model = \n[", spec)).toThrow(CodexConfigError);
  });

  it.each([
    `[mcp_servers]\nvesper = { command = "node", args = ["x"] }\n`,
    `mcp_servers.vesper.command = "node"\n`,
  ])("refuses forms it does not edit: %j", (content) => {
    expect(() => upsertCodexServer(content, spec)).toThrow(/inline table or dotted keys/);
  });
});

describe("removeCodexServer", () => {
  it("removes only the vesper table", () => {
    const installed = upsertCodexServer(EXISTING, spec);
    const removed = removeCodexServer(installed);
    expect(hasCodexServer(removed)).toBe(false);
    expect(parse(removed)).toEqual(parse(EXISTING));
    expect(removed).toBe(EXISTING);
  });

  it("leaves a file without vesper untouched", () => {
    expect(removeCodexServer(EXISTING)).toBe(EXISTING);
  });

  it("removes a table from the middle of the file", () => {
    const middle = `[a]\nx = 1\n\n[mcp_servers.vesper]\ncommand = "node"\n\n[mcp_servers.vesper.env]\nK = "v"\n\n[b]\ny = 2\n`;
    const removed = removeCodexServer(middle);
    expect(parse(removed)).toEqual({ a: { x: 1 }, b: { y: 2 } });
    expect(removed).toBe(`[a]\nx = 1\n\n[b]\ny = 2\n`);
  });
});

describe("AGENTS.md managed rules", () => {
  const rules = `${VESPER_RULES_HEADING}\n\nUse mcp__vesper__store_memory.\n`;

  it("creates, appends and replaces only the managed block", () => {
    const created = upsertManagedRules("", rules);
    expect(created).toBe(`${AGENTS_BEGIN_MARKER}\n${rules.trim()}\n${AGENTS_END_MARKER}\n`);

    const mine = "# My instructions\n\nAlways run tests.\n";
    const appended = upsertManagedRules(mine, rules);
    expect(appended.startsWith("# My instructions\n\nAlways run tests.\n\n")).toBe(true);
    expect(upsertManagedRules(appended, rules)).toBe(appended);

    const withTail = `${appended}\n## Added later\n`;
    const replaced = upsertManagedRules(withTail, `${VESPER_RULES_HEADING}\n\nNew text.`);
    expect(replaced).toContain("New text.");
    expect(replaced).not.toContain("store_memory");
    expect(replaced).toContain("## Added later");
    expect(replaced.match(/vesper:begin/g)).toHaveLength(1);
  });

  it("spots rules appended by hand outside the block", () => {
    expect(hasUnmanagedVesperRules(`# Mine\n\n${rules}`)).toBe(true);
    expect(hasUnmanagedVesperRules(upsertManagedRules("# Mine\n", rules))).toBe(false);
  });

  it("removes the block and keeps the user's text", () => {
    const mine = "# My instructions\n";
    expect(removeManagedRules(upsertManagedRules(mine, rules))).toBe(mine);
    expect(removeManagedRules(mine)).toBe(mine);
    expect(removeManagedRules(upsertManagedRules("", rules))).toBe("");
  });

  it("refuses an unmatched marker", () => {
    expect(() => upsertManagedRules(`${AGENTS_BEGIN_MARKER}\nhalf a block\n`, rules)).toThrow(CodexConfigError);
  });
});

describe("Codex files on disk", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "vesper-codex-"));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("creates config.toml, then reports unchanged, then updates with a backup and the original mode", () => {
    const config = join(home, "config.toml");
    expect(installCodexServer(spec, home).status).toBe("created");
    expect(installCodexServer(spec, home)).toEqual({ path: config, status: "unchanged" });

    chmodSync(config, 0o600);
    const before = readFileSync(config, "utf-8");
    const change = installCodexServer({ ...spec, serverPath: "/moved/server.js" }, home);
    expect(change.status).toBe("updated");
    expect(readFileSync(change.backupPath!, "utf-8")).toBe(before);
    expect(statSync(config).mode & 0o777).toBe(0o600);
    expect(readFileSync(config, "utf-8")).toContain("/moved/server.js");
  });

  it("does not write when it refuses", () => {
    const config = join(home, "config.toml");
    const inline = `[mcp_servers]\nvesper = { command = "node" }\n`;
    writeFileSync(config, inline);
    expect(() => installCodexServer(spec, home)).toThrow(CodexConfigError);
    expect(readFileSync(config, "utf-8")).toBe(inline);
    expect(existsSync(`${config}.vesper-backup`)).toBe(false);
  });

  it("uninstalls what it installed", () => {
    writeFileSync(join(home, "config.toml"), EXISTING);
    writeFileSync(join(home, "AGENTS.md"), "# Mine\n");
    installCodexServer(spec, home);
    installCodexRules(`${VESPER_RULES_HEADING}\n`, home);
    expect(uninstallCodexServer(home).status).toBe("removed");
    expect(uninstallCodexRules(home).status).toBe("removed");
    expect(readFileSync(join(home, "config.toml"), "utf-8")).toBe(EXISTING);
    expect(readFileSync(join(home, "AGENTS.md"), "utf-8")).toBe("# Mine\n");
    expect(uninstallCodexServer(home).status).toBe("absent");
  });

  it("reports absent when there is no Codex home", () => {
    const missing = join(home, "nope");
    expect(uninstallCodexServer(missing).status).toBe("absent");
    expect(existsSync(missing)).toBe(false);
  });
});
