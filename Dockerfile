FROM node:22-slim

WORKDIR /app

# Bản cài đặt OpenClaw toàn hệ thống
RUN npm install -g openclaw@latest

# Bắt buộc cài dependencies cho các custom skills của bạn tại đây
RUN npm install imap-simple mailparser

EXPOSE 18789

CMD ["openclaw", "gateway", "--verbose"]