/** @file CCR statusline module for claude-gpt. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_SETTINGS_FILE = path.join(os.homedir(), ".claude-code-router", "codex-settings.json");
const DEFAULTS = { model: "gpt-5.5", reasoningEffort: "xhigh" };

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
 * @param {string|undefined} model
 * @returns {string}
 */
function normalizeModel(model) {
  const value = String(model || DEFAULTS.model);
  return value.includes(",") ? value.split(",").pop().trim() : value.trim();
}

/**
 * @param {string|undefined} model
 * @returns {string}
 */
function prettyModel(model) {
  return normalizeModel(model).replace(/^gpt/i, "GPT");
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function present(value) {
  return value !== undefined && value !== null && String(value) !== "" && String(value) !== "0";
}

/**
 * @param {object} [vars]
 * @returns {string}
 */
function contextText(vars = {}) {
  const pieces = [];
  if (present(vars.totalInputTokens) || present(vars.contextWindowSize)) {
    const used = present(vars.totalInputTokens) ? vars.totalInputTokens : "0";
    const size = present(vars.contextWindowSize) ? vars.contextWindowSize : "?";
    const pct = present(vars.contextPercent) ? ` ${vars.contextPercent}%` : "";
    pieces.push(`ctx ${used}/${size}${pct}`);
  }
  if (present(vars.totalOutputTokens)) pieces.push(`out ${vars.totalOutputTokens}`);
  return pieces.length ? ` · ${pieces.join(" · ")}` : "";
}

/**
 * @param {object} [vars]
 * @param {object} [options]
 * @returns {string}
 */
module.exports = function codexStatusLine(vars = {}, options = {}) {
  const file = options.settingsFile || process.env.CODEX_OAUTH_SETTINGS_FILE || DEFAULT_SETTINGS_FILE;
  const settings = { ...DEFAULTS, ...(readJson(file) || {}) };
  return `${prettyModel(settings.model)} ${settings.reasoningEffort || DEFAULTS.reasoningEffort} via Codex OAuth${contextText(vars)}`;
};
