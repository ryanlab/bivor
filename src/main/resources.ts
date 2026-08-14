/**
 * Resource management: pi packages (npm/git plugins), skills, and MCP config.
 * Shares pi's own settings/agent-dir storage so changes are visible to the CLI.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, resolve, sep } from "node:path";
import type { WebContents } from "electron";
import {
  DefaultPackageManager,
  getAgentDir,
  loadSkills,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  IPC,
  type McpConfigInfo,
  type PackageItem,
  type PromptItem,
  type SkillItem,
} from "@shared/protocol";

function makePackageManager(cwd: string, sender?: WebContents): DefaultPackageManager {
  const agentDir = getAgentDir();
  const pm = new DefaultPackageManager({
    cwd,
    agentDir,
    settingsManager: SettingsManager.create(cwd, agentDir),
  });
  if (sender) {
    pm.setProgressCallback((event) => {
      if (!sender.isDestroyed()) {
        sender.send(IPC.packagesProgress, {
          type: event.type,
          action: event.action,
          source: event.source,
          message: event.message,
        });
      }
    });
  }
  return pm;
}

export function listPackages(cwd: string): PackageItem[] {
  return makePackageManager(cwd).listConfiguredPackages();
}

export async function installPackage(
  cwd: string,
  source: string,
  local: boolean,
  sender: WebContents,
): Promise<void> {
  await makePackageManager(cwd, sender).installAndPersist(source, { local });
}

export async function removePackage(
  cwd: string,
  source: string,
  local: boolean,
  sender: WebContents,
): Promise<void> {
  await makePackageManager(cwd, sender).removeAndPersist(source, { local });
}

export async function updatePackages(cwd: string, sender: WebContents): Promise<void> {
  await makePackageManager(cwd, sender).update();
}

// ---------- Path safety ----------
// Renderer-supplied paths are untrusted. Destructive skill/mcp writes must stay
// within known roots to prevent path traversal into arbitrary filesystem writes.

function within(child: string, parent: string): boolean {
  // Real paths on both sides: /tmp vs /private/tmp on macOS, symlinked roots…
  const c = realOrResolve(child);
  const p = realOrResolve(parent);
  return c === p || c.startsWith(p + sep);
}

/** Real path if the file exists (defeats symlink escapes), else lexical resolve. */
function realOrResolve(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

function editableSkillRoots(cwd: string): string[] {
  return [join(getAgentDir(), "skills"), join(cwd, ".pi", "skills")];
}

function assertEditableSkill(cwd: string, filePath: string): string {
  const rp = realOrResolve(filePath);
  if (extname(rp) !== ".md") throw new Error("非法技能路径（必须是 .md 文件）");
  if (!editableSkillRoots(cwd).some((root) => within(rp, root))) {
    throw new Error("技能路径超出允许范围");
  }
  return rp;
}

function assertReadableSkill(cwd: string, filePath: string): string {
  const rp = realOrResolve(filePath);
  if (extname(rp) !== ".md") throw new Error("非法技能路径");
  // 可编辑根 + 当前会话已加载的技能文件（含内置默认技能）都允许读取
  if (editableSkillRoots(cwd).some((root) => within(rp, root))) return rp;
  const known = new Set(listSkills(cwd).map((s) => realOrResolve(s.filePath)));
  if (known.has(rp)) return rp;
  throw new Error("技能路径超出允许范围");
}

// ---------- Skills ----------

export function listSkills(cwd: string): SkillItem[] {
  const { skills } = loadSkills({
    cwd,
    agentDir: getAgentDir(),
    skillPaths: [],
    includeDefaults: true,
  });
  return skills.map((s) => ({
    name: s.name,
    description: s.description,
    filePath: s.filePath,
    baseDir: s.baseDir,
    source: s.sourceInfo?.source ?? "",
  }));
}

export function readSkill(cwd: string, filePath: string): string {
  return readFileSync(assertReadableSkill(cwd, filePath), "utf8");
}

export function saveSkill(cwd: string, filePath: string, content: string): void {
  writeFileSync(assertEditableSkill(cwd, filePath), content, "utf8");
}

export function createSkill(
  scope: "user" | "project",
  cwd: string,
  name: string,
  description: string,
): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("无效的技能名称");
  const base =
    scope === "user" ? join(getAgentDir(), "skills") : join(cwd, ".pi", "skills");
  const dir = join(base, slug);
  if (existsSync(join(dir, "SKILL.md"))) throw new Error(`技能 ${slug} 已存在`);
  mkdirSync(dir, { recursive: true });
  const content = `---
name: ${slug}
description: ${description || "描述这个技能什么时候该被使用"}
---

# ${name}

在这里写这个技能的具体指令。agent 匹配到 description 时会读取本文件并遵循其中的步骤。
`;
  const filePath = join(dir, "SKILL.md");
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

export function deleteSkill(cwd: string, filePath: string): void {
  const rp = assertEditableSkill(cwd, filePath);
  if (!rp.endsWith(`${sep}SKILL.md`) && !rp.endsWith("/SKILL.md")) {
    // top-level .md skill file
    rmSync(rp);
    return;
  }
  const dir = resolve(rp, "..");
  // Never allow removing a skills root itself — only a skill's own subdirectory.
  if (editableSkillRoots(cwd).some((root) => realOrResolve(root) === dir)) {
    throw new Error("拒绝删除技能根目录");
  }
  if (!editableSkillRoots(cwd).some((root) => within(dir, root))) {
    throw new Error("技能目录超出允许范围");
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---------- Prompt templates ----------
// Templates are plain .md files with optional frontmatter (description /
// argument-hint), loaded by the SDK from agentDir/prompts and cwd/.pi/prompts.

function promptRoots(cwd: string): Array<{ dir: string; scope: "user" | "project" }> {
  return [
    { dir: join(getAgentDir(), "prompts"), scope: "user" },
    { dir: join(cwd, ".pi", "prompts"), scope: "project" },
  ];
}

function assertPromptPath(cwd: string, filePath: string): string {
  const rp = realOrResolve(filePath);
  if (extname(rp) !== ".md") throw new Error("非法模板路径（必须是 .md 文件）");
  if (!promptRoots(cwd).some((r) => within(rp, r.dir))) {
    throw new Error("模板路径超出允许范围");
  }
  return rp;
}

function parsePromptFrontmatter(content: string): { description: string; argumentHint?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!m) return { description: "" };
  const get = (key: string): string | undefined => {
    const line = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(m[1]);
    return line?.[1].trim().replace(/^["']|["']$/g, "");
  };
  return { description: get("description") ?? "", argumentHint: get("argument-hint") };
}

export function listPrompts(cwd: string): PromptItem[] {
  const out: PromptItem[] = [];
  for (const { dir, scope } of promptRoots(cwd)) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (extname(f) !== ".md") continue;
      const filePath = join(dir, f);
      try {
        const fm = parsePromptFrontmatter(readFileSync(filePath, "utf8"));
        out.push({ name: basename(f, ".md"), ...fm, filePath, scope });
      } catch {
        // unreadable file — skip
      }
    }
  }
  return out;
}

export function readPrompt(cwd: string, filePath: string): string {
  return readFileSync(assertPromptPath(cwd, filePath), "utf8");
}

export function savePrompt(cwd: string, filePath: string, content: string): void {
  writeFileSync(assertPromptPath(cwd, filePath), content, "utf8");
}

export function createPrompt(
  scope: "user" | "project",
  cwd: string,
  name: string,
  description: string,
): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("无效的模板名称");
  const root = promptRoots(cwd).find((r) => r.scope === scope)!;
  const filePath = join(root.dir, `${slug}.md`);
  if (existsSync(filePath)) throw new Error(`模板 ${slug} 已存在`);
  mkdirSync(root.dir, { recursive: true });
  const content = `---
description: ${description || "描述这个模板的用途"}
argument-hint: [参数]
---

在这里写模板正文。发送 /${slug} 参数 时，$ARGUMENTS 会被替换为参数文本；也可用 $1 $2 引用单个参数。
`;
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

export function deletePrompt(cwd: string, filePath: string): void {
  rmSync(assertPromptPath(cwd, filePath));
}

// ---------- MCP ----------

const MCP_ADAPTER_PACKAGE = "npm:pi-mcp-adapter";

export function readMcpConfig(cwd: string): McpConfigInfo {
  const globalPath = join(getAgentDir(), "mcp.json");
  const projectPath = join(cwd, ".mcp.json");
  const packages = listPackages(cwd);
  const adapterInstalled = packages.some((p) => p.source.includes("pi-mcp-adapter"));
  return {
    adapterInstalled,
    globalPath,
    projectPath,
    globalContent: existsSync(globalPath) ? readFileSync(globalPath, "utf8") : undefined,
    projectContent: existsSync(projectPath) ? readFileSync(projectPath, "utf8") : undefined,
  };
}

export function saveMcpConfig(cwd: string, path: string, content: string): void {
  // Only the two canonical mcp.json locations may be written.
  const allowed = [join(getAgentDir(), "mcp.json"), join(cwd, ".mcp.json")].map(realOrResolve);
  if (!allowed.includes(realOrResolve(path))) throw new Error("MCP 配置路径超出允许范围");
  JSON.parse(content); // validate before write
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

export async function installMcpAdapter(cwd: string, sender: WebContents): Promise<void> {
  await installPackage(cwd, MCP_ADAPTER_PACKAGE, false, sender);
}

// ---------- Project long-term memory ----------

export function readProjectMemory(cwd: string): { path: string; content: string } {
  const path = join(cwd, ".pi", "memory.md");
  return { path, content: existsSync(path) ? readFileSync(path, "utf8") : "" };
}

export function saveProjectMemory(cwd: string, content: string): void {
  const path = join(cwd, ".pi", "memory.md");
  if (!content.trim()) {
    if (existsSync(path)) rmSync(path);
    return;
  }
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(path, content, "utf8");
}
