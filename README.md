# Claude Code Router Codex OAuth Bridge

Run the **Claude Code harness** against your ChatGPT/Codex OAuth subscription quota through Claude Code Router (CCR), while keeping normal Claude Code/work-plan usage available.

## What you get

- `claude` — unchanged; normal Claude Code/work plan.
- `claude-work` — direct Claude Code/work-plan launcher that unsets CCR env vars.
- `claude-gpt` — Claude Code -> CCR -> ChatGPT Codex backend using OAuth.
- `claude-gpt-auth` — local OAuth credential helper.
- `claude-gpt-settings` — live model/reasoning settings helper.
- `claude-gpt-doctor` — verifies CCR, OAuth, settings, and live Codex routing.
- `/gpt-settings`, `/gpt-model`, `/gpt-effort` — Claude Code slash commands installed by the installer.

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

By default `claude-gpt` **always launches Claude Code with**:

```bash
--model openai-codex,gpt-5.5
```

and the transformer defaults the upstream Codex request to `gpt-5.5` with `xhigh` reasoning effort.

Interactive startup prints a banner showing the route and active upstream settings. The installer also replaces/augments CCR's statusline so it shows the route plus current context/session token counters when Claude Code provides them:

```text
GPT-5.5 xhigh via Codex OAuth · ctx 42.1k/400k 11% · out 3.7k
```

Claude Code's top-left TUI label may still display its Anthropic-facing model alias in some cases. The CCR statusline/logs and `claude-gpt-doctor` show the actual routed upstream model.

### Tweak model/effort

From your shell:

```bash
claude-gpt-settings show
claude-gpt-settings preset max       # gpt-5.5 + xhigh
claude-gpt-settings preset balanced  # gpt-5.4 + high
claude-gpt-settings preset fast      # gpt-5.4-mini + none
claude-gpt-settings set --model gpt-5.5 --effort xhigh
```

From inside a `claude-gpt` Claude Code session, use the installed slash commands:

```text
/gpt-settings show
/gpt-settings preset fast
/gpt-settings set --model gpt-5.5 --effort xhigh
/gpt-model gpt-5.5
/gpt-effort xhigh
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
- CCR statusline module: `~/.claude-code-router/statusline-codex.js`
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
- `CLAUDE_GPT_MODEL` — upstream Codex model override
- `CLAUDE_GPT_EFFORT` / `CLAUDE_GPT_REASONING_EFFORT` — upstream Codex reasoning effort override
- `CLAUDE_GPT_BANNER=0` — disable interactive startup banner
- `CLAUDE_GPT_BANNER_DELAY_MS` — banner delay before launching Claude Code, default `900`
- `SKIP_CCR_INSTALL=1` — do not auto-install CCR

## Token/context display and compaction

The statusline token counters come from Claude Code's statusline payload:

- `ctx used/window %` — current context-window input tokens and percent
- `out` — current context/session output token counter when available
- trailing `↑` / `↓` modules — last request input/output usage

No custom `claude-gpt` auto-compact limit is configured. Claude Code still owns compaction behavior. In this bridge config, CCR's only token threshold is routing-related:

```json
"longContextThreshold": 120000
```

That threshold no longer changes models because all routes are set to `openai-codex,gpt-5.5`; it does not trigger compaction.

## Verify

```bash
npm run check
claude-gpt-doctor          # includes a live Codex smoke test
claude-gpt-doctor --local  # local checks only
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
