/**
 * Resource management: pi packages (npm/git plugins), skills, and MCP config.
 * Shares pi's own settings/agent-dir storage so changes are visible to the CLI.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, resolve, sep } from "node:path";
import type { WebContents } from "electron";
import {
  DefaultPackageManager,
  getAgentDir,
  loadSkillsFromDir,
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
  return makePackageManager(cwd).listConfiguredPackages().map((pkg) => ({
    ...pkg,
    version: readInstalledVersion(pkg.installedPath),
  }));
}

function readInstalledVersion(installedPath?: string): string | undefined {
  if (!installedPath || !existsSync(installedPath)) return undefined;
  try {
    const raw = readFileSync(join(installedPath, "package.json"), "utf8");
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === "string" && version.trim() ? version.trim() : undefined;
  } catch {
    return undefined;
  }
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

export async function updatePackages(
  cwd: string,
  sender: WebContents,
  source?: string,
): Promise<void> {
  await makePackageManager(cwd, sender).update(source);
}

export async function checkPackageUpdates(cwd: string): Promise<
  Array<{ source: string; scope: "user" | "project" }>
> {
  try {
    const updates = await makePackageManager(cwd).checkForAvailableUpdates();
    return updates.map((u) => ({
      source: u.source,
      scope: u.scope === "project" ? "project" : "user",
    }));
  } catch {
    return [];
  }
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

function skillRoots(cwd: string): Array<{ dir: string; scope: "user" | "project" }> {
  return [
    { dir: join(getAgentDir(), "skills"), scope: "user" },
    { dir: join(cwd, ".pi", "skills"), scope: "project" },
  ];
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
  const out: SkillItem[] = [];
  const seen = new Set<string>();
  for (const { dir, scope } of skillRoots(cwd)) {
    if (!existsSync(dir)) continue;
    const { skills } = loadSkillsFromDir({ dir, source: scope });
    for (const s of skills) {
      const key = realOrResolve(s.filePath);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name: s.name,
        description: s.description,
        filePath: s.filePath,
        baseDir: s.baseDir,
        source: s.sourceInfo?.source ?? "",
        scope,
      });
    }
  }
  return out;
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

function findSkillDirs(root: string): string[] {
  const rp = realOrResolve(root);
  let st;
  try {
    st = statSync(rp);
  } catch {
    throw new Error("路径不存在");
  }
  if (st.isFile()) {
    if (basename(rp) !== "SKILL.md") throw new Error("请选择 SKILL.md 或技能文件夹");
    return [resolve(rp, "..")];
  }
  if (existsSync(join(rp, "SKILL.md"))) return [rp];
  const found: string[] = [];
  const scan = (dir: string, depth: number): void => {
    if (depth > 3) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
      const p = join(dir, ent.name);
      if (existsSync(join(p, "SKILL.md"))) found.push(p);
      else scan(p, depth + 1);
    }
  };
  scan(rp, 0);
  return found;
}

export function importSkill(
  scope: "user" | "project",
  cwd: string,
  fromPath: string,
): string[] {
  const dirs = findSkillDirs(fromPath);
  if (dirs.length === 0) throw new Error("未找到 SKILL.md");
  const destRoot =
    scope === "user" ? join(getAgentDir(), "skills") : join(cwd, ".pi", "skills");
  mkdirSync(destRoot, { recursive: true });
  const destRootR = realOrResolve(destRoot);
  const imported: string[] = [];
  for (const dir of dirs) {
    const src = realOrResolve(dir);
    if (within(src, destRootR) || src === destRootR) {
      throw new Error("该文件夹已在技能目录中");
    }
    const slug = basename(src)
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!slug) throw new Error("无效的技能名称");
    const dest = join(destRoot, slug);
    if (existsSync(dest)) throw new Error(`技能 ${slug} 已存在`);
    cpSync(src, dest, { recursive: true });
    imported.push(join(dest, "SKILL.md"));
  }
  return imported;
}

const SKILL_INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function tokenizeArgs(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out.filter(Boolean);
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*[mK]/g, "");
}

export function parseSkillInstallInput(raw: string): { source: string; skills: string[] } {
  const line = raw.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!line) throw new Error("请填写技能来源");
  const stripped = line
    .replace(/^(?:npx\s+(?:--yes\s+)?)?skills\s+add\s+/i, "")
    .trim();
  const tokens = tokenizeArgs(stripped);
  const skills: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === "--skill" || tok === "-s") {
      const name = tokens[++i];
      if (name) skills.push(name);
      continue;
    }
    if (tok.startsWith("--skill=")) {
      skills.push(tok.slice("--skill=".length));
      continue;
    }
    if (
      tok === "-g" ||
      tok === "--global" ||
      tok === "-y" ||
      tok === "--yes" ||
      tok === "--copy" ||
      tok === "--all" ||
      tok === "-l" ||
      tok === "--list"
    ) {
      continue;
    }
    if (tok === "-a" || tok === "--agent") {
      i += 1;
      continue;
    }
    if (tok.startsWith("-")) continue;
    rest.push(tok);
  }
  if (rest.length !== 1) throw new Error("无效的技能来源");
  const source = rest[0];
  if (
    /[\n\r;|&$`]/.test(source) ||
    source.length > 500 ||
    !(
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?$/.test(source) ||
      /^https?:\/\//i.test(source) ||
      /^git@/i.test(source) ||
      /^ssh:\/\//i.test(source) ||
      source.startsWith("./") ||
      source.startsWith("../") ||
      source.startsWith("/")
    )
  ) {
    throw new Error("无效的技能来源");
  }
  for (const name of skills) {
    if (!/^[\w.*?-]+$/.test(name) || name.length > 120) {
      throw new Error(`无效的技能名称：${name}`);
    }
  }
  return { source, skills };
}

function runSkillsCli(
  args: string[],
  cwd: string,
  onLine: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === "win32";
    const child = isWin
      ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", args.map((a) => `"${a.replace(/"/g, '""')}"`).join(" ")], {
          cwd,
          windowsHide: true,
          env: { ...process.env },
        })
      : spawn(process.env.SHELL || "/bin/zsh", ["-lc", `cd ${shQuote(cwd)} && ${args.map(shQuote).join(" ")}`], {
          cwd,
          env: { ...process.env },
        });

    let out = "";
    const take = (chunk: Buffer | string): void => {
      const text = chunk.toString();
      out += text;
      if (out.length > 20_000) out = out.slice(-12_000);
      const lines = stripAnsi(text)
        .split(/\r?\n|\r/)
        .map((l) => l.trim())
        .filter(Boolean);
      for (const line of lines) onLine(line);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("安装超时"));
    }, SKILL_INSTALL_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stripAnsi(out).trim().split(/\r?\n/).slice(-8).join("\n");
      reject(new Error(detail || `技能安装失败 (exit ${code})`));
    });
  });
}

/** Install community skills via `npx skills add`, targeting the pi agent paths. */
export async function installSkillSource(
  cwd: string,
  raw: string,
  local: boolean,
  sender: WebContents,
): Promise<void> {
  const { source, skills } = parseSkillInstallInput(raw);
  const names = skills.length > 0 ? skills : ["*"];
  if (local) mkdirSync(join(cwd, ".pi", "skills"), { recursive: true });
  const args = [
    "npx",
    "--yes",
    "skills",
    "add",
    source,
    "-a",
    "pi",
    "-y",
    "--copy",
    ...(!local ? ["-g"] : []),
    ...names.flatMap((name) => ["--skill", name]),
  ];
  const emit = (message: string): void => {
    if (!sender.isDestroyed()) sender.send(IPC.skillsProgress, message);
  };
  emit(`npx skills add ${source}…`);
  await runSkillsCli(args, cwd, emit);
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
