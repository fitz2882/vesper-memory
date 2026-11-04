import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile, parseEnvFile } from "../src/utils/env-file.js";

describe("parseEnvFile", () => {
  it("reads KEY=value lines and skips comments and blanks", () => {
    expect(parseEnvFile("# c\nA=1\r\n\n B = x=y \n#B=2\n")).toEqual({ A: "1", B: "x=y" });
  });
});

describe("loadEnvFile", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "vesper-env-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("creates .env as an exact copy of .env.example and invents no credentials", () => {
    const example = readFileSync(join(__dirname, "..", ".env.example"), "utf-8");
    writeFileSync(join(root, ".env.example"), example);
    const first = loadEnvFile(root);
    expect(readFileSync(join(root, ".env"), "utf-8")).toBe(example);
    for (const key of ["REDIS_PASSWORD", "QDRANT_API_KEY", "POSTGRES_PASSWORD"]) {
      expect(first).not.toHaveProperty(key);
    }
    expect(loadEnvFile(root)).toEqual(first);
  });

  it("keeps credentials the user set in .env, on every run", () => {
    writeFileSync(join(root, ".env"), "REDIS_PASSWORD=mine\n");
    expect(loadEnvFile(root)).toEqual({ REDIS_PASSWORD: "mine" });
    expect(loadEnvFile(root)).toEqual({ REDIS_PASSWORD: "mine" });
  });

  it("returns defaults when neither file exists", () => {
    expect(loadEnvFile(root)).toEqual({});
    expect(existsSync(join(root, ".env"))).toBe(false);
  });
});
