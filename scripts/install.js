#!/usr/bin/env node
// Cross-platform installer for the CCR Codex OAuth bridge.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CCR_DIR = process.env.CCR_DIR || path.join(os.homedir(), ".claude-code-router");
const BIN_DIR = process.env.BIN_DIR || path.join(os.homedir(), ".local", "bin");
const AUTH_FILE = process.env.CODEX_OAUTH_AUTH_FILE || path.join(CCR_DIR, "codex-auth.json");
const SETTINGS_FILE = process.env.CODEX_OAUTH_SETTINGS_FILE || path.join(CCR_DIR, "codex-settings.json");
const EMPTY_MCP_FILE = process.env.CLAUDE_GPT_EMPTY_MCP_FILE || path.join(CCR_DIR, "empty-mcp.json");
const STATUSLINE_FILE = path.join(CCR_DIR, "statusline-codex.js");
const APIKEY = process.env.CCR_APIKEY || "sk-ccr-local";
const HOST = process.env.CCR_HOST || "127.0.0.1";
const PORT = Number(process.env.CCR_PORT || 3456);
const IS_WIN = process.platform === "win32";

function mkdir(dir, mode) {
  fs.mkdirSync(dir, { recursive: true, mode });
  try {
    if (mode) fs.chmodSync(dir, mode);
  } catch {}
}

function copy(src, dest, mode) {
  mkdir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  try {
    if (mode) fs.chmodSync(dest, mode);
  } catch {}
}

function commandExists(command) {
  const result = IS_WIN
    ? spawnSync("where", [command], { stdio: "ignore", windowsHide: true })
    : spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: IS_WIN,
    windowsHide: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function createWindowsCmd(name, targetJs) {
  const cmd = `@echo off\r\nnode "%~dp0\\${path.basename(targetJs)}" %*\r\n`;
  fs.writeFileSync(path.join(BIN_DIR, `${name}.cmd`), cmd);
}

function installLaunchers() {
  mkdir(BIN_DIR);
  const entries = [
    ["claude-gpt", "claude-gpt.js"],
    ["claude-work", "claude-work.js"],
    ["claude-gpt-auth", "claude-gpt-auth.js"],
    ["claude-gpt-settings", "claude-gpt-settings.js"],
    ["claude-gpt-doctor", "claude-gpt-doctor.js"],
  ];

  for (const [name, file] of entries) {
    const src = path.join(ROOT, "bin", file);
    if (IS_WIN) {
      const dest = path.join(BIN_DIR, file);
      copy(src, dest, 0o755);
      createWindowsCmd(name, dest);
    } else {
      copy(src, path.join(BIN_DIR, name), 0o755);
    }
  }
}

function writeDefaultSettings() {
  if (fs.existsSync(SETTINGS_FILE)) return;
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify({ model: "gpt-5.5", reasoningEffort: "xhigh" }, null, 2) + "\n",
    { mode: 0o600 },
  );
  try {
    fs.chmodSync(SETTINGS_FILE, 0o600);
  } catch {}
}

function writeEmptyMcpConfig() {
  fs.writeFileSync(EMPTY_MCP_FILE, JSON.stringify({ mcpServers: {} }, null, 2) + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(EMPTY_MCP_FILE, 0o600);
  } catch {}
}

function installClaudeCommands() {
  const commandsDir = path.join(os.homedir(), ".claude", "commands");
  mkdir(commandsDir, 0o700);
  for (const file of ["gpt-settings.md", "gpt-model.md", "gpt-effort.md"]) {
    copy(path.join(ROOT, "commands", file), path.join(commandsDir, file), 0o644);
  }
}

