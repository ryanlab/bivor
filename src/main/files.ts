/**
 * Project file listing for @-mentions in the composer.
 * Prefers git (fast, respects .gitignore); falls back to a bounded readdir walk.
 */
import { execFile } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

const MAX_FILES = 8000;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "build",
  ".next",
  "target",
  ".venv",
  "__pycache__",
]);

export async function listProjectFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await exec(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd, timeout: 10000, maxBuffer: 64 * 1024 * 1024 },
    );
    const files = stdout.split("\n").filter(Boolean);
    if (files.length > 0) return files.slice(0, MAX_FILES);
  } catch {
    // not a git repo — fall through
  }
  const result: string[] = [];
  const walk = (dir: string, rel: string, depth: number): void => {
    if (result.length >= MAX_FILES || depth > 8) return;
    let entries;
    try {
      entries = readdirSync(join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (result.length >= MAX_FILES) return;
      if (e.name.startsWith(".") && e.name !== ".env") continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(dir, relPath, depth + 1);
      } else {
        result.push(relPath);
      }
    }
  };
  walk(cwd, "", 0);
  return result;
}
