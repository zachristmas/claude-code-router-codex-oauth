#!/usr/bin/env node
/** @file Codex OAuth credential helper. */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { webcrypto } = require("node:crypto");
const { setTimeout: sleep } = require("node:timers/promises");

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
const OAUTH_PORT = 1455;
const AUTH_FILE = process.env.CODEX_OAUTH_AUTH_FILE || path.join(os.homedir(), ".claude-code-router", "codex-auth.json");
const SAFETY_MARGIN_MS = 3000;

/** @returns {void} */
function usage() {
  console.log(`Usage: claude-gpt-auth [status|copy-opencode|login|headless]

Commands:
  status          Show whether local Codex OAuth credentials exist
  copy-opencode   Copy existing OpenCode OpenAI OAuth credentials
  login           Browser PKCE login (default)
  headless        Device-code login for headless shells
`);
}

/**
 * @param {string} file
 * @param {*} value
 * @returns {void}
 */
function writeJson0600(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
}

/**
 * @param {string} file
 * @returns {object|undefined}
 */
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return undefined; }
}

/**
 * @template T
 * @param {T[]} values
 * @returns {T[]}
 */
function unique(values) {
  return [...new Set(values.filter(Boolean))];
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
function getOpenCodeAuth() {
  for (const file of opencodeAuthCandidates()) {
    const raw = readJson(file);
    const auth = raw?.openai;
    if (auth?.type === "oauth" && auth.access && auth.refresh) return auth;

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
 * @param {string|undefined} token
 * @returns {object|undefined}
 */
function parseJwtClaims(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return undefined;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { return undefined; }
}

/**
 * @param {object|undefined} claims
 * @returns {string|undefined}
 */
function extractAccountIdFromClaims(claims) {
  return claims?.chatgpt_account_id || claims?.["https://api.openai.com/auth"]?.chatgpt_account_id || claims?.organizations?.[0]?.id;
}

/**
 * @param {object} tokens
 * @returns {string|undefined}
 */
function extractAccountId(tokens) {
  return extractAccountIdFromClaims(parseJwtClaims(tokens.id_token)) || extractAccountIdFromClaims(parseJwtClaims(tokens.access_token));
}

/**
 * @param {ArrayBuffer|Buffer|Uint8Array} buffer
 * @returns {string}
 */
function base64UrlEncode(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * @param {number} length
 * @returns {string}
 */
function randomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = webcrypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes).map((b) => chars[b % chars.length]).join("");
}

/** @returns {Promise<{verifier: string, challenge: string}>} */
async function pkce() {
  const verifier = randomString(43);
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64UrlEncode(digest) };
}

/** @returns {string} */
function state() {
  return base64UrlEncode(webcrypto.getRandomValues(new Uint8Array(32)).buffer);
}

/**
 * @param {string} redirectUri
 * @param {{verifier: string, challenge: string}} codes
 * @param {string} oauthState
 * @returns {string}
 */
function buildAuthorizeUrl(redirectUri, codes, oauthState) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: codes.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state: oauthState,
    originator: "claude-code-router",
  });
  return `${ISSUER}/oauth/authorize?${params.toString()}`;
}

/**
 * @param {string} code
 * @param {string} redirectUri
 * @param {{verifier: string, challenge: string}} codes
 * @returns {Promise<object>}
 */
async function exchangeCodeForTokens(code, redirectUri, codes) {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: codes.verifier,
    }).toString(),
  });
  if (!response.ok) throw new Error(`Token exchange failed: ${response.status}`);
  return response.json();
}

/**
 * @param {string} url
 * @returns {void}
 */
function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}