function writeConfig() {
  const configFile = path.join(CCR_DIR, "config.json");
  if (fs.existsSync(configFile)) {
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    const backup = path.join(CCR_DIR, `config.${stamp}.bak.json`);
    fs.copyFileSync(configFile, backup);
    console.log(`Backed up existing CCR config to ${backup}`);
  }

  const config = {
    APIKEY,
    HOST,
    PORT,
    LOG: true,
    LOG_LEVEL: "info",
    API_TIMEOUT_MS: 600000,
    NON_INTERACTIVE_MODE: false,
    StatusLine: {
      enabled: true,
      currentStyle: "default",
      default: {
        modules: [
          { type: "workDir", icon: "", text: "{{workDirName}}", color: "bright_blue" },
          { type: "gitBranch", icon: "", text: "{{gitBranch}}", color: "bright_magenta" },
          { type: "script", icon: "", scriptPath: STATUSLINE_FILE, color: "bright_cyan", options: { settingsFile: SETTINGS_FILE } },
          { type: "usage", icon: "↑", text: "{{inputTokens}}", color: "bright_green" },
          { type: "usage", icon: "↓", text: "{{outputTokens}}", color: "bright_yellow" },
        ],
      },
    },
    transformers: [
      {
        path: path.join(CCR_DIR, "plugins", "codex-oauth.js"),
        options: {
          authFile: AUTH_FILE,
          settingsFile: SETTINGS_FILE,
          defaultModel: "gpt-5.5",
          defaultReasoningEffort: "xhigh",
          originator: "claude-code-router",
        },
      },
    ],
    Providers: [
      {
        name: "openai-codex",
        api_base_url: "https://chatgpt.com/backend-api/codex/responses",
        api_key: "opencode-oauth-dummy-key",
        models: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2"],
        transformer: { use: ["codex-oauth"] },
      },
    ],
    Router: {
      default: "openai-codex,gpt-5.5",
      background: "openai-codex,gpt-5.5",
      think: "openai-codex,gpt-5.5",
      longContext: "openai-codex,gpt-5.5",
      longContextThreshold: 120000,
    },
  };

  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(configFile, 0o600);
  } catch {}
}

function main() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) {
    console.error("Node 20+ is required because the transformer uses global fetch/Web Streams.");
    process.exit(1);
  }

  mkdir(CCR_DIR, 0o700);
  mkdir(path.join(CCR_DIR, "plugins"), 0o700);

  if (!commandExists("ccr")) {
    if (process.env.SKIP_CCR_INSTALL === "1") {
      console.error("ccr is missing. Install: npm install -g @musistudio/claude-code-router");
      process.exit(1);
    }
    if (!commandExists("npm")) {
      console.error("ccr is missing and npm is unavailable. Install @musistudio/claude-code-router manually.");
      process.exit(1);
    }
    console.log("Installing @musistudio/claude-code-router globally...");
    run("npm", ["install", "-g", "@musistudio/claude-code-router"]);
  }

  if (!commandExists("claude")) {
    console.warn("Warning: claude is not on PATH yet. Install Claude Code before using claude-gpt/claude-work.");
  }

  copy(path.join(ROOT, "plugins", "codex-oauth.js"), path.join(CCR_DIR, "plugins", "codex-oauth.js"), 0o644);
  copy(path.join(ROOT, "statusline", "codex.js"), STATUSLINE_FILE, 0o644);
  installLaunchers();
  installClaudeCommands();
  writeDefaultSettings();
  writeEmptyMcpConfig();
  writeConfig();

  if (!fs.existsSync(AUTH_FILE)) {
    console.log("\nNo Codex OAuth credentials installed yet. Next step:");
    console.log("  claude-gpt-auth login");
    console.log("or, if OpenCode is already logged in:");
    console.log("  claude-gpt-auth copy-opencode");
  }

  console.log("\nInstalled Claude Code Router Codex OAuth bridge.");
  console.log("Launchers:");
  console.log("  claude-gpt          # Claude Code harness via ChatGPT/Codex OAuth");
  console.log("  claude-work         # direct Claude Code/work-plan routing");
  console.log("  claude-gpt-settings # tweak model/effort");
  console.log("  claude-gpt-doctor   # verify routing/settings");
  if (!process.env.PATH?.split(path.delimiter).includes(BIN_DIR)) {
    console.log(`\nNote: ${BIN_DIR} is not on PATH in this shell. npm install -g . will create global shims, or add that directory to PATH.`);
  }
}

main();
