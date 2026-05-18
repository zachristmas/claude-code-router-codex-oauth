// Claude Code Router transformer: OpenAI Codex OAuth via ChatGPT subscription.
//
// This transformer adapts CCR's OpenAI Chat Completions-shaped request body
// into the ChatGPT Codex Responses endpoint used by OpenCode/Codex OAuth.
// It uses local OAuth credentials from ~/.claude-code-router/codex-auth.json,
// falling back to common OpenCode auth.json locations when present.
//
// No tokens are logged or printed.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const DUMMY_KEY = "opencode-oauth-dummy-key";
const DEFAULT_AUTH_FILE = path.join(os.homedir(), ".claude-code-router", "codex-auth.json");
const DEFAULT_SETTINGS_FILE = path.join(os.homedir(), ".claude-code-router", "codex-settings.json");

function expandHome(value) {
  if (!value) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
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
  ]).map(expandHome);
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

function parseJwtClaims(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

function extractAccountIdFromClaims(claims) {
  return (
    claims?.chatgpt_account_id ||
    claims?.["https://api.openai.com/auth"]?.chatgpt_account_id ||
    claims?.organizations?.[0]?.id
  );
}

function extractAccountId(tokens) {
  const idClaims = parseJwtClaims(tokens.id_token);
  const accessClaims = parseJwtClaims(tokens.access_token);
  return extractAccountIdFromClaims(idClaims) || extractAccountIdFromClaims(accessClaims);
}

async function refreshAccessToken(refreshToken) {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Codex OAuth token refresh failed: ${response.status}`);
  }
  return response.json();
}

function loadAuthFromFile(file) {
  const raw = readJson(file);
  if (!raw || typeof raw !== "object") return undefined;

  // Native bridge auth shape.
  if (raw.type === "oauth" && raw.access && raw.refresh) {
    return { file, format: "native", auth: raw };
  }

  // OpenCode legacy auth shape: { openai: { type: "oauth", ... } }
  if (raw.openai?.type === "oauth" && raw.openai.access && raw.openai.refresh) {
    return { file, format: "opencode-v1", auth: raw.openai, raw };
  }

  // OpenCode v2 shape, if present: { version: 2, accounts, active }.
  if (raw.version === 2 && raw.accounts && raw.active) {
    const activeId = raw.active.openai;
    const account = activeId ? raw.accounts[activeId] : Object.values(raw.accounts).find((entry) => entry.serviceID === "openai");
    if (account?.credential?.type === "oauth") {
      return { file, format: "opencode-v2", auth: account.credential, raw, accountId: account.id };
    }
  }

  return undefined;
}

function normalizeModelId(model) {
  if (!model || typeof model !== "string") return undefined;
  return model.includes(",") ? model.split(",").pop().trim() : model.trim();
}

function loadCodexSettings(options = {}) {
  const settingsFile = expandHome(options.settingsFile || process.env.CODEX_OAUTH_SETTINGS_FILE || DEFAULT_SETTINGS_FILE);
  const settings = readJson(settingsFile) || {};
  return {
    model: normalizeModelId(process.env.CLAUDE_GPT_MODEL || settings.model || options.model || options.defaultModel),
    reasoningEffort:
      process.env.CLAUDE_GPT_EFFORT ||
      process.env.CLAUDE_GPT_REASONING_EFFORT ||
      settings.reasoningEffort ||
      settings.effort ||
      options.reasoningEffort ||
      options.defaultReasoningEffort,
    settingsFile,
  };
}

function saveAuth(loaded, auth) {
  if (loaded.format === "native") {
    writeJson0600(loaded.file, auth);
    return;
  }
  if (loaded.format === "opencode-v1") {
    loaded.raw.openai = { ...loaded.raw.openai, ...auth };
    writeJson0600(loaded.file, loaded.raw);
    return;
  }
  if (loaded.format === "opencode-v2") {
    const raw = loaded.raw;
    const account = raw.accounts?.[loaded.accountId];
    if (account) account.credential = { ...account.credential, ...auth };
    writeJson0600(loaded.file, raw);
  }
}

async function loadCodexAuth(options = {}) {
  const authFile = expandHome(options.authFile || process.env.CODEX_OAUTH_AUTH_FILE || DEFAULT_AUTH_FILE);
  const checked = [authFile, ...opencodeAuthCandidates()];
  let loaded;
  for (const file of checked) {
    loaded = loadAuthFromFile(file);
    if (loaded) break;
  }
  if (!loaded) {
    throw new Error(
      `No Codex OAuth credentials found. Run claude-gpt-auth first, or login with OpenCode and copy credentials. Checked: ${unique(checked).join(", ")}.`,
    );
  }

  const auth = { ...loaded.auth };
  const refreshSkewMs = Number(options.refreshSkewMs ?? 60_000);
  if (!auth.access || !auth.expires || Number(auth.expires) < Date.now() + refreshSkewMs) {
    const tokens = await refreshAccessToken(auth.refresh);
    auth.access = tokens.access_token;
    auth.refresh = tokens.refresh_token || auth.refresh;
    auth.expires = Date.now() + (tokens.expires_in ?? 3600) * 1000;
    auth.accountId = extractAccountId(tokens) || auth.accountId;
    saveAuth(loaded, auth);
  }
  return auth;
}

function textFromContent(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part) return "";
        if (part.type === "text") return part.text || "";
        if (part.type === "input_text") return part.text || "";
        if (part.type === "image_url") return `[image: ${part.image_url?.url || "attached"}]`;
        return typeof part === "string" ? part : JSON.stringify(part);
      })
      .filter(Boolean)
      .join("\n");
  }
  return JSON.stringify(content);
}

function userContentToResponses(content) {
  if (typeof content === "string") return [{ type: "input_text", text: content }];
  if (!Array.isArray(content)) return [{ type: "input_text", text: textFromContent(content) }];

  const parts = [];
  for (const part of content) {
    if (!part) continue;
    if (part.type === "text") {
      parts.push({ type: "input_text", text: part.text || "" });
      continue;
    }
    if (part.type === "input_text") {
      parts.push({ type: "input_text", text: part.text || "" });
      continue;
    }
    if (part.type === "image_url") {
      const imageUrl = part.image_url?.url;
      if (imageUrl) parts.push({ type: "input_image", image_url: imageUrl, detail: part.image_url?.detail });
      continue;
    }
    parts.push({ type: "input_text", text: JSON.stringify(part) });
  }
  return parts.length ? parts : [{ type: "input_text", text: "" }];
}

function mcpToolParts(name) {
  const match = String(name || "").match(/^mcp__(.+?)__(.+)$/);
  if (!match) return undefined;
  return { server: match[1], operation: match[2] };
}

function sanitizeToolName(value) {
  return String(value || "tool").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 48);
}

function isMcpDispatchName(name) {
  return /^mcp_dispatch__[A-Za-z0-9_]+$/.test(String(name || ""));
}

function summarizeSchema(schema = {}) {
  const props = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const names = Object.keys(props).slice(0, 12);
  const propText = names
    .map((name) => {
      const prop = props[name] || {};
      const type = Array.isArray(prop.type) ? prop.type.join("|") : prop.type || (prop.enum ? "enum" : "any");
      return `${name}:${type}`;
    })
    .join(", ");
  return `required=[${required.join(",")}] props={${propText}${Object.keys(props).length > names.length ? ",…" : ""}}`;
}

function shouldCompressMcpTools(options = {}) {
  const env = process.env.CLAUDE_GPT_COMPRESS_MCP;
  if (env && ["0", "false", "off", "no"].includes(env.toLowerCase())) return false;
  return options.compressMcpTools !== false;
}

function compressMcpTools(tools, options = {}) {
  if (!shouldCompressMcpTools(options)) return tools;
  const minTools = Number(options.compressMcpMinTools ?? process.env.CLAUDE_GPT_COMPRESS_MCP_MIN_TOOLS ?? 4);
  const passthrough = [];
  const groups = new Map();

  for (const tool of tools) {
    const parts = mcpToolParts(tool.name);
    if (!parts) {
      passthrough.push(tool);
      continue;
    }
    if (!groups.has(parts.server)) groups.set(parts.server, []);
    groups.get(parts.server).push({ ...tool, mcp: parts });
  }

  for (const [server, group] of groups) {
    if (group.length < minTools) {
      passthrough.push(...group.map(({ mcp, ...tool }) => tool));
      continue;
    }

    const names = group.map((tool) => tool.name);
    const details = group
      .map((tool) => `- ${tool.name}: ${tool.description || "No description."} ${summarizeSchema(tool.parameters)}`)
      .join("\n");

    passthrough.push({
      type: "function",
      name: `mcp_dispatch__${sanitizeToolName(server)}`,
      description:
        `Dispatch to one ${server} MCP tool. Choose the exact original tool name and provide input_json as a JSON object string for that tool. ` +
        `Do not leave input_json empty when required fields are listed. Example: ` +
        `{"name":"mcp__${server}__some_tool","input_json":"{\\"project\\":\\"CIC Backlog\\"}"}. ` +
        `Available tools:\n${details}`,
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            enum: names,
            description: "Exact original MCP tool name to call.",
          },
          input_json: {
            type: "string",
            description:
              "JSON object string containing the exact input for the selected MCP tool, including every required field listed in the tool summary.",
          },
        },
        required: ["name", "input_json"],
        additionalProperties: false,
      },
    });
  }

  return passthrough;
}

function cloneJson(value) {
  if (!value || typeof value !== "object") return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function sanitizeToolForResponses(tool) {
  const sanitized = {
    ...tool,
    parameters: cloneJson(tool.parameters || { type: "object", properties: {} }),
  };

  // Claude Code's Read tool exposes an optional PDF-only `pages` string. Codex tends to
  // fill optional strings as `""`, which Claude Code rejects for non-PDF reads. Hide it
  // upstream and scrub it again on the way back for safety.
  if (sanitized.name === "Read" && sanitized.parameters?.properties?.pages) {
    delete sanitized.parameters.properties.pages;
    if (Array.isArray(sanitized.parameters.required)) {
      sanitized.parameters.required = sanitized.parameters.required.filter((name) => name !== "pages");
    }
  }

  return sanitized;
}

function chatToolsToResponses(tools, options = {}) {
  if (!Array.isArray(tools)) return undefined;
  const converted = [];
  for (const tool of tools) {
    if (!tool) continue;
    if (tool.type === "function" && tool.function?.name) {
      converted.push(
        sanitizeToolForResponses({
          type: "function",
          name: tool.function.name,
          description: tool.function.description || "",
          parameters: tool.function.parameters || { type: "object", properties: {} },
        }),
      );
      continue;
    }
    if (tool.name) {
      converted.push(
        sanitizeToolForResponses({
          type: "function",
          name: tool.name,
          description: tool.description || "",
          parameters: tool.parameters || tool.input_schema || { type: "object", properties: {} },
        }),
      );
    }
  }
  const compressed = compressMcpTools(converted, options);
  return compressed.length ? compressed : undefined;
}

function toolChoiceToResponses(toolChoice) {
  if (!toolChoice) return undefined;
  if (typeof toolChoice === "string") return toolChoice;
  if (toolChoice.type === "function" && toolChoice.function?.name) return { type: "function", name: toolChoice.function.name };
  if (toolChoice.type === "tool" && toolChoice.name) return { type: "function", name: toolChoice.name };
  if (toolChoice.type) return toolChoice.type;
  return undefined;
}

function chatToResponses(body, options = {}) {
  const instructions = [];
  const input = [];

  for (const message of body.messages || []) {
    if (!message || !message.role) continue;
    if (message.role === "system" || message.role === "developer") {
      const text = textFromContent(message.content);
      if (text) instructions.push(text);
      continue;
    }
    if (message.role === "user") {
      input.push({ role: "user", content: userContentToResponses(message.content) });
      continue;
    }
    if (message.role === "assistant") {
      const text = textFromContent(message.content);
      if (text) input.push({ role: "assistant", content: [{ type: "output_text", text }] });
      if (Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) {
          if (!call?.function?.name) continue;
          input.push({
            type: "function_call",
            call_id: call.id,
            name: call.function.name,
            arguments:
              typeof call.function.arguments === "string"
                ? call.function.arguments
                : JSON.stringify(call.function.arguments || {}),
          });
        }
      }
      continue;
    }
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id,
        output: typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? ""),
      });
    }
  }

  const request = {
    model: normalizeModelId(options.model) || normalizeModelId(body.model),
    instructions: instructions.join("\n\n") || "You are a concise coding assistant.",
    input,
    stream: true,
    store: false,
    parallel_tool_calls: true,
  };

  const tools = chatToolsToResponses(body.tools, options);
  if (tools) request.tools = tools;

  const toolChoice = toolChoiceToResponses(body.tool_choice);
  if (toolChoice) request.tool_choice = toolChoice;

  const effort = options.reasoningEffort || options.defaultReasoningEffort || body.reasoning?.effort || body.reasoningEffort || body.reasoning_effort;
  if (effort && effort !== "none") request.reasoning = { effort };

  // The ChatGPT Codex endpoint currently rejects max_output_tokens and requires streaming.
  // It may also reject some sampling parameters for reasoning models, so keep this lean.
  return request;
}

function mapUsage(usage = {}) {
  const prompt = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const completion = usage.output_tokens ?? usage.completion_tokens ?? 0;
  const cached = usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    prompt_tokens_details: { cached_tokens: cached },
  };
}

async function* iterateSSE(readable) {
  if (!readable) return;
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        const event = parseSSEBlock(block);
        if (event) yield event;
      }
    }
    buffer += decoder.decode();
    const final = parseSSEBlock(buffer.trim());
    if (final) yield final;
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

function parseSSEBlock(block) {
  if (!block) return undefined;
  let event = "message";
  const data = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return undefined;
  const raw = data.join("\n");
  let json;
  try {
    json = JSON.parse(raw);
  } catch {}
  return { event, raw, json };
}

function createChatChunk(state, delta, finishReason = null, usage) {
  return {
    id: state.responseId || `chatcmpl_${Date.now()}`,
    object: "chat.completion.chunk",
    created: state.created || Math.floor(Date.now() / 1000),
    model: state.model || "gpt-5.4-mini",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  };
}

function finishReasonFromState(state) {
  if (state.toolCalls.size > 0) return "tool_calls";
  return state.finishReason || "stop";
}

function parseDispatchInput(parsed) {
  if (typeof parsed?.input_json === "string") {
    try {
      const input = JSON.parse(parsed.input_json || "{}");
      return input && typeof input === "object" && !Array.isArray(input) ? input : {};
    } catch {
      return {};
    }
  }
  if (typeof parsed?.arguments_json === "string") {
    try {
      const input = JSON.parse(parsed.arguments_json || "{}");
      return input && typeof input === "object" && !Array.isArray(input) ? input : {};
    } catch {
      return {};
    }
  }
  return parsed?.input && typeof parsed.input === "object" && !Array.isArray(parsed.input) ? parsed.input : {};
}

function scrubToolArguments(name, argumentsText) {
  try {
    const parsed = JSON.parse(argumentsText || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return argumentsText;

    if (name === "Read") {
      if (parsed.pages === "" || parsed.pages === null) delete parsed.pages;
    }

    if (name === "EnterWorktree") {
      if (parsed.name === "" || parsed.name === null) delete parsed.name;
      if (parsed.path === "" || parsed.path === null) delete parsed.path;

      // Codex sometimes puts an existing absolute path in `name`, or invents a
      // filler `name` while also providing `path`. Claude Code requires at most
      // one of them. Prefer an explicit path because it enters the intended
      // existing worktree instead of creating a new one.
      if (typeof parsed.name === "string" && parsed.name.startsWith("/") && parsed.path === undefined) {
        parsed.path = parsed.name;
        delete parsed.name;
      }
      if (typeof parsed.path === "string" && parsed.path !== "") {
        delete parsed.name;
      }
    }

    return JSON.stringify(parsed);
  } catch {
    return argumentsText;
  }
}

function mapMcpDispatchCall(name, argumentsText) {
  if (!isMcpDispatchName(name)) return { name, argumentsText };
  try {
    const parsed = JSON.parse(argumentsText || "{}");
    if (typeof parsed.name === "string" && parsed.name.startsWith("mcp__")) {
      return {
        name: parsed.name,
        argumentsText: JSON.stringify(parseDispatchInput(parsed)),
      };
    }
  } catch {}
  return { name, argumentsText };
}

function mapToolCall(name, argumentsText) {
  const mapped = mapMcpDispatchCall(name, argumentsText);
  return {
    name: mapped.name,
    argumentsText: scrubToolArguments(mapped.name, mapped.argumentsText),
  };
}

function updateStateFromEvent(state, payload) {
  if (!payload || typeof payload !== "object") return;
  if (payload.response) {
    state.responseId = payload.response.id || state.responseId;
    state.created = payload.response.created_at || state.created;
    state.model = payload.response.model || state.model;
    if (payload.response.usage) state.usage = mapUsage(payload.response.usage);
    if (payload.response.status === "completed") state.finishReason = finishReasonFromState(state);
    if (payload.response.status === "incomplete") state.finishReason = "length";
  }
}

function responsesStreamToChatStream(readable, logger) {
  const encoder = new TextEncoder();
  const state = { toolCalls: new Map(), text: "", usage: undefined, finished: false };
  const emit = (controller, value) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
  const emitToolCall = (controller, index, call) => {
    if (!call || call.emitted) return;
    const mapped = mapToolCall(call.name, call.arguments);
    call.name = mapped.name;
    call.arguments = mapped.argumentsText;
    call.emitted = true;
    emit(
      controller,
      createChatChunk(state, {
        tool_calls: [
          {
            index,
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments },
          },
        ],
      }),
    );
  };
  const emitPendingToolCalls = (controller) => {
    for (const [index, call] of Array.from(state.toolCalls.entries()).sort((a, b) => a[0] - b[0])) {
      emitToolCall(controller, index, call);
    }
  };

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of iterateSSE(readable)) {
          const payload = event.json;
          updateStateFromEvent(state, payload);

          if (payload?.error || event.event === "error") {
            emit(controller, { error: payload?.error || payload || { message: event.raw } });
            continue;
          }

          switch (payload?.type || event.event) {
            case "response.output_text.delta": {
              const text = payload.delta || "";
              state.text += text;
              emit(controller, createChatChunk(state, { content: text }));
              break;
            }
            case "response.output_item.added": {
              const item = payload.item;
              if (item?.type === "function_call") {
                const index = payload.output_index ?? state.toolCalls.size;
                state.toolCalls.set(index, {
                  id: item.call_id,
                  name: item.name,
                  arguments: "",
                  emitted: false,
                });
              }
              break;
            }
            case "response.function_call_arguments.delta": {
              const index = payload.output_index ?? 0;
              const call = state.toolCalls.get(index) || { id: payload.item_id, name: "tool", arguments: "", emitted: false };
              call.arguments += payload.delta || "";
              state.toolCalls.set(index, call);
              break;
            }
            case "response.function_call_arguments.done": {
              const index = payload.output_index ?? 0;
              const call = state.toolCalls.get(index);
              if (call && payload.arguments) call.arguments = payload.arguments;
              emitToolCall(controller, index, call);
              break;
            }
            case "response.reasoning_summary_text.delta": {
              emit(controller, createChatChunk(state, { thinking: { content: payload.delta || "" } }));
              break;
            }
            case "response.completed": {
              state.finished = true;
              emitPendingToolCalls(controller);
              emit(controller, createChatChunk(state, {}, finishReasonFromState(state), state.usage));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              return;
            }
            case "response.failed": {
              state.finished = true;
              emit(controller, { error: payload.response?.error || payload });
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              return;
            }
          }
        }

        if (!state.finished) {
          emitPendingToolCalls(controller);
          emit(controller, createChatChunk(state, {}, finishReasonFromState(state), state.usage));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      } catch (error) {
        logger?.error?.(`codex-oauth stream conversion failed: ${error.message}`);
        controller.error(error);
      }
    },
  });
}

async function responsesStreamToChatJson(readable) {
  const state = { toolCalls: new Map(), text: "", usage: undefined, responseId: undefined, created: undefined, model: undefined };

  for await (const event of iterateSSE(readable)) {
    const payload = event.json;
    updateStateFromEvent(state, payload);
    if (payload?.error || event.event === "error") {
      return { error: payload?.error || payload || { message: event.raw } };
    }
    switch (payload?.type || event.event) {
      case "response.output_text.delta":
        state.text += payload.delta || "";
        break;
      case "response.output_text.done":
        if (typeof payload.text === "string") state.text = payload.text;
        break;
      case "response.output_item.added":
        if (payload.item?.type === "function_call") {
          const index = payload.output_index ?? state.toolCalls.size;
          state.toolCalls.set(index, {
            id: payload.item.call_id,
            type: "function",
            function: { name: payload.item.name, arguments: "" },
          });
        }
        break;
      case "response.function_call_arguments.delta": {
        const index = payload.output_index ?? 0;
        const call = state.toolCalls.get(index) || {
          id: payload.item_id,
          type: "function",
          function: { name: "tool", arguments: "" },
        };
        call.function.arguments += payload.delta || "";
        state.toolCalls.set(index, call);
        break;
      }
      case "response.function_call_arguments.done": {
        const index = payload.output_index ?? 0;
        const call = state.toolCalls.get(index);
        if (call && payload.arguments) call.function.arguments = payload.arguments;
        break;
      }
    }
  }

  const toolCalls = Array.from(state.toolCalls.keys())
    .sort((a, b) => a - b)
    .map((key) => {
      const call = state.toolCalls.get(key);
      const mapped = mapToolCall(call.function.name, call.function.arguments);
      return {
        ...call,
        function: {
          ...call.function,
          name: mapped.name,
          arguments: mapped.argumentsText,
        },
      };
    });

  return {
    id: state.responseId || `chatcmpl_${Date.now()}`,
    object: "chat.completion",
    created: state.created || Math.floor(Date.now() / 1000),
    model: state.model || "gpt-5.4-mini",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: state.text || null,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls.length ? "tool_calls" : "stop",
      },
    ],
    usage: state.usage || mapUsage(),
  };
}

class CodexOAuthTransformer {
  constructor(options = {}) {
    this.options = options;
    this.name = options.name || "codex-oauth";
  }

  async transformRequestIn(body, provider, ctx) {
    const auth = await loadCodexAuth(this.options);
    const settings = loadCodexSettings(this.options);
    const requestBody = chatToResponses(body, { ...this.options, ...settings });
    const headers = {
      Authorization: `Bearer ${auth.access}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      originator: this.options.originator || "claude-code-router",
      "User-Agent": this.options.userAgent || `claude-code-router-codex-oauth (${os.platform()} ${os.release()}; ${os.arch()})`,
    };
    if (auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;

    return {
      body: requestBody,
      config: {
        url: new URL(this.options.endpoint || CODEX_API_ENDPOINT),
        headers,
      },
    };
  }

  async transformResponseOut(response, ctx) {
    const wantsStream = ctx?.req?.body?.stream === true;
    if (wantsStream) {
      return new Response(responsesStreamToChatStream(response.body, this.logger), {
        status: response.status,
        statusText: response.statusText,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const chat = await responsesStreamToChatJson(response.body);
    return new Response(JSON.stringify(chat), {
      status: response.status,
      statusText: response.statusText,
      headers: { "Content-Type": "application/json" },
    });
  }
}

CodexOAuthTransformer.loadCodexAuth = loadCodexAuth;
CodexOAuthTransformer.chatToResponses = chatToResponses;
CodexOAuthTransformer.responsesStreamToChatJson = responsesStreamToChatJson;
CodexOAuthTransformer.loadCodexSettings = loadCodexSettings;

module.exports = CodexOAuthTransformer;

if (require.main === module) {
  (async () => {
    const transformer = new CodexOAuthTransformer();
    const body = {
      model: process.argv[2] || "gpt-5.4-mini",
      stream: false,
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
    };
    const { body: requestBody, config } = await transformer.transformRequestIn(body, { apiKey: DUMMY_KEY }, {});
    const upstream = await fetch(config.url, {
      method: "POST",
      headers: config.headers,
      body: JSON.stringify(requestBody),
    });
    if (!upstream.ok) {
      const text = await upstream.text();
      throw new Error(`Self-test upstream failed: ${upstream.status} ${text}`);
    }
    const converted = await transformer.transformResponseOut(upstream, { req: { body } });
    const result = await converted.json();
    const text = result.choices?.[0]?.message?.content;
    console.log(JSON.stringify({ ok: text === "ok", text, model: result.model }, null, 2));
  })().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