/** @returns {Promise<void>} */
async function browserLogin() {
  const redirectUri = `http://127.0.0.1:${OAUTH_PORT}/auth/callback`;
  const codes = await pkce();
  const oauthState = state();
  const authUrl = buildAuthorizeUrl(redirectUri, codes, oauthState);

  const callback = new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || "/", redirectUri);
        if (url.pathname !== "/auth/callback") {
          res.writeHead(404).end("not found");
          return;
        }
        const error = url.searchParams.get("error");
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        if (error) throw new Error(error);
        if (!code) throw new Error("Missing authorization code");
        if (returnedState !== oauthState) throw new Error("OAuth state mismatch");
        const tokens = await exchangeCodeForTokens(code, redirectUri, codes);
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>Authorization successful</h1><p>You can close this window and return to your terminal.</p>");
        server.close();
        resolve(tokens);
      } catch (err) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(String(err.message || err));
        server.close();
        reject(err);
      }
    });
    server.on("error", reject);
    server.listen(OAUTH_PORT, "127.0.0.1", () => {
      console.log(`Opening browser for ChatGPT authorization...`);
      console.log(authUrl);
      openBrowser(authUrl);
    });
  });

  const tokens = await callback;
  saveTokens(tokens);
}

/** @returns {Promise<void>} */
async function headlessLogin() {
  const response = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "claude-code-router-codex-oauth" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });
  if (!response.ok) throw new Error("Failed to initiate device authorization");
  const device = await response.json();
  const interval = Math.max(parseInt(device.interval) || 5, 1) * 1000;
  console.log(`Open: ${ISSUER}/codex/device`);
  console.log(`Enter code: ${device.user_code}`);

  while (true) {
    const poll = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "claude-code-router-codex-oauth" },
      body: JSON.stringify({ device_auth_id: device.device_auth_id, user_code: device.user_code }),
    });
    if (poll.ok) {
      const data = await poll.json();
      const tokenResponse = await fetch(`${ISSUER}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: data.authorization_code,
          redirect_uri: `${ISSUER}/deviceauth/callback`,
          client_id: CLIENT_ID,
          code_verifier: data.code_verifier,
        }).toString(),
      });
      if (!tokenResponse.ok) throw new Error(`Token exchange failed: ${tokenResponse.status}`);
      saveTokens(await tokenResponse.json());
      return;
    }
    if (poll.status !== 403 && poll.status !== 404) throw new Error(`Device authorization failed: ${poll.status}`);
    await sleep(interval + SAFETY_MARGIN_MS);
  }
}

/**
 * @param {object} tokens
 * @returns {void}
 */
function saveTokens(tokens) {
  const auth = {
    type: "oauth",
    refresh: tokens.refresh_token,
    access: tokens.access_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    accountId: extractAccountId(tokens),
  };
  writeJson0600(AUTH_FILE, auth);
  console.log(`Saved Codex OAuth credentials to ${AUTH_FILE}`);
}

/** @returns {Promise<void>} */
async function main() {
  const command = process.argv[2] || "login";
  if (command === "-h" || command === "--help" || command === "help") return usage();
  if (command === "status") {
    const auth = readJson(AUTH_FILE);
    if (auth?.type === "oauth" && auth.access && auth.refresh) {
      console.log(`Codex OAuth credentials present: ${AUTH_FILE}`);
      console.log(`Expires: ${auth.expires ? new Date(auth.expires).toISOString() : "unknown"}`);
      console.log(`Account id: ${auth.accountId ? "present" : "not stored"}`);
    } else {
      console.log(`No Codex OAuth credentials at ${AUTH_FILE}`);
      if (getOpenCodeAuth()) console.log(`OpenCode OpenAI OAuth credentials are available; run: claude-gpt-auth copy-opencode`);
      process.exitCode = 1;
    }
    return;
  }
  if (command === "copy-opencode") {
    const auth = getOpenCodeAuth();
    if (!auth) throw new Error(`No OpenCode OpenAI OAuth credentials found. Checked: ${opencodeAuthCandidates().join(", ")}`);
    writeJson0600(AUTH_FILE, auth);
    console.log(`Copied OpenCode OpenAI OAuth credentials to ${AUTH_FILE}`);
    return;
  }
  if (command === "headless") return await headlessLogin();
  if (command === "login") return await browserLogin();
  throw new Error(`Unknown command: ${command}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
