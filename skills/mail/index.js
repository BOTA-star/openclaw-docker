/**
 * Gmail → OpenRouter AI Summary → Telegram
 *
 * Usage:
 *   node index.js
 *   node index.js "unread"
 *   node index.js "latest unread"
 *   node index.js "earliest unread"
 *   node index.js "from:abc@gmail.com since:2026-05-18 before:2026-05-25"
 *
 * Keyword / subject examples:
 *   node index.js "Figma since:2026-05-27"
 *   node index.js "subject:Figma since:2026-05-27"
 *   node index.js "text:Figma since:2026-05-27"
 *   node index.js "count subject:CV last:7d"
 *   node index.js "bao nhiêu CV trong vòng 7 ngày gần nhất"
 *
 * Default behavior:
 *   - If no filter is provided: lấy email CHƯA ĐỌC MỚI NHẤT
 *   - If multiple emails match: mặc định lấy email MỚI NHẤT
 *
 * Stop mechanism:
 *   - MAIL_RUN_COOLDOWN_SECONDS=30 by default
 *   - If agent retries too quickly, script exits silently to avoid repeated paid calls
 */

if (String(process.env.ALLOW_INSECURE_TLS || "").toLowerCase() === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  console.log("WARNING: TLS certificate verification is disabled.");
}

const fs = require("fs");
const os = require("os");
const path = require("path");
const imaps = require("imap-simple");
const { simpleParser } = require("mailparser");

/* =========================
   CONSTANTS
========================= */

const MAX_EMAIL_CHARS_FOR_AI = 6000;
const MAX_TELEGRAM_MESSAGE_CHARS = 3900;
const DEFAULT_SAMPLE_LIMIT = 8;

/* =========================
   ENV HELPERS
========================= */

function requiredEnv(name) {
  const value = process.env[name];

  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return String(value).trim();
}

function optionalEnv(name, fallback = "") {
  const value = process.env[name];
  return value && String(value).trim() ? String(value).trim() : fallback;
}

function normalizeTelegramChatId(value = "") {
  return String(value).trim().replace(/^telegram:/i, "");
}

/* =========================
   RUN GUARD / STOP MECHANISM
========================= */

function getRunGuardPath() {
  return optionalEnv(
    "MAIL_RUN_GUARD_PATH",
    path.join(os.tmpdir(), "openclaw-mail-skill-run-guard.json")
  );
}

function shouldSkipBecauseRecentlyRan(rawInput = "") {
  const cooldownSeconds = Number(optionalEnv("MAIL_RUN_COOLDOWN_SECONDS", "30"));

  if (!Number.isFinite(cooldownSeconds) || cooldownSeconds <= 0) {
    return false;
  }

  const guardPath = getRunGuardPath();
  const now = Date.now();

  try {
    if (fs.existsSync(guardPath)) {
      const previous = JSON.parse(fs.readFileSync(guardPath, "utf8"));
      const previousStartedAt = Number(previous.startedAt || 0);
      const ageMs = now - previousStartedAt;

      if (ageMs >= 0 && ageMs < cooldownSeconds * 1000) {
        console.log(
          `STOP: Another mail run happened ${Math.round(
            ageMs / 1000
          )}s ago. Cooldown=${cooldownSeconds}s. Skip to prevent retry loop.`
        );
        return true;
      }
    }

    fs.writeFileSync(
      guardPath,
      JSON.stringify(
        {
          startedAt: now,
          pid: process.pid,
          rawInput,
        },
        null,
        2
      ),
      "utf8"
    );
  } catch (err) {
    console.log("Run guard warning:", err.message);
  }

  return false;
}

/* =========================
   IMAP CONFIG
========================= */

