/** App-level config (desktop-only settings, e.g. E2B sandbox key). */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";

import type { AppConfigPayload } from "@shared/protocol";

export type AppConfig = AppConfigPayload;

let cached: AppConfig | undefined;

function configPath(): string {
  return join(app.getPath("userData"), "bivor-config.json");
}

export function getConfig(): AppConfig {
  if (cached) return cached;
  try {
    cached = existsSync(configPath())
      ? (JSON.parse(readFileSync(configPath(), "utf8")) as AppConfig)
      : {};
  } catch {
    cached = {};
  }
  return cached;
}

export function setConfig(patch: Partial<AppConfig>): AppConfig {
  // IPC structured clone drops `undefined` properties, so `null` is the wire
  // format for "remove this setting".
  const next: Record<string, unknown> = { ...getConfig(), ...patch };
  for (const key of Object.keys(next)) {
    if (next[key] === null || next[key] === undefined) delete next[key];
  }
  cached = next as AppConfig;
  mkdirSync(dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(next, null, 2), "utf8");
  return next as AppConfig;
}
