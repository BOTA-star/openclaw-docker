# RUNBOOK - OpenClaw Claude Handover

## 1. Mục đích

Tài liệu này hướng dẫn cách vận hành nhanh hệ thống OpenClaw Gateway chạy bằng Docker, tích hợp Telegram và skill mail ở mức POC/Test.

Repo này không dùng cho production trực tiếp. Mục tiêu là giúp người nhận bàn giao có thể:

* Tạo file môi trường `.env`.
* Chạy lại OpenClaw Gateway bằng Docker.
* Kiểm tra Gateway, Telegram polling.
* Test skill mail.
* Biết cách xử lý một số lỗi thường gặp.

---

## 2. Yêu cầu trước khi chạy

Máy cần có:

* Docker Desktop.
* Docker Compose v2.
* Git.
* File `.env` đã được tạo từ `.env.example`.
* Telegram Bot Token.
* OpenRouter API Key.
* Email/App Password nếu cần test skill mail.

---

## 3. Chuẩn bị file `.env`

Repo không commit file `.env` vì file này chứa token/API key thật.

Tạo file `.env` từ `.env.example`:

```powershell
Copy-Item .env.example .env
```

Sau đó mở `.env` và điền thông tin thật:

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

Lưu ý:

* Không commit file `.env`.
* Không gửi output có chứa token/API key lên chat hoặc tài liệu public.
* Nếu token/API key bị lộ, cần revoke/regenerate lại.

---

## 4. Kiểm tra Docker Compose

Dùng lệnh sau để kiểm tra cấu hình compose mà không bung secret ra terminal:

```powershell
docker compose config --no-interpolate
```

Không nên dùng `docker compose config` rồi copy toàn bộ output, vì lệnh này có thể hiển thị giá trị thật trong `.env`.

---

## 5. Chạy OpenClaw Gateway

Build và chạy container:

```powershell
docker compose up -d --build
```

Xem log:

```powershell
docker logs -f openclaw
```

Khi chạy thành công, log thường có các dòng:

```txt
[gateway] starting...
[gateway] http server listening
[gateway] ready
[telegram] starting provider
[telegram] isolated polling ingress started
```

Nếu thấy các dòng này, Gateway và Telegram polling đã chạy.

---

## 6. Truy cập Gateway UI

Gateway được map local tại:

```txt
http://127.0.0.1:18789
```

Port đang được giới hạn ở local host để phục vụ test:

```yaml
127.0.0.1:18789:18789
```

---

## 7. Dừng hệ thống

Dừng container:

```powershell
docker compose down
```

Nếu container bị kẹt hoặc restart loop, có thể xóa cưỡng bức:

```powershell
docker rm -f openclaw
```

Sau đó chạy lại:

```powershell
docker compose up -d --build
```

---

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

Nếu `npm ci` lỗi, dùng:

```bash
npm install
```

Chạy skill:

```bash
node index.js
```

Nếu lỗi:

```txt
Cannot find module 'imap-simple'
```

nghĩa là chưa cài dependencies. Chạy lại:

```bash
npm install
```

Sau khi cài, folder `node_modules` có thể sinh ra trong thư mục skill. Không commit folder này lên GitHub.

---

## 9. Kiểm tra Telegram

Sau khi Gateway chạy, gửi tin nhắn vào Telegram bot đã cấu hình.

Kiểm tra log:

```powershell
docker logs -f openclaw
```

Nếu bot nhận được tin nhắn, log thường có dạng:

```txt
[telegram] Inbound message telegram:<user_id> -> @bot_name
```

Nếu bot gửi phản hồi thành công, log có thể có:

```txt
[telegram] sendMessage ok
```

---

## 10. Lỗi thường gặp

### 10.1 Lỗi Missing config

Log:

```txt
Missing config. Run `openclaw setup` or set gateway.mode=local
```

Nguyên nhân thường gặp:

* Docker không mount đúng file config.
* File `config/openclaw.example.json` không tồn tại.
* `docker-compose.yml` mount sai path.

Cần kiểm tra trong `docker-compose.yml` có dòng:

```yaml
volumes:
  - ./config/openclaw.example.json:/root/.openclaw/openclaw.json
```

Sau đó chạy lại:

```powershell
docker compose down
docker compose up -d --build
```

---

### 10.2 Lỗi container restarting

Kiểm tra log:

```powershell
docker logs --tail 200 openclaw
```

Nếu lỗi liên quan config, xử lý theo mục `10.1`.

Nếu lỗi liên quan env, kiểm tra file `.env` đã đủ biến chưa.

---

### 10.3 Lỗi thiếu module Node.js

Log:

```txt
Cannot find module 'imap-simple'
```

Cách xử lý:

```bash
cd /root/.openclaw/workspace/skills/mail
npm install
node index.js
```

---

### 10.4 Warning Gateway binding non-loopback

Log:

```txt
Gateway is binding to a non-loopback address
```

Trong phạm vi POC, warning này chưa phải lỗi nghiêm trọng vì Docker Compose đã giới hạn port host ở `127.0.0.1`.

Nếu triển khai thật, cần kiểm tra lại cấu hình bind, auth token, firewall và quyền truy cập.

---

### 10.5 Warning Telegram menu text exceeded

Log:

```txt
menu text exceeded...
```

Đây không phải lỗi nghiêm trọng. OpenClaw tự rút gọn menu command để phù hợp giới hạn payload Telegram.

---

### 10.6 Warning browser-automation skill bị skip

Log có thể xuất hiện:

```txt
Skipping escaped skill path outside its configured root
```

Warning này liên quan tới skill `browser-automation`. Trong phạm vi POC hiện tại, nếu chỉ test Gateway, Telegram và skill mail thì chưa ảnh hưởng trực tiếp.

---

## 11. Backup

Chạy script backup:

```powershell
.\scripts\backup-openclaw.ps1
```

File backup có thể chứa token, credentials hoặc config thật.

Không upload backup lên GitHub.

---

## 12. Healthcheck nhanh

Chạy script:

```powershell
.\scripts\healthcheck.ps1
```

Script này dùng để kiểm tra nhanh:

* Container Docker.
* Log OpenClaw.
* Port Gateway.

---

## 13. Checklist vận hành nhanh

Trước khi chạy:

* [ ] Đã tạo `.env` từ `.env.example`.
* [ ] Đã điền Telegram Bot Token.
* [ ] Đã điền OpenRouter API Key.
* [ ] Đã điền email/app password nếu cần test mail.
* [ ] Đã chạy `docker compose config --no-interpolate`.
* [ ] Không commit `.env`.

Sau khi chạy:

* [ ] Container `openclaw` đang running.
* [ ] Log có `[gateway] ready`.
* [ ] Log có Telegram polling started.
* [ ] Gateway UI mở được tại `http://127.0.0.1:18789`.
* [ ] Skill mail chạy được sau khi cài dependencies.
* [ ] Đã ghi nhận kết quả test vào `docs/test-log.md`.

---

## 14. Ghi chú bảo mật

Trước khi bàn giao chính thức, nên tạo lại các thông tin đã dùng trong quá trình test:

* OpenRouter API Key.
* Telegram Bot Token.
* Gmail App Password.
* OpenClaw Gateway Token.

Sau khi tạo lại, cập nhật vào `.env` mới và không commit file này.
