#!/usr/bin/env node
// Verify the claude-gpt CCR -> Codex OAuth setup without printing secrets.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CCR_DIR = process.env.CCR_DIR || path.join(os.homedir(), ".claude-code-router");
const CONFIG_FILE = path.join(CCR_DIR, "config.json");
const AUTH_FILE = process.env.CODEX_OAUTH_AUTH_FILE || path.join(CCR_DIR, "codex-auth.json");
const SETTINGS_FILE = process.env.CODEX_OAUTH_SETTINGS_FILE || path.join(CCR_DIR, "codex-settings.json");
const TRANSFORMER_FILE = process.env.CODEX_OAUTH_TRANSFORMER_FILE || path.join(CCR_DIR, "plugins", "codex-oauth.js");
const DEFAULTS = { model: "gpt-5.5", reasoningEffort: "xhigh" };

let failures = 0;
let warnings = 0;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function commandExists(command) {
  const result = process.platform === "win32"
    ? spawnSync("where", [command], { stdio: "ignore", windowsHide: true })
    : spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function pass(message) {
  console.log(`✅ ${message}`);
}

function warn(message) {
  warnings++;
  console.log(`⚠️  ${message}`);
}

function fail(message) {
  failures++;
  console.log(`❌ ${message}`);
}

function normalizeModel(model) {
  const value = String(model || DEFAULTS.model);
  return value.includes(",") ? value.split(",").pop().trim() : value.trim();
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function hasCommand(name) {
  const file = path.join(os.homedir(), ".claude", "commands", `${name}.md`);
  if (fs.existsSync(file)) pass(`/${name} slash command installed`);
  else warn(`/${name} slash command missing at ${file}`);
}

async function healthCheck(config) {
  const host = config.HOST || "127.0.0.1";
  const port = config.PORT || 3456;
  const apiKey = config.APIKEY || "test";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`http://${host}:${port}/health`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (response.ok) pass(`CCR health endpoint is up at http://${host}:${port}`);
    else warn(`CCR health endpoint returned ${response.status}; run: ccr restart`);
  } catch {
    warn(`CCR health endpoint is not reachable; run: ccr restart`);
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyTransformer(settings, live) {
  if (!fs.existsSync(TRANSFORMER_FILE)) {
    fail(`Transformer missing: ${TRANSFORMER_FILE}`);
    return;
  }
  pass(`Transformer installed: ${TRANSFORMER_FILE}`);

  let Transformer;
  try {
    Transformer = require(TRANSFORMER_FILE);
  } catch (error) {
    fail(`Transformer failed to load: ${error.message}`);
    return;
  }

  const transformer = new Transformer({
    authFile: AUTH_FILE,
    settingsFile: SETTINGS_FILE,
    defaultModel: DEFAULTS.model,
    defaultReasoningEffort: DEFAULTS.reasoningEffort,
    originator: "claude-code-router",
  });

  let transformed;
  try {
    transformed = await transformer.transformRequestIn(
      {
        model: "openai-codex,gpt-5.5",
        stream: false,
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
      },
      {},
      {},
    );
  } catch (error) {
    fail(`Transformer request preparation failed: ${error.message}`);
    return;
  }

  const body = transformed.body;
  const authHeader = transformed.config?.headers?.Authorization;
  if (authHeader?.startsWith("Bearer ")) pass("OAuth access token loaded/refreshed (not printed)");
  else fail("OAuth access token was not attached");

  if (body.model === normalizeModel(settings.model)) pass(`Next upstream model: ${body.model}`);
  else fail(`Unexpected upstream model: ${body.model}; expected ${normalizeModel(settings.model)}`);

  if (body.reasoning?.effort === settings.reasoningEffort) pass(`Next reasoning effort: ${body.reasoning.effort}`);
  else fail(`Unexpected reasoning effort: ${body.reasoning?.effort || "none"}; expected ${settings.reasoningEffort}`);

  console.log("Prepared upstream body summary:");
  console.log(pretty({ model: body.model, reasoning: body.reasoning, stream: body.stream, store: body.store }));

  if (!live) return;

  try {
    const upstream = await fetch(transformed.config.url, {
      method: "POST",
      headers: transformed.config.headers,
      body: JSON.stringify(body),
    });
    if (!upstream.ok) {
      const text = await upstream.text();
      fail(`Live Codex request failed: HTTP ${upstream.status} ${text.slice(0, 300)}`);
      return;
    }
    const converted = await transformer.transformResponseOut(upstream, { req: { body: { stream: false } } });
    const json = await converted.json();
    const text = json.choices?.[0]?.message?.content;
    if (text === "ok") pass(`Live Codex request returned ok via ${json.model}`);
    else warn(`Live Codex request returned unexpected text: ${text || "<empty>"}`);
  } catch (error) {
    fail(`Live Codex request failed: ${error.message}`);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const live = !args.has("--local") && !args.has("--no-live");

  console.log("claude-gpt doctor\n");

  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20) pass(`Node ${process.versions.node}`);
  else fail(`Node ${process.versions.node}; Node 20+ required`);

  commandExists("claude") ? pass("claude on PATH") : fail("claude missing from PATH");
  commandExists("ccr") ? pass("ccr on PATH") : fail("ccr missing from PATH");

  const config = readJson(CONFIG_FILE);
  if (config) pass(`CCR config present: ${CONFIG_FILE}`);
  else fail(`CCR config missing/unreadable: ${CONFIG_FILE}`);

  const auth = readJson(AUTH_FILE);
  if (auth?.type === "oauth" && auth.access && auth.refresh) {
    pass(`Codex OAuth credentials present: ${AUTH_FILE}`);
    if (auth.expires) console.log(`   expires=${new Date(auth.expires).toISOString()}`);
    console.log(`   accountId=${auth.accountId ? "present" : "missing"}`);
  } else {
    fail(`Codex OAuth credentials missing: ${AUTH_FILE}`);
  }

  const settings = { ...DEFAULTS, ...(readJson(SETTINGS_FILE) || {}) };
  settings.model = normalizeModel(settings.model);
  pass(`Codex settings: ${settings.model} ${settings.reasoningEffort}`);
  console.log(`   settingsFile=${SETTINGS_FILE}`);

  hasCommand("gpt-settings");
  hasCommand("gpt-model");
  hasCommand("gpt-effort");

  if (config) {
    const routerDefault = config.Router?.default;
    if (routerDefault === "openai-codex,gpt-5.5") pass("CCR Router.default is openai-codex,gpt-5.5");
    else warn(`CCR Router.default is ${routerDefault || "missing"}`);

    const statusLine = config.StatusLine;
    if (statusLine?.enabled && statusLine?.default?.modules) pass("CCR StatusLine is customized for claude-gpt");
    else warn("CCR StatusLine is not customized; reinstall with ccr-codex-oauth-install");

    await healthCheck(config);
  }

  await verifyTransformer(settings, live);

  console.log("");
  if (failures) {
    console.log(`Doctor failed: ${failures} failure(s), ${warnings} warning(s).`);
    process.exit(1);
  }
  console.log(`Doctor passed${warnings ? ` with ${warnings} warning(s)` : ""}.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