function createImapConfig() {
  const allowInsecureTls =
    String(process.env.ALLOW_INSECURE_TLS || "").toLowerCase() === "true";

  return {
    imap: {
      user: requiredEnv("EMAIL_USER"),
      password: requiredEnv("EMAIL_PASS"),
      host: optionalEnv("EMAIL_IMAP_HOST", "imap.gmail.com"),
      port: Number(optionalEnv("EMAIL_IMAP_PORT", "993")),
      tls: true,
      authTimeout: Number(optionalEnv("EMAIL_AUTH_TIMEOUT", "20000")),
      tlsOptions: {
        rejectUnauthorized: !allowInsecureTls,
      },
    },
  };
}

/* =========================
   TEXT CLEANING
========================= */

function decodeHtmlEntities(text = "") {
  return String(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function cleanHtml(html = "") {
  return decodeHtmlEntities(html)
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<head[^>]*>.*?<\/head>/gis, "")
    .replace(/<style[^>]*>.*?<\/style>/gis, "")
    .replace(/<script[^>]*>.*?<\/script>/gis, "")
    .replace(/<!--.*?-->/gs, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizePlainText(text = "") {
  return decodeHtmlEntities(text)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getCleanEmailText(parsed) {
  const plain = normalizePlainText(parsed.text || "");

  if (plain) {
    return plain;
  }

  return cleanHtml(parsed.html || "");
}

function truncateText(text = "", maxChars = 1000) {
  const safeText = String(text || "");

  if (safeText.length <= maxChars) {
    return safeText;
  }

  return `${safeText.slice(0, maxChars).trim()}\n\n...[content truncated]`;
}

/* =========================
   FILTER PARSING
========================= */

function stripKnownCommand(input = "") {
  return String(input)
    .replace(/^\/mail(@\w+)?\s*/i, "")
    .replace(/^\/emailsummarize(@\w+)?\s*/i, "")
    .replace(/^\/skill\s+mail\s*/i, "")
    .replace(/^\/skill\s+emailsummarize\s*/i, "")
    .trim();
}

function formatDateForImap(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  return `${date.getDate()}-${months[date.getMonth()]}-${date.getFullYear()}`;
}

function subtractDaysForImap(days) {
  const safeDays = Number(days);

  if (!Number.isFinite(safeDays) || safeDays <= 0) {
    return null;
  }

  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - safeDays);

  return formatDateForImap(date);
}

function toImapDate(dateStr) {
  if (!dateStr) return null;

  const raw = String(dateStr).trim();

  if (/^\d{1,2}-[a-z]{3}-\d{4}$/i.test(raw)) {
    return raw.replace(
      /^(\d{1,2})-([a-z]{3})-(\d{4})$/i,
      (_, day, mon, year) =>
        `${Number(day)}-${mon.charAt(0).toUpperCase()}${mon
          .slice(1)
          .toLowerCase()}-${year}`
    );
  }

  const vnDate = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (vnDate) {
    const [, dd, mm, yyyy] = vnDate;
    return formatDateForImap(new Date(Number(yyyy), Number(mm) - 1, Number(dd)));
  }

  const isoDate = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoDate) {
    const [, yyyy, mm, dd] = isoDate;
    return formatDateForImap(new Date(Number(yyyy), Number(mm) - 1, Number(dd)));
  }

  const d = new Date(raw);

  if (Number.isNaN(d.getTime())) {
    return null;
  }

  return formatDateForImap(d);
}

function cleanKeyword(value = "") {
  return String(value)
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/[.,?!;:]+$/g, "")
    .trim();
}

function extractRelativeSinceDate(input = "") {
  const text = String(input || "");

  const patterns = [
    /\bnewer_than:(\d+)([dmy])\b/i,
    /\blast:(\d+)([dmy]?)\b/i,
    /\bdays:(\d+)\b/i,
    /last\s+(\d+)\s+days?/i,
    /(?:trong\s+vòng|trong|vòng)\s+(\d+)\s+ngày/i,
    /(\d+)\s+ngày\s+(?:gần nhất|qua|vừa qua|trước)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (!match) continue;

    const value = Number(match[1]);
    const unit = match[2] || "d";

    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }

    const date = new Date();
    date.setHours(0, 0, 0, 0);

    if (unit.toLowerCase() === "d") {
      date.setDate(date.getDate() - value);
    } else if (unit.toLowerCase() === "m") {
      date.setMonth(date.getMonth() - value);
    } else if (unit.toLowerCase() === "y") {
      date.setFullYear(date.getFullYear() - value);
    }

    return formatDateForImap(date);
  }

  return null;
}

