# OpenClaw Docker POC

Repo này dùng để chạy thử OpenClaw Gateway bằng Docker, tích hợp Telegram Bot và skill đọc/tóm tắt email từ Gmail.

Mục tiêu: clone repo → tạo file môi trường → chạy Docker → test Telegram + mail skill.

## Tính năng chính

* Chạy OpenClaw Gateway bằng Docker
* Kết nối Telegram Bot
* Kết nối Gmail qua IMAP
* Tìm email theo filter: người gửi, ngày, trạng thái chưa đọc, từ khóa, tiêu đề, nội dung
* Tóm tắt email bằng AI
* Gửi kết quả về Telegram
* Hỗ trợ đếm email theo từ khóa, ví dụ số lượng CV gửi về

## Cấu trúc thư mục

```txt
.
├─ config/
│  └─ openclaw.example.json
├─ docs/
├─ scripts/
├─ skills/
│  └─ mail/
│     ├─ index.js
│     ├─ package.json
│     └─ SKILL.md
├─ .env.example
├─ docker-compose.yml
├─ Dockerfile
├─ README.md
└─ RUNBOOK.md
```

## Yêu cầu trước khi chạy

Cần có:

* Docker Desktop
* Telegram Bot Token
* Telegram User ID hoặc Chat ID
* Gmail App Password
* API key cho model AI, ví dụ OpenRouter hoặc Google AI Studio/Gemini

## Cài đặt

Clone repo:

```powershell
git clone https://github.com/BOTA-star/openclaw-docker.git
cd openclaw-docker
```

Tạo file môi trường:

```powershell
Copy-Item .env.example .env
```

Mở file `.env` và điền thông tin thật:

```env
# OpenClaw Gateway
OPENCLAW_GATEWAY_TOKEN=replace_with_gateway_token

# Telegram
TELEGRAM_BOT_TOKEN=replace_with_telegram_bot_token
TELEGRAM_ALLOWED_USER_ID=replace_with_your_telegram_user_id
OPENCLAW_TELEGRAM_OWNER=telegram:replace_with_your_telegram_user_id
TELEGRAM_CHAT_ID=replace_with_telegram_chat_id

# AI Provider - OpenRouter
OPENROUTER_API_KEY=replace_with_openrouter_api_key
OPENAI_API_KEY=replace_with_openrouter_api_key
OPENAI_BASE_URL=
OPENROUTER_MODEL=replace_with_your model

# Gmail IMAP
EMAIL_USER=replace_with_gmail_address
EMAIL_PASS=replace_with_gmail_app_password

# Local test only
ALLOW_INSECURE_TLS=true

# Optional
# OPENROUTER_MAX_TOKENS=700

# MAIL_RUN_COOLDOWN_SECONDS=30

# MAIL_SAMPLE_LIMIT=8

# EMAIL_IMAP_HOST=imap.gmail.com

# EMAIL_IMAP_PORT=993

# EMAIL_AUTH_TIMEOUT=20000

## Chạy Docker

Build và chạy container:

```powershell
docker compose up -d --build
```

Xem log:

```powershell
docker logs -f openclaw
```

Dừng container:

```powershell
docker compose down
```

## Kiểm tra skill mail

Vào container:

```powershell
docker exec -it openclaw bash
```

Di chuyển vào thư mục skill:

```bash
cd /root/.openclaw/workspace/skills/mail
```

Cài dependencies nếu cần:

```bash
npm ci
```

Test lấy email mới nhất chưa đọc:

```bash
node index.js "latest unread"
```

Test tìm email theo từ khóa trong 7 ngày gần nhất:

```bash
node index.js "<keyword> newer_than:7d"
```

Test tìm theo tiêu đề:

```bash
node index.js "subject:<keyword> newer_than:7d"
```

Test tìm trong tiêu đề + nội dung:

```bash
node index.js "text:<keyword> newer_than:7d"
```

Test đếm email có từ khóa CV trong 7 ngày gần nhất:

```bash
node index.js "count CV newer_than:7d"
```

## Test trên Telegram

Sau khi bot đã chạy, có thể nhắn trực tiếp:

```txt
`/skill mail <keyword> newer_than:7d`
```

Hoặc:

```txt
`/skill mail count CV newer_than:7d`
```

Ví dụ câu tự nhiên:

```txt
Trong vòng 7 ngày gần nhất, có email nào đến hộp thư của tôi đề cập <keyword> không?
```

Kết quả sẽ được gửi về Telegram.

## Một số filter hỗ trợ

```txt
unread
latest unread
earliest unread
from:abc@gmail.com
since:2026-05-18
before:2026-05-25
newer_than:7d
subject:<keyword>
text:<keyword>
body:<keyword>
count <keyword> newer_than:7d
count subject:<keyword> newer_than:7d
```

## Lưu ý bảo mật

Không commit các file hoặc thư mục sau:

```txt
.env
workspace/
node_modules/
**/node_modules/
backups/
logs/
credentials/
*.log
*.sqlite
*.sqlite-shm
*.sqlite-wal
```

Trước khi bàn giao hoặc public repo, nên tạo lại:

* Telegram Bot Token
* Gmail App Password
* AI API Key
* OpenClaw Gateway Token

## Troubleshooting nhanh

Kiểm tra container:

```powershell
docker ps
```

Kiểm tra OpenClaw có nhận skill mail chưa:

```powershell
docker exec -it openclaw sh -lc "openclaw skills list | grep mail"
```

Nếu Telegram báo `Unknown skill: mail`, kiểm tra lại:

```txt
skills/mail/SKILL.md
config/openclaw.example.json
docker-compose.yml
```

Nếu lỗi model/API, kiểm tra lại API key trong `.env`.

Nếu lỗi certificate khi test local, giữ:

```env
ALLOW_INSECURE_TLS=true
```

## Trạng thái

Repo hiện phục vụ mục tiêu POC/test nội bộ, chưa phải production-ready.
