# Claude Code Router Codex OAuth Bridge

Run the **Claude Code harness** against your ChatGPT/Codex OAuth subscription quota through Claude Code Router (CCR), while keeping normal Claude Code/work-plan usage available.

## What you get

- `claude` — unchanged; normal Claude Code/work plan.
- `claude-work` — direct Claude Code/work-plan launcher that unsets CCR env vars.
- `claude-gpt` — Claude Code -> CCR -> ChatGPT Codex backend using OAuth.
- `claude-gpt-auth` — local OAuth credential helper.
- `claude-gpt-settings` — live model/reasoning settings helper.
- `/gpt-settings` — Claude Code slash command installed by the installer.

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

### Recommended: install directly from GitHub

No npm package publish is required:

```bash
npm install -g github:zachristmas/claude-code-router-codex-oauth
ccr-codex-oauth-install
```

### From a local clone

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

By default `claude-gpt` uses `gpt-5.5` with `xhigh` reasoning effort.

Claude Code's top-left TUI label may still display its Anthropic-facing model alias, such as `Sonnet 4.6`, and `API Usage Billing`. That is normal for this bridge: Claude Code still speaks Anthropic-shaped requests to CCR, and CCR routes them to ChatGPT/Codex OAuth upstream. The installer enables CCR's status line so the routed model is visible after responses. You can also verify routing with CCR logs or a `claude-gpt -p` smoke test.

### Tweak model/effort

From your shell:

```bash
claude-gpt-settings show
claude-gpt-settings preset max       # gpt-5.5 + xhigh
claude-gpt-settings preset balanced  # gpt-5.4 + high
claude-gpt-settings preset fast      # gpt-5.4-mini + none
claude-gpt-settings set --model gpt-5.5 --effort xhigh
```

From inside a `claude-gpt` Claude Code session, use the installed slash command:

```text
/gpt-settings show
/gpt-settings preset fast
/gpt-settings set --model gpt-5.5 --effort xhigh
```

Settings are stored at `~/.claude-code-router/codex-settings.json`. The transformer reads that file on every request, so changes apply to the next request without restarting CCR. The top-left Claude Code model label may not update until a new session; the CCR statusline/logs show the actual routed upstream model.

Direct work Claude route:

```bash
claude-work
claude-work -p "Reply with exactly: ok"
```

## Files installed

- CCR config: `~/.claude-code-router/config.json`
- CCR transformer: `~/.claude-code-router/plugins/codex-oauth.js`
- OAuth credentials: `~/.claude-code-router/codex-auth.json`
- Live Codex settings: `~/.claude-code-router/codex-settings.json`
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
- `CLAUDE_GPT_MODEL` — launch-time model override for Claude Code's `--model`
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
