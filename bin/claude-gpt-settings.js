#!/usr/bin/env node
/** @file claude-gpt routing settings CLI. */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SETTINGS_FILE = process.env.CODEX_OAUTH_SETTINGS_FILE || path.join(os.homedir(), ".claude-code-router", "codex-settings.json");
const DEFAULT_SETTINGS = {
  model: "gpt-5.5",
  reasoningEffort: "xhigh",
};
const MODELS = new Set(["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2"]);
const EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);
const PRESETS = {
  max: { model: "gpt-5.5", reasoningEffort: "xhigh" },
  xhigh: { model: "gpt-5.5", reasoningEffort: "xhigh" },
  balanced: { model: "gpt-5.4", reasoningEffort: "high" },
  fast: { model: "gpt-5.4-mini", reasoningEffort: "none" },
  codex: { model: "gpt-5.3-codex", reasoningEffort: "xhigh" },
};

/** @returns {void} */
function usage() {
  console.log(`Usage: claude-gpt-settings [show|set|preset|reset]

Commands:
  show                                Print current model/effort
  set --model gpt-5.5 --effort xhigh  Set values
  set gpt-5.5 xhigh                   Set values, positional shorthand
  preset max                          gpt-5.5 + xhigh
  preset balanced                     gpt-5.4 + high
  preset fast                         gpt-5.4-mini + none
  reset                               Reset to gpt-5.5 + xhigh

Settings file:
  ${SETTINGS_FILE}

Changes apply to the next claude-gpt request. Claude Code's top-left label may
not update until a new session, but CCR statusline/logs show the actual route.
`);
}

/**
 * @param {string|undefined} model
 * @returns {string|undefined}
 */
function normalizeModel(model) {
  if (!model) return undefined;
  const value = String(model).includes(",") ? String(model).split(",").pop().trim() : String(model).trim();
  return value;
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

/** @returns {{model: string, reasoningEffort: string}} */
function readSettings() {
  return { ...DEFAULT_SETTINGS, ...(readJson(SETTINGS_FILE) || {}) };
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

/**
 * @param {{model: string, reasoningEffort: string}} settings
 * @returns {{model: string, reasoningEffort: string}}
 */
function validate(settings) {
  settings.model = normalizeModel(settings.model);
  if (!MODELS.has(settings.model)) {
    throw new Error(`Unsupported model: ${settings.model}. Supported: ${[...MODELS].join(", ")}`);
  }
  if (!EFFORTS.has(settings.reasoningEffort)) {
    throw new Error(`Unsupported effort: ${settings.reasoningEffort}. Supported: ${[...EFFORTS].join(", ")}`);
  }
  return settings;
}

/**
 * @param {{model: string, reasoningEffort: string}} settings
 * @returns {void}
 */
function printSettings(settings) {
  console.log(`model=${settings.model}`);
  console.log(`reasoningEffort=${settings.reasoningEffort}`);
  console.log(`settingsFile=${SETTINGS_FILE}`);
}

/**
 * @param {string[]} args
 * @returns {{model: string, reasoningEffort: string}}
 */
function parseSetArgs(args) {
  const next = { ...readSettings() };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--model" || arg === "-m") {
      next.model = args[++i];
    } else if (arg.startsWith("--model=")) {
      next.model = arg.slice("--model=".length);
    } else if (arg === "--effort" || arg === "--reasoning-effort" || arg === "-e") {
      next.reasoningEffort = args[++i];
    } else if (arg.startsWith("--effort=")) {
      next.reasoningEffort = arg.slice("--effort=".length);
    } else if (arg.startsWith("--reasoning-effort=")) {
      next.reasoningEffort = arg.slice("--reasoning-effort=".length);
    } else {
      positional.push(arg);
    }
  }
  if (positional[0]) next.model = positional[0];
  if (positional[1]) next.reasoningEffort = positional[1];
  return next;
}

/**
 * @param {{model: string, reasoningEffort: string}} settings
 * @returns {void}
 */
function saveAndPrint(settings) {
  const clean = validate(settings);
  writeJson0600(SETTINGS_FILE, clean);
  printSettings(clean);
  console.log("Applies on the next claude-gpt request.");
}

/** @returns {void} */
function main() {
  const [command = "show", ...args] = process.argv.slice(2);
  if (["help", "--help", "-h"].includes(command)) return usage();
  if (command === "show" || command === "status") return printSettings(validate(readSettings()));
  if (command === "reset") return saveAndPrint(DEFAULT_SETTINGS);
  if (command === "preset") {
    const name = args[0] || "max";
    const preset = PRESETS[name];
    if (!preset) throw new Error(`Unknown preset: ${name}. Presets: ${Object.keys(PRESETS).join(", ")}`);
    return saveAndPrint(preset);
  }
  if (command === "set") return saveAndPrint(parseSetArgs(args));

  if (MODELS.has(normalizeModel(command))) return saveAndPrint(parseSetArgs([command, ...args]));

  throw new Error(`Unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
