---
description: Set claude-gpt upstream Codex reasoning effort
argument-hint: "xhigh | high | medium | low | none | show"
---

Set or show the claude-gpt upstream reasoning effort.

If `$ARGUMENTS` is empty or `show`, run:

```bash
claude-gpt-settings show
```

Otherwise run:

```bash
claude-gpt-settings set --effort $ARGUMENTS
```

Then summarize the current effort. Changes apply to the next claude-gpt request.
