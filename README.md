# OpenClaw Docker POC

Repo này dùng để chạy thử OpenClaw bằng Docker, kết nối với Telegram Bot và skill đọc/tóm tắt email từ Gmail.

Mục tiêu đơn giản:

```txt
Clone source → điền file cấu hình → chạy Docker → nhắn Telegram để test
```

## 1. Tính năng chính

* Chạy OpenClaw Gateway bằng Docker
* Kết nối Telegram Bot
* Kết nối Gmail qua IMAP
* Tìm email theo người gửi, tiêu đề, nội dung, ngày, trạng thái chưa đọc
* Tóm tắt email bằng AI
* Gửi kết quả về Telegram
* Hỗ trợ đếm số lượng email theo từ khóa, ví dụ: đếm số email có chứa từ “CV”

## 2. Cần chuẩn bị trước

Trước khi cài đặt, cần có:

* Docker Desktop
* Telegram Bot Token
* Telegram User ID
* Gmail App Password
* OpenRouter API Key hoặc API key model AI tương ứng 

## 3. Clone source về máy

Mở PowerShell tại thư mục muốn lưu source, sau đó chạy:

```powershell
git clone https://github.com/BOTA-star/openclaw-docker.git
cd openclaw-docker
```

## 4. Tạo file môi trường `.env`

Chạy lệnh:

```powershell
copy .env.example .env
```

Sau đó mở file `.env` và điền thông tin thật:

```env
# OpenClaw Gateway
OPENCLAW_GATEWAY_TOKEN=replace_with_gateway_token

# Telegram
TELEGRAM_BOT_TOKEN=replace_with_telegram_bot_token
OPENCLAW_TELEGRAM_USER_ID=replace_with_your_telegram_user_id
OPENCLAW_TELEGRAM_OWNER=telegram:replace_with_your_telegram_user_id
TELEGRAM_CHAT_ID=replace_with_telegram_chat_id

# AI Provider
OPENROUTER_API_KEY=replace_with_openrouter_api_key
hoặc
OPENAI_API_KEY=replace_with_openrouter_api_key
OPENROUTER_MODEL=openrouter/openrouter/auto

# Gmail IMAP
EMAIL_USER=replace_with_gmail_address
EMAIL_PASS=replace_with_gmail_app_password

# Local test only
ALLOW_INSECURE_TLS=true
```

Lưu ý:

* Không commit file `.env` lên Git.
* `EMAIL_PASS` là Gmail App Password, không phải mật khẩu Gmail đăng nhập bình thường.
* `OPENCLAW_TELEGRAM_USER_ID` là ID Telegram dạng số.
* `OPENCLAW_TELEGRAM_OWNER` nên có dạng `telegram:<user_id>`.
* `ALLOW_INSECURE_TLS` chỉ `true` vì đang test / demo, không sử dụng trên môi trường produciton.

## 5. Tạo file cấu hình OpenClaw

Chạy lệnh:

```powershell
copy config/openclaw.example.json config/openclaw.json
```

File `openclaw.example.json` là file mẫu.

File `openclaw.json` là file chạy thật ở máy local.

Không nên commit file `openclaw.json` nếu trong đó có thông tin riêng.

## 6. Chạy Docker

Build và chạy container:

```powershell
docker compose up -d --build
```

Xem log để kiểm tra hệ thống chạy chưa:

```powershell
docker logs -f openclaw
```

Dừng hệ thống:

```powershell
docker compose down
```

Khởi động lại container:

```powershell
docker restart openclaw
```

## 7. Cài dependencies cho mail skill

Sau khi clone source mới về, mail skill có thể chưa có thư mục `node_modules`.

Chạy lệnh sau để cài:

```powershell
docker exec -it openclaw sh -lc 'cd /root/.openclaw-docker/skills/mail && npm install'
```

Sau đó restart lại:

```powershell
docker restart openclaw
```

Kiểm tra mail skill đã có `node_modules` chưa:

```powershell
docker exec -it openclaw sh -lc 'test -d /root/.openclaw-docker/skills/mail/node_modules && echo "mail skill OK" || echo "missing node_modules"'
```

Nếu hiện:

```txt
mail skill OK
```

là đã cài thành công.

## 8. Test trên Telegram

Sau khi Docker chạy thành công, mở Telegram và nhắn trực tiếp cho bot.

Có thể test bằng câu ngắn:

```txt
hi
```

Hoặc test mail skill:

```txt
`/skill mail latest unread`
```

Ví dụ tìm email có từ khóa trong 7 ngày gần nhất:

