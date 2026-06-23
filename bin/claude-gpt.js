#!/usr/bin/env node
/** @file Claude Code launcher through CCR and Codex OAuth. */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const AUTH_FILE = process.env.CODEX_OAUTH_AUTH_FILE || path.join(os.homedir(), ".claude-code-router", "codex-auth.json");
const SETTINGS_FILE = process.env.CODEX_OAUTH_SETTINGS_FILE || path.join(os.homedir(), ".claude-code-router", "codex-settings.json");
const EMPTY_MCP_FILE = process.env.CLAUDE_GPT_EMPTY_MCP_FILE || path.join(os.homedir(), ".claude-code-router", "empty-mcp.json");
const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_EFFORT = "xhigh";
const LAUNCH_MODEL = "openai-codex,gpt-5.5";

/**
 * @template T
 * @param {T[]} values
 * @returns {T[]}
 */
function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * @param {string} file
 * @returns {object|undefined}
 */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * @param {string} file
 * @param {*} value
 * @returns {void}
 */
function writeJson0600(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
}

/** @returns {void} */
function ensureEmptyMcpConfig() {
  if (!fs.existsSync(EMPTY_MCP_FILE)) writeJson0600(EMPTY_MCP_FILE, { mcpServers: {} });
}

/** @returns {string[]} */
function opencodeAuthCandidates() {
  const home = os.homedir();
  return unique([
    process.env.OPENCODE_AUTH_FILE,
    process.env.OPENCODE_AUTH_PATH,
    process.env.XDG_DATA_HOME && path.join(process.env.XDG_DATA_HOME, "opencode", "auth.json"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "opencode", "auth.json"),
    process.env.APPDATA && path.join(process.env.APPDATA, "opencode", "auth.json"),
    path.join(home, ".local", "share", "opencode", "auth.json"),
    path.join(home, "AppData", "Local", "opencode", "auth.json"),
    path.join(home, "AppData", "Roaming", "opencode", "auth.json"),
  ]);
}

/** @returns {object|undefined} */
function loadOpenCodeAuth() {
  for (const file of opencodeAuthCandidates()) {
    const raw = readJson(file);
    if (raw?.openai?.type === "oauth" && raw.openai.access && raw.openai.refresh) return raw.openai;

    if (raw?.version === 2 && raw.accounts && raw.active) {
      const activeId = raw.active.openai;
      const entry = activeId && raw.accounts[activeId]
        ? [activeId, raw.accounts[activeId]]
        : Object.entries(raw.accounts).find(([, account]) => account.serviceID === "openai");
      if (entry?.[1]?.credential?.type === "oauth") return { ...entry[1].credential, accountId: entry[1].id || entry[0] };
    }
  }
}

/**
 * @param {string} command
 * @returns {string}
 */
function executableName(command) {
  return process.platform === "win32" && !command.toLowerCase().endsWith(".cmd") && !command.toLowerCase().endsWith(".exe")
    ? `${command}.cmd`
    : command;
}

/**
 * @param {string} command
 * @returns {string[]}
 */
function voltaNodeBinCandidates(command) {
  const base = path.join(os.homedir(), ".volta", "tools", "image", "node");
  try {
    return fs
      .readdirSync(base)
      .map((version) => path.join(base, version, "bin", executableName(command)))
      .filter((file) => fs.existsSync(file));
  } catch {
    return [];
  }
}

/**
 * @param {string} command
 * @returns {string|undefined}
 */
function commandPath(command) {
  const result = process.platform === "win32"
    ? spawnSync("where", [command], { encoding: "utf8", windowsHide: true })
    : spawnSync("sh", ["-c", `command -v ${command}`], { encoding: "utf8" });
  if (!result.error && result.status === 0) return result.stdout.split(/\r?\n/).find(Boolean)?.trim();
}

/**
 * @param {string} command
 * @param {Array<string|undefined>} [extraCandidates]
 * @returns {string|undefined}
 */