function hasCountIntent(input = "") {
  return /\b(count|how many|total|thống kê|thong ke|tổng hợp|tong hop|bao nhiêu|bao nhieu|đếm|dem|số lượng|so luong)\b/i.test(
    input
  );
}

function extractExplicitKeyword(input = "") {
  const text = String(input || "");

  const subjectMatch =
    text.match(/\bsubject:("[^"]+"|'[^']+'|[^\s]+)/i) ||
    text.match(/\btitle:("[^"]+"|'[^']+'|[^\s]+)/i) ||
    text.match(/\btiêu_đề:("[^"]+"|'[^']+'|[^\s]+)/i) ||
    text.match(/\btieu_de:("[^"]+"|'[^']+'|[^\s]+)/i);

  if (subjectMatch) {
    return {
      field: "subject",
      keyword: cleanKeyword(subjectMatch[1]),
    };
  }

  const bodyMatch =
    text.match(/\bbody:("[^"]+"|'[^']+'|[^\s]+)/i) ||
    text.match(/\bcontent:("[^"]+"|'[^']+'|[^\s]+)/i) ||
    text.match(/\bnoi_dung:("[^"]+"|'[^']+'|[^\s]+)/i) ||
    text.match(/\bnội_dung:("[^"]+"|'[^']+'|[^\s]+)/i);

  if (bodyMatch) {
    return {
      field: "body",
      keyword: cleanKeyword(bodyMatch[1]),
    };
  }

  const textMatch =
    text.match(/\btext:("[^"]+"|'[^']+'|[^\s]+)/i) ||
    text.match(/\bkeyword:("[^"]+"|'[^']+'|[^\s]+)/i) ||
    text.match(/\bkw:("[^"]+"|'[^']+'|[^\s]+)/i) ||
    text.match(/\btừ_khóa:("[^"]+"|'[^']+'|[^\s]+)/i) ||
    text.match(/\btu_khoa:("[^"]+"|'[^']+'|[^\s]+)/i);

  if (textMatch) {
    return {
      field: "text",
      keyword: cleanKeyword(textMatch[1]),
    };
  }

  return null;
}

function extractKeywordFromNaturalText(input = "") {
  const original = String(input || "").trim();

  const mentionedMatch = original.match(
    /(?:đề cập|de cap|chứa|chua|liên quan đến|lien quan den|về|ve|keyword|từ khóa|tu khoa)\s+["']?([A-Za-z0-9_.+\-# ]{2,60})["']?/i
  );

  if (mentionedMatch) {
    const candidate = cleanKeyword(
      mentionedMatch[1]
        .replace(/\b(không|khong|ko|chưa|chua|nhỉ|nhi|ạ|a)\b.*$/i, "")
        .trim()
    );

    if (candidate) {
      return candidate;
    }
  }

  const upperTokens = original.match(/\b[A-Z0-9]{2,}\b/g);
  if (upperTokens && upperTokens.length) {
    const ignored = new Set(["ALL", "UNSEEN", "FROM", "SINCE", "BEFORE", "TEXT"]);
    const token = upperTokens.find((item) => !ignored.has(item.toUpperCase()));

    if (token) {
      return token;
    }
  }

  let text = original;

  text = text
    .replace(/\bfrom:[^\s]+/gi, "")
    .replace(/\bsender:[^\s]+/gi, "")
    .replace(/\bsince:[^\s]+/gi, "")
    .replace(/\bafter:[^\s]+/gi, "")
    .replace(/\bbefore:[^\s]+/gi, "")
    .replace(/\bto:[^\s]+/gi, "")
    .replace(/\btu:[^\s]+/gi, "")
    .replace(/\btừ:[^\s]+/gi, "")
    .replace(/\bden:[^\s]+/gi, "")
    .replace(/\bđến:[^\s]+/gi, "")
    .replace(/\bnewer_than:\d+[dmy]\b/gi, "")
    .replace(/\bolder_than:\d+[dmy]\b/gi, "")
    .replace(/\blast:\d+[dmy]?\b/gi, "")
    .replace(/\bdays:\d+\b/gi, "")
    .replace(/\bsubject:("[^"]+"|'[^']+'|[^\s]+)/gi, "")
    .replace(/\btitle:("[^"]+"|'[^']+'|[^\s]+)/gi, "")
    .replace(/\bbody:("[^"]+"|'[^']+'|[^\s]+)/gi, "")
    .replace(/\bcontent:("[^"]+"|'[^']+'|[^\s]+)/gi, "")
    .replace(/\btext:("[^"]+"|'[^']+'|[^\s]+)/gi, "")
    .replace(/\bkeyword:("[^"]+"|'[^']+'|[^\s]+)/gi, "")
    .replace(/\bkw:("[^"]+"|'[^']+'|[^\s]+)/gi, "")
    .replace(/\bunread\b/gi, "")
    .replace(/\bunseen\b/gi, "")
    .replace(/\blatest\b/gi, "")
    .replace(/\bnewest\b/gi, "")
    .replace(/\bearliest\b/gi, "")
    .replace(/\boldest\b/gi, "")
    .replace(/\bmới nhất\b/gi, "")
    .replace(/\bmoi nhat\b/gi, "")
    .replace(/\bsớm nhất\b/gi, "")
    .replace(/\bsom nhat\b/gi, "")
    .replace(/\bchưa đọc\b/gi, "")
    .replace(/\bchua doc\b/gi, "")
    .replace(/\bcount\b/gi, "")
    .replace(/\btổng hợp\b/gi, "")
    .replace(/\btong hop\b/gi, "")
    .replace(/\bbao nhiêu\b/gi, "")
    .replace(/\bbao nhieu\b/gi, "")
    .replace(/\bthống kê\b/gi, "")
    .replace(/\bthong ke\b/gi, "")
    .replace(/(?:trong\s+vòng|trong|vòng)\s+\d+\s+ngày/gi, "")
    .replace(/\d+\s+ngày\s+(?:gần nhất|qua|vừa qua|trước)/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  text = cleanKeyword(text);

  if (!text) {
    return null;
  }

  // Tránh lấy cả câu tiếng Việt quá dài làm keyword.
  if (text.length > 60) {
    return null;
  }

  return text;
}

function parseFilter(input = "") {
  const cleanedInput = stripKnownCommand(input);

  const filter = {
    raw: cleanedInput,
    sender: null,
    sinceDate: null,
    beforeDate: null,
    unreadOnly: false,

    // Giữ behavior mới: mặc định lấy mail mới nhất.
    mode: "latest",

    // NEW: keyword search
    searchField: null, // subject | body | text
    keyword: null,

    // NEW: count/summary mode
    action: hasCountIntent(cleanedInput) ? "count" : "single",
  };

  const fromMatch =
    cleanedInput.match(/\bfrom:([^\s]+)/i) ||
    cleanedInput.match(/\bsender:([^\s]+)/i);

  const sinceMatch =
    cleanedInput.match(/\bsince:([^\s]+)/i) ||
    cleanedInput.match(/\bafter:([^\s]+)/i) ||
    cleanedInput.match(/\btu:([^\s]+)/i) ||
    cleanedInput.match(/\btừ:([^\s]+)/i);

  const beforeMatch =
    cleanedInput.match(/\bbefore:([^\s]+)/i) ||
    cleanedInput.match(/\bto:([^\s]+)/i) ||
    cleanedInput.match(/\bden:([^\s]+)/i) ||
    cleanedInput.match(/\bđến:([^\s]+)/i);

  if (fromMatch) {
    filter.sender = fromMatch[1];
  }

  if (sinceMatch) {
    if (/^\d+[dmy]$/i.test(sinceMatch[1])) {
      filter.sinceDate = extractRelativeSinceDate(cleanedInput);
    } else {
      filter.sinceDate = toImapDate(sinceMatch[1]);
    }
  }

  if (!filter.sinceDate) {
    filter.sinceDate = extractRelativeSinceDate(cleanedInput);
  }

  if (beforeMatch) {
    filter.beforeDate = toImapDate(beforeMatch[1]);
  }

  if (/\b(unread|unseen|chưa đọc|chua doc)\b/i.test(cleanedInput)) {
    filter.unreadOnly = true;
  }

  if (/\b(latest|newest|mới nhất|moi nhat)\b/i.test(cleanedInput)) {
    filter.mode = "latest";
  }

  if (/\b(earliest|oldest|sớm nhất|som nhat|cũ nhất|cu nhat)\b/i.test(cleanedInput)) {
    filter.mode = "earliest";
  }

  const explicitKeyword = extractExplicitKeyword(cleanedInput);

  if (explicitKeyword?.keyword) {
    filter.searchField = explicitKeyword.field;
    filter.keyword = explicitKeyword.keyword;
  } else {
    const naturalKeyword = extractKeywordFromNaturalText(cleanedInput);

    if (naturalKeyword) {
      // Mặc định keyword tự do sẽ tìm trong subject.
      // Ví dụ: "Figma since:2026-05-27" -> SUBJECT Figma
      // Nếu muốn tìm cả subject + body thì dùng text:Figma
      filter.searchField = "subject";
      filter.keyword = naturalKeyword;
    }
  }

  return filter;
}

function buildSearchCriteria(filter) {
  const hasAnyExplicitFilter =
    Boolean(filter.sender) ||
    Boolean(filter.sinceDate) ||
    Boolean(filter.beforeDate) ||
    Boolean(filter.unreadOnly) ||
    Boolean(filter.keyword);

  const criteria = [];

  // Nếu không truyền gì, mặc định lấy email chưa đọc.
  if (!hasAnyExplicitFilter || filter.unreadOnly) {
    criteria.push("UNSEEN");
  } else {
    criteria.push("ALL");
  }

  if (filter.sender) {
    criteria.push(["FROM", filter.sender]);
  }

  if (filter.sinceDate) {
    criteria.push(["SINCE", filter.sinceDate]);
  }

  if (filter.beforeDate) {
    criteria.push(["BEFORE", filter.beforeDate]);
  }

  if (filter.keyword) {
    if (filter.searchField === "body") {
      criteria.push(["BODY", filter.keyword]);
    } else if (filter.searchField === "text") {
      criteria.push(["TEXT", filter.keyword]);
    } else {
      criteria.push(["SUBJECT", filter.keyword]);
    }
  }

  return criteria;
}

/* =========================
   OPENROUTER SUMMARY
========================= */

async function summarize(text = "") {
  const apiKey = optionalEnv("OPENROUTER_API_KEY") || optionalEnv("OPENAI_API_KEY");

  if (!apiKey) {
    console.log("Missing OPENROUTER_API_KEY / OPENAI_API_KEY. Fallback to raw preview.");
    return truncateText(text, 700);
  }

  const baseUrl = optionalEnv("OPENAI_BASE_URL", "https://openrouter.ai/api/v1");
  const model = optionalEnv("OPENROUTER_MODEL", "google/gemini-2.5-flash");

  const maxTokens = Number(optionalEnv("OPENROUTER_MAX_TOKENS", "700"));
  const contentForAi = truncateText(text, MAX_EMAIL_CHARS_FOR_AI);

  try {
    const prompt = `
Bạn là trợ lý tóm tắt email.

Hãy tóm tắt email dưới đây bằng tiếng Việt, ngắn gọn, rõ ý.

Yêu cầu output:
- Mục đích chính của email
- Thông tin quan trọng
- Việc cần làm / cần phản hồi nếu có
- Nếu email không có hành động cần làm, ghi rõ: "Chưa thấy việc cần xử lý ngay"

EMAIL:
${contentForAi}
`.trim();

    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "Bạn tóm tắt email ngắn gọn, chính xác, ưu tiên thông tin cần hành động.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: maxTokens,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.log("OpenRouter error:", JSON.stringify(data, null, 2));
      return truncateText(text, 700);
    }

    return data?.choices?.[0]?.message?.content?.trim() || "Không tạo được tóm tắt.";
  } catch (err) {
    console.log("Summarize error:", err.message);
    return truncateText(text, 700);
  }
}

/* =========================
   TELEGRAM
========================= */

function formatDate(dateValue) {
  if (!dateValue) return "unknown";

  const d = new Date(dateValue);

  if (Number.isNaN(d.getTime())) {
    return String(dateValue);
  }

  return d.toLocaleString("vi-VN", {
    timeZone: optionalEnv("TZ", "Asia/Ho_Chi_Minh"),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSearchInfo(filter) {
  return [
    `Filter: ${filter.raw || "unread"}`,
    `Action: ${filter.action === "count" ? "đếm/tổng hợp" : "lấy 1 email"}`,
    `Search field: ${filter.searchField || "none"}`,
    `Keyword: ${filter.keyword || "none"}`,
    `Mode: ${filter.mode === "latest" ? "mới nhất" : "sớm nhất"}`,
  ].join("\n");
}

function formatEmail(email, filter) {
  return `
📩 EMAIL MATCHED

${formatSearchInfo(filter)}

From: ${email.from}
Subject: ${email.subject}
Date: ${formatDate(email.date)}

Summary:
${email.summary}
`.trim();
}

function formatCountResult({ total, samples, filter }) {
  const sampleText = samples.length
    ? samples
        .map((email, index) => {
          return `${index + 1}. ${formatDate(email.date)}
From: ${email.from}
Subject: ${email.subject}`;
        })
        .join("\n\n")
    : "Không có email mẫu để hiển thị.";

  return `
📊 EMAIL COUNT RESULT

${formatSearchInfo(filter)}

Total matched emails: ${total}

Sample emails:
${sampleText}
`.trim();
}

async function sendTelegram(message) {
  const token = optionalEnv("TELEGRAM_BOT_TOKEN");
  const rawChatId =
    optionalEnv("TELEGRAM_CHAT_ID") || optionalEnv("OPENCLAW_TELEGRAM_OWNER");

  const chatId = normalizeTelegramChatId(rawChatId);

  if (!token || !chatId) {
    console.log(
      "Missing Telegram config: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID/OPENCLAW_TELEGRAM_OWNER are required."
    );
    return;
  }

  const safeMessage = truncateText(message, MAX_TELEGRAM_MESSAGE_CHARS);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: safeMessage,
      disable_web_page_preview: true,
    }),
  });

  const data = await res.json();

  if (!data.ok) {
    console.log("Telegram send error:", JSON.stringify(data, null, 2));
    return;
  }

  console.log("Telegram: SENT");
}

/* =========================
   MAIL PROCESSING
========================= */

function getMailSortValue(result) {
  const uid = Number(result?.attributes?.uid || 0);

  if (uid > 0) {
    return uid;
  }

  const seqNo = Number(result?.seqNo || result?.attributes?.seqno || 0);

  if (seqNo > 0) {
    return seqNo;
  }

  return 0;
}

function sortMails(results = []) {
  return [...results].sort((a, b) => {
    return getMailSortValue(a) - getMailSortValue(b);
  });
}

function pickTargetMail(results, mode = "latest") {
  const sorted = sortMails(results);

  if (mode === "earliest") {
    return sorted[0];
  }

  return sorted[sorted.length - 1];
}

function pickSampleMails(results, mode = "latest", limit = DEFAULT_SAMPLE_LIMIT) {
  const sorted = sortMails(results);

  if (mode === "earliest") {
    return sorted.slice(0, limit);
  }

  return sorted.slice(-limit).reverse();
}

function extractRawEmail(result) {
  const rawPart =
    result?.parts?.find((p) => p.which === "") ||
    result?.parts?.find((p) => p.body);

  return rawPart?.body || "";
}

async function parseEmailFromResult(result) {
  const raw = extractRawEmail(result);

  if (!raw) {
    return {
      from: "unknown",
      subject: "(cannot read raw email)",
      date: "",
      text: "",
    };
  }

  const parsed = await simpleParser(raw);

  return {
    from: parsed.from?.text || "unknown",
    subject: parsed.subject || "(no subject)",
    date: parsed.date || "",
    text: getCleanEmailText(parsed),
  };
}

async function buildCountSamples(results, filter) {
  const sampleLimit = Number(optionalEnv("MAIL_SAMPLE_LIMIT", String(DEFAULT_SAMPLE_LIMIT)));
  const safeLimit = Number.isFinite(sampleLimit) && sampleLimit > 0 ? sampleLimit : DEFAULT_SAMPLE_LIMIT;

  const sampleMails = pickSampleMails(results, filter.mode, safeLimit);
  const samples = [];

  for (const item of sampleMails) {
    const parsed = await parseEmailFromResult(item);
    samples.push({
      from: parsed.from,
      subject: parsed.subject,
      date: parsed.date,
    });
  }

  return samples;
}

/* =========================
   MAIN
========================= */

async function run() {
  let connection;

  try {
    const rawArg = process.argv.slice(2).join(" ").trim();

    if (shouldSkipBecauseRecentlyRan(rawArg)) {
      return;
    }

    const filter = parseFilter(rawArg);
    const searchCriteria = buildSearchCriteria(filter);

    console.log("Raw input:", rawArg || "(empty)");
    console.log("Parsed filter:", filter);
    console.log("Search criteria:", JSON.stringify(searchCriteria));

    console.log("Connecting IMAP...");
    connection = await imaps.connect(createImapConfig());

    await connection.openBox("INBOX");
    console.log("INBOX opened");

    const results = await connection.search(searchCriteria, {
      bodies: [""],
      markSeen: false,
    });

    console.log("Matched emails:", results.length);

    if (!results.length) {
      const noMailMessage = `Không tìm thấy email phù hợp với filter: ${
        filter.raw || "unread"
      }`;

      console.log(noMailMessage);
      await sendTelegram(noMailMessage);
      return;
    }

    console.log("Pick mode:", filter.mode);
    console.log("Action:", filter.action);

    if (filter.action === "count") {
      const samples = await buildCountSamples(results, filter);

      const countMessage = formatCountResult({
        total: results.length,
        samples,
        filter,
      });

      await sendTelegram(countMessage);
      console.log("DONE");
      return;
    }

    const targetMail = pickTargetMail(results, filter.mode);
    const parsed = await parseEmailFromResult(targetMail);

    if (!parsed.text) {
      const emptyMessage =
        "Tìm thấy email nhưng nội dung email rỗng hoặc không parse được.";

      console.log(emptyMessage);
      await sendTelegram(emptyMessage);
      return;
    }

    const summary = await summarize(parsed.text);

    const email = {
      from: parsed.from,
      subject: parsed.subject,
      date: parsed.date,
      summary,
    };

    console.log("Selected email:", {
      from: email.from,
      subject: email.subject,
      date: email.date,
    });

    const message = formatEmail(email, filter);

    await sendTelegram(message);

    console.log("DONE");
  } catch (err) {
    console.error("FATAL:", err);

    try {
      await sendTelegram(`Lỗi khi xử lý email: ${err.message}`);
    } catch (sendErr) {
      console.error("Cannot send error to Telegram:", sendErr.message);
    }

    process.exitCode = 1;
  } finally {
    if (connection) {
      try {
        connection.end();
      } catch (err) {
        console.log("Connection close warning:", err.message);
      }
    }
  }
}

run();
