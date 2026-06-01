# OpenClaw Claude Handover

Repo này dùng để bàn giao POC triển khai OpenClaw Gateway bằng Docker, tích hợp kênh Telegram và thử nghiệm skill mail.

Mục tiêu của repo là giúp người nhận bàn giao có thể clone source, tạo file môi trường, chạy lại OpenClaw Gateway bằng Docker và kiểm thử skill đã chuẩn bị.

## 1. Trạng thái hiện tại

Hệ thống hiện đang ở mức POC/Test, chưa phải production-ready.

Đã hoàn thành:

* Triển khai OpenClaw Gateway bằng Docker.
* Cấu hình gateway chạy qua port `18789`.
* Cấu hình Telegram bot qua biến môi trường.
* Cấu hình OpenRouter API qua biến môi trường.
* Gateway đã khởi động thành công.
* Telegram polling đã chạy.
* Skill mail đã chạy thử sau khi cài dependencies.

Cần kiểm tra/phát triển thêm:

* Độ ổn định API/model.
* Quota hoặc giới hạn từ OpenRouter/API provider.
* Hoàn thiện thêm security hardening.
* Hoàn thiện thêm quy trình backup/restore.
* Kênh Zalo hiện chưa chốt, nên Telegram đang được dùng làm kênh test chính.

## 2. Cấu trúc thư mục

```txt
openclaw-claude-handover/
├─ config/
│  ├─ openclaw.example.json
│  ├─ SOUL.md
│  └─ TOOLS.md
├─ docs/
│  ├─ test-log.md
│  └─ known-issues.md
├─ scripts/
│  ├─ backup-openclaw.ps1
│  └─ healthcheck.ps1
├─ skills/
│  └─ mail/
│     ├─ index.js
│     ├─ package.json
│     ├─ package-lock.json
│     ├─ skill.json
│     └─ SKILL.md
├─ .env.example
├─ .gitignore
├─ docker-compose.yml
├─ Dockerfile
├─ HANDOVER.md
├─ README.md
└─ RUNBOOK.md
```

## 3. Các file không được commit

Không commit các file/thư mục sau vì có thể chứa token, credentials, log, session hoặc runtime state:

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

## 4. Chuẩn bị file môi trường

Repo không commit file `.env`. Người nhận bàn giao cần tự tạo file `.env` từ `.env.example`.

Trên Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Sau đó mở file `.env` và điền thông tin thật:

```env
OPENCLAW_GATEWAY_TOKEN=replace_with_gateway_token

TELEGRAM_BOT_TOKEN=replace_with_telegram_bot_token
OPENCLAW_TELEGRAM_OWNER=telegram:replace_with_your_telegram_user_id
TELEGRAM_CHAT_ID=replace_with_your_telegram_chat_id

OPENROUTER_API_KEY=replace_with_openrouter_api_key
OPENCLAW_MODEL=openai/gemini-2.5-flash

EMAIL_USER=replace_with_email_user
EMAIL_PASS=replace_with_email_app_password
```

Lưu ý: Không upload hoặc commit file `.env` lên GitHub.

## 5. Kiểm tra Docker Compose

Chạy lệnh:

```powershell
docker compose config --no-interpolate
```

Lệnh này giúp kiểm tra cấu hình compose mà không bung giá trị secret thật ra terminal.

Không nên gửi hoặc chụp toàn bộ output của lệnh `docker compose config` nếu trong đó có token/API key thật.

## 6. Chạy OpenClaw Gateway

Build và chạy container:

```powershell
docker compose up -d --build
```

Xem log:

```powershell
docker logs -f openclaw
```

Log chạy thành công thường có các dòng tương tự:

```txt
[gateway] starting...
[gateway] http server listening
[gateway] ready
[telegram] starting provider
[telegram] isolated polling ingress started
```

Dừng container:

```powershell
docker compose down
```

## 7. Truy cập Gateway UI

Gateway được map local tại:

```txt
http://127.0.0.1:18789
```

Port trong `docker-compose.yml` đang giới hạn ở `127.0.0.1` để phục vụ môi trường test local.

## 8. Test skill mail

Vào container:

```powershell
docker exec -it openclaw bash
```

Di chuyển tới thư mục skill mail:

```bash
cd /root/.openclaw/workspace/skills/mail
```

Cài dependencies:

```bash
npm ci
```

Nếu `npm ci` lỗi thì dùng:

```bash
npm install
```

Chạy skill:

```bash
node index.js
```

Lưu ý: Không commit thư mục `node_modules`.

## 9. Một số warning đã ghi nhận

### Gateway binding warning

Có thể xuất hiện warning:

```txt
Gateway is binding to a non-loopback address
```

Trong phạm vi POC, warning này chưa phải lỗi nghiêm trọng vì Docker Compose đã giới hạn port host ở `127.0.0.1`.

### Telegram menu text warning

Có thể xuất hiện warning:

```txt
menu text exceeded...
```

Đây không phải lỗi nghiêm trọng. OpenClaw tự rút gọn menu command để phù hợp giới hạn payload.

### Browser automation skill warning

Có thể xuất hiện warning liên quan `browser-automation` bị skip do symlink/path escape. Warning này không ảnh hưởng đến phạm vi test hiện tại nếu chỉ kiểm thử Gateway, Telegram và skill mail.

## 10. Backup

Script backup nằm tại:

```txt
scripts/backup-openclaw.ps1
```

Chạy backup:

```powershell
.\scripts\backup-openclaw.ps1
```

File backup có thể chứa credentials/token nên không được upload lên GitHub.

## 11. Ghi chú bảo mật

Một số token/API key đã từng được dùng trong quá trình test. Trước khi bàn giao chính thức, cần tạo lại các thông tin sau:

* OpenRouter API key.
* Telegram Bot Token.
* Gmail App Password.
* OpenClaw Gateway Token.

Sau khi tạo lại, cập nhật vào file `.env` mới và không commit file này.

## 12. Kết luận

Repo hiện phục vụ mục tiêu bàn giao POC. Người nhận có thể clone repo, tạo `.env`, chạy Docker Compose, kiểm tra Gateway, Telegram polling và test skill mail.

Hệ thống chưa được xác nhận production-ready, cần tiếp tục kiểm thử thêm về bảo mật, quyền truy cập, độ ổn định model/API và quy trình vận hành thực tế.
