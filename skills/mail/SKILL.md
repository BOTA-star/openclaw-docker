---
name: mail
description: Execute a local Gmail search script to find, count, and summarize emails by sender, date, unread status, subject, body, or keyword. Use this skill when the user asks to check mail, search email, find emails mentioning a keyword, count CV emails, summarize email, or filter Gmail messages.
user-invocable: true
---

# Mail Skill

This skill must execute the local mail script. Do not only print a command.

Use this skill when the user asks to:

* check email
* search Gmail
* find an email by keyword
* find emails mentioning Figma, CV, invoice, meeting, proposal, or any keyword
* count emails matching a keyword
* summarize the latest matching email
* filter by sender, date, unread status, subject, body, or text

## Execution command

Always execute this local shell command exactly one time:

cd /root/.openclaw-docker/skills/mail && node index.js "<FILTER>"

Replace `<FILTER>` with the compact filter converted from the user request.

Never reply with `<skill_command>`.
Never reply with `/skill mail ...`.
Never show the command as text instead of executing it.
Never wrap the command in XML tags.
Never run the command more than one time for the same user request.

## Supported filters

The script supports these filters:

* unread
* latest unread
* earliest unread
* from:abc@gmail.com
* since:2026-05-18
* before:2026-05-25
* newer_than:7d
* subject:Figma
* text:Figma
* body:Figma
* count CV newer_than:7d
* count subject:CV newer_than:7d

## Conversion rules

Convert natural language into a compact filter before executing the script.

User: "Trong vòng 7 ngày gần nhất, có email nào đến hộp thư của tôi đề cập Figma không?"
Filter:
Figma newer_than:7d

User: "Trong 7 ngày gần nhất có mail nào tiêu đề có Figma không?"
Filter:
subject:Figma newer_than:7d

User: "Có email nào nội dung nhắc đến Figma trong 7 ngày gần nhất không?"
Filter:
text:Figma newer_than:7d

User: "Tổng hợp có bao nhiêu CV gửi về trong 7 ngày gần nhất"
Filter:
count CV newer_than:7d

User: "Có bao nhiêu email tiêu đề có CV trong 7 ngày gần nhất?"
Filter:
count subject:CV newer_than:7d

User: "Lấy email mới nhất chưa đọc"
Filter:
latest unread

User: "Tìm mail từ abc@gmail.com từ ngày 2026-05-18 đến trước ngày 2026-05-25"
Filter:
from:abc@gmail.com since:2026-05-18 before:2026-05-25

## Search behavior

* If the user says "đề cập đến <keyword>", use `<keyword> newer_than:<N>d`.
* If the user says "tiêu đề", "subject", or "title", use `subject:<keyword>`.
* If the user says "nội dung", "body", "content", or wants broader search, use `text:<keyword>`.
* If the user asks "bao nhiêu", "tổng hợp", "thống kê", "count", or "how many", add `count` at the beginning.
* If the user asks "trong vòng 7 ngày gần nhất", use `newer_than:7d`.
* If the user asks "trong vòng 30 ngày gần nhất", use `newer_than:30d`.
* If no time range is mentioned, do not invent one.

## Stop rules

* Execute the script only once.
* Do not retry with another filter.
* Do not run additional searches after the script finishes.
* Do not summarize again after the script sends Telegram output.
* Do not send duplicate Telegram messages.
* The script sends the final result to Telegram by itself.
* After the script finishes successfully, reply only: "Đã chạy kiểm tra email."
* If the script returns no result, reply only: "Đã chạy kiểm tra email, không tìm thấy email phù hợp."
* Never expose tokens, passwords, app passwords, API keys, or raw environment variables.

## Execution rule

You must execute the local script before replying.

Command format:

cd /root/.openclaw-docker/skills/mail && node index.js "<FILTER>"

Never claim the email check has been completed unless the command was actually executed.

If you cannot execute the command, reply exactly:

Không chạy được kiểm tra email. Vui lòng dùng lệnh /skill mail <filter>.

## Final response rule

After the script finishes successfully, reply exactly:

Đã chạy kiểm tra email.

Do not say:
- Kiểm tra đã hoàn tất
- Kết quả đã được gửi đến Telegram
- Tôi đã tìm kiếm
- Tôi đã kiểm tra
- Có phải bạn muốn...
- Any additional explanation

## Mail routing rule

When the user asks in Telegram to check, search, count, summarize, or find Gmail emails, always use the `mail` skill.

Examples:
- "Trong vòng 7 ngày gần nhất, có email nào đề cập Figma không?" -> use mail skill with filter: Figma newer_than:7d
- "Có bao nhiêu CV gửi về trong 7 ngày gần nhất?" -> use mail skill with filter: count CV newer_than:7d
- "Tìm mail từ abc@gmail.com trong tháng này" -> use mail skill with the proper sender and date filter

Never answer that the mail check has completed unless the mail skill/script was actually executed.
Never invent email results.