function resolveCommand(command, extraCandidates = []) {
  const fromPath = commandPath(command);
  if (fromPath) return fromPath;

  const candidates = unique([
    ...extraCandidates,
    path.join(os.homedir(), ".volta", "bin", executableName(command)),
    path.join(os.homedir(), ".local", "bin", executableName(command)),
    ...voltaNodeBinCandidates(command),
  ]);

  return candidates.find((file) => {
    try {
      return fs.existsSync(file) && fs.statSync(file).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {Array<string|undefined>} dirs
 * @returns {void}
 */
function prependPath(env, dirs) {
  const delimiter = path.delimiter;
  const current = env.PATH || "";
  const parts = unique([...dirs.filter(Boolean), ...current.split(delimiter).filter(Boolean)]);
  env.PATH = parts.join(delimiter);
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} option
 * @returns {string}
 */
function appendNodeOption(env, option) {
  const current = env.NODE_OPTIONS || "";
  if (current.split(/\s+/).includes(option)) return current;
  return `${current} ${option}`.trim();
}

/**
 * @param {string[]} args
 * @returns {boolean}
 */
function shouldShowInteractiveBanner(args) {
  if (!process.stdout.isTTY) return false;
  return !args.some((arg) => arg === "-p" || arg === "--print" || arg.startsWith("--print="));
}

/** @returns {string} */
function settingsModel() {
  const settings = readJson(SETTINGS_FILE) || {};
  const model = process.env.CLAUDE_GPT_MODEL || settings.model || DEFAULT_MODEL;
  return String(model).includes(",") ? String(model).split(",").pop().trim() : String(model).trim();
}

/** @returns {string} */
function settingsEffort() {
  const settings = readJson(SETTINGS_FILE) || {};
  return String(process.env.CLAUDE_GPT_EFFORT || settings.reasoningEffort || DEFAULT_EFFORT).trim();
}

/**
 * @param {string[]} args
 * @returns {string[]}
 */
function withLaunchModel(args) {
  const cleaned = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--model") {
      i++;
      continue;
    }
    if (arg.startsWith("--model=")) continue;
    cleaned.push(arg);
  }
  return ["--model", LAUNCH_MODEL, ...cleaned];
}

/**
 * @param {string[]} args
 * @returns {{args: string[], withMcp: boolean, noMcp: boolean}}
 */
function parseWrapperFlags(args) {
  let withMcp = false;
  let noMcp = false;
  const cleaned = [];
  for (const arg of args) {
    if (arg === "--with-mcp" || arg === "--claude-gpt-with-mcp") {
      withMcp = true;
      continue;
    }
    if (arg === "--no-mcp" || arg === "--claude-gpt-no-mcp") {
      noMcp = true;
      continue;
    }
    cleaned.push(arg);
  }
  const env = String(process.env.CLAUDE_GPT_MCP || "all").toLowerCase();
  if (["all", "full", "default", "on", "1", "true"].includes(env)) withMcp = true;
  if (["off", "none", "builtin", "builtins", "0", "false"].includes(env)) noMcp = true;
  return { args: cleaned, withMcp, noMcp };
}

/**
 * @param {string[]} args
 * @returns {boolean}
 */
function hasMcpArgs(args) {
  return args.some((arg) => arg === "--mcp-config" || arg.startsWith("--mcp-config=") || arg === "--strict-mcp-config");
}

/**
 * @param {string[]} args
 * @param {{withMcp: boolean, noMcp: boolean}} flags
 * @returns {string[]}
 */
function withMcpPolicy(args, flags) {
  if (flags.withMcp && !flags.noMcp) return args;
  if (hasMcpArgs(args)) return args;
  ensureEmptyMcpConfig();
  return ["--strict-mcp-config", "--mcp-config", EMPTY_MCP_FILE, ...args];
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string[]} args
 * @param {string} mcpMode
 * @returns {Promise<void>}
 */
async function showStartupBanner(args, mcpMode) {
  if (!shouldShowInteractiveBanner(args)) return;
  if (process.env.CLAUDE_GPT_BANNER === "0" || process.env.CLAUDE_GPT_BANNER === "false") return;
  console.error("╭────────────────────────────────────────────────────────────╮");
  console.error("│ claude-gpt: Claude Code → CCR → ChatGPT Codex OAuth       │");
  console.error(`│ launch --model: ${LAUNCH_MODEL.padEnd(40)} │`);
  console.error(`│ upstream:       ${`${settingsModel()} ${settingsEffort()}`.padEnd(40)} │`);
  console.error(`│ mcp:            ${mcpMode.padEnd(40)} │`);
  console.error("│ tweak inside:   /gpt-settings, /gpt-model, /gpt-effort     │");
  console.error("│ verify:         claude-gpt-doctor                          │");
  console.error("╰────────────────────────────────────────────────────────────╯");
  const delay = Number(process.env.CLAUDE_GPT_BANNER_DELAY_MS || 900);
  if (delay > 0) await sleep(delay);
}

/** @returns {Promise<void>} */
async function main() {
  if (!fs.existsSync(AUTH_FILE)) {
    const auth = loadOpenCodeAuth();
    if (auth) {
      writeJson0600(AUTH_FILE, auth);
    } else {
      console.error("No ChatGPT/Codex OAuth credentials found.");
      console.error("Run: claude-gpt-auth login");
      console.error("or, if OpenCode is already logged in: claude-gpt-auth copy-opencode");
      process.exit(1);
    }
  }

  const ccrCommand = resolveCommand("ccr", [process.env.CCR_BIN, process.env.CLAUDE_CODE_ROUTER_BIN]);
  if (!ccrCommand) {
    console.error("claude-code-router (ccr) was not found. Install: npm install -g @musistudio/claude-code-router");
    process.exit(1);
  }

  const claudeCommand = resolveCommand("claude", [process.env.CLAUDE_BIN, process.env.CLAUDE_CODE_BIN]);
  if (!claudeCommand) {
    console.error("claude was not found. Install Claude Code first.");
    process.exit(1);
  }

  const env = { ...process.env };
  prependPath(env, [path.dirname(ccrCommand), path.dirname(claudeCommand), path.join(os.homedir(), ".volta", "bin")]);
  env.NODE_OPTIONS = appendNodeOption(env, "--no-deprecation");

  const parsed = parseWrapperFlags(process.argv.slice(2));
  const mcpMode = parsed.withMcp && !parsed.noMcp ? "Claude/default MCPs (compressed)" : "built-in tools only";
  const args = withMcpPolicy(withLaunchModel(parsed.args), parsed);
  await showStartupBanner(args, mcpMode);

  const child = spawn(ccrCommand, ["code", ...args], {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
    windowsHide: false,
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
  child.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
