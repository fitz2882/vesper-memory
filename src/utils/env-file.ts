import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Parse KEY=value lines, ignoring blanks and # comments. */
export function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
  }
  return env;
}

/**
 * Read `<root>/.env`, creating it from `.env.example` when missing.
 *
 * The bundled Docker services run without authentication, so no credentials
 * are invented here: a password or API key reaches the MCP client only when
 * the user set it in `.env` themselves, and every run returns the same values.
 */
export function loadEnvFile(
  root: string,
  notify: (message: string) => void = () => {},
): Record<string, string> {
  const envPath = join(root, ".env");
  const examplePath = join(root, ".env.example");
  if (!existsSync(envPath)) {
    if (!existsSync(examplePath)) {
      notify(".env and .env.example not found, using default values");
      return {};
    }
    notify("Creating .env from .env.example...");
    copyFileSync(examplePath, envPath);
  }
  return parseEnvFile(readFileSync(envPath, "utf-8"));
}
