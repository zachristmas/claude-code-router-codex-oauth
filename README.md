# Claude Code Router Codex OAuth Bridge

Run the **Claude Code harness** against your ChatGPT/Codex OAuth subscription quota through Claude Code Router (CCR), while keeping normal Claude Code/work-plan usage available.

## What you get

- `claude` — unchanged; normal Claude Code/work plan.
- `claude-work` — direct Claude Code/work-plan launcher that unsets CCR env vars.
- `claude-gpt` — Claude Code -> CCR -> ChatGPT Codex backend using OAuth.
- `claude-gpt-auth` — local OAuth credential helper.

Works on macOS, Linux, and Windows with Node 20+.

## Important warning

This uses the ChatGPT Codex backend endpoint (`chatgpt.com/backend-api/codex/responses`) and an OAuth flow compatible with OpenCode/Codex. That behavior is unofficial/private-ish and may break if OpenAI changes it.

Do **not** commit or share OAuth files. Tokens are stored locally at:

```text
~/.claude-code-router/codex-auth.json
```

## Requirements

- Node.js 20+
- Claude Code (`claude` on PATH)
- Claude Code Router (`ccr` on PATH)
  - The installer will try `npm install -g @musistudio/claude-code-router` if missing.

## Install

### Recommended: from this repo

```bash
git clone https://github.com/zachristmas/claude-code-router-codex-oauth.git
cd claude-code-router-codex-oauth
npm install -g .
ccr-codex-oauth-install
```

### Direct clone without npm global shims

macOS/Linux:

```bash
./install.sh
```

All platforms:

```bash
node scripts/install.js
```

If you use the direct installer, make sure `~/.local/bin` is on PATH. On Windows, prefer `npm install -g .` so npm creates `.cmd` shims.

## Authenticate

Browser login:

```bash
claude-gpt-auth login
```

Headless/device login:

```bash
claude-gpt-auth headless
```

If OpenCode is already logged into OpenAI OAuth, copy that local credential:

```bash
claude-gpt-auth copy-opencode
```

Check status:

```bash
claude-gpt-auth status
```

## Use

OpenAI/Codex subscription route:

```bash
claude-gpt
claude-gpt -p "Reply with exactly: ok"
```

Direct work Claude route:

```bash
claude-work
claude-work -p "Reply with exactly: ok"
```

## Files installed

- CCR config: `~/.claude-code-router/config.json`
- CCR transformer: `~/.claude-code-router/plugins/codex-oauth.js`
- OAuth credentials: `~/.claude-code-router/codex-auth.json`
- Launchers: npm global shims, or `~/.local/bin/*` when using the direct installer

The installer backs up an existing CCR config before overwriting it:

```text
~/.claude-code-router/config.YYYYMMDDHHMMSS.bak.json
```

## Environment overrides

- `CCR_DIR` — default `~/.claude-code-router`
- `CCR_HOST` — default `127.0.0.1`
- `CCR_PORT` — default `3456`
- `CCR_APIKEY` — default `sk-ccr-local`
- `CODEX_OAUTH_AUTH_FILE` — default `~/.claude-code-router/codex-auth.json`
- `BIN_DIR` — direct installer launcher dir, default `~/.local/bin`
- `SKIP_CCR_INSTALL=1` — do not auto-install CCR

## Verify

```bash
npm run check
claude-gpt -p "Reply with exactly: ok"
claude-gpt --allowedTools 'Bash(pwd)' -p 'Run pwd and reply only with the resulting path.'
```

## How it works

CCR receives Claude Code traffic on Anthropic-compatible `/v1/messages`, converts it to OpenAI chat-completions shape, then this transformer:

1. loads/refreshed local ChatGPT OAuth credentials,
2. converts OpenAI chat-completions-style requests to OpenAI Responses-style input,
3. sends them to ChatGPT Codex with `stream: true` and `store: false`,
4. converts Codex Responses SSE back to OpenAI chat-completions SSE/JSON,
5. lets CCR convert that back to Claude-compatible output for Claude Code.