```txt
`/skill mail text:CV newer_than:7d`
```

Ví dụ đếm email có từ khóa CV trong 7 ngày gần nhất:

```txt
`/skill mail count CV newer_than:7d`
```

Nếu bot trả lời lại trên Telegram là hệ thống đã chạy thành công.

## 9. Một số câu lệnh mail skill thường dùng

```txt
latest unread
unread
from:abc@gmail.com
subject:CV
text:CV
newer_than:7d
count CV newer_than:7d
count subject:CV newer_than:7d
```

Có thể nhắn tự nhiên hơn, ví dụ:

```txt
Trong 7 ngày gần nhất có email nào đề cập đến CV không?
```

## 10. Lỗi thường gặp và cách xử lý

### Lỗi 1: OpenClaw access not configured

Thông báo lỗi:

```txt
OpenClaw: access not configured
```

Nguyên nhân thường gặp:

* Telegram user chưa được cấp quyền.
* Chưa cấu hình Telegram User ID.
* Chưa approve pairing code.

Cách xử lý khuyến nghị:

Kiểm tra trong `.env` đã có:

```env
OPENCLAW_TELEGRAM_USER_ID=your_telegram_user_id
OPENCLAW_TELEGRAM_OWNER=telegram:your_telegram_user_id
```

Trong `openclaw.example.json` hoặc `openclaw.json`, Telegram nên có cấu hình:

```json
"dmPolicy": "allowlist",
"allowFrom": [
  "${TELEGRAM_ALLOWED_USER_ID}"
]
```

Sau đó restart:

```powershell
docker restart openclaw
```

Nếu dùng pairing code, approve bằng lệnh:

```powershell
docker exec -it openclaw openclaw pairing approve telegram <PAIRING_CODE>
```

Ví dụ:

```powershell
docker exec -it openclaw openclaw pairing approve telegram GELSJVQZ
```

### Lỗi 2: Mail skill thiếu node_modules

Thông báo lỗi:

```txt
The mail skill script could not be executed because the node_modules directory is missing.
```

Nguyên nhân:

* Sau khi clone source từ Git về, thư mục `node_modules` không được tải về theo.
* Đây là bình thường vì `node_modules` thường không được commit lên Git.

Cách xử lý:

```powershell
docker exec -it openclaw sh -lc 'cd /root/.openclaw-docker/skills/mail && npm install'
docker restart openclaw
```

### Lỗi 3: LLM request timed out

Thông báo lỗi:

```txt
LLM request timed out
Provider finish_reason: error
```

Nguyên nhân thường gặp:

* OpenRouter phản hồi chậm.
* Model `openrouter/openrouter/auto` bị timeout.
* API key sai hoặc hết quota.
* Chưa cấu hình model fallback.

Cách xử lý nhanh:

* Kiểm tra `OPENROUTER_API_KEY` trong `.env`.
* Kiểm tra tài khoản OpenRouter còn quota không.
* Đổi sang model cụ thể thay vì dùng `openrouter/openrouter/auto`.
* Restart container sau khi sửa config:

```powershell
docker restart openclaw
```

### Lỗi 4: No session found

Thông báo log:

```txt
sessions.resolve errorMessage=No session found
```

Nguyên nhân thường gặp:

* Session cũ của web UI hoặc kết nối cũ sau khi restart container.
* Nếu Telegram vẫn nhận và trả lời tin nhắn thì lỗi này có thể bỏ qua.

Cách xử lý nếu cần:

```powershell
docker restart openclaw
```

Sau đó refresh lại trình duyệt hoặc mở tab ẩn danh.

## 11. Checklist trước khi demo

Trước khi demo, chạy nhanh các lệnh sau:

```powershell
docker ps
```

Xem log:

```powershell
docker logs -f openclaw
```

Kiểm tra mail skill:

```powershell
docker exec -it openclaw sh -lc 'test -d /root/.openclaw-docker/skills/mail/node_modules && echo "mail skill OK" || echo "missing node_modules"'
```

Nhắn Telegram:

```txt
hi
```

Nếu bot phản hồi, hệ thống đã sẵn sàng demo.

## 12. Lưu ý bảo mật

Không commit các file/thư mục sau:

```txt
.env
config/openclaw.json
node_modules/
**/node_modules/
workspace/
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
* OpenRouter API Key
* OpenClaw Gateway Token

## 13. Trạng thái dự án

Repo hiện dùng cho mục tiêu POC/test nội bộ.

Chưa phải bản production-ready.
