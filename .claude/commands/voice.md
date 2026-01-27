---
description: Toggle voice notifications on/off
allowed-tools: Bash
---

Toggle voice notifications on or off.

First, check the current state by reading the voice_enabled file:

```bash
cat ~/.claude/voice_enabled 2>/dev/null || echo "1"
```

If the result is "1" (or file doesn't exist), voice is currently ON. To disable it, run:
```bash
echo "0" > ~/.claude/voice_enabled
```
Then tell the user: "Voice notifications disabled."

If the result is "0", voice is currently OFF. To enable it, run:
```bash
echo "1" > ~/.claude/voice_enabled
```
Then tell the user: "Voice notifications enabled."
