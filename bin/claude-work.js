#!/usr/bin/env node
// Cross-platform launcher: direct Claude Code / work-plan routing.

const { spawn } = require("node:child_process");

const env = { ...process.env };
delete env.ANTHROPIC_BASE_URL;
delete env.ANTHROPIC_AUTH_TOKEN;
delete env.ANTHROPIC_API_KEY;
delete env.DISABLE_COST_WARNINGS;

const child = spawn("claude", process.argv.slice(2), {
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
