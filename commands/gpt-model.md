---
description: Set claude-gpt upstream Codex model
argument-hint: "gpt-5.5 | gpt-5.4 | gpt-5.4-mini | show"
---

Set or show the claude-gpt upstream model.

If `$ARGUMENTS` is empty or `show`, run:

```bash
claude-gpt-settings show
```

Otherwise run:

```bash
claude-gpt-settings set --model $ARGUMENTS
```

Then summarize the current model. Changes apply to the next claude-gpt request.
