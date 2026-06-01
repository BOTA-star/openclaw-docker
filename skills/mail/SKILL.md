---
name: mail
description: Search Gmail emails by filter, summarize the matched email, and send the result to Telegram.
user-invocable: true
---

# Mail Skill

Use this skill when the user asks to check, search, fetch, read, or summarize Gmail emails.

Examples:

- `/skill mail unread`
- `/skill mail latest unread`
- `/skill mail from:abc@gmail.com since:2026-05-18 before:2026-05-25`
  
When invoked, run this command:

```bash
node /root/.openclaw/workspace/skills/mail/index.js "<input>"
```

Where `<input>` is the user input after the skill name, e.g., `unread`, `latest unread`, or `from:`