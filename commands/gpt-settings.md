---
description: Show or change claude-gpt Codex model/reasoning settings
argument-hint: "show | preset max | preset fast | set --model gpt-5.5 --effort xhigh"
---

Run the local claude-gpt settings helper with the provided arguments, then summarize the result.

Command:

```bash
claude-gpt-settings $ARGUMENTS
```

Notes:
- Changes apply on the next claude-gpt request.
- The Claude Code top-left model label may not update until a new session.
- CCR statusline/logs show the actual routed upstream model.
