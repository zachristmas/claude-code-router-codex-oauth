#!/usr/bin/env node
// Cross-platform launcher: Claude Code harness -> CCR -> ChatGPT Codex OAuth.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const AUTH_FILE = process.env.CODEX_OAUTH_AUTH_FILE || path.join(os.homedir(), ".claude-code-router", "codex-auth.json");
const SETTINGS_FILE = process.env.CODEX_OAUTH_SETTINGS_FILE || path.join(os.homedir(), ".claude-code-router", "codex-settings.json");
const DEFAULT_MODEL = "gpt-5.5";

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function writeJson0600(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
}

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

function loadOpenCodeAuth() {
  for (const file of opencodeAuthCandidates()) {
    const raw = readJson(file);
    if (raw?.openai?.type === "oauth" && raw.openai.access && raw.openai.refresh) return raw.openai;

    if (raw?.version === 2 && raw.accounts && raw.active) {
      const activeId = raw.active.openai;
      const account = activeId ? raw.accounts[activeId] : Object.values(raw.accounts).find((entry) => entry.serviceID === "openai");
      if (account?.credential?.type === "oauth") return account.credential;
    }
  }
}

function commandExists(command) {
  const result = process.platform === "win32"
    ? spawnSync("where", [command], { stdio: "ignore", windowsHide: true })
    : spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function appendNodeOption(env, option) {
  const current = env.NODE_OPTIONS || "";
  if (current.split(/\s+/).includes(option)) return current;
  return `${current} ${option}`.trim();
}

function shouldShowInteractiveBanner(args) {
  if (!process.stdout.isTTY) return false;
  return !args.some((arg) => arg === "-p" || arg === "--print" || arg.startsWith("--print="));
}

function settingsModel() {
  const settings = readJson(SETTINGS_FILE) || {};
  const model = process.env.CLAUDE_GPT_MODEL || settings.model || DEFAULT_MODEL;
  return String(model).includes(",") ? String(model).split(",").pop().trim() : String(model).trim();
}

function hasModelArg(args) {
  return args.some((arg) => arg === "--model" || arg.startsWith("--model="));
}

function withDefaultModel(args) {
  if (hasModelArg(args)) return args;
  return ["--model", `openai-codex,${settingsModel()}`, ...args];
}

function main() {
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

  if (!commandExists("ccr")) {
    console.error("claude-code-router (ccr) is not on PATH. Install: npm install -g @musistudio/claude-code-router");
    process.exit(1);
  }

  if (!commandExists("claude")) {
    console.error("claude is not on PATH. Install Claude Code first.");
    process.exit(1);
  }

  const env = { ...process.env };
  env.NODE_OPTIONS = appendNodeOption(env, "--no-deprecation");

  const args = withDefaultModel(process.argv.slice(2));
  if (shouldShowInteractiveBanner(args)) {
    const settings = readJson(SETTINGS_FILE) || {};
    console.error(`claude-gpt: routing Claude Code through CCR -> ChatGPT/Codex OAuth (${settingsModel()} ${settings.reasoningEffort || "xhigh"}).`);
    console.error("claude-gpt: use /gpt-settings inside Claude Code, or run claude-gpt-settings, to tweak model/effort.");
  }

  const child = spawn("ccr", ["code", ...args], {
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

main();
